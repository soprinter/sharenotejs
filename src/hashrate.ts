/**
 * Hashrate, probability, and planning helpers.
 *
 * These project a {@link Sharenote}'s difficulty onto operational figures — how
 * much hashrate a target denomination needs, how long a rig takes to earn one,
 * and human-readable displays. Values here are `number`-valued by design: they
 * are statistical estimates and presentation, never accounting accumulators.
 */
import { SharenoteError, assertFinite } from "./errors.js";
import { Sharenote, type SharenoteInput, CENTIBIT_STEP } from "./difficulty.js";

/** A named confidence level for hashrate planning. */
export enum ReliabilityId {
  /** Expected (mean) hashrate, 50th-percentile-ish; multiplier `1`. */
  Mean = "mean",
  /** Succeeds ~90% of the time. */
  Usually90 = "usually_90",
  /** Succeeds ~95% of the time. */
  Often95 = "often_95",
  /** Succeeds ~99% of the time. */
  VeryLikely99 = "very_likely_99",
  /** Succeeds ~99.9% of the time. */
  Almost999 = "almost_999",
}

/** Which hashrate figure an {@link Estimate} reports as its headline value. */
export enum PrimaryMode {
  /** The mean (expected) hashrate. */
  Mean = "mean",
  /** The confidence-adjusted (quantile) hashrate. */
  Quantile = "quantile",
}

/** SI unit for a hashrate magnitude. */
export enum HashrateUnit {
  Hps = "H/s",
  KHps = "kH/s",
  MHps = "MH/s",
  GHps = "GH/s",
  THps = "TH/s",
  PHps = "PH/s",
  EHps = "EH/s",
  ZHps = "ZH/s",
}

/** A reliability level with its confidence and Poisson multiplier. */
export interface ReliabilityLevel {
  readonly id: ReliabilityId;
  readonly label: string;
  /** Target confidence in `(0, 1)`, or `null` for the mean. */
  readonly confidence: number | null;
  /** Hashrate multiplier `-ln(1 - confidence)` (or `1` for the mean). */
  readonly multiplier: number;
}

/** A hashrate given as a magnitude plus an optional unit (defaults to H/s). */
export interface HashrateDescriptor {
  readonly value: number;
  readonly unit?: HashrateUnit;
}

/**
 * Anything accepted as a hashrate: raw H/s (`number`), a `{ value, unit }`
 * descriptor, or a human string such as `"5 GH/s"`.
 */
export type HashrateInput = number | HashrateDescriptor | string;

/** A hashrate rendered for display. */
export interface HumanHashrate {
  /** The scaled magnitude in `unit`. */
  readonly value: number;
  /** The chosen unit string, e.g. `"GH/s"`. */
  readonly unit: string;
  /** The formatted `"<value> <unit>"` string. */
  readonly display: string;
  /** The SI exponent (0 = H/s, 1 = kH/s, …). */
  readonly exponent: number;
}

/** Precision control for {@link formatHashrate}. */
export interface FormatHashrateOptions {
  readonly precision?: number;
}

/** Confidence selection shared by planning helpers. */
export interface HashrateOptions {
  /** A named level, or a confidence in `(0, 1)`. */
  readonly reliability?: ReliabilityId | number;
  /** An explicit Poisson multiplier, overriding {@link HashrateOptions.reliability}. */
  readonly multiplier?: number;
}

/** Options for {@link estimate}. */
export interface EstimateOptions extends HashrateOptions {
  /** Which figure to report as the headline hashrate. */
  readonly primaryMode?: PrimaryMode;
  /** Decimal places for {@link Estimate.probabilityDisplay}. */
  readonly probabilityPrecision?: number;
}

/** Options for {@link planFromHashrate}. */
export interface PlanOptions extends EstimateOptions {
  readonly hashrate: HashrateInput;
  readonly seconds: number;
}

/** An inclusive hashrate band `[min, max]` in H/s. */
export interface HashrateRange {
  readonly min: number;
  readonly max: number;
}

/** A difficulty estimate for a note over a time window. */
export interface Estimate {
  readonly sharenote: Sharenote;
  readonly label: string;
  readonly zBits: number;
  readonly seconds: number;
  readonly probabilityPerHash: number;
  readonly probabilityDisplay: string;
  readonly expectedHashes: number;
  readonly requiredHashrateMean: number;
  readonly requiredHashrateQuantile: number;
  readonly requiredHashratePrimary: number;
  readonly requiredHashrateHuman: HumanHashrate;
  readonly multiplier: number;
  readonly quantile: number | null;
  readonly primaryMode: PrimaryMode;
}

