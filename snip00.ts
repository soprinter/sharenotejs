/**
 * SNIP-0000 — Core Z Arithmetic and Hashrate Conversion.
 *
 * This module implements the foundational mathematics described in
 * `sharenote-snip.md` (see SNIP-0000 in §9) and exposes the public helpers
 * that the rest of the SharenoteJS toolkit builds upon.
 */

const SNIP_0000_IMPLEMENTATION = {
  id: "SNIP-0000",
  title: "Core Z Arithmetic and Hashrate Conversion",
  status: "stable",
  summary:
    "Implements canonical note encoding, probability maths, and hashrate " +
    "planning for the Sharenote proof-of-work format.",
  specification: "../sharenote-snip.md",
} as const;

const CENT_BIT_STEP = 0.01;
const CONTINUOUS_EXPONENT_STEP = CENT_BIT_STEP; // backwards compatibility alias
const MAX_CENTS = 99;
const MIN_CENTS = 0;
enum ReliabilityId {
  Mean = "mean",
  Usually90 = "usually_90",
  Often95 = "often_95",
  VeryLikely99 = "very_likely_99",
  Almost999 = "almost_999",
}

interface ReliabilityLevel {
  id: ReliabilityId;
  label: string;
  confidence: number | null;
  multiplier: number;
}

interface Sharenote {
  z: number;
  cents: number;
  bits: number;
  label: string;
}

interface HumanHashrate {
  value: number;
  unit: string;
  display: string;
  exponent: number;
}

enum HashrateUnit {
  Hps = "H/s",
  KHps = "kH/s",
  MHps = "MH/s",
  GHps = "GH/s",
  THps = "TH/s",
  PHps = "PH/s",
  EHps = "EH/s",
  ZHps = "ZH/s",
}

interface HashrateDescriptor {
  value: number;
  unit?: HashrateUnit;
}

type HashrateValue = number | HashrateDescriptor;
type HashrateParseInput = HashrateValue | string;

enum PrimaryMode {
  Mean = "mean",
  Quantile = "quantile",
}

interface BillEstimate {
  sharenote: Sharenote;
  label: string;
  bits: number;
  secondsTarget: number;
  probabilityPerHash: number;
  probabilityDisplay: string;
  expectedHashes: number;
  requiredHashrateMean: number;
  requiredHashrateQuantile: number;
  requiredHashratePrimary: number;
  requiredHashrateHuman: HumanHashrate;
  multiplier: number;
  quantile: number | null;
  primaryMode: PrimaryMode;
}

const RELIABILITY_LEVELS: Record<ReliabilityId, ReliabilityLevel> = {
  [ReliabilityId.Mean]: {
    id: ReliabilityId.Mean,
    label: "On average",
    confidence: null,
    multiplier: 1,
  },
  [ReliabilityId.Usually90]: {
    id: ReliabilityId.Usually90,
    label: "Usually (90%)",
    confidence: 0.9,
    multiplier: 2.302585092994046,
  },
  [ReliabilityId.Often95]: {
    id: ReliabilityId.Often95,
    label: "Often (95%)",
    confidence: 0.95,
    multiplier: 2.995732273553991,
  },
  [ReliabilityId.VeryLikely99]: {
    id: ReliabilityId.VeryLikely99,
    label: "Very likely (99%)",
    confidence: 0.99,
    multiplier: 4.605170185988092,
  },
  [ReliabilityId.Almost999]: {
    id: ReliabilityId.Almost999,
    label: "Almost certain (99.9%)",
    confidence: 0.999,
    multiplier: 6.907755278982137,
  },
};

class SharenoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharenoteError";
  }
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new SharenoteError(`${field} must be a finite number`);
  }
}

function clampCents(cents: number): number {
  if (!Number.isFinite(cents)) {
    throw new SharenoteError("cents must be a finite number");
  }
  const rounded = Math.trunc(Math.round(cents));
  if (rounded < MIN_CENTS) return MIN_CENTS;
  if (rounded > MAX_CENTS) return MAX_CENTS;
  return rounded;
}

