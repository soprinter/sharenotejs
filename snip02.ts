/**
 * SNIP-02: Hashrate & Telemetry Event Helpers (Kind 35502).
 *
 * Provides types and marshal/unmarshal functions for hashrate telemetry
 * events broadcast by miners and pools over Nostr.
 */

export const KIND_HASHRATE = 35502;

const WORKER_PREFIX = "w:";

export interface Worker {
  name: string;
  hashrate: string;
  sharenote: string;
  meanSharenote: string;
  countSharenotes: number;
  countRejectedSharenotes: number;
  meanTimeSec: string;
  lastAcceptedUnix: number;
  userAgent: string;
}

export interface Hashrate {
  address: string;
  totalHashrate: string;
  meanSharenote: string;
  hashrate: string;
  workers: Worker[];
}

export type Tags = string[][];

export function createWorker(partial: Partial<Worker> & { name: string }): Worker {
  return {
    hashrate: "",
    sharenote: "",
    meanSharenote: "",
    countSharenotes: 0,
    countRejectedSharenotes: 0,
    meanTimeSec: "",
    lastAcceptedUnix: 0,
    userAgent: "",
    ...partial,
  };
}

export function createHashrate(partial?: Partial<Hashrate>): Hashrate {
  return {
    address: "",
    totalHashrate: "",
    meanSharenote: "",
    hashrate: "",
    workers: [],
    ...partial,
  };
}

export function marshalTags(hr: Hashrate): Tags {
  if (!hr.address) {
    throw new Error("address is required");
  }

  const tags: Tags = [["a", hr.address]];

  if (hr.totalHashrate) {
    const tag = ["all", hr.totalHashrate];
    if (hr.meanSharenote) {
      tag.push(`msn:${hr.meanSharenote}`);
    }
    tags.push(tag);
  } else if (hr.hashrate) {
    const tag = ["h", hr.hashrate];
    if (hr.meanSharenote) {
      tag.push(`msn:${hr.meanSharenote}`);
    }
    tags.push(tag);
  }

  for (const w of hr.workers) {
    const tag = marshalWorker(w);
    if (tag) {
      tags.push(tag);
    }
  }

  return tags;
}

export function unmarshalTags(tags: Tags): Hashrate {
  const hr = createHashrate();

  for (const tag of tags) {
    if (!tag.length) continue;
    const key = tag[0];

    if (key === "a" && tag.length >= 2) {
      hr.address = tag[1];
    } else if (key === "all" && tag.length >= 2) {
      hr.totalHashrate = tag[1];
      hr.meanSharenote = extractInlineMsn(tag.slice(2));
    } else if (key === "h" && tag.length >= 2) {
      hr.hashrate = tag[1];
      if (!hr.meanSharenote) {
        hr.meanSharenote = extractInlineMsn(tag.slice(2));
      }
    } else if (key.startsWith(WORKER_PREFIX)) {
      const name = key.slice(WORKER_PREFIX.length);
      if (!name) continue;
      const w = createWorker({ name });
      for (const f of tag.slice(1)) {
        const colonIdx = f.indexOf(":");
        if (colonIdx === -1) continue;
        const k = f.slice(0, colonIdx);
        const v = f.slice(colonIdx + 1);
        if (!v) continue;
        if (k === "h") w.hashrate = v;
        else if (k === "sn") w.sharenote = v;
        else if (k === "msn") w.meanSharenote = v;
        else if (k === "csn") w.countSharenotes = parseInt(v, 10);
        else if (k === "crsn") w.countRejectedSharenotes = parseInt(v, 10);
        else if (k === "mt") w.meanTimeSec = v;
        else if (k === "lsn") w.lastAcceptedUnix = parseInt(v, 10);
        else if (k === "ua") w.userAgent = v;
      }
      hr.workers.push(w);
    }
  }

  if (!hr.address) {
    throw new Error("missing address tag");
  }

  return hr;
}

function marshalWorker(w: Worker): string[] | null {
  const name = w.name.trim();
  if (!name) return null;

  const tag = [`${WORKER_PREFIX}${name}`];
  if (w.hashrate) tag.push(`h:${w.hashrate}`);
  if (w.sharenote) tag.push(`sn:${w.sharenote}`);
  if (w.meanSharenote) tag.push(`msn:${w.meanSharenote}`);
  tag.push(`csn:${w.countSharenotes}`);
  if (w.countRejectedSharenotes > 0) tag.push(`crsn:${w.countRejectedSharenotes}`);
  if (w.meanTimeSec) tag.push(`mt:${w.meanTimeSec}`);
  if (w.lastAcceptedUnix) tag.push(`lsn:${w.lastAcceptedUnix}`);
  if (w.userAgent) tag.push(`ua:${w.userAgent}`);
  return tag;
}

function extractInlineMsn(fields: string[]): string {
  for (const f of fields) {
    if (f.startsWith("msn:")) {
      return f.slice(4);
    }
  }
  return "";
}