/** The note a given rig can earn in a window, with the full {@link Estimate}. */
export interface Plan {
  readonly sharenote: Sharenote;
  readonly estimate: Estimate;
  readonly seconds: number;
  readonly inputHashrate: number;
  readonly inputHashrateHuman: HumanHashrate;
}

/** All named reliability levels, keyed by {@link ReliabilityId}. */
export const RELIABILITY_LEVELS: Readonly<Record<ReliabilityId, ReliabilityLevel>> = {
  [ReliabilityId.Mean]: { id: ReliabilityId.Mean, label: "On average", confidence: null, multiplier: 1 },
  [ReliabilityId.Usually90]: { id: ReliabilityId.Usually90, label: "Usually (90%)", confidence: 0.9, multiplier: 2.302585092994046 },
  [ReliabilityId.Often95]: { id: ReliabilityId.Often95, label: "Often (95%)", confidence: 0.95, multiplier: 2.995732273553991 },
  [ReliabilityId.VeryLikely99]: { id: ReliabilityId.VeryLikely99, label: "Very likely (99%)", confidence: 0.99, multiplier: 4.605170185988092 },
  [ReliabilityId.Almost999]: { id: ReliabilityId.Almost999, label: "Almost certain (99.9%)", confidence: 0.999, multiplier: 6.907755278982137 },
};

/** The reliability levels as an ordered array. */
export function reliabilityLevels(): ReliabilityLevel[] {
  return Object.values(RELIABILITY_LEVELS);
}

const HASHRATE_UNITS: readonly { unit: HashrateUnit; exponent: number }[] = [
  { unit: HashrateUnit.Hps, exponent: 0 },
  { unit: HashrateUnit.KHps, exponent: 1 },
  { unit: HashrateUnit.MHps, exponent: 2 },
  { unit: HashrateUnit.GHps, exponent: 3 },
  { unit: HashrateUnit.THps, exponent: 4 },
  { unit: HashrateUnit.PHps, exponent: 5 },
  { unit: HashrateUnit.EHps, exponent: 6 },
  { unit: HashrateUnit.ZHps, exponent: 7 },
];

const HASH_COUNT_PREFIXES = ["", "K", "M", "G", "T", "P", "E", "Z", "Y"] as const;

const HASHRATE_PREFIX_EXPONENT: Readonly<Record<string, number>> = {
  "": 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6, Z: 7,
};

const HASHRATE_STRING_PATTERN =
  /^([+-]?(?:\d+(?:[_,]?\d+)*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z/\s-]+)?$/;

const float64Buffer = new Float64Array(1);
const float64Bits = new BigUint64Array(float64Buffer.buffer);
const HASHRATE_RANGE_FUDGE_STEPS = 8n;

/** Step a positive float down by `steps` ULPs (used to widen range floors). */
function nextDown(value: number, steps = 1n): number {
  if (!Number.isFinite(value) || value <= 0) {
    return value;
  }
  float64Buffer[0] = value;
  float64Bits[0] -= steps;
  return float64Buffer[0];
}

function resolveUnit(unit?: string | HashrateUnit): { exponent: number; unit: HashrateUnit } {
  if (!unit) {
    return { exponent: 0, unit: HashrateUnit.Hps };
  }
  let normalized = `${unit}`.toUpperCase().replace(/[_\-\s]+/g, "");
  normalized = normalized.replace(/HPS$/, "H/S").replace(/HS$/, "H/S");
  if (!normalized.endsWith("/S") && normalized.includes("H")) {
    normalized = `${normalized}/S`;
  }
  normalized = normalized.replace(/\/S\/S/g, "/S");
  const match = normalized.match(/^([KMGTPEZ]?)(H)\/S$/);
  if (!match) {
    throw new SharenoteError(`unrecognised hashrate unit: "${unit}"`);
  }
  const exponent = HASHRATE_PREFIX_EXPONENT[match[1] ?? ""];
  if (exponent === undefined) {
    throw new SharenoteError(`unsupported hashrate prefix: "${match[1]}"`);
  }
  return { exponent, unit: HASHRATE_UNITS[exponent].unit };
}

/**
 * Parse a hashrate to raw H/s.
 *
 * @example
 * ```ts
 * parseHashrate("5 GH/s");                           // 5_000_000_000
 * parseHashrate({ value: 3.5, unit: HashrateUnit.PHps }); // 3.5e15
 * parseHashrate(5e9);                                // 5_000_000_000
 * ```
 */
