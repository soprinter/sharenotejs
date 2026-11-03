/**
 * Pool accounting events: invoices and miner payout shares.
 *
 * Covers the Unpaid/Settled invoice pair ({@link SharenoteKind.UnpaidInvoice} /
 * {@link SharenoteKind.SettledInvoice}) and the pending → finalized → paid share
 * lifecycle ({@link SharenoteKind.PendingShare} / {@link SharenoteKind.FinalizedShare} /
 * {@link SharenoteKind.SharePayment}). Block and share identifiers are blake2b-256
 * hashes, matching the Go and Python reference SDKs byte-for-byte.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { SharenoteError } from "../errors.js";
import { is32ByteHex } from "../hex.js";
import { SharenoteKind, type Tags } from "../kinds.js";
import {
  type Settlement,
  buildSettlementTag,
  parseSettlementTag,
} from "./settlement.js";

/** Parse a decimal string into an exact `bigint`, throwing on malformed input. */
function parseBigInt(value: string, field: string): bigint {
  try {
    return BigInt(value.trim());
  } catch {
    throw new SharenoteError(`${field} is not an integer: "${value}"`);
  }
}

/** A pool's declaration of a secured block's reward (kinds 35500/35501). */
export interface Invoice {
  /** The block anchor: blake2b-256 of the height integer (the `d` tag). */
  heightHash: string;
  /** 32-byte hex block hash. */
  blockHash: string;
  /** Block height; MUST be greater than zero. */
  height: number;
  /**
   * Total block reward available, in the coin's base unit (its smallest unit;
   * satoshi on Bitcoin as an example). A `bigint` for exact round-trip across
   * the full int64 range (decision D4).
   */
  amount: bigint;
  /** Number of participating workers. */
  workers: bigint;
  /** The pool's combined difficulty label (a display floor, never verified). */
  shares: string;
  /** The payout settlement, or `null` while unsettled. */
  settlement: Settlement | null;
}

/** A per-miner payout slice (kinds 35503/35504/35505). */
export interface Share {
  /** `Hash(height, address, worker)` while pending, `Hash(height, address)` once finalized. */
  shareId: string;
  /** The miner's chain receiving address. */
  address: string;
  /** The block anchor: blake2b-256 of the height integer. */
  heightHash: string;
  /** 32-byte hex block hash. */
  blockHash: string;
  /** Hex chain ID; defaults to `"15"` when absent. */
  chainId: string;
  /** One or more worker names merged into this slice. */
  workers: string[];
  /** Block height; MUST be greater than zero. */
  height: number;
  /**
   * The miner's payout amount, in the coin's base unit (its smallest unit;
   * satoshi on Bitcoin as an example). A `bigint` for exact round-trip (D4).
   */
  amount: bigint;
  /** The miner's difficulty label (a display floor). */
  shares: string;
  /** The miner's sharenote count. */
  shareCount: bigint;
  /** The pool's aggregate difficulty label. */
  totalShares: string;
  /** The pool's total sharenote count. */
  totalShareCount: bigint;
  /** Creation time in milliseconds since the Unix epoch. */
  timestamp: number;
  /**
   * Transaction fee deducted from the payout, in the coin's base unit (its
   * smallest unit; satoshi on Bitcoin as an example). A `bigint` (D4).
   */
  fee: bigint;
  /** Estimated block height at which payment will occur. */
  estPaymentHeight: number;
  /** References to Raw Sharenote minting events (kind 35510) by event id. */
  sharenoteEventIds: string[];
  /** The payout settlement, or `null` while unsettled. */
  settlement: Settlement | null;
}

/** Create an {@link Invoice}, filling defaults for any omitted field. */
export function createInvoice(partial?: Partial<Invoice>): Invoice {
  return {
    heightHash: "",
    blockHash: "",
    height: 0,
    amount: 0n,
    workers: 0n,
    shares: "",
    settlement: null,
    ...partial,
  };
}

/** Create a {@link Share}, filling defaults for any omitted field. */
export function createShare(partial?: Partial<Share>): Share {
  return {
    shareId: "",
    address: "",
    heightHash: "",
    blockHash: "",
    chainId: "",
    workers: [],
    height: 0,
    amount: 0n,
    shares: "",
    shareCount: 0n,
    totalShares: "",
    totalShareCount: 0n,
    timestamp: 0,
    fee: 0n,
    estPaymentHeight: 0,
    sharenoteEventIds: [],
    settlement: null,
    ...partial,
  };
}