function bitsFromComponents(z: number, cents: number): number {
  assertFinite(z, "z");
  assertFinite(cents, "cents");
  if (!Number.isInteger(z) || z < 0) {
    throw new SharenoteError("z must be a non-negative integer");
  }
  const normalizedCents = clampCents(cents);
  return z + normalizedCents * CENT_BIT_STEP;
}

function formatLabel(z: number, cents: number): string {
  const normalizedCents = clampCents(cents);
  return `${z}Z${normalizedCents.toString().padStart(2, "0")}`;
}

function sanitizeLabel(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function parseLabel(label: string): { z: number; cents: number } {
  const cleaned = sanitizeLabel(label);

  const simpleMatch = cleaned.match(/^(\d+)Z(?:(\d{1,2})(?:CZ)?)?$/);
  if (simpleMatch) {
    const z = Number.parseInt(simpleMatch[1], 10);
    const cents = simpleMatch[2]
      ? Number.parseInt(simpleMatch[2], 10)
      : 0;
    return {
      z,
      cents: clampCents(cents),
    };
  }

  const spacedMatch = cleaned.match(/^(\d+)\.(\d{1,2})Z$/);
  if (spacedMatch) {
    const z = Number.parseInt(spacedMatch[1], 10);
    const decimals = spacedMatch[2].padEnd(2, "0").slice(0, 2);
    const cents = Number.parseInt(decimals, 10);
    return { z, cents: clampCents(cents) };
  }

  const decimalMatch = cleaned.match(/^(\d+(?:\.\d+)?)Z$/);
  if (decimalMatch) {
    const bits = Number.parseFloat(decimalMatch[1]);
    assertFinite(bits, "bits");
    const note = noteFromBits(bits);
    return { z: note.z, cents: note.cents };
  }

  throw new SharenoteError(`Unrecognised Sharenote label: "${label}"`);
}

function noteFromComponents(z: number, cents: number): Sharenote {
  const normalizedZ = Math.trunc(z);
  const normalizedCents = clampCents(cents);
  const bits = bitsFromComponents(normalizedZ, normalizedCents);
  return {
    z: normalizedZ,
    cents: normalizedCents,
    bits,
    label: formatLabel(normalizedZ, normalizedCents),
  };
}

function noteFromBits(bits: number): Sharenote {
  assertFinite(bits, "bits");
  if (bits < 0) {
    throw new SharenoteError("bits must be non-negative");
  }
  const z = Math.floor(bits);
  const fractionalBits = bits - z;
  const rawCents = Math.floor(fractionalBits / CENT_BIT_STEP + 1e-9);
  const cents = clampCents(rawCents);
  return noteFromComponents(z, cents);
}

function difficultyFromBits(bits: number): number {
  return 2 ** bits;
}

function difficultyFromNote(
  note: Sharenote | string | { z: number; cents: number }
): number {
  return difficultyFromBits(ensureNote(note).bits);
}

function bitsFromDifficulty(difficulty: number): number {
  if (!Number.isFinite(difficulty) || difficulty <= 0) {
    throw new SharenoteError("difficulty must be > 0");
  }
  return Math.log2(difficulty);
}

function ensureNote(input: Sharenote | string | { z: number; cents: number }): Sharenote {
  if (typeof input === "string") {
    const { z, cents } = parseLabel(input);
    return noteFromComponents(z, cents);
  }
  if ("label" in input && "bits" in input) {
    return input;
  }
  if ("z" in input && "cents" in input) {
    return noteFromComponents(input.z, input.cents);
  }
  throw new SharenoteError("Unsupported Sharenote input");
}

function probabilityFromBits(bits: number): number {
  assertFinite(bits, "bits");
  return 2 ** -bits;
}

function expectedHashes(bits: number): number {
  return 1 / probabilityFromBits(bits);
}

function requiredHashrateBits(bits: number, seconds: number, multiplier = 1): number {
  assertFinite(seconds, "seconds");
  assertFinite(multiplier, "multiplier");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  if (multiplier <= 0) {
    throw new SharenoteError("multiplier must be > 0");
  }
  return (expectedHashes(bits) * multiplier) / seconds;
}

function reliabilityById(id: ReliabilityId): ReliabilityLevel {
  return RELIABILITY_LEVELS[id];
}

function requiredHashrate(
  note: Sharenote | string | { z: number; cents: number },
  seconds: number,
  options?: { reliability?: ReliabilityId | number; multiplier?: number }
): number {
  const resolved = ensureNote(note);
  let multiplier = 1;
  if (options?.multiplier) {
    multiplier = options.multiplier;
  } else if (options?.reliability) {
    if (typeof options.reliability === "number") {
      multiplier = -Math.log(1 - options.reliability);
    } else {
      multiplier = reliabilityById(options.reliability).multiplier;
    }
  }
  return requiredHashrateBits(resolved.bits, seconds, multiplier);
}

function requiredHashrateMean(
  note: Sharenote | string | { z: number; cents: number },
  seconds: number
): number {
  return requiredHashrate(note, seconds, { multiplier: 1 });
}

function requiredHashrateQuantile(
  note: Sharenote | string | { z: number; cents: number },
  seconds: number,
  confidence: number
): number {
  if (confidence <= 0 || confidence >= 1) {
    throw new SharenoteError("confidence must be between 0 and 1 (exclusive)");
  }
  const multiplier = -Math.log(1 - confidence);
  return requiredHashrate(note, seconds, { multiplier });
}

function maxBitsForHashrate(
  hashrate: number,
  seconds: number,
  multiplier = 1
): number {
  assertFinite(hashrate, "hashrate");
  assertFinite(seconds, "seconds");
  assertFinite(multiplier, "multiplier");
  if (hashrate <= 0) {
    throw new SharenoteError("hashrate must be > 0");
  }
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  if (multiplier <= 0) {
    throw new SharenoteError("multiplier must be > 0");
  }
  const value = hashrate * seconds / multiplier;
  return Math.log2(value);
}

function noteFromHashrate(
  hashrate: HashrateValue,
  seconds: number,
  options?: { reliability?: ReliabilityId | number; multiplier?: number }
): Sharenote {
  const resolvedHashrate = normalizeHashrateValue(hashrate);
  let multiplier = 1;
  if (options?.multiplier) {
    multiplier = options.multiplier;
  } else if (options?.reliability) {
    multiplier =
      typeof options.reliability === "number"
        ? -Math.log(1 - options.reliability)
        : reliabilityById(options.reliability).multiplier;
  }
  const bits = maxBitsForHashrate(resolvedHashrate, seconds, multiplier);
  return noteFromBits(bits);
}

function targetFor(
  note: Sharenote | string | { z: number; cents: number }
): bigint {
  const resolved = ensureNote(note);
  const bits = resolved.bits;
  const integerBits = Math.floor(bits);
  const fractionalBits = bits - integerBits;
  const baseExponent = 256 - integerBits;
  if (baseExponent < 0) {
    throw new SharenoteError("z is too large; target would underflow");
  }
  const scale = Math.pow(2, -fractionalBits);
  const precisionBits = 48;
  const scaleFactor = Math.round(scale * 2 ** precisionBits);
  const base = 1n << BigInt(baseExponent);
  return (base * BigInt(scaleFactor)) >> BigInt(precisionBits);
}

function probabilityPerHash(
  note: Sharenote | string | { z: number; cents: number }
): number {
  const resolved = ensureNote(note);
  return probabilityFromBits(resolved.bits);
}

function expectedHashesForNote(
  note: Sharenote | string | { z: number; cents: number }
): number {
  const resolved = ensureNote(note);
  return expectedHashes(resolved.bits);
}

function compareNotes(
  a: Sharenote | string | { z: number; cents: number },
  b: Sharenote | string | { z: number; cents: number }
): number {
  const noteA = ensureNote(a);
  const noteB = ensureNote(b);
  if (noteA.z !== noteB.z) {
    return noteA.z - noteB.z;
  }
  return noteA.cents - noteB.cents;
}

function nbitsToSharenote(hex: string): Sharenote {
  const cleaned = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{8}$/.test(cleaned)) {
    throw new SharenoteError("nBits must be an 8-character hex string");
  }
  const n = Number.parseInt(cleaned, 16);
  const exponent = n >>> 24;
  const mantissa = n & 0xFFFFFF;
  if (mantissa === 0) {
    throw new SharenoteError("mantissa must be non-zero");
  }
  const log2Target = Math.log2(mantissa) + 8 * (exponent - 3);
  const bits = 256 - log2Target;
  return noteFromBits(bits);
}

