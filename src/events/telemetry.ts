/**
 * Hashrate telemetry events ({@link SharenoteKind.HashrateTelemetry}, kind 35502).
 *
 * A miner streams live per-farm and per-worker metrics. All data travels in
 * tags to keep high-frequency broadcasts small, so the event `content` is empty.
 */
import { SharenoteError } from "../errors.js";
import { type Tags } from "../kinds.js";

const WORKER_PREFIX = "w:";

/** One worker's telemetry sub-fields (the `w:<name>` tag). */
export interface TelemetryWorker {
  /** The worker name (the part after `w:`). */
  name: string;
  /** EMA-adjusted hashrate in H/s (`h:`). */
  hashrate: string;
  /** Minimum difficulty actively assigned (`sn:`). */
  sharenote: string;
  /** Mean Sharenote achieved (`msn:`). */
  meanSharenote: string;
  /** Count of accepted sharenotes (`csn:`). */
  countSharenotes: number;
  /** Count of rejected sharenotes (`crsn:`, omitted when zero). */
  countRejectedSharenotes: number;
  /** Mean seconds between accepted shares (`mt:`). */
  meanTimeSec: string;
  /** Unix timestamp of the last valid share (`lsn:`). */
  lastAcceptedUnix: number;
  /** The mining software's user-agent (`ua:`). */
  userAgent: string;
}

/** A miner's telemetry snapshot. */
export interface Telemetry {
  /** The chain address of the mining operation (the `a` tag). */
  address: string;
  /** Total EMA-adjusted hashrate across all workers (the `all` tag). */
  totalHashrate: string;
  /** The inline Mean Sharenote label carried with `all`/`h`. */
  meanSharenote: string;
  /** A single worker's hashrate when there is no aggregate (the `h` tag). */
  hashrate: string;
  /** Per-worker metrics, sorted alphabetically by name. */
  workers: TelemetryWorker[];
}

/** Create a {@link TelemetryWorker}, filling defaults for omitted fields. */
export function createTelemetryWorker(
  partial: Partial<TelemetryWorker> & { name: string }
): TelemetryWorker {
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

/** Create a {@link Telemetry}, filling defaults for omitted fields. */
export function createTelemetry(partial?: Partial<Telemetry>): Telemetry {
  return {
    address: "",
    totalHashrate: "",
    meanSharenote: "",
    hashrate: "",
    workers: [],
    ...partial,
  };
}

function buildWorkerTag(worker: TelemetryWorker): string[] | null {
  const name = worker.name.trim();
  if (!name) return null;

  const tag = [`${WORKER_PREFIX}${name}`];
  if (worker.hashrate) tag.push(`h:${worker.hashrate}`);
  if (worker.sharenote) tag.push(`sn:${worker.sharenote}`);
  if (worker.meanSharenote) tag.push(`msn:${worker.meanSharenote}`);
  tag.push(`csn:${worker.countSharenotes}`);
  if (worker.countRejectedSharenotes > 0) tag.push(`crsn:${worker.countRejectedSharenotes}`);
  if (worker.meanTimeSec) tag.push(`mt:${worker.meanTimeSec}`);
  if (worker.lastAcceptedUnix) tag.push(`lsn:${worker.lastAcceptedUnix}`);
  if (worker.userAgent) tag.push(`ua:${worker.userAgent}`);
  return tag;
}

function inlineMeanSharenote(fields: readonly string[]): string {
  for (const field of fields) {
    if (field.startsWith("msn:")) return field.slice(4);
  }
  return "";
}

/**
 * Encode a {@link Telemetry} snapshot as Nostr event tags.
 *
 * @throws a {@link SharenoteError} when `address` is empty (the required `a` tag).
 */
export function buildTelemetryTags(telemetry: Telemetry): Tags {
  if (!telemetry.address) {
    throw new SharenoteError("address is required");
  }
  const tags: string[][] = [["a", telemetry.address]];

  if (telemetry.totalHashrate) {
    const tag = ["all", telemetry.totalHashrate];
    if (telemetry.meanSharenote) tag.push(`msn:${telemetry.meanSharenote}`);
    tags.push(tag);
  } else if (telemetry.hashrate) {
    const tag = ["h", telemetry.hashrate];
    if (telemetry.meanSharenote) tag.push(`msn:${telemetry.meanSharenote}`);
    tags.push(tag);
  }

  // Worker tags are sorted alphabetically by name for determinism (NIP-SN A15),
  // matching the Go and Python builders. A copy is sorted so the caller's array
  // is left untouched.
  const sortedWorkers = [...telemetry.workers].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const worker of sortedWorkers) {
    const tag = buildWorkerTag(worker);
    if (tag) tags.push(tag);
  }
  return tags;
}

