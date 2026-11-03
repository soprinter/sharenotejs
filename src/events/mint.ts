/**
 * Raw Sharenote / AuxPoW minting events ({@link SharenoteKind.RawSharenote}, kind 35510).
 *
 * The minting agent packages the unparsed, hex-encoded block header (the `dd`
 * tag) plus one `w` entry per merged-mining branch (primary chain first). This
 * is the only cryptographically verifiable artifact in the chain: every later
 * accounting record points back to it. Validators hash the header to confirm it
 * yields the `HeaderHash` — a denomination label never verifies a target (A2).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { Sharenote } from "../difficulty.js";
import { SharenoteError } from "../errors.js";
import { type Tags } from "../kinds.js";

/** One merged-mining branch solved by the same hash execution (a `w` entry). */
export interface AuxBlock {
  /** The branch's target block hash. */
  blockHash: string;
  /** Hex-encoded network identifier, e.g. `"15"` or `"2a"`. */
  chainId: string;
  /** The chain's block height. */
  height: number;
  /** Whether the hash reached that network's subsidy target. */
  solved: boolean;
  /** That branch's Sharenote difficulty label (lowercase). */
  sharenoteLabel: string;
}

/** A raw minted Sharenote carrying a block header and its AuxPoW branches. */
export interface RawSharenote {
  /** The block header hash; the unique addressable coordinate (the `d` tag). */
  headerHash: string;
  /** The miner's chain receiving address (the `a` tag). */
  address: string;
  /** The worker name. */
  worker: string;
  /** The mining software's user-agent string. */
  agent: string;
  /** The Sharenote denomination label, always lowercase (the `z` tag). */
  label: string;
  /** The primary chain's hex ID; its `w` entry MUST appear first. */
  primaryChainId: string;
  /** Every merged-mining branch, primary chain first. */
  auxBlocks: AuxBlock[];
  /** The full block header encoded as hex (the `dd` tag). */
  headerHex: string;
}

/** Create an {@link AuxBlock}, filling defaults for omitted fields. */
export function createAuxBlock(partial?: Partial<AuxBlock>): AuxBlock {
  return {
    blockHash: "",
    chainId: "",
    height: 0,
    solved: false,
    sharenoteLabel: "",
    ...partial,
  };
}

/** Create a {@link RawSharenote}, filling defaults for omitted fields. */
export function createRawSharenote(partial?: Partial<RawSharenote>): RawSharenote {
  return {
    headerHash: "",
    address: "",
    worker: "",
    agent: "",
    label: "",
    primaryChainId: "",
    auxBlocks: [],
    headerHex: "",
    ...partial,
  };
}

function buildAuxBlockTag(block: AuxBlock): string[] {
  return [
    "w",
    block.blockHash,
    block.chainId,
    String(block.height),
    String(block.solved),
    block.sharenoteLabel,
  ];
}

/**
 * Encode a {@link RawSharenote} as Nostr event tags, in canonical order
 * (`d`, `a`, `z`, `w`…, `dd`) with the primary chain's `w` entry first.
 *
 * When both `headerHex` and `headerHash` are present, the header hash is
 * validated first (see {@link validateHeaderHash}).
 *
 * @throws a {@link SharenoteError} when `auxBlocks` is empty, the primary chain
 * is not among them, or header validation fails.
 */
export function buildRawSharenoteTags(note: RawSharenote): Tags {
  if (!note.auxBlocks.length) {
    throw new SharenoteError("auxBlocks must not be empty");
  }
  if (note.headerHex && note.headerHash) {
    validateHeaderHash(note);
  }

  const primaryIndex = note.auxBlocks.findIndex((b) => b.chainId === note.primaryChainId);
  if (primaryIndex === -1) {
    throw new SharenoteError(`primary chain ${note.primaryChainId} not found in aux blocks`);
  }

  const tags: string[][] = [
    ["d", note.headerHash],
    ["a", note.address, note.worker, note.agent],
    ["z", note.label.toLowerCase()],
    buildAuxBlockTag(note.auxBlocks[primaryIndex]),
  ];
  note.auxBlocks.forEach((block, index) => {
    if (index !== primaryIndex) tags.push(buildAuxBlockTag(block));
  });
  tags.push(["dd", note.headerHex]);
  return tags;
}

/** Decode Nostr event tags into a {@link RawSharenote}. */
export function parseRawSharenoteTags(tags: Tags): RawSharenote {
  const note = createRawSharenote();

  for (const tag of tags) {
    if (!tag.length) continue;
    const key = tag[0];
    if (key === "d" && tag.length >= 2) {
      note.headerHash = tag[1];
    } else if (key === "a" && tag.length >= 4) {
      note.address = tag[1];
      note.worker = tag[2];
      note.agent = tag[3];
    } else if (key === "z" && tag.length >= 2) {
      note.label = tag[1];
    } else if (key === "w" && tag.length >= 6) {
      note.auxBlocks.push({
        blockHash: tag[1],
        chainId: tag[2],
        height: Number.parseInt(tag[3], 10),
        solved: tag[4].toLowerCase() === "true",
        sharenoteLabel: tag[5],
      });
    } else if (key === "dd" && tag.length >= 2) {
      note.headerHex = tag[1];
    }
  }

  if (note.auxBlocks.length) {
    note.primaryChainId = note.auxBlocks[0].chainId;
  }
  return note;
}