function getReliabilityLevels(): ReliabilityLevel[] {
  return Object.values(RELIABILITY_LEVELS);
}

function formatProbabilityDisplay(bits: number, precision = 8): string {
  assertFinite(bits, "bits");
  return `1 / 2^${bits.toFixed(precision)}`;
}

const HASHRATE_UNITS = [
  { unit: "H/s", threshold: 0 },
  { unit: "kH/s", threshold: 1 },
  { unit: "MH/s", threshold: 2 },
  { unit: "GH/s", threshold: 3 },
  { unit: "TH/s", threshold: 4 },
  { unit: "PH/s", threshold: 5 },
  { unit: "EH/s", threshold: 6 },
  { unit: "ZH/s", threshold: 7 },
];

const HASHRATE_PREFIX_EXPONENT: Record<string, number> = {
  "": 0,
  K: 1,
  M: 2,
  G: 3,
  T: 4,
  P: 5,
  E: 6,
  Z: 7,
};

const HASHRATE_STRING_PATTERN =
  /^([+-]?(?:\d+(?:[_,]?\d+)*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z\/\s-]+)?$/;

function resolveHashrateUnit(
  unit?: string | HashrateUnit
): { exponent: number; unit: string } {
  if (!unit) {
    return { exponent: 0, unit: HASHRATE_UNITS[0].unit };
  }

  const raw =
    typeof unit === "string" ? unit : (unit as HashrateUnit).valueOf();
  if (raw.trim() === "") {
    return { exponent: 0, unit: HASHRATE_UNITS[0].unit };
  }
  let normalized = raw.toUpperCase();
  normalized = normalized.replace(/[_\-\s]+/g, "");
  normalized = normalized.replace(/HPS$/, "H/S");
  normalized = normalized.replace(/HS$/, "H/S");
  if (!normalized.endsWith("/S") && normalized.includes("H")) {
    normalized = `${normalized}/S`;
  }
  normalized = normalized.replace(/\/S\/S/g, "/S");

  const match = normalized.match(/^([KMGTPEZ]?)(H)\/S$/);
  if (!match) {
    throw new SharenoteError(`Unrecognised hashrate unit: "${unit}"`);
  }

  const prefix = match[1] ?? "";
  const exponent = HASHRATE_PREFIX_EXPONENT[prefix];
  if (exponent === undefined) {
    throw new SharenoteError(`Unsupported hashrate prefix: "${prefix}"`);
  }

  const canonicalUnit = HASHRATE_UNITS[exponent]?.unit;
  if (!canonicalUnit) {
    throw new SharenoteError(`No canonical unit for exponent: ${exponent}`);
  }

  return { exponent, unit: canonicalUnit };
}

