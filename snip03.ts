/**
 * SNIP-03: Pool Accounting Event Helpers (Kinds 35500-35505).
 *
 * Provides types and marshal/unmarshal functions for pool invoices
 * and miner payout share events.
 */

export const KIND_INVOICE = 35500;
export const KIND_SETTLED_INVOICE = 35501;
export const KIND_PENDING_SHARE = 35503;
export const KIND_FINALIZED_SHARE = 35504;
export const KIND_SHARE_PAYMENT = 35505;

import { blake2b } from "@noble/hashes/blake2.js";

export type Tags = string[][];

export interface Transaction {
  txid: string;
  confirmed: boolean;
  blockHeight: number;
  blockHash: string;
}

export interface Invoice {
  heightHash: string;
  blockHash: string;
  height: number;
  amount: number;
  workers: number;
  shares: string;
  tx: Transaction | null;
}

export interface Share {
  shareId: string;
  address: string;
  heightHash: string;
  blockHash: string;
  chainId: string;
  workers: string[];
  height: number;
  amount: number;
  shares: string;
  shareCount: number;
  totalShares: string;
  totalShareCount: number;
  timestamp: number;
  fee: number;
  estPaymentHeight: number;
  sharenoteEventIds: string[];
  tx: Transaction | null;
}

export function createTransaction(partial?: Partial<Transaction>): Transaction {
  return { txid: "", confirmed: false, blockHeight: 0, blockHash: "", ...partial };
}

export function createInvoice(partial?: Partial<Invoice>): Invoice {
  return {
    heightHash: "", blockHash: "", height: 0, amount: 0,
    workers: 0, shares: "", tx: null, ...partial,
  };
}

export function createShare(partial?: Partial<Share>): Share {
  return {
    shareId: "", address: "", heightHash: "", blockHash: "",
    chainId: "", workers: [], height: 0, amount: 0,
    shares: "", shareCount: 0, totalShares: "", totalShareCount: 0,
    timestamp: 0, fee: 0, estPaymentHeight: 0,
    sharenoteEventIds: [], tx: null, ...partial,
  };
}

// --- blake2b-256 helpers ---

function blake2b256Hex(data: string): string {
  // blake2b with dkLen:32 is true blake2b-256 (different IV from blake2b512 truncated).
  const bytes = blake2b(new TextEncoder().encode(data), { dkLen: 32 });
  return Buffer.from(bytes).toString("hex");
}

export function computeHeightHash(height: number): string {
  return blake2b256Hex(String(height));
}

export function computePendingShareId(height: number, address: string, worker: string): string {
  return blake2b256Hex(`${height}/${address}/${worker}`);
}

export function computePaymentShareId(height: number, address: string): string {
  return blake2b256Hex(`${height}/${address}`);
}

// --- Invoice ---

export function marshalInvoiceTags(inv: Invoice): Tags {
  const tags: Tags = [
    ["d", inv.heightHash],
    ["b", inv.blockHash],
    ["height", String(inv.height)],
    ["amount", String(inv.amount)],
    ["workers", String(inv.workers)],
  ];
  if (inv.shares) tags.push(["shares", inv.shares]);
  if (inv.tx) tags.push(marshalTx(inv.tx));
  return tags;
}

export function unmarshalInvoiceTags(tags: Tags): Invoice {
  const inv = createInvoice();
  for (const tag of tags) {
    if (tag.length < 2) continue;
    const [k, v] = tag;
    if (k === "d") inv.heightHash = v;
    else if (k === "b") inv.blockHash = v;
    else if (k === "height") inv.height = parseInt(v, 10);
    else if (k === "amount") inv.amount = parseInt(v, 10);
    else if (k === "workers") inv.workers = parseInt(v, 10);
    else if (k === "shares") inv.shares = v;
    else if (k === "x") inv.tx = unmarshalTx(tag);
  }
  return inv;
}

// --- Share ---