/**
 * Verify that double-SHA-256 of the hex header yields the stated `headerHash`
 * (NIP-SN A14). Hashing uses `@noble/hashes`, so it is browser-portable.
 *
 * @throws a {@link SharenoteError} when either field is missing or the hash
 * does not match.
 */
export function validateHeaderHash(note: RawSharenote): void {
  if (!note.headerHex || !note.headerHash) {
    throw new SharenoteError("both headerHex and headerHash are required for validation");
  }
  const first = sha256(hexToBytes(note.headerHex));
  const second = sha256(first);
  // Byte-reverse for block-hash display format.
  const computed = bytesToHex(second.slice().reverse());
  if (computed !== note.headerHash) {
    throw new SharenoteError(
      `header hash mismatch: computed ${computed}, got ${note.headerHash}`
    );
  }
}

/**
 * Validate the shape of a denomination label (e.g. `34z10`).
 *
 * @throws a {@link SharenoteError} when the label is not `<digits>z<1-2 digits>`.
 */
export function validateLabel(label: string): void {
  if (!/^\d+z\d{1,2}$/.test(label.toLowerCase())) {
    throw new SharenoteError(
      `invalid sharenote label format: ${label} (expected format like '34z10')`
    );
  }
}

/** Options for {@link validateRawSharenoteEvent}. */
export interface ValidateRawSharenoteOptions {
  /**
   * The primary chain's hex ID, known out of band (a received 35510 carries no
   * tag marking which branch is primary). When given, the validator requires a
   * branch with this chain ID and that it appears **first** (NIP-SN A14). When
   * omitted, only the "at least one branch" rule is enforced.
   */
  readonly primaryChainId?: string;
}

/**
 * Validate a Raw Sharenote (kind 35510) event's raw tags against the full
 * NIP-SN A14 rule — operating on tags directly so ordering, arity, and casing
 * violations that parsing would normalise away are still caught:
 *
 * - **Clause 1:** the byte-reversed double-SHA-256 of the `dd` header hex MUST
 *   equal the `d` HeaderHash.
 * - **Clause 2:** that hash, read as a big-endian 256-bit integer, MUST clear
 *   the leading-zero bound implied by `z` — `int(d, 16) ≤ target_for(z)` (the
 *   clause previously missing in all three SDKs).
 * - Exactly one `d`, `z` (lowercase), and `dd` (the **last** tag); at least one
 *   `w` branch; each `w` entry has **exactly six** elements; and, when the
 *   primary chain is known, it is present and first.
 *
 * @throws a {@link SharenoteError} on the first violation.
 */
export function validateRawSharenoteEvent(
  tags: Tags,
  opts?: ValidateRawSharenoteOptions
): void {
  let headerHash = "";
  let label = "";
  let headerHex = "";
  let lastKey = "";
  const branches: (readonly string[])[] = [];

  for (const tag of tags) {
    if (!tag.length) continue;
    lastKey = tag[0];
    if (tag[0] === "d" && !headerHash && tag.length >= 2) headerHash = tag[1];
    else if (tag[0] === "z" && !label && tag.length >= 2) label = tag[1];
    else if (tag[0] === "w") branches.push(tag);
    else if (tag[0] === "dd" && !headerHex && tag.length >= 2) headerHex = tag[1];
  }

  if (!headerHash) throw new SharenoteError("raw sharenote is missing its d (header hash) tag");
  if (!label) throw new SharenoteError("raw sharenote is missing its z (denomination) tag");
  if (!headerHex) throw new SharenoteError("raw sharenote is missing its dd (header hex) tag");

  if (label !== label.toLowerCase()) {
    throw new SharenoteError("raw sharenote z label must be lowercase (A14)");
  }
  if (lastKey !== "dd") {
    throw new SharenoteError("raw sharenote dd tag must be the last tag (A14)");
  }
  if (branches.length === 0) {
    throw new SharenoteError("raw sharenote needs at least one w branch (A14)");
  }
  for (const w of branches) {
    if (w.length !== 6) {
      throw new SharenoteError("raw sharenote w entry must have exactly six elements (A14)");
    }
  }

  const primary = opts?.primaryChainId;
  if (primary) {
    if (!branches.some((w) => w[2] === primary)) {
      throw new SharenoteError(
        `raw sharenote primary chain ${primary} is absent from the w branches (A14)`
      );
    }
    if (branches[0][2] !== primary) {
      throw new SharenoteError(
        `raw sharenote primary chain ${primary} must be the first w branch (A14)`
      );
    }
  }

  // Clause 1: reversed double-SHA-256(dd) == d.
  const computed = bytesToHex(sha256(sha256(hexToBytes(headerHex))).slice().reverse());
  if (computed !== headerHash) {
    throw new SharenoteError(
      `raw sharenote header hash mismatch (A14 clause 1): computed ${computed}, got ${headerHash}`
    );
  }

  // Clause 2: the hash (big-endian) must clear the z leading-zero bound.
  const target = Sharenote.fromLabel(label).target();
  if (BigInt(`0x${headerHash}`) > target) {
    throw new SharenoteError(
      "raw sharenote header hash does not clear the z leading-zero bound (A14 clause 2)"
    );
  }
}