function normalizeHashrateValue(input: HashrateValue): number {
  if (typeof input === "number") {
    assertFinite(input, "hashrate");
    if (input < 0) {
      throw new SharenoteError("hashrate must be >= 0");
    }
    return input;
  }
  if (typeof input === "object" && input !== null) {
    const descriptor = input as HashrateDescriptor;
    if (typeof descriptor.value !== "number") {
      throw new SharenoteError("hashrate descriptor value must be a number");
    }
    assertFinite(descriptor.value, "hashrate value");
    if (descriptor.value < 0) {
      throw new SharenoteError("hashrate must be >= 0");
    }
    const { exponent } = resolveHashrateUnit(descriptor.unit);
    return descriptor.value * Math.pow(10, exponent * 3);
  }
  throw new SharenoteError("Unsupported hashrate input");
}

function parseHashrate(input: HashrateParseInput): number {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "") {
      throw new SharenoteError("hashrate string must not be empty");
    }
    const match = trimmed.match(HASHRATE_STRING_PATTERN);
    if (!match) {
      throw new SharenoteError(`Unrecognised hashrate format: "${input}"`);
    }
    const magnitudeRaw = match[1].replace(/[,_]/g, "");
    const value = Number(magnitudeRaw);
    assertFinite(value, "hashrate");
    if (value < 0) {
      throw new SharenoteError("hashrate must be >= 0");
    }
    const unit =
      match[2] && match[2].trim() !== "" ? match[2].trim() : undefined;
    const { exponent } = resolveHashrateUnit(unit);
    return value * Math.pow(10, exponent * 3);
  }

  return normalizeHashrateValue(input);
}

