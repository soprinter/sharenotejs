import { describe, expect, it } from "vitest";

import {
  SharenoteError,
  SharenoteKind,
  type Settlement,
  buildInvoiceTags,
  parseInvoiceTags,
  buildShareTags,
  parseShareTags,
  validateInvoice,
  validateShare,
  computeHeightHash,
  computePendingShareId,
  computeFinalizedShareId,
  createInvoice,
  createShare,
  pendingSettlement,
  confirmedSettlement,
} from "../src/index";

/** A valid 32-byte (64-hex-char) block hash for A7/A9 block-anchor checks. */
const BH = "00".repeat(32);

describe("accounting kinds", () => {
  it("exposes the invoice and share kinds", () => {
    expect(SharenoteKind.UnpaidInvoice).toBe(35500);
    expect(SharenoteKind.SettledInvoice).toBe(35501);
    expect(SharenoteKind.PendingShare).toBe(35503);
    expect(SharenoteKind.FinalizedShare).toBe(35504);
    expect(SharenoteKind.SharePayment).toBe(35505);
  });
});

describe("hash identifiers", () => {
  it("computes a deterministic blake2b-256 height hash matching Go/Python", () => {
    expect(computeHeightHash(843000)).toBe(computeHeightHash(843000));
    expect(computeHeightHash(843000)).toHaveLength(64);
    expect(computeHeightHash(843000)).toBe(
      "9d83d89f11bc0b930935e9a58e93ac1e43cdcaf25e8e4d68dc4c96763208f479"
    );
    expect(computeHeightHash(1)).not.toBe(computeHeightHash(2));
  });

  it("varies share ids by their inputs", () => {
    expect(computePendingShareId(100, "a", "rig01")).toBe(computePendingShareId(100, "a", "rig01"));
    expect(computePendingShareId(100, "a", "rig01")).not.toBe(computePendingShareId(100, "a", "rig02"));
    expect(computePendingShareId(100, "a", "w")).not.toBe(computePendingShareId(101, "a", "w"));
    expect(computeFinalizedShareId(100, "a")).toHaveLength(64);
    expect(computeFinalizedShareId(100, "a")).not.toBe(computeFinalizedShareId(100, "b"));
  });
});

