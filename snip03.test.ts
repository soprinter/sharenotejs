import { describe, it, expect } from "vitest";
import {
  marshalInvoiceTags, unmarshalInvoiceTags,
  marshalShareTags, unmarshalShareTags,
  validateInvoice, validateShare,
  computeHeightHash, computePendingShareId, computePaymentShareId,
  createInvoice, createShare, createTransaction,
  KIND_INVOICE, KIND_SETTLED_INVOICE,
  KIND_PENDING_SHARE, KIND_FINALIZED_SHARE, KIND_SHARE_PAYMENT,
} from "./snip03";

describe("snip03", () => {
  describe("constants", () => {
    it("exports correct kind values", () => {
      expect(KIND_INVOICE).toBe(35500);
      expect(KIND_SETTLED_INVOICE).toBe(35501);
      expect(KIND_PENDING_SHARE).toBe(35503);
      expect(KIND_FINALIZED_SHARE).toBe(35504);
      expect(KIND_SHARE_PAYMENT).toBe(35505);
    });
  });

  describe("hash functions", () => {
    it("computeHeightHash is deterministic", () => {
      const h1 = computeHeightHash(843000);
      const h2 = computeHeightHash(843000);
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);
    });

    it("computeHeightHash differs for different heights", () => {
      expect(computeHeightHash(1)).not.toBe(computeHeightHash(2));
    });

    it("computeHeightHash is hex", () => {
      const h = computeHeightHash(100);
      expect(() => BigInt(`0x${h}`)).not.toThrow();
    });

    it("computePendingShareId is deterministic", () => {
      const id1 = computePendingShareId(100, "addr1", "rig01");
      const id2 = computePendingShareId(100, "addr1", "rig01");
      expect(id1).toBe(id2);
    });

    it("computePendingShareId varies by worker", () => {
      expect(computePendingShareId(100, "addr1", "rig01"))
        .not.toBe(computePendingShareId(100, "addr1", "rig02"));
    });

    it("computePendingShareId varies by address", () => {
      expect(computePendingShareId(100, "a", "rig01"))
        .not.toBe(computePendingShareId(100, "b", "rig01"));
    });

    it("computePendingShareId varies by height", () => {
      expect(computePendingShareId(1, "a", "w"))
        .not.toBe(computePendingShareId(2, "a", "w"));
    });

    it("computePaymentShareId is deterministic", () => {
      const id1 = computePaymentShareId(100, "addr1");
      const id2 = computePaymentShareId(100, "addr1");
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(64);
    });

    it("computePaymentShareId varies by address", () => {
      expect(computePaymentShareId(100, "a")).not.toBe(computePaymentShareId(100, "b"));
    });

    it("computePaymentShareId varies by height", () => {
      expect(computePaymentShareId(1, "a")).not.toBe(computePaymentShareId(2, "a"));
    });

    it("cross-library: produces blake2b-256 consistent with Go/Python", () => {
      // Correct blake2b-256("843000") = 9d83d89f... (verified against Python hashlib.blake2b(digest_size=32) and Go x/crypto/blake2b.New256)
      // The OLD wrong implementation used blake2b512 truncated to 32 bytes, which produces a DIFFERENT hash (6ef93a9c...)
      const h = computeHeightHash(843000);
      expect(h).toBe("9d83d89f11bc0b930935e9a58e93ac1e43cdcaf25e8e4d68dc4c96763208f479");
    });
  });

  describe("invoice marshal", () => {
    it("full invoice tags", () => {
      const inv = createInvoice({
        heightHash: "aabb", blockHash: "ccdd",
        height: 100, amount: 5000, workers: 3, shares: "34z10",
      });
      const tags = marshalInvoiceTags(inv);
      expect(tags).toContainEqual(["d", "aabb"]);
      expect(tags).toContainEqual(["b", "ccdd"]);
      expect(tags).toContainEqual(["height", "100"]);
      expect(tags).toContainEqual(["amount", "5000"]);
      expect(tags).toContainEqual(["workers", "3"]);
      expect(tags).toContainEqual(["shares", "34z10"]);
    });

    it("omits shares when empty", () => {
      const tags = marshalInvoiceTags(createInvoice({
        heightHash: "a", blockHash: "b", height: 1, amount: 1, workers: 1,
      }));
      expect(tags.find(t => t[0] === "shares")).toBeUndefined();
    });

    it("omits tx when null", () => {
      const tags = marshalInvoiceTags(createInvoice({
        heightHash: "a", blockHash: "b", height: 1, amount: 1, workers: 1,
      }));
      expect(tags.find(t => t[0] === "x")).toBeUndefined();
    });

    it("unconfirmed tx format", () => {
      const tags = marshalInvoiceTags(createInvoice({
        heightHash: "a", blockHash: "b", height: 1, amount: 1, workers: 1,
        tx: createTransaction({ txid: "txid123" }),
      }));
      expect(tags).toContainEqual(["x", "txid123"]);
    });

    it("confirmed tx format", () => {
      const tags = marshalInvoiceTags(createInvoice({
        heightHash: "a", blockHash: "b", height: 1, amount: 1, workers: 1,
        tx: createTransaction({ txid: "txid123", confirmed: true, blockHeight: 50, blockHash: "bh" }),
      }));
      expect(tags).toContainEqual(["x", "txid123", "50", "bh"]);
    });
  });

  describe("invoice unmarshal", () => {
    it("skips short tags", () => {
      const inv = unmarshalInvoiceTags([["d"], ["d", "hash"]]);
      expect(inv.heightHash).toBe("hash");
    });

    it("all fields parsed", () => {
      const inv = unmarshalInvoiceTags([
        ["d", "hh"], ["b", "bh"], ["height", "100"],
        ["amount", "5000"], ["workers", "3"], ["shares", "34z10"],
      ]);
      expect(inv.heightHash).toBe("hh");
      expect(inv.blockHash).toBe("bh");
      expect(inv.height).toBe(100);
      expect(inv.amount).toBe(5000);
      expect(inv.workers).toBe(3);
      expect(inv.shares).toBe("34z10");
    });

    it("unknown tags ignored", () => {
      const inv = unmarshalInvoiceTags([["d", "hh"], ["unknown", "val"]]);
      expect(inv.heightHash).toBe("hh");
    });
  });

  describe("invoice round-trip", () => {
    it("without tx", () => {
      const inv = createInvoice({
        heightHash: computeHeightHash(843000), blockHash: "00".repeat(32),
        height: 843000, amount: 625000000, workers: 5, shares: "34z10",
      });
      const parsed = unmarshalInvoiceTags(marshalInvoiceTags(inv));
      expect(parsed.heightHash).toBe(inv.heightHash);
      expect(parsed.height).toBe(843000);
      expect(parsed.amount).toBe(625000000);
      expect(parsed.shares).toBe("34z10");
      expect(parsed.tx).toBeNull();
    });

    it("with confirmed tx", () => {
      const inv = createInvoice({
        heightHash: computeHeightHash(100), blockHash: "ab".repeat(32),
        height: 100, amount: 5000, workers: 2,
        tx: createTransaction({
          txid: "ff".repeat(32), confirmed: true, blockHeight: 101, blockHash: "cd".repeat(32),
        }),
      });
      const parsed = unmarshalInvoiceTags(marshalInvoiceTags(inv));
      expect(parsed.tx!.txid).toBe("ff".repeat(32));
      expect(parsed.tx!.confirmed).toBe(true);
      expect(parsed.tx!.blockHeight).toBe(101);
    });

    it("with unconfirmed tx", () => {
      const inv = createInvoice({
        heightHash: "h", blockHash: "b", height: 1, amount: 1, workers: 1,
        tx: createTransaction({ txid: "abc" }),
      });
      const parsed = unmarshalInvoiceTags(marshalInvoiceTags(inv));
      expect(parsed.tx!.txid).toBe("abc");
      expect(parsed.tx!.confirmed).toBe(false);
    });

    it("minimal invoice", () => {
      const inv = createInvoice({ heightHash: "h", blockHash: "b", height: 1, amount: 1, workers: 1 });
      const parsed = unmarshalInvoiceTags(marshalInvoiceTags(inv));
      expect(parsed.height).toBe(1);
      expect(parsed.shares).toBe("");
      expect(parsed.tx).toBeNull();
    });
  });

  describe("share marshal", () => {
    it("full share tags", () => {
      const s = createShare({
        shareId: "sid", address: "addr", heightHash: "hh", blockHash: "bh",
        chainId: "15", workers: ["rig01", "rig02"], height: 100, amount: 1000,
        shares: "33z53", shareCount: 5, totalShares: "34z10", totalShareCount: 20,
        timestamp: 1700000000, fee: 100, estPaymentHeight: 200,
        sharenoteEventIds: ["ev1", "ev2"],
      });
      const tags = marshalShareTags(s);
      expect(tags).toContainEqual(["d", "sid"]);
      expect(tags).toContainEqual(["a", "addr"]);
      expect(tags).toContainEqual(["h", "hh"]);
      expect(tags).toContainEqual(["b", "bh"]);
      expect(tags).toContainEqual(["chain", "15"]);
      expect(tags).toContainEqual(["workers", "rig01", "rig02"]);
      expect(tags).toContainEqual(["height", "100"]);
      expect(tags).toContainEqual(["amount", "1000"]);
      expect(tags).toContainEqual(["shares", "33z53", "5"]);
      expect(tags).toContainEqual(["totalshares", "34z10", "20"]);
      expect(tags).toContainEqual(["timestamp", "1700000000"]);
      expect(tags).toContainEqual(["fee", "100"]);
      expect(tags).toContainEqual(["eph", "200"]);
      expect(tags).toContainEqual(["sn", "ev1"]);
      expect(tags).toContainEqual(["sn", "ev2"]);
    });

    it("omits chain when empty", () => {
      const tags = marshalShareTags(createShare({
        shareId: "s", address: "a", heightHash: "h", blockHash: "b",
        workers: ["w"], height: 1, amount: 1,
      }));
      expect(tags.find(t => t[0] === "chain")).toBeUndefined();
    });

    it("omits fee when zero", () => {
      const tags = marshalShareTags(createShare({
        shareId: "s", address: "a", heightHash: "h", blockHash: "b",
        workers: ["w"], height: 1, amount: 1,
      }));
      expect(tags.find(t => t[0] === "fee")).toBeUndefined();
    });

    it("omits eph when zero", () => {
      const tags = marshalShareTags(createShare({
        shareId: "s", address: "a", heightHash: "h", blockHash: "b",
        workers: ["w"], height: 1, amount: 1,
      }));
      expect(tags.find(t => t[0] === "eph")).toBeUndefined();
    });

    it("shares without count", () => {
      const tags = marshalShareTags(createShare({
        shareId: "s", address: "a", heightHash: "h", blockHash: "b",
        workers: ["w"], height: 1, amount: 1, shares: "33z53",
      }));
      const sharesTag = tags.find(t => t[0] === "shares")!;
      expect(sharesTag).toEqual(["shares", "33z53"]);
    });

    it("whitespace event ids skipped", () => {
      const tags = marshalShareTags(createShare({
        shareId: "s", address: "a", heightHash: "h", blockHash: "b",
        workers: ["w"], height: 1, amount: 1,
        sharenoteEventIds: ["ev1", "  ", "", "ev2"],
      }));
      const snTags = tags.filter(t => t[0] === "sn");
      expect(snTags).toHaveLength(2);
    });
  });

  describe("share unmarshal", () => {
    it("multiple sn tags collected", () => {
      const s = unmarshalShareTags([
        ["d", "sid"], ["a", "addr"], ["h", "hh"], ["b", "bh"],
        ["workers", "w1"], ["height", "1"], ["amount", "1"],
        ["timestamp", "0"], ["sn", "ev1"], ["sn", "ev2", "ev3"],
      ]);
      expect(s.sharenoteEventIds).toEqual(["ev1", "ev2", "ev3"]);
    });

    it("unknown tags ignored", () => {
      const s = unmarshalShareTags([
        ["d", "sid"], ["a", "addr"], ["h", "hh"], ["b", "bh"],
        ["workers", "w1"], ["height", "1"], ["amount", "1"],
        ["timestamp", "0"], ["unknown", "val"],
      ]);
      expect(s.shareId).toBe("sid");
    });

    it("shares with count", () => {
      const s = unmarshalShareTags([
        ["d", "s"], ["a", "a"], ["h", "h"], ["b", "b"],
        ["workers", "w"], ["height", "1"], ["amount", "1"],
        ["shares", "33z53", "5"], ["timestamp", "0"],
      ]);
      expect(s.shares).toBe("33z53");
      expect(s.shareCount).toBe(5);
    });

    it("totalshares with count", () => {
      const s = unmarshalShareTags([
        ["d", "s"], ["a", "a"], ["h", "h"], ["b", "b"],
        ["workers", "w"], ["height", "1"], ["amount", "1"],
        ["totalshares", "34z10", "20"], ["timestamp", "0"],
      ]);
      expect(s.totalShares).toBe("34z10");
      expect(s.totalShareCount).toBe(20);
    });
  });

  describe("share round-trip", () => {
    it("pending share", () => {
      const s = createShare({
        shareId: computePendingShareId(100, "addr1", "rig01"),
        address: "addr1", heightHash: computeHeightHash(100),
        blockHash: "ab".repeat(32), workers: ["rig01"], height: 100, amount: 1000,
        shares: "33z53", shareCount: 5, totalShares: "34z10",
        totalShareCount: 20, timestamp: 1700000000, fee: 100,
        estPaymentHeight: 200, sharenoteEventIds: ["event1", "event2"],
      });
      const parsed = unmarshalShareTags(marshalShareTags(s));
      expect(parsed.shareId).toBe(s.shareId);
      expect(parsed.shares).toBe("33z53");
      expect(parsed.shareCount).toBe(5);
      expect(parsed.fee).toBe(100);
      expect(parsed.sharenoteEventIds).toEqual(["event1", "event2"]);
    });

    it("share with chain and tx", () => {
      const s = createShare({
        shareId: computePaymentShareId(100, "addr1"),
        address: "addr1", heightHash: computeHeightHash(100),
        blockHash: "ab".repeat(32), chainId: "15",
        workers: ["rig01", "rig02"], height: 100, amount: 2000,
        timestamp: 1700000000,
        tx: createTransaction({ txid: "cc".repeat(32) }),
      });
      const parsed = unmarshalShareTags(marshalShareTags(s));
      expect(parsed.chainId).toBe("15");
      expect(parsed.workers).toEqual(["rig01", "rig02"]);
      expect(parsed.tx!.txid).toBe("cc".repeat(32));
      expect(parsed.tx!.confirmed).toBe(false);
    });

    it("minimal share", () => {
      const s = createShare({
        shareId: "s", address: "a", heightHash: "h", blockHash: "b",
        workers: ["w"], height: 1, amount: 1,
      });
      const parsed = unmarshalShareTags(marshalShareTags(s));
      expect(parsed.shares).toBe("");
      expect(parsed.fee).toBe(0);
      expect(parsed.estPaymentHeight).toBe(0);
      expect(parsed.sharenoteEventIds).toEqual([]);
      expect(parsed.tx).toBeNull();
    });
  });

  describe("validate invoice", () => {
    it("valid", () => {
      expect(() => validateInvoice(createInvoice({
        heightHash: computeHeightHash(100), height: 100, amount: 5000,
      }))).not.toThrow();
    });

    it("zero height", () => {
      expect(() => validateInvoice(createInvoice({ height: 0, amount: 5000 })))
        .toThrow("height must be greater than zero");
    });

    it("negative height", () => {
      expect(() => validateInvoice(createInvoice({ height: -1, amount: 5000 })))
        .toThrow("height must be greater than zero");
    });

    it("wrong height hash", () => {
      expect(() => validateInvoice(createInvoice({
        heightHash: "wrong", height: 100, amount: 5000,
      }))).toThrow("height hash mismatch");
    });

    it("zero amount", () => {
      expect(() => validateInvoice(createInvoice({
        heightHash: computeHeightHash(100), height: 100, amount: 0,
      }))).toThrow("amount must be positive");
    });

    it("negative amount", () => {
      expect(() => validateInvoice(createInvoice({
        heightHash: computeHeightHash(100), height: 100, amount: -1,
      }))).toThrow("amount must be positive");
    });
  });

  describe("validate share", () => {
    it("valid pending", () => {
      expect(() => validateShare(createShare({
        shareId: computePendingShareId(100, "addr1", "rig01"),
        heightHash: computeHeightHash(100), height: 100,
        address: "addr1", workers: ["rig01"],
      }), KIND_PENDING_SHARE)).not.toThrow();
    });

    it("valid finalized", () => {
      const s = createShare({
        shareId: computePaymentShareId(100, "addr1"),
        heightHash: computeHeightHash(100), height: 100,
        address: "addr1", workers: ["rig01"],
      });
      expect(() => validateShare(s, KIND_FINALIZED_SHARE)).not.toThrow();
      expect(() => validateShare(s, KIND_SHARE_PAYMENT)).not.toThrow();
    });

    it("zero height", () => {
      expect(() => validateShare(
        createShare({ height: 0, workers: ["w"] }), KIND_PENDING_SHARE,
      )).toThrow("height must be greater than zero");
    });

    it("wrong height hash", () => {
      expect(() => validateShare(
        createShare({ heightHash: "wrong", height: 100, workers: ["w"] }), KIND_PENDING_SHARE,
      )).toThrow("height hash mismatch");
    });

    it("no workers", () => {
      expect(() => validateShare(
        createShare({ heightHash: computeHeightHash(100), height: 100 }), KIND_PENDING_SHARE,
      )).toThrow("at least one worker");
    });

    it("wrong share id", () => {
      expect(() => validateShare(createShare({
        shareId: "wrong", heightHash: computeHeightHash(100),
        height: 100, address: "addr1", workers: ["rig01"],
      }), KIND_PENDING_SHARE)).toThrow("shareID mismatch");
    });

    it("unknown kind", () => {
      expect(() => validateShare(createShare({
        heightHash: computeHeightHash(100), height: 100,
        address: "addr1", workers: ["rig01"],
      }), 99999)).toThrow("unknown share kind");
    });
  });

  describe("transaction round-trip", () => {
    it("unconfirmed tx", () => {
      const inv = unmarshalInvoiceTags([["d", "h"], ["x", "txid123"]]);
      expect(inv.tx!.txid).toBe("txid123");
      expect(inv.tx!.confirmed).toBe(false);
      expect(inv.tx!.blockHeight).toBe(0);
    });

    it("confirmed tx", () => {
      const inv = unmarshalInvoiceTags([["d", "h"], ["x", "txid123", "50", "blockhash"]]);
      expect(inv.tx!.txid).toBe("txid123");
      expect(inv.tx!.confirmed).toBe(true);
      expect(inv.tx!.blockHeight).toBe(50);
      expect(inv.tx!.blockHash).toBe("blockhash");
    });

    it("tx with empty block hash stays unconfirmed", () => {
      const inv = unmarshalInvoiceTags([["d", "h"], ["x", "txid123", "50", ""]]);
      expect(inv.tx!.confirmed).toBe(false);
    });
  });
});