function humanHashrate(hashrate: number): HumanHashrate {
  assertFinite(hashrate, "hashrate");
  if (hashrate <= 0) {
    return { value: 0, unit: "H/s", display: "0 H/s", exponent: 0 };
  }

  const logValue = Math.log10(hashrate);
  const unitIndex = Math.min(
    HASHRATE_UNITS.length - 1,
    Math.floor(logValue / 3)
  );
  const exponent = HASHRATE_UNITS[unitIndex].threshold;
  const scaled =
    hashrate / Math.pow(10, exponent * 3);
  const value = Number.isFinite(scaled) ? scaled : hashrate;
  const displayValue =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return {
    value,
    unit: HASHRATE_UNITS[unitIndex].unit,
    exponent,
    display: `${displayValue} ${HASHRATE_UNITS[unitIndex].unit}`,
  };
}

interface EstimateOptions {
  reliability?: ReliabilityId | number;
  multiplier?: number;
  primaryMode?: PrimaryMode;
  probabilityPrecision?: number;
}

interface HashratePlanOptions extends EstimateOptions {
  hashrate: HashrateValue;
  seconds: number;
}

interface SharenotePlan {
  sharenote: Sharenote;
  bill: BillEstimate;
  secondsTarget: number;
  inputHashrateHps: number;
  inputHashrateHuman: HumanHashrate;
}

function resolveMultiplier(
  opts?: EstimateOptions
): { multiplier: number; quantile: number | null } {
  if (opts?.multiplier) {
    return { multiplier: opts.multiplier, quantile: null };
  }
  if (typeof opts?.reliability === "number") {
    const q = opts.reliability;
    if (q <= 0 || q >= 1) {
      throw new SharenoteError("reliability must be in (0,1)");
    }
    return { multiplier: -Math.log(1 - q), quantile: q };
  }
  if (opts?.reliability) {
    const level = reliabilityById(opts.reliability);
    return {
      multiplier: level.multiplier,
      quantile: level.confidence ?? null,
    };
  }
  return { multiplier: 1, quantile: null };
}

function estimateSharenote(
  note: Sharenote | string | { z: number; cents: number },
  seconds: number,
  options?: EstimateOptions
): BillEstimate {
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }

  const resolved = ensureNote(note);
  const { multiplier, quantile } = resolveMultiplier(options);
  const probability = probabilityPerHash(resolved);
  const expectation = expectedHashesForNote(resolved);
  const mean = requiredHashrateMean(resolved, seconds);
  const quantileHashrate =
    options?.primaryMode === PrimaryMode.Mean && quantile === null
      ? requiredHashrate(resolved, seconds, { multiplier: 1 })
      : requiredHashrate(resolved, seconds, { multiplier });

  const resolvedPrimaryMode =
    options?.primaryMode ?? (quantile ? PrimaryMode.Quantile : PrimaryMode.Mean);
  const primary =
    resolvedPrimaryMode === PrimaryMode.Quantile ? quantileHashrate : mean;

  return {
    sharenote: resolved,
    label: resolved.label,
    bits: resolved.bits,
    secondsTarget: seconds,
    probabilityPerHash: probability,
    probabilityDisplay: formatProbabilityDisplay(
      resolved.bits,
      options?.probabilityPrecision ?? 8
    ),
    expectedHashes: expectation,
    requiredHashrateMean: mean,
    requiredHashrateQuantile: quantileHashrate,
    requiredHashratePrimary: primary,
    requiredHashrateHuman: humanHashrate(primary),
    multiplier,
    quantile,
    primaryMode: resolvedPrimaryMode,
  };
}