/** Decode Nostr event tags into a {@link Telemetry} snapshot. */
export function parseTelemetryTags(tags: Tags): Telemetry {
  const telemetry = createTelemetry();

  for (const tag of tags) {
    if (!tag.length) continue;
    const key = tag[0];

    if (key === "a" && tag.length >= 2) {
      telemetry.address = tag[1];
    } else if (key === "all" && tag.length >= 2) {
      telemetry.totalHashrate = tag[1];
      telemetry.meanSharenote = inlineMeanSharenote(tag.slice(2));
    } else if (key === "h" && tag.length >= 2) {
      telemetry.hashrate = tag[1];
      if (!telemetry.meanSharenote) {
        telemetry.meanSharenote = inlineMeanSharenote(tag.slice(2));
      }
    } else if (key.startsWith(WORKER_PREFIX)) {
      const name = key.slice(WORKER_PREFIX.length);
      if (!name) continue;
      const worker = createTelemetryWorker({ name });
      for (const field of tag.slice(1)) {
        const colon = field.indexOf(":");
        if (colon === -1) continue;
        const subKey = field.slice(0, colon);
        const subValue = field.slice(colon + 1);
        if (!subValue) continue;
        if (subKey === "h") worker.hashrate = subValue;
        else if (subKey === "sn") worker.sharenote = subValue;
        else if (subKey === "msn") worker.meanSharenote = subValue;
        else if (subKey === "csn") worker.countSharenotes = Number.parseInt(subValue, 10);
        else if (subKey === "crsn") worker.countRejectedSharenotes = Number.parseInt(subValue, 10);
        else if (subKey === "mt") worker.meanTimeSec = subValue;
        else if (subKey === "lsn") worker.lastAcceptedUnix = Number.parseInt(subValue, 10);
        else if (subKey === "ua") worker.userAgent = subValue;
      }
      telemetry.workers.push(worker);
    }
  }

  if (!telemetry.address) {
    throw new SharenoteError("missing address tag");
  }
  return telemetry;
}

/**
 * Validate a Hashrate Telemetry (kind 35502) event's raw tags against NIP-SN
 * A15: exactly one `a` tag, **exactly one** of `all` / `h` carrying a hashrate,
 * and every `w:<name>` worker group carrying an `h:` sub-field.
 *
 * @throws a {@link SharenoteError} on the first violation.
 */
export function validateTelemetryEvent(tags: Tags): void {
  let addressCount = 0;
  let hasAll = false;
  let hasSingle = false;
  const workers: (readonly string[])[] = [];

  for (const tag of tags) {
    if (!tag.length) continue;
    const key = tag[0];
    if (key === "a") addressCount += 1;
    else if (key === "all") hasAll = true;
    else if (key === "h") hasSingle = true;
    else if (key.startsWith(WORKER_PREFIX) && key.length > WORKER_PREFIX.length) {
      workers.push(tag);
    }
  }

  if (addressCount !== 1) {
    throw new SharenoteError("telemetry requires exactly one a tag (A15)");
  }
  if (hasAll === hasSingle) {
    throw new SharenoteError("telemetry requires exactly one of all or h (A15)");
  }
  for (const worker of workers) {
    const name = worker[0].slice(WORKER_PREFIX.length);
    const hasHashrate = worker
      .slice(1)
      .some((field) => field.startsWith("h:") && field.length > 2);
    if (!hasHashrate) {
      throw new SharenoteError(`telemetry worker ${name} is missing its h: hashrate (A15)`);
    }
  }
}