function blake2b256Hex(data: string): string {
  // blake2b with dkLen 32 is true blake2b-256 (a distinct IV from blake2b-512
  // truncated to 32 bytes), matching Go x/crypto/blake2b and Python hashlib.
  return bytesToHex(blake2b(new TextEncoder().encode(data), { dkLen: 32 }));
}

/** The block anchor `HeightHash` = blake2b-256 of the height integer. */
export function computeHeightHash(height: number): string {
  return blake2b256Hex(String(height));
}

/** A pending share's `ShareID` = `Hash(height, address, worker)`. */
export function computePendingShareId(
  height: number,
  address: string,
  worker: string
): string {
  return blake2b256Hex(`${height}/${address}/${worker}`);
}

/** A finalized/paid share's `ShareID` = `Hash(height, address)`. */
export function computeFinalizedShareId(height: number, address: string): string {
  return blake2b256Hex(`${height}/${address}`);
}

/** Encode an {@link Invoice} as Nostr event tags. */
export function buildInvoiceTags(invoice: Invoice): Tags {
  const tags: string[][] = [
    ["d", invoice.heightHash],
    ["b", invoice.blockHash],
    ["height", String(invoice.height)],
    ["amount", String(invoice.amount)],
    ["workers", String(invoice.workers)],
  ];
  if (invoice.shares) tags.push(["shares", invoice.shares]);
  if (invoice.settlement) tags.push(buildSettlementTag(invoice.settlement));
  return tags;
}

/** Decode Nostr event tags into an {@link Invoice}. */
export function parseInvoiceTags(tags: Tags): Invoice {
  const invoice = createInvoice();
  for (const tag of tags) {
    if (tag.length < 2) continue;
    const [key, value] = tag;
    if (key === "d") invoice.heightHash = value;
    else if (key === "b") invoice.blockHash = value;
    else if (key === "height") invoice.height = Number.parseInt(value, 10);
    else if (key === "amount") invoice.amount = parseBigInt(value, "amount");
    else if (key === "workers") invoice.workers = parseBigInt(value, "workers");
    else if (key === "shares") invoice.shares = value;
    else if (key === "x") invoice.settlement = parseSettlementTag(tag);
  }
  return invoice;
}

/**
 * Encode a {@link Share} as Nostr event tags.
 *
 * Pass `kind` to enforce the kind-specific constraints at build time. A
 * {@link SharenoteKind.SharePayment} (35505) MUST carry an explicit `chain`
 * (decision D5 / NIP-SN A13): building one without `chainId` throws rather than
 * silently defaulting.
 *
 * @throws a {@link SharenoteError} when `kind` is `SharePayment` and `chainId`
 * is empty.
 */
export function buildShareTags(share: Share, kind?: SharenoteKind): Tags {
  if (kind === SharenoteKind.SharePayment && !share.chainId) {
    throw new SharenoteError("share payment requires a chain tag (A13)");
  }
  const tags: string[][] = [
    ["d", share.shareId],
    ["a", share.address],
    ["h", share.heightHash],
    ["b", share.blockHash],
  ];
  if (share.chainId) tags.push(["chain", share.chainId]);
  tags.push(["workers", ...share.workers]);
  tags.push(["height", String(share.height)]);
  tags.push(["amount", String(share.amount)]);

  if (share.shares) {
    const tag = ["shares", share.shares];
    if (share.shareCount > 0n) tag.push(String(share.shareCount));
    tags.push(tag);
  }
  if (share.totalShares) {
    const tag = ["totalshares", share.totalShares];
    if (share.totalShareCount > 0n) tag.push(String(share.totalShareCount));
    tags.push(tag);
  }

  tags.push(["timestamp", String(share.timestamp)]);
  if (share.fee) tags.push(["fee", String(share.fee)]);
  if (share.estPaymentHeight) tags.push(["eph", String(share.estPaymentHeight)]);
  for (const eventId of share.sharenoteEventIds) {
    if (eventId.trim()) tags.push(["sn", eventId]);
  }
  if (share.settlement) tags.push(buildSettlementTag(share.settlement));
  return tags;
}

