import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import {
  marshalTags, unmarshalTags,
  validateHeaderHash, validateLabel,
  createSharenote, createAuxBlock,
  KIND_SHARENOTE,
} from "./snip04";

describe("snip04", () => {
  describe("constants", () => {
    it("KIND_SHARENOTE = 35510", () => {
      expect(KIND_SHARENOTE).toBe(35510);
    });
  });

  describe("marshalTags", () => {
    it("tag order: d, a, z, w..., dd", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "addr", worker: "w", agent: "a",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ blockHash: "bh", chainId: "15", height: 1, sharenoteLabel: "30z00" })],
      });
      const tags = marshalTags(sn);
      expect(tags[0][0]).toBe("d");
      expect(tags[1][0]).toBe("a");
      expect(tags[2][0]).toBe("z");
      expect(tags[tags.length - 1][0]).toBe("dd");
    });

    it("label is lowercased", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "a", worker: "w", agent: "ag",
        label: "34Z10", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "34z10" })],
      });
      const tags = marshalTags(sn);
      const zTag = tags.find(t => t[0] === "z")!;
      expect(zTag[1]).toBe("34z10");
    });

    it("a tag format", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "fc1qtest", worker: "rig01", agent: "bmminer/2.0",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" })],
      });
      const tags = marshalTags(sn);
      expect(tags[1]).toEqual(["a", "fc1qtest", "rig01", "bmminer/2.0"]);
    });

    it("primary chain first", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "2a",
        auxBlocks: [
          createAuxBlock({ blockHash: "aa", chainId: "15", height: 1, sharenoteLabel: "30z00" }),
          createAuxBlock({ blockHash: "bb", chainId: "2a", height: 2, sharenoteLabel: "30z00" }),
        ],
      });
      const tags = marshalTags(sn);
      const wTags = tags.filter(t => t[0] === "w");
      expect(wTags[0][2]).toBe("2a");
      expect(wTags[1][2]).toBe("15");
    });

    it("single aux block", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({
          blockHash: "bh", chainId: "15", height: 843000, solved: true, sharenoteLabel: "40z00",
        })],
      });
      const tags = marshalTags(sn);
      const wTags = tags.filter(t => t[0] === "w");
      expect(wTags).toHaveLength(1);
      expect(wTags[0]).toEqual(["w", "bh", "15", "843000", "true", "40z00"]);
    });

    it("solved false format", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ chainId: "15", height: 1, solved: false, sharenoteLabel: "30z00" })],
      });
      const tags = marshalTags(sn);
      const wTag = tags.find(t => t[0] === "w")!;
      expect(wTag[4]).toBe("false");
    });

    it("throws on empty auxBlocks", () => {
      expect(() => marshalTags(createSharenote({ label: "30z00" })))
        .toThrow("auxBlocks must not be empty");
    });

    it("throws on missing primary chain", () => {
      expect(() => marshalTags(createSharenote({
        label: "30z00", primaryChainId: "ff",
        auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" })],
      }))).toThrow("primary chain ff not found");
    });

    it("three aux blocks ordering", () => {
      const sn = createSharenote({
        headerHash: "hh", address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "2a",
        auxBlocks: [
          createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" }),
          createAuxBlock({ chainId: "2a", height: 2, sharenoteLabel: "30z00" }),
          createAuxBlock({ chainId: "ff", height: 3, sharenoteLabel: "30z00" }),
        ],
      });
      const tags = marshalTags(sn);
      const wTags = tags.filter(t => t[0] === "w");
      expect(wTags).toHaveLength(3);
      expect(wTags[0][2]).toBe("2a");
      expect(wTags[1][2]).toBe("15");
      expect(wTags[2][2]).toBe("ff");
    });
  });

  describe("unmarshalTags", () => {
    it("skips empty tags", () => {
      const sn = unmarshalTags([[], ["d", "hh"], ["z", "30z00"]]);
      expect(sn.headerHash).toBe("hh");
    });

    it("skips short a tag", () => {
      const sn = unmarshalTags([["a", "addr"], ["d", "hh"]]);
      expect(sn.address).toBe(""); // needs >= 4 elements
    });

    it("skips short w tag", () => {
      const sn = unmarshalTags([["w", "bh", "15", "1", "true"]]); // only 5, needs 6
      expect(sn.auxBlocks).toHaveLength(0);
    });

    it("primary chain from first w tag", () => {
      const sn = unmarshalTags([
        ["w", "bh1", "15", "1", "true", "30z00"],
        ["w", "bh2", "2a", "2", "false", "30z00"],
      ]);
      expect(sn.primaryChainId).toBe("15");
    });

    it("solved is case insensitive", () => {
      const sn1 = unmarshalTags([["w", "bh", "15", "1", "True", "30z00"]]);
      expect(sn1.auxBlocks[0].solved).toBe(true);

      const sn2 = unmarshalTags([["w", "bh", "15", "1", "FALSE", "30z00"]]);
      expect(sn2.auxBlocks[0].solved).toBe(false);
    });

    it("dd tag parsed", () => {
      const sn = unmarshalTags([["dd", "0100000081cd02ab"]]);
      expect(sn.headerHex).toBe("0100000081cd02ab");
    });
  });

  describe("round-trip", () => {
    it("full round-trip", () => {
      const sn = createSharenote({
        headerHash: "00".repeat(32), address: "fc1qtest",
        worker: "rig01", agent: "bmminer/2.0",
        label: "34Z10", primaryChainId: "15",
        auxBlocks: [
          createAuxBlock({ blockHash: "ab".repeat(32), chainId: "15", height: 843000, solved: true, sharenoteLabel: "40z00" }),
          createAuxBlock({ blockHash: "cd".repeat(32), chainId: "2a", height: 110000, solved: false, sharenoteLabel: "34z10" }),
        ],
      });
      const parsed = unmarshalTags(marshalTags(sn));

      expect(parsed.headerHash).toBe("00".repeat(32));
      expect(parsed.address).toBe("fc1qtest");
      expect(parsed.worker).toBe("rig01");
      expect(parsed.agent).toBe("bmminer/2.0");
      expect(parsed.label).toBe("34z10");
      expect(parsed.primaryChainId).toBe("15");
      expect(parsed.auxBlocks).toHaveLength(2);
      expect(parsed.auxBlocks[0].height).toBe(843000);
      expect(parsed.auxBlocks[0].solved).toBe(true);
      expect(parsed.auxBlocks[1].chainId).toBe("2a");
      expect(parsed.auxBlocks[1].solved).toBe(false);
    });

    it("single block with headerHex", () => {
      // Use a valid header_hex / header_hash pair.
      const headerHex = "00".repeat(80);
      const headerBytes = Buffer.from(headerHex, "hex");
      const first = createHash("sha256").update(headerBytes).digest();
      const second = createHash("sha256").update(first).digest();
      const headerHash = Buffer.from(second).reverse().toString("hex");

      const sn = createSharenote({
        headerHash, address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ blockHash: "bh", chainId: "15", height: 1, sharenoteLabel: "30z00" })],
        headerHex,
      });
      const parsed = unmarshalTags(marshalTags(sn));
      expect(parsed.headerHex).toBe(headerHex);
      expect(parsed.auxBlocks).toHaveLength(1);
    });
  });

  describe("validateHeaderHash", () => {
    it("requires both fields", () => {
      expect(() => validateHeaderHash(createSharenote({ headerHash: "abc" })))
        .toThrow("both headerHex and headerHash are required");
      expect(() => validateHeaderHash(createSharenote({ headerHex: "abc" })))
        .toThrow("both headerHex and headerHash are required");
    });

    it("valid double-SHA256", () => {
      const headerHex = "00".repeat(80);
      const headerBytes = Buffer.from(headerHex, "hex");
      const first = createHash("sha256").update(headerBytes).digest();
      const second = createHash("sha256").update(first).digest();
      const expectedHash = Buffer.from(second).reverse().toString("hex");

      const sn = createSharenote({ headerHash: expectedHash, headerHex });
      expect(() => validateHeaderHash(sn)).not.toThrow();
    });

    it("invalid hash mismatch", () => {
      expect(() => validateHeaderHash(createSharenote({
        headerHash: "ff".repeat(32), headerHex: "00".repeat(80),
      }))).toThrow("header hash mismatch");
    });

    it("marshal validates when both present", () => {
      expect(() => marshalTags(createSharenote({
        headerHash: "ff".repeat(32), headerHex: "00".repeat(80),
        address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" })],
      }))).toThrow("header hash mismatch");
    });

    it("marshal skips validation when hex empty", () => {
      expect(() => marshalTags(createSharenote({
        headerHash: "ff".repeat(32),
        address: "a", worker: "w", agent: "ag",
        label: "30z00", primaryChainId: "15",
        auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" })],
      }))).not.toThrow();
    });
  });

  describe("validateLabel", () => {
    it("valid lowercase", () => {
      expect(() => validateLabel("34z10")).not.toThrow();
    });

    it("valid uppercase", () => {
      expect(() => validateLabel("30Z00")).not.toThrow();
    });

    it("no z rejects", () => {
      expect(() => validateLabel("abc")).toThrow("invalid sharenote label");
    });

    it("non-numeric before z rejects", () => {
      expect(() => validateLabel("abz10")).toThrow("invalid sharenote label");
    });

    it("non-numeric after z rejects", () => {
      expect(() => validateLabel("30zxx")).toThrow("invalid sharenote label");
    });

    it("empty after z rejects", () => {
      expect(() => validateLabel("30z")).toThrow("invalid sharenote label");
    });

    it("zero values valid", () => {
      expect(() => validateLabel("0z0")).not.toThrow();
    });
  });
});
