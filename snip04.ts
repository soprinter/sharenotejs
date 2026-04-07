/**
 * SNIP-04: Raw Sharenote Minting & AuxPoW Event Helpers (Kind 35510).
 *
 * Provides types and marshal/unmarshal functions for sharenote minting
 * events that package merged-mining block headers into verifiable payloads.
 */

import { createHash } from "crypto";

export const KIND_SHARENOTE = 35510;

export type Tags = string[][];

export interface AuxBlock {
  blockHash: string;
  chainId: string;
  height: number;
  solved: boolean;
  sharenoteLabel: string;
}

export interface Sharenote {
  headerHash: string;
  address: string;
  worker: string;
  agent: string;
  label: string;
  primaryChainId: string;
  auxBlocks: AuxBlock[];
  headerHex: string;
}

export function createAuxBlock(partial?: Partial<AuxBlock>): AuxBlock {
  return {
    blockHash: "", chainId: "", height: 0,
    solved: false, sharenoteLabel: "", ...partial,
  };
}

export function createSharenote(partial?: Partial<Sharenote>): Sharenote {
  return {
    headerHash: "", address: "", worker: "", agent: "",
    label: "", primaryChainId: "", auxBlocks: [], headerHex: "",
    ...partial,
  };
}

export function marshalTags(sn: Sharenote): Tags {
  if (!sn.auxBlocks.length) {
    throw new Error("auxBlocks must not be empty");
  }

  if (sn.headerHex && sn.headerHash) {
    validateHeaderHash(sn);
  }

  const label = sn.label.toLowerCase();

  const tags: Tags = [
    ["d", sn.headerHash],
    ["a", sn.address, sn.worker, sn.agent],
    ["z", label],
  ];

  // Primary chain first.
  const primaryIdx = sn.auxBlocks.findIndex(b => b.chainId === sn.primaryChainId);
  if (primaryIdx === -1) {
    throw new Error(`primary chain ${sn.primaryChainId} not found in aux blocks`);
  }

  tags.push(marshalAuxBlock(sn.auxBlocks[primaryIdx]));
  for (let i = 0; i < sn.auxBlocks.length; i++) {
    if (i === primaryIdx) continue;
    tags.push(marshalAuxBlock(sn.auxBlocks[i]));
  }

  tags.push(["dd", sn.headerHex]);
  return tags;
}

export function unmarshalTags(tags: Tags): Sharenote {
  const sn = createSharenote();

  for (const tag of tags) {
    if (!tag.length) continue;
    const k = tag[0];

    if (k === "d" && tag.length >= 2) {
      sn.headerHash = tag[1];
    } else if (k === "a" && tag.length >= 4) {
      sn.address = tag[1];
      sn.worker = tag[2];
      sn.agent = tag[3];
    } else if (k === "z" && tag.length >= 2) {
      sn.label = tag[1];
    } else if (k === "w" && tag.length >= 6) {
      sn.auxBlocks.push({
        blockHash: tag[1],
        chainId: tag[2],
        height: parseInt(tag[3], 10),
        solved: tag[4].toLowerCase() === "true",
        sharenoteLabel: tag[5],
      });
    } else if (k === "dd" && tag.length >= 2) {
      sn.headerHex = tag[1];
    }
  }

  if (sn.auxBlocks.length) {
    sn.primaryChainId = sn.auxBlocks[0].chainId;
  }

  return sn;
}

export function validateHeaderHash(sn: Sharenote): void {
  if (!sn.headerHex || !sn.headerHash) {
    throw new Error("both headerHex and headerHash are required for validation");
  }

  const headerBytes = Buffer.from(sn.headerHex, "hex");
  const first = createHash("sha256").update(headerBytes).digest();
  const second = createHash("sha256").update(first).digest();
  // Byte-reverse for block hash display format.
  const reversed = Buffer.from(second).reverse();
  const computed = reversed.toString("hex");
  if (computed !== sn.headerHash) {
    throw new Error(`header hash mismatch: computed ${computed}, got ${sn.headerHash}`);
  }
}

export function validateLabel(label: string): void {
  const low = label.toLowerCase();
  if (!/^\d+z\d{1,2}$/.test(low)) {
    throw new Error(`invalid sharenote label format: ${label} (expected format like '34z10')`);
  }
}

function marshalAuxBlock(b: AuxBlock): string[] {
  return [
    "w",
    b.blockHash,
    b.chainId,
    String(b.height),
    String(b.solved),
    b.sharenoteLabel,
  ];
}