/** Decode Nostr event tags into a {@link Share}. */
export function parseShareTags(tags: Tags): Share {
  const share = createShare();
  for (const tag of tags) {
    if (tag.length < 2) continue;
    const [key, value] = tag;
    if (key === "d") share.shareId = value;
    else if (key === "a") share.address = value;
    else if (key === "h") share.heightHash = value;
    else if (key === "b") share.blockHash = value;
    else if (key === "chain") share.chainId = value;
    else if (key === "workers") share.workers = tag.slice(1);
    else if (key === "height") share.height = Number.parseInt(value, 10);
    else if (key === "amount") share.amount = parseBigInt(value, "amount");
    else if (key === "shares") {
      share.shares = value;
      if (tag.length >= 3) share.shareCount = parseBigInt(tag[2], "shares count");
    } else if (key === "totalshares") {
      share.totalShares = value;
      if (tag.length >= 3) share.totalShareCount = parseBigInt(tag[2], "totalshares count");
    } else if (key === "timestamp") share.timestamp = Number.parseInt(value, 10);
    else if (key === "fee") share.fee = parseBigInt(value, "fee");
    else if (key === "eph") share.estPaymentHeight = Number.parseInt(value, 10);
    else if (key === "sn") share.sharenoteEventIds.push(...tag.slice(1));
    else if (key === "x") share.settlement = parseSettlementTag(tag);
  }
  return share;
}

/**
 * Validate an {@link Invoice} against the NIP-SN MUST-set: block anchors and
 * amount (A7) and, for a {@link SharenoteKind.SettledInvoice}, a confirmed
 * full-form settlement (A8). The `d` HeightHash MUST equal
 * `blake2b-256(height)`, the block hash MUST be 32-byte hex, `height` MUST be
 * greater than zero, and `amount` MUST be positive. Throws a
 * {@link SharenoteError} on the first violation.
 *
 * @param kind the invoice kind; pass {@link SharenoteKind.SettledInvoice} to
 *   enforce the A8 settlement requirement.
 */
export function validateInvoice(invoice: Invoice, kind?: SharenoteKind): void {
  if (invoice.height <= 0) {
    throw new SharenoteError("height must be greater than zero");
  }
  const expected = computeHeightHash(invoice.height);
  if (invoice.heightHash !== expected) {
    throw new SharenoteError(
      `height hash mismatch: expected ${expected}, got ${invoice.heightHash}`
    );
  }
  if (!is32ByteHex(invoice.blockHash)) {
    throw new SharenoteError("block hash must be 32-byte hex");
  }
  if (invoice.amount <= 0n) {
    throw new SharenoteError("amount must be positive");
  }
  if (
    kind === SharenoteKind.SettledInvoice &&
    (!invoice.settlement || !invoice.settlement.confirmed)
  ) {
    throw new SharenoteError("settled invoice requires a full-form settlement (A8)");
  }
}

/**
 * Validate a {@link Share} against the NIP-SN MUST-set for the given kind: block
 * anchor and workers (A9), the `ShareID` coordinate (A10), and — for a
 * {@link SharenoteKind.SharePayment} — a required `chain` tag and a confirmed
 * full-form settlement (A13 / decision D5, no silent default). `HeightHash`
 * MUST equal `blake2b-256(height)`, the block hash MUST be 32-byte hex, at least
 * one worker MUST be present, and the `ShareID` MUST equal the kind's expected
 * hash. Throws a {@link SharenoteError} on the first violation.
 */
export function validateShare(share: Share, kind: SharenoteKind): void {
  if (share.height <= 0) {
    throw new SharenoteError("height must be greater than zero");
  }
  const expected = computeHeightHash(share.height);
  if (share.heightHash !== expected) {
    throw new SharenoteError(
      `height hash mismatch: expected ${expected}, got ${share.heightHash}`
    );
  }
  if (!is32ByteHex(share.blockHash)) {
    throw new SharenoteError("block hash must be 32-byte hex");
  }
  if (!share.workers.length) {
    throw new SharenoteError("at least one worker is required");
  }

  let expectedId: string;
  if (kind === SharenoteKind.PendingShare) {
    expectedId = computePendingShareId(share.height, share.address, share.workers[0]);
  } else if (
    kind === SharenoteKind.FinalizedShare ||
    kind === SharenoteKind.SharePayment
  ) {
    expectedId = computeFinalizedShareId(share.height, share.address);
  } else {
    throw new SharenoteError(`unknown share kind: ${kind}`);
  }

  if (share.shareId !== expectedId) {
    throw new SharenoteError(
      `shareID mismatch: expected ${expectedId}, got ${share.shareId}`
    );
  }

  if (kind === SharenoteKind.SharePayment) {
    if (!share.chainId) {
      throw new SharenoteError("share payment requires a chain tag (A13)");
    }
    if (!share.settlement || !share.settlement.confirmed) {
      throw new SharenoteError("share payment requires a full-form settlement (A13)");
    }
  }
}