describe("invoices", () => {
  it("builds and omits optional tags", () => {
    const full = buildInvoiceTags(
      createInvoice({ heightHash: "aabb", blockHash: "ccdd", height: 100, amount: 5000n, workers: 3n, shares: "34z10" })
    );
    expect(full).toEqual(
      expect.arrayContaining([["d", "aabb"], ["b", "ccdd"], ["height", "100"], ["amount", "5000"], ["workers", "3"], ["shares", "34z10"]])
    );

    const minimal = buildInvoiceTags(createInvoice({ heightHash: "a", blockHash: "b", height: 1, amount: 1n, workers: 1n }));
    expect(minimal.find((t) => t[0] === "shares")).toBeUndefined();
    expect(minimal.find((t) => t[0] === "x")).toBeUndefined();
  });

  it("encodes settlement in short and full form", () => {
    const unconfirmed = buildInvoiceTags(
      createInvoice({ heightHash: "a", blockHash: "b", height: 1, amount: 1n, workers: 1n, settlement: pendingSettlement("txid123") })
    );
    expect(unconfirmed).toContainEqual(["x", "txid123"]);

    const confirmed = buildInvoiceTags(
      createInvoice({ heightHash: "a", blockHash: "b", height: 1, amount: 1n, workers: 1n, settlement: confirmedSettlement("txid123", 50, "bh") })
    );
    expect(confirmed).toContainEqual(["x", "txid123", "50", "bh"]);
  });

  it("parses, skipping short and unknown tags", () => {
    const inv = parseInvoiceTags([["d"], ["d", "hh"], ["b", "bh"], ["height", "100"], ["amount", "5000"], ["workers", "3"], ["shares", "34z10"], ["unknown", "x"]]);
    expect(inv).toMatchObject({ heightHash: "hh", blockHash: "bh", height: 100, amount: 5000n, workers: 3n, shares: "34z10" });
  });

  it("round-trips with a confirmed settlement", () => {
    const inv = createInvoice({
      heightHash: computeHeightHash(100), blockHash: "ab".repeat(32), height: 100, amount: 5000n, workers: 2n,
      settlement: confirmedSettlement("ff".repeat(32), 101, "cd".repeat(32)),
    });
    const parsed = parseInvoiceTags(buildInvoiceTags(inv));
    const s = parsed.settlement as Extract<Settlement, { confirmed: true }>;
    expect(s.confirmed).toBe(true);
    expect(s.txid).toBe("ff".repeat(32));
    expect(s.blockHeight).toBe(101);
  });

  it("treats a tx with an empty block hash as unconfirmed", () => {
    const inv = parseInvoiceTags([["d", "h"], ["x", "txid123", "50", ""]]);
    expect(inv.settlement?.confirmed).toBe(false);
  });

  it("validates", () => {
    expect(() => validateInvoice(createInvoice({ heightHash: computeHeightHash(100), blockHash: BH, height: 100, amount: 5000n }))).not.toThrow();
    expect(() => validateInvoice(createInvoice({ height: 0, amount: 5000n }))).toThrow("height must be greater than zero");
    expect(() => validateInvoice(createInvoice({ heightHash: "wrong", height: 100, amount: 5000n }))).toThrow("height hash mismatch");
    expect(() => validateInvoice(createInvoice({ heightHash: computeHeightHash(100), blockHash: "deadbeef", height: 100, amount: 5000n }))).toThrow("block hash must be 32-byte hex");
    expect(() => validateInvoice(createInvoice({ heightHash: computeHeightHash(100), blockHash: BH, height: 100, amount: 0n }))).toThrow("amount must be positive");
  });

  it("requires a full-form settlement for a settled invoice (A8)", () => {
    const base = createInvoice({ heightHash: computeHeightHash(100), blockHash: BH, height: 100, amount: 5000n });
    expect(() => validateInvoice(base, SharenoteKind.SettledInvoice)).toThrow("full-form settlement");
    expect(() => validateInvoice({ ...base, settlement: pendingSettlement("tx") }, SharenoteKind.SettledInvoice)).toThrow("full-form settlement");
    expect(() =>
      validateInvoice({ ...base, settlement: confirmedSettlement("tx", 101, BH) }, SharenoteKind.SettledInvoice)
    ).not.toThrow();
  });
});