export function marshalShareTags(s: Share): Tags {
  const tags: Tags = [
    ["d", s.shareId],
    ["a", s.address],
    ["h", s.heightHash],
    ["b", s.blockHash],
  ];

  if (s.chainId) tags.push(["chain", s.chainId]);
  tags.push(["workers", ...s.workers]);
  tags.push(["height", String(s.height)]);
  tags.push(["amount", String(s.amount)]);

  if (s.shares) {
    const shareTag = ["shares", s.shares];
    if (s.shareCount > 0) shareTag.push(String(s.shareCount));
    tags.push(shareTag);
  }

  if (s.totalShares) {
    const totalTag = ["totalshares", s.totalShares];
    if (s.totalShareCount > 0) totalTag.push(String(s.totalShareCount));
    tags.push(totalTag);
  }

  tags.push(["timestamp", String(s.timestamp)]);

  if (s.fee) tags.push(["fee", String(s.fee)]);
  if (s.estPaymentHeight) tags.push(["eph", String(s.estPaymentHeight)]);

  for (const eid of s.sharenoteEventIds) {
    if (eid.trim()) tags.push(["sn", eid]);
  }

  if (s.tx) tags.push(marshalTx(s.tx));
  return tags;
}

export function unmarshalShareTags(tags: Tags): Share {
  const s = createShare();
  for (const tag of tags) {
    if (tag.length < 2) continue;
    const [k, v] = tag;
    if (k === "d") s.shareId = v;
    else if (k === "a") s.address = v;
    else if (k === "h") s.heightHash = v;
    else if (k === "b") s.blockHash = v;
    else if (k === "chain") s.chainId = v;
    else if (k === "workers") s.workers = tag.slice(1);
    else if (k === "height") s.height = parseInt(v, 10);
    else if (k === "amount") s.amount = parseInt(v, 10);
    else if (k === "shares") {
      s.shares = v;
      if (tag.length >= 3) s.shareCount = parseInt(tag[2], 10);
    } else if (k === "totalshares") {
      s.totalShares = v;
      if (tag.length >= 3) s.totalShareCount = parseInt(tag[2], 10);
    } else if (k === "timestamp") s.timestamp = parseInt(v, 10);
    else if (k === "fee") s.fee = parseInt(v, 10);
    else if (k === "eph") s.estPaymentHeight = parseInt(v, 10);
    else if (k === "sn") s.sharenoteEventIds.push(...tag.slice(1));
    else if (k === "x") s.tx = unmarshalTx(tag);
  }
  return s;
}

// --- Validation ---

export function validateInvoice(inv: Invoice): void {
  if (inv.height <= 0) throw new Error("height must be greater than zero");
  const expected = computeHeightHash(inv.height);
  if (inv.heightHash !== expected) {
    throw new Error(`height hash mismatch: expected ${expected}, got ${inv.heightHash}`);
  }
  if (inv.amount <= 0) throw new Error("amount must be positive");
}

export function validateShare(s: Share, kind: number): void {
  if (s.height <= 0) throw new Error("height must be greater than zero");
  const expected = computeHeightHash(s.height);
  if (s.heightHash !== expected) {
    throw new Error(`height hash mismatch: expected ${expected}, got ${s.heightHash}`);
  }
  if (!s.workers.length) throw new Error("at least one worker is required");

  let expectedId: string;
  if (kind === KIND_PENDING_SHARE) {
    expectedId = computePendingShareId(s.height, s.address, s.workers[0]);
  } else if (kind === KIND_FINALIZED_SHARE || kind === KIND_SHARE_PAYMENT) {
    expectedId = computePaymentShareId(s.height, s.address);
  } else {
    throw new Error(`unknown share kind: ${kind}`);
  }

  if (s.shareId !== expectedId) {
    throw new Error(`shareID mismatch: expected ${expectedId}, got ${s.shareId}`);
  }
}

// --- Transaction helpers ---

function marshalTx(tx: Transaction): string[] {
  if (tx.confirmed) {
    return ["x", tx.txid, String(tx.blockHeight), tx.blockHash];
  }
  return ["x", tx.txid];
}

function unmarshalTx(tag: string[]): Transaction {
  const tx = createTransaction({ txid: tag[1] });
  if (tag.length >= 4 && tag[3]) {
    const height = parseInt(tag[2], 10);
    if (!isNaN(height)) {
      tx.blockHeight = height;
      tx.blockHash = tag[3];
      tx.confirmed = true;
    }
  }
  return tx;
}