export function parseHashrate(input: HashrateInput): number {
  if (typeof input === "number") {
    assertFinite(input, "hashrate");
    if (input < 0) {
      throw new SharenoteError("hashrate must be >= 0");
    }
    return input;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "") {
      throw new SharenoteError("hashrate string must not be empty");
    }
    const match = trimmed.match(HASHRATE_STRING_PATTERN);
    if (!match) {
      throw new SharenoteError(`unrecognised hashrate format: "${input}"`);
    }
    const value = Number(match[1].replace(/[,_]/g, ""));
    assertFinite(value, "hashrate");
    if (value < 0) {
      throw new SharenoteError("hashrate must be >= 0");
    }
    const { exponent } = resolveUnit(match[2]?.trim());
    return value * 10 ** (exponent * 3);
  }
  assertFinite(input.value, "hashrate value");
  if (input.value < 0) {
    throw new SharenoteError("hashrate must be >= 0");
  }
  const { exponent } = resolveUnit(input.unit);
  return input.value * 10 ** (exponent * 3);
}

/** Render a hashrate (H/s) for display, choosing the natural SI unit. */
export function formatHashrate(hps: number, opts?: FormatHashrateOptions): HumanHashrate {
  assertFinite(hps, "hashrate");
  if (hps <= 0) {
    return { value: 0, unit: HashrateUnit.Hps, display: "0 H/s", exponent: 0 };
  }
  const index = Math.min(HASHRATE_UNITS.length - 1, Math.max(0, Math.floor(Math.log10(hps) / 3)));
  const unit = HASHRATE_UNITS[index];
  const scaled = hps / 10 ** (unit.exponent * 3);
  let display: string;
  if (opts?.precision !== undefined) {
    display = scaled.toFixed(Math.max(0, opts.precision));
  } else if (scaled >= 100) {
    display = scaled.toFixed(0);
  } else if (scaled >= 10) {
    display = scaled.toFixed(1);
  } else {
    display = scaled.toFixed(2);
  }
  return {
    value: Number.isFinite(scaled) ? scaled : hps,
    unit: unit.unit,
    exponent: unit.exponent,
    display: `${display} ${unit.unit}`,
  };
}

/** Render a count of hashes for display, e.g. `"2.48 GH/s"`. */
export function formatHashCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 H/s";
  }
  const index = Math.min(HASH_COUNT_PREFIXES.length - 1, Math.max(0, Math.floor(Math.log10(value) / 3)));
  const scaled = value / 10 ** (index * 3);
  let display: string;
  if (scaled >= 100) display = scaled.toFixed(0);
  else if (scaled >= 10) display = scaled.toFixed(1);
  else display = scaled.toFixed(2);
  const prefix = HASH_COUNT_PREFIXES[index];
  return `${display} ${prefix}H/s`;
}

/** Format a per-hash probability as `"1 / 2^<zBits>"`. */
export function formatProbability(zBits: number, precision = 8): string {
  assertFinite(zBits, "zBits");
  return `1 / 2^${zBits.toFixed(precision)}`;
}

/** Probability that a single random hash clears a note's difficulty. */
export function probabilityPerHash(note: SharenoteInput): number {
  return Sharenote.from(note).probabilityPerHash();
}

/** Expected number of hashes to find one share at a note's difficulty. */
export function expectedHashes(note: SharenoteInput): number {
  return Sharenote.from(note).expectedHashes();
}

function resolveMultiplier(opts?: HashrateOptions): number {
  if (opts?.multiplier !== undefined) {
    return opts.multiplier;
  }
  if (opts?.reliability === undefined) {
    return 1;
  }
  return typeof opts.reliability === "number"
    ? -Math.log(1 - opts.reliability)
    : RELIABILITY_LEVELS[opts.reliability].multiplier;
}

/**
 * Hashrate (H/s) needed to find one share at `note`'s difficulty within
 * `seconds`, scaled by the resolved confidence multiplier (default mean).
 */
export function requiredHashrate(
  note: SharenoteInput,
  seconds: number,
  opts?: HashrateOptions
): number {
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  const multiplier = resolveMultiplier(opts);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new SharenoteError("multiplier must be > 0");
  }
  return (Sharenote.from(note).expectedHashes() * multiplier) / seconds;
}

/** Mean (expected) hashrate to find one share within `seconds`. */
export function requiredHashrateMean(note: SharenoteInput, seconds: number): number {
  return requiredHashrate(note, seconds, { multiplier: 1 });
}

/** Hashrate to find one share within `seconds` with the given `confidence`. */
export function requiredHashrateQuantile(
  note: SharenoteInput,
  seconds: number,
  confidence: number
): number {
  if (confidence <= 0 || confidence >= 1) {
    throw new SharenoteError("confidence must be in (0,1)");
  }
  return requiredHashrate(note, seconds, { multiplier: -Math.log(1 - confidence) });
}