describe("shares", () => {
  it("builds the full tag set in order", () => {
    const tags = buildShareTags(
      createShare({
        shareId: "sid", address: "addr", heightHash: "hh", blockHash: "bh", chainId: "15",
        workers: ["rig01", "rig02"], height: 100, amount: 1000n, shares: "33z53", shareCount: 5n,
        totalShares: "34z10", totalShareCount: 20n, timestamp: 1700000000, fee: 100n, estPaymentHeight: 200,
        sharenoteEventIds: ["ev1", "ev2"],
      })
    );
    expect(tags).toEqual(
      expect.arrayContaining([
        ["d", "sid"], ["a", "addr"], ["h", "hh"], ["b", "bh"], ["chain", "15"],
        ["workers", "rig01", "rig02"], ["shares", "33z53", "5"], ["totalshares", "34z10", "20"],
        ["timestamp", "1700000000"], ["fee", "100"], ["eph", "200"], ["sn", "ev1"], ["sn", "ev2"],
      ])
    );
  });

  it("omits optional tags and skips blank event ids", () => {
    const tags = buildShareTags(
      createShare({ shareId: "s", address: "a", heightHash: "h", blockHash: "b", workers: ["w"], height: 1, amount: 1n, shares: "33z53", sharenoteEventIds: ["ev1", "  ", "", "ev2"] })
    );
    expect(tags.find((t) => t[0] === "chain")).toBeUndefined();
    expect(tags.find((t) => t[0] === "fee")).toBeUndefined();
    expect(tags.find((t) => t[0] === "eph")).toBeUndefined();
    expect(tags.find((t) => t[0] === "shares")).toEqual(["shares", "33z53"]);
    expect(tags.filter((t) => t[0] === "sn")).toHaveLength(2);
  });

  it("parses counts and collects multiple sn tags", () => {
    const s = parseShareTags([
      ["d", "sid"], ["a", "addr"], ["h", "hh"], ["b", "bh"], ["workers", "w1", "w2"],
      ["height", "1"], ["amount", "1"], ["shares", "33z53", "5"], ["totalshares", "34z10", "20"],
      ["timestamp", "0"], ["sn", "ev1"], ["sn", "ev2", "ev3"], ["unknown", "v"],
    ]);
    expect(s.shareCount).toBe(5n);
    expect(s.totalShareCount).toBe(20n);
    expect(s.workers).toEqual(["w1", "w2"]);
    expect(s.sharenoteEventIds).toEqual(["ev1", "ev2", "ev3"]);
  });

  it("round-trips a pending share", () => {
    const share = createShare({
      shareId: computePendingShareId(100, "addr1", "rig01"), address: "addr1", heightHash: computeHeightHash(100),
      blockHash: "ab".repeat(32), workers: ["rig01"], height: 100, amount: 1000n, shares: "33z53", shareCount: 5n,
      timestamp: 1700000000, fee: 100n, sharenoteEventIds: ["event1", "event2"],
      settlement: pendingSettlement("cc".repeat(32)),
    });
    const parsed = parseShareTags(buildShareTags(share));
    expect(parsed.shareId).toBe(share.shareId);
    expect(parsed.fee).toBe(100n);
    expect(parsed.sharenoteEventIds).toEqual(["event1", "event2"]);
    expect(parsed.settlement?.confirmed).toBe(false);
  });

  it("validates by kind", () => {
    const pending = createShare({ shareId: computePendingShareId(100, "a", "rig01"), heightHash: computeHeightHash(100), blockHash: BH, height: 100, address: "a", workers: ["rig01"] });
    expect(() => validateShare(pending, SharenoteKind.PendingShare)).not.toThrow();

    const finalized = createShare({ shareId: computeFinalizedShareId(100, "a"), heightHash: computeHeightHash(100), blockHash: BH, height: 100, address: "a", workers: ["rig01"] });
    expect(() => validateShare(finalized, SharenoteKind.FinalizedShare)).not.toThrow();

    expect(() => validateShare(createShare({ height: 0, workers: ["w"] }), SharenoteKind.PendingShare)).toThrow("height must be greater than zero");
    expect(() => validateShare(createShare({ heightHash: "wrong", height: 100, workers: ["w"] }), SharenoteKind.PendingShare)).toThrow("height hash mismatch");
    expect(() => validateShare(createShare({ heightHash: computeHeightHash(100), blockHash: "deadbeef", height: 100, workers: ["w"] }), SharenoteKind.PendingShare)).toThrow("block hash must be 32-byte hex");
    expect(() => validateShare(createShare({ heightHash: computeHeightHash(100), blockHash: BH, height: 100 }), SharenoteKind.PendingShare)).toThrow("at least one worker");
    expect(() => validateShare(createShare({ shareId: "wrong", heightHash: computeHeightHash(100), blockHash: BH, height: 100, address: "a", workers: ["rig01"] }), SharenoteKind.PendingShare)).toThrow("shareID mismatch");
    expect(() => validateShare(finalized, 99999 as SharenoteKind)).toThrow("unknown share kind");
  });

  it("requires a chain tag and full-form settlement for a share payment (A13/D5)", () => {
    const base = createShare({ shareId: computeFinalizedShareId(100, "a"), heightHash: computeHeightHash(100), blockHash: BH, height: 100, address: "a", workers: ["rig01"] });
    // No chain tag → rejected (no silent default).
    expect(() => validateShare(base, SharenoteKind.SharePayment)).toThrow("chain tag");
    // Chain present but no confirmed settlement → rejected.
    expect(() => validateShare({ ...base, chainId: "15" }, SharenoteKind.SharePayment)).toThrow("full-form settlement");
    // Chain + confirmed full-form settlement → accepted.
    expect(() =>
      validateShare({ ...base, chainId: "15", settlement: confirmedSettlement("tx", 101, BH) }, SharenoteKind.SharePayment)
    ).not.toThrow();
    // The builder also requires the chain for a payment.
    expect(() => buildShareTags(base, SharenoteKind.SharePayment)).toThrow("chain tag");
    expect(() => buildShareTags({ ...base, chainId: "15" }, SharenoteKind.SharePayment)).not.toThrow();
  });
});
