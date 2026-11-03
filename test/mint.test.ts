import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SharenoteError,
  SharenoteKind,
  buildRawSharenoteTags,
  parseRawSharenoteTags,
  validateHeaderHash,
  validateLabel,
  createRawSharenote,
  createAuxBlock,
} from "../src/index";

/** Build a valid header hex / header hash pair via Bitcoin-style double SHA-256. */
function headerPair(): { headerHex: string; headerHash: string } {
  const headerHex = "00".repeat(80);
  const first = createHash("sha256").update(Buffer.from(headerHex, "hex")).digest();
  const second = createHash("sha256").update(first).digest();
  return { headerHex, headerHash: Buffer.from(second).reverse().toString("hex") };
}

describe("raw sharenote (kind 35510)", () => {
  it("is kind 35510", () => {
    expect(SharenoteKind.RawSharenote).toBe(35510);
  });

  describe("buildRawSharenoteTags", () => {
    it("emits tags in canonical order with the primary chain first", () => {
      const tags = buildRawSharenoteTags(
        createRawSharenote({
          headerHash: "hh", address: "fc1qtest", worker: "rig01", agent: "bmminer/2.0",
          label: "34Z10", primaryChainId: "2a",
          auxBlocks: [
            createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" }),
            createAuxBlock({ chainId: "2a", height: 2, sharenoteLabel: "30z00" }),
            createAuxBlock({ chainId: "ff", height: 3, sharenoteLabel: "30z00" }),
          ],
        })
      );
      expect(tags[0][0]).toBe("d");
      expect(tags[1]).toEqual(["a", "fc1qtest", "rig01", "bmminer/2.0"]);
      expect(tags[2]).toEqual(["z", "34z10"]); // lowercased
      expect(tags[tags.length - 1][0]).toBe("dd");
      const w = tags.filter((t) => t[0] === "w");
      expect(w.map((t) => t[2])).toEqual(["2a", "15", "ff"]);
    });

    it("encodes a single solved block", () => {
      const tags = buildRawSharenoteTags(
        createRawSharenote({
          headerHash: "hh", address: "a", worker: "w", agent: "ag", label: "30z00", primaryChainId: "15",
          auxBlocks: [createAuxBlock({ blockHash: "bh", chainId: "15", height: 843000, solved: true, sharenoteLabel: "40z00" })],
        })
      );
      expect(tags.filter((t) => t[0] === "w")).toEqual([["w", "bh", "15", "843000", "true", "40z00"]]);
    });

    it("rejects empty aux blocks and a missing primary chain", () => {
      expect(() => buildRawSharenoteTags(createRawSharenote({ label: "30z00" }))).toThrow("auxBlocks must not be empty");
      expect(() =>
        buildRawSharenoteTags(createRawSharenote({ label: "30z00", primaryChainId: "ff", auxBlocks: [createAuxBlock({ chainId: "15", height: 1 })] }))
      ).toThrow("primary chain ff not found");
    });
  });

  describe("parseRawSharenoteTags", () => {
    it("ignores short tags and takes the primary chain from the first `w`", () => {
      const note = parseRawSharenoteTags([
        [], ["a", "addr"], ["d", "hh"], ["z", "30z00"],
        ["w", "bh", "15", "1", "true"], // too short, skipped
        ["w", "bh1", "15", "1", "True", "30z00"], ["w", "bh2", "2a", "2", "FALSE", "30z00"], ["dd", "0100"],
      ]);
      expect(note.headerHash).toBe("hh");
      expect(note.address).toBe(""); // `a` needs >= 4 elements
      expect(note.primaryChainId).toBe("15");
      expect(note.auxBlocks).toHaveLength(2);
      expect(note.auxBlocks[0].solved).toBe(true);
      expect(note.auxBlocks[1].solved).toBe(false);
      expect(note.headerHex).toBe("0100");
    });
  });

  it("round-trips a multi-branch note", () => {
    const note = createRawSharenote({
      headerHash: "00".repeat(32), address: "fc1qtest", worker: "rig01", agent: "bmminer/2.0",
      label: "34Z10", primaryChainId: "15",
      auxBlocks: [
        createAuxBlock({ blockHash: "ab".repeat(32), chainId: "15", height: 843000, solved: true, sharenoteLabel: "40z00" }),
        createAuxBlock({ blockHash: "cd".repeat(32), chainId: "2a", height: 110000, solved: false, sharenoteLabel: "34z10" }),
      ],
    });
    const parsed = parseRawSharenoteTags(buildRawSharenoteTags(note));
    expect(parsed.label).toBe("34z10");
    expect(parsed.primaryChainId).toBe("15");
    expect(parsed.auxBlocks).toHaveLength(2);
    expect(parsed.auxBlocks[0].height).toBe(843000);
    expect(parsed.auxBlocks[1].chainId).toBe("2a");
  });

  describe("validateHeaderHash", () => {
    it("accepts a valid double-SHA-256 header and rejects a mismatch", () => {
      const { headerHex, headerHash } = headerPair();
      expect(() => validateHeaderHash(createRawSharenote({ headerHash, headerHex }))).not.toThrow();
      expect(() => validateHeaderHash(createRawSharenote({ headerHash: "ff".repeat(32), headerHex }))).toThrow("header hash mismatch");
      expect(() => validateHeaderHash(createRawSharenote({ headerHash: "abc" }))).toThrow("both headerHex and headerHash are required");
    });

    it("runs during build when both fields are present", () => {
      expect(() =>
        buildRawSharenoteTags(createRawSharenote({
          headerHash: "ff".repeat(32), headerHex: "00".repeat(80), address: "a", worker: "w", agent: "ag",
          label: "30z00", primaryChainId: "15", auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" })],
        }))
      ).toThrow("header hash mismatch");

      expect(() =>
        buildRawSharenoteTags(createRawSharenote({
          headerHash: "ff".repeat(32), address: "a", worker: "w", agent: "ag",
          label: "30z00", primaryChainId: "15", auxBlocks: [createAuxBlock({ chainId: "15", height: 1, sharenoteLabel: "30z00" })],
        }))
      ).not.toThrow(); // skipped when hex is empty
    });
  });

  describe("validateLabel", () => {
    it("accepts valid labels in either case", () => {
      expect(() => validateLabel("34z10")).not.toThrow();
      expect(() => validateLabel("30Z00")).not.toThrow();
      expect(() => validateLabel("0z0")).not.toThrow();
    });

    it("rejects malformed labels", () => {
      for (const bad of ["abc", "abz10", "30zxx", "30z"]) {
        expect(() => validateLabel(bad)).toThrow(SharenoteError);
      }
    });
  });
});