/** The hashrate band `[min, max]` whose notes all round to the same label. */
export function hashrateRange(
  note: SharenoteInput,
  seconds: number,
  opts?: HashrateOptions
): HashrateRange {
  const resolved = Sharenote.from(note);
  const lower = requiredHashrate(resolved, seconds, opts);
  const min = lower > 0 ? Math.max(0, nextDown(lower, HASHRATE_RANGE_FUDGE_STEPS)) : 0;
  const upper = requiredHashrate(resolved.zBits + CENTIBIT_STEP, seconds, opts);
  const adjustedMin = Math.min(min, upper);
  return { min: adjustedMin, max: Math.max(adjustedMin, upper) };
}

/** The maximum Z-bits a rig at `hashrate` H/s can reach within `seconds`. */
export function maxZBits(hashrate: number, seconds: number, multiplier = 1): number {
  assertFinite(hashrate, "hashrate");
  assertFinite(seconds, "seconds");
  assertFinite(multiplier, "multiplier");
  if (hashrate <= 0) throw new SharenoteError("hashrate must be > 0");
  if (seconds <= 0) throw new SharenoteError("seconds must be > 0");
  if (multiplier <= 0) throw new SharenoteError("multiplier must be > 0");
  return Math.log2((hashrate * seconds) / multiplier);
}

/** The note a rig at the given hashrate can earn within `seconds`. */
export function sharenoteFromHashrate(
  hashrate: HashrateInput,
  seconds: number,
  opts?: HashrateOptions
): Sharenote {
  const hps = parseHashrate(hashrate);
  return Sharenote.fromZBits(maxZBits(hps, seconds, resolveMultiplier(opts)));
}

/**
 * Compute a full {@link Estimate} for a note over a `seconds` window.
 *
 * @example
 * ```ts
 * const bill = estimate("33Z53", 5, { reliability: 0.95 });
 * bill.requiredHashrateHuman.display; // "7.43 GH/s"
 * bill.probabilityDisplay;            // "1 / 2^33.53000000"
 * ```
 */
export function estimate(
  note: SharenoteInput,
  seconds: number,
  opts?: EstimateOptions
): Estimate {
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  const resolved = Sharenote.from(note);

  let multiplier: number;
  let quantile: number | null;
  if (opts?.multiplier !== undefined) {
    multiplier = opts.multiplier;
    quantile = null;
  } else if (typeof opts?.reliability === "number") {
    if (opts.reliability <= 0 || opts.reliability >= 1) {
      throw new SharenoteError("reliability must be in (0,1)");
    }
    multiplier = -Math.log(1 - opts.reliability);
    quantile = opts.reliability;
  } else if (opts?.reliability) {
    const level = RELIABILITY_LEVELS[opts.reliability];
    multiplier = level.multiplier;
    quantile = level.confidence;
  } else {
    multiplier = 1;
    quantile = null;
  }

  const mean = requiredHashrateMean(resolved, seconds);
  const quantileRate = requiredHashrate(resolved, seconds, { multiplier });
  const primaryMode = opts?.primaryMode ?? (quantile ? PrimaryMode.Quantile : PrimaryMode.Mean);
  const primary = primaryMode === PrimaryMode.Quantile ? quantileRate : mean;

  return {
    sharenote: resolved,
    label: resolved.label,
    zBits: resolved.zBits,
    seconds,
    probabilityPerHash: resolved.probabilityPerHash(),
    probabilityDisplay: formatProbability(resolved.zBits, opts?.probabilityPrecision ?? 8),
    expectedHashes: resolved.expectedHashes(),
    requiredHashrateMean: mean,
    requiredHashrateQuantile: quantileRate,
    requiredHashratePrimary: primary,
    requiredHashrateHuman: formatHashrate(primary),
    multiplier,
    quantile,
    primaryMode,
  };
}

/** Estimate several notes over the same window. */
export function estimateMany(
  notes: readonly SharenoteInput[],
  seconds: number,
  opts?: EstimateOptions
): Estimate[] {
  return notes.map((note) => estimate(note, seconds, opts));
}

/**
 * Plan the note a rig can earn: parse the hashrate, derive the reachable note,
 * and report its full {@link Estimate} in one call.
 */
export function planFromHashrate(opts: PlanOptions): Plan {
  const { hashrate, seconds, ...rest } = opts;
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  const hps = parseHashrate(hashrate);
  if (hps <= 0) {
    throw new SharenoteError("hashrate must be > 0");
  }
  const note = sharenoteFromHashrate(hps, seconds, {
    reliability: rest.reliability,
    multiplier: rest.multiplier,
  });
  return {
    sharenote: note,
    estimate: estimate(note, seconds, rest),
    seconds,
    inputHashrate: hps,
    inputHashrateHuman: formatHashrate(hps),
  };
}