function estimateSharenotes(
  notes: Array<Sharenote | string | { z: number; cents: number }>,
  seconds: number,
  options?: EstimateOptions
): BillEstimate[] {
  return notes.map((note) => estimateSharenote(note, seconds, options));
}

function planSharenoteFromHashrate(options: HashratePlanOptions): SharenotePlan {
  const { hashrate, seconds, ...estimateOptions } = options;
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  const numericHashrate = normalizeHashrateValue(hashrate);
  if (numericHashrate <= 0) {
    throw new SharenoteError("hashrate must be > 0");
  }

  const { reliability, multiplier, primaryMode, probabilityPrecision } =
    estimateOptions;

  const note = noteFromHashrate(numericHashrate, seconds, {
    reliability,
    multiplier,
  });

  const bill = estimateSharenote(note, seconds, {
    reliability,
    multiplier,
    primaryMode,
    probabilityPrecision,
  });

  return {
    sharenote: note,
    bill,
    secondsTarget: seconds,
    inputHashrateHps: numericHashrate,
    inputHashrateHuman: humanHashrate(numericHashrate),
  };
}

function combineNotesSerial(
  notes: Array<Sharenote | string | { z: number; cents: number }>
): Sharenote {
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new SharenoteError("notes array must not be empty");
  }
  const totalDifficulty = notes.reduce(
    (acc, note) => acc + difficultyFromNote(note),
    0
  );
  if (!Number.isFinite(totalDifficulty) || totalDifficulty <= 0) {
    return noteFromBits(0);
  }
  return noteFromBits(bitsFromDifficulty(totalDifficulty));
}

function noteDifference(
  minuend: Sharenote | string | { z: number; cents: number },
  subtrahend: Sharenote | string | { z: number; cents: number }
): Sharenote {
  const diff =
    difficultyFromNote(minuend) - difficultyFromNote(subtrahend);
  if (diff <= 0) {
    return noteFromBits(0);
  }
  return noteFromBits(bitsFromDifficulty(diff));
}

function scaleNote(
  note: Sharenote | string | { z: number; cents: number },
  factor: number
): Sharenote {
  assertFinite(factor, "factor");
  if (factor < 0) {
    throw new SharenoteError("factor must be >= 0");
  }
  if (factor === 0) {
    return noteFromBits(0);
  }
  const scaled = difficultyFromNote(note) * factor;
  return noteFromBits(bitsFromDifficulty(scaled));
}

function divideNote(
  numerator: Sharenote | string | { z: number; cents: number },
  denominator: Sharenote | string | { z: number; cents: number }
): number {
  const num = difficultyFromNote(numerator);
  const den = difficultyFromNote(denominator);
  if (den <= 0) {
    throw new SharenoteError("division by a zero-difficulty note");
  }
  return num / den;
}

export {
  SNIP_0000_IMPLEMENTATION,
  CENT_BIT_STEP,
  CONTINUOUS_EXPONENT_STEP,
  MAX_CENTS,
  MIN_CENTS,
  RELIABILITY_LEVELS,
  ReliabilityId,
  SharenoteError,
  estimateSharenote,
  estimateSharenotes,
  combineNotesSerial,
  noteDifference,
  scaleNote,
  divideNote,
  bitsFromComponents,
  compareNotes,
  ensureNote,
  expectedHashes,
  expectedHashesForNote,
  formatLabel as formatNoteLabel,
  getReliabilityLevels,
  humanHashrate,
  parseHashrate,
  maxBitsForHashrate,
  nbitsToSharenote,
  noteFromBits,
  noteFromComponents,
  noteFromHashrate,
  parseLabel as parseNoteLabel,
  planSharenoteFromHashrate,
  PrimaryMode,
  HashrateUnit,
  probabilityFromBits,
  probabilityPerHash,
  requiredHashrate,
  requiredHashrateMean,
  requiredHashrateQuantile,
  targetFor,
  formatProbabilityDisplay,
};

export type {
  ReliabilityLevel,
  Sharenote,
  HumanHashrate,
  BillEstimate,
  EstimateOptions,
  HashrateValue,
  HashrateParseInput,
  HashrateDescriptor,
  HashratePlanOptions,
  SharenotePlan,
};
