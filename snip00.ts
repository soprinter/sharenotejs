const CENT_ZBIT_STEP = 0.01;
const CONTINUOUS_EXPONENT_STEP = CENT_ZBIT_STEP;
const MIN_CENTZ = 0;
const MAX_CENTZ = 99;
const CENTZ_UNITS_PER_Z = Math.round(1 / CENT_ZBIT_STEP);

enum ReliabilityId {
  Mean = "mean",
  Usually90 = "usually_90",
  Often95 = "often_95",
  VeryLikely99 = "very_likely_99",
  Almost999 = "almost_999",
}

enum PrimaryMode {
  Mean = "mean",
  Quantile = "quantile",
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

interface ReliabilityLevel {
  id: ReliabilityId;
  label: string;
  confidence: number | null;
  multiplier: number;
}

interface HumanHashrateOptions {
  precision?: number;
}

interface HumanHashrate {
  value: number;
  unit: string;
  display: string;
  exponent: number;
}

interface HashrateDescriptor {
  value: number;
  unit?: HashrateUnit;
}

type HashrateValue = number | HashrateDescriptor;
type HashrateParseInput = HashrateValue | string;

type SharenoteLike = Sharenote | string | number | { z: number; cents: number };

interface HashrateOptions {
  reliability?: ReliabilityId | number;
  multiplier?: number;
}

interface EstimateOptions extends HashrateOptions {
  primaryMode?: PrimaryMode;
  probabilityPrecision?: number;
}

interface HashratePlanOptions extends EstimateOptions {
  hashrate: HashrateValue;
  seconds: number;
}

interface BillEstimate {
  sharenote: Sharenote;
  label: string;
  zBits: number;
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

interface SharenotePlan {
  sharenote: Sharenote;
  bill: BillEstimate;
  secondsTarget: number;
  inputHashrateHps: number;
  inputHashrateHuman: HumanHashrate;
}

class SharenoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharenoteError";
  }
}

class HashrateMeasurement {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  floatValue(): number {
    return this.value;
  }

  human(opts?: HumanHashrateOptions): HumanHashrate {
    return humanHashrate(this.value, opts);
  }

  toString(): string {
    return this.human().display;
  }
}

class HashesMeasurement {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  floatValue(): number {
    return this.value;
  }

  toString(): string {
    return formatHashCount(this.value);
  }
}

class HashrateRange {
  readonly minimum: number;
  readonly maximum: number;

  constructor(minimum: number, maximum: number) {
    this.minimum = minimum;
    this.maximum = maximum;
  }

  human(opts?: HumanHashrateOptions): [HumanHashrate, HumanHashrate] {
    return [humanHashrate(this.minimum, opts), humanHashrate(this.maximum, opts)];
  }
}

class Sharenote {
  readonly z: number;
  readonly cents: number;
  readonly zBits: number;
  private readonly labelOverride?: string;

  constructor(z: number, cents: number, zBits: number, labelOverride?: string) {
    this.z = z;
    this.cents = cents;
    this.zBits = zBits;
    this.labelOverride = labelOverride;
  }

  get label(): string {
    return this.labelOverride ?? formatLabel(this.z, this.cents);
  }

  toString(): string {
    return this.label;
  }

  probabilityPerHash(): number {
    return probabilityFromZBits(this.zBits);
  }

  expectedHashes(): HashesMeasurement {
    return expectedHashesForZBits(this.zBits);
  }

  requiredHashrate(seconds: number, options?: HashrateOptions): HashrateMeasurement {
    return requiredHashrate(this, seconds, options);
  }

  requiredHashrateMean(seconds: number): HashrateMeasurement {
    return requiredHashrateMean(this, seconds);
  }

  requiredHashrateQuantile(seconds: number, confidence: number): HashrateMeasurement {
    return requiredHashrateQuantile(this, seconds, confidence);
  }

  requiredHashrateMeasurement(seconds: number, options?: HashrateOptions): HashrateMeasurement {
    return requiredHashrate(this, seconds, options);
  }

  requiredHashrateMeanMeasurement(seconds: number): HashrateMeasurement {
    return requiredHashrateMean(this, seconds);
  }

  requiredHashrateQuantileMeasurement(seconds: number, confidence: number): HashrateMeasurement {
    return requiredHashrateQuantile(this, seconds, confidence);
  }

  hashrateRange(seconds: number, options?: HashrateOptions): HashrateRange {
    return hashrateRangeForNote(this, seconds, options);
  }

  target(): bigint {
    return targetFor(this);
  }

  combineSerial(...others: SharenoteLike[]): Sharenote {
    return combineNotesSerial([this, ...others]);
  }

  difference(other: SharenoteLike): Sharenote {
    return noteDifference(this, other);
  }

  scale(factor: number): Sharenote {
    return scaleNote(this, factor);
  }

  nBits(): string {
    return sharenoteToNBits(this);
  }
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

const HASHRATE_UNITS = [
  { unit: HashrateUnit.Hps, exponent: 0 },
  { unit: HashrateUnit.KHps, exponent: 1 },
  { unit: HashrateUnit.MHps, exponent: 2 },
  { unit: HashrateUnit.GHps, exponent: 3 },
  { unit: HashrateUnit.THps, exponent: 4 },
  { unit: HashrateUnit.PHps, exponent: 5 },
  { unit: HashrateUnit.EHps, exponent: 6 },
  { unit: HashrateUnit.ZHps, exponent: 7 },
];

const HASH_COUNT_UNITS = [
  { prefix: "", exponent: 0 },
  { prefix: "K", exponent: 1 },
  { prefix: "M", exponent: 2 },
  { prefix: "G", exponent: 3 },
  { prefix: "T", exponent: 4 },
  { prefix: "P", exponent: 5 },
  { prefix: "E", exponent: 6 },
  { prefix: "Z", exponent: 7 },
  { prefix: "Y", exponent: 8 },
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

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new SharenoteError(`${field} must be a finite number`);
  }
}

function clampCentZ(cents: number): number {
  assertFinite(cents, "cents");
  const normalized = Math.trunc(Math.round(cents));
  if (normalized < MIN_CENTZ) return MIN_CENTZ;
  if (normalized > MAX_CENTZ) return MAX_CENTZ;
  return normalized;
}

function formatLabel(z: number, cents: number): string {
  const normalizedCents = clampCentZ(cents);
  return `${z}Z${normalizedCents.toString().padStart(2, "0")}`;
}

function sanitizeLabel(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function parseLabel(label: string): Sharenote {
  const cleaned = sanitizeLabel(label);

  const simpleMatch = cleaned.match(/^(\d+)Z(?:(\d{1,2})(?:CZ)?)?$/);
  if (simpleMatch) {
    const z = Number.parseInt(simpleMatch[1], 10);
    const cents = simpleMatch[2] ? Number.parseInt(simpleMatch[2], 10) : 0;
    return noteFromComponents(z, cents);
  }

  const dottedMatch = cleaned.match(/^(\d+)\.(\d{1,2})Z$/);
  if (dottedMatch) {
    const z = Number.parseInt(dottedMatch[1], 10);
    const decimals = dottedMatch[2].padEnd(2, "0").slice(0, 2);
    return noteFromComponents(z, Number.parseInt(decimals, 10));
  }

  const decimalMatch = cleaned.match(/^(\d+(?:\.\d+)?)Z$/);
  if (decimalMatch) {
    const zBits = Number.parseFloat(decimalMatch[1]);
    assertFinite(zBits, "zBits");
    return noteFromZBits(zBits);
  }

  throw new SharenoteError(`Unrecognised Sharenote label: "${label}"`);
}

function labelComponentsFromZBits(zBits: number): { z: number; cents: number } {
  const z = Math.floor(zBits);
  const fractional = zBits - z;
  const rawCents = Math.floor(fractional / CENT_ZBIT_STEP + 1e-9);
  return { z: z < 0 ? 0 : z, cents: clampCentZ(rawCents) };
}

function zBitsFromComponents(z: number, cents: number): number {
  assertFinite(z, "z");
  assertFinite(cents, "cents");
  if (!Number.isInteger(z) || z < 0) {
    throw new SharenoteError("z must be a non-negative integer");
  }
  return z + clampCentZ(cents) * CENT_ZBIT_STEP;
}

function noteFromComponents(z: number, cents: number): Sharenote {
  if (!Number.isInteger(z) || z < 0) {
    throw new SharenoteError("z must be a non-negative integer");
  }
  const normalizedCents = clampCentZ(cents);
  const zBits = zBitsFromComponents(z, normalizedCents);
  return new Sharenote(z, normalizedCents, zBits);
}

function noteFromCentZBits(centZ: number): Sharenote {
  assertFinite(centZ, "centZ");
  if (centZ < 0) {
    throw new SharenoteError("cent-z value must be non-negative");
  }
  const z = Math.floor(centZ / CENTZ_UNITS_PER_Z);
  const cents = centZ % CENTZ_UNITS_PER_Z;
  return noteFromComponents(z, cents);
}

function mustNoteFromCentZBits(centZ: number): Sharenote {
  return noteFromCentZBits(centZ);
}

function noteFromZBits(zBits: number): Sharenote {
  assertFinite(zBits, "zBits");
  if (zBits < 0) {
    throw new SharenoteError("zBits must be non-negative");
  }
  const { z, cents } = labelComponentsFromZBits(zBits);
  return new Sharenote(z, cents, zBits);
}

function mustNoteFromZBits(zBits: number): Sharenote {
  return noteFromZBits(zBits);
}

function difficultyFromZBits(zBits: number): number {
  return 2 ** zBits;
}

function zBitsFromDifficulty(difficulty: number): number {
  assertFinite(difficulty, "difficulty");
  if (difficulty <= 0) {
    throw new SharenoteError("difficulty must be > 0");
  }
  return Math.log2(difficulty);
}

function difficultyFromNote(note: SharenoteLike): number {
  return difficultyFromZBits(ensureNote(note).zBits);
}

function ensureNote(input: SharenoteLike): Sharenote {
  if (input instanceof Sharenote) {
    return input;
  }
  if (typeof input === "string") {
    return parseLabel(input);
  }
  if (typeof input === "number") {
    assertFinite(input, "zBits");
    return noteFromZBits(input);
  }
  if (typeof input === "object" && input !== null) {
    const candidate = input as { z?: number; cents?: number };
    if (typeof candidate.z === "number" && typeof candidate.cents === "number") {
      return noteFromComponents(candidate.z, candidate.cents);
    }
  }
  throw new SharenoteError("Unsupported Sharenote input");
}

function probabilityFromZBits(zBits: number): number {
  assertFinite(zBits, "zBits");
  return 2 ** -zBits;
}

function probabilityPerHash(note: SharenoteLike): number {
  const resolved = ensureNote(note);
  return probabilityFromZBits(resolved.zBits);
}

function expectedHashesScalarFromZBits(zBits: number): number {
  const probability = probabilityFromZBits(zBits);
  return 1 / probability;
}

function expectedHashesForZBits(zBits: number): HashesMeasurement {
  return new HashesMeasurement(expectedHashesScalarFromZBits(zBits));
}

function expectedHashesForNote(note: SharenoteLike): HashesMeasurement {
  const resolved = ensureNote(note);
  return expectedHashesForZBits(resolved.zBits);
}

function expectedHashesMeasurement(note: SharenoteLike): HashesMeasurement {
  return expectedHashesForNote(note);
}

function requiredHashrateValue(
  note: SharenoteLike,
  seconds: number,
  options?: HashrateOptions
): number {
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  let multiplier = 1;
  if (options?.multiplier !== undefined) {
    multiplier = options.multiplier;
  } else if (options?.reliability !== undefined) {
    multiplier =
      typeof options.reliability === "number"
        ? -Math.log(1 - options.reliability)
        : RELIABILITY_LEVELS[options.reliability].multiplier;
  }
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new SharenoteError("multiplier must be > 0");
  }
  const resolved = ensureNote(note);
  const expected = expectedHashesScalarFromZBits(resolved.zBits);
  return (expected * multiplier) / seconds;
}

function requiredHashrate(
  note: SharenoteLike,
  seconds: number,
  options?: HashrateOptions
): HashrateMeasurement {
  return new HashrateMeasurement(requiredHashrateValue(note, seconds, options));
}

function requiredHashrateMean(note: SharenoteLike, seconds: number): HashrateMeasurement {
  return requiredHashrate(note, seconds, { multiplier: 1 });
}

function requiredHashrateQuantile(
  note: SharenoteLike,
  seconds: number,
  confidence: number
): HashrateMeasurement {
  if (confidence <= 0 || confidence >= 1) {
    throw new SharenoteError("confidence must be in (0,1)");
  }
  return requiredHashrate(note, seconds, { multiplier: -Math.log(1 - confidence) });
}

function requiredHashrateMeasurement(
  note: SharenoteLike,
  seconds: number,
  options?: HashrateOptions
): HashrateMeasurement {
  return requiredHashrate(note, seconds, options);
}

function requiredHashrateMeanMeasurement(note: SharenoteLike, seconds: number): HashrateMeasurement {
  return requiredHashrateMean(note, seconds);
}

function requiredHashrateQuantileMeasurement(
  note: SharenoteLike,
  seconds: number,
  confidence: number
): HashrateMeasurement {
  return requiredHashrateQuantile(note, seconds, confidence);
}

function hashrateRangeForNote(
  note: SharenoteLike,
  seconds: number,
  options?: HashrateOptions
): HashrateRange {
  const resolved = ensureNote(note);
  const minimum = requiredHashrateValue(resolved, seconds, options);
  const maximumCandidate = requiredHashrateValue(resolved.zBits + CENT_ZBIT_STEP, seconds, options);
  const maximum = Math.max(minimum, maximumCandidate);
  return new HashrateRange(minimum, maximum);
}

function maxZBitsForHashrate(hashrate: number, seconds: number, multiplier = 1): number {
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
  return Math.log2((hashrate * seconds) / multiplier);
}

function noteFromHashrate(
  hashrate: HashrateValue,
  seconds: number,
  options?: HashrateOptions
): Sharenote {
  const numeric = normalizeHashrateValue(hashrate);
  let multiplier = 1;
  if (options?.multiplier !== undefined) {
    multiplier = options.multiplier;
  } else if (options?.reliability !== undefined) {
    multiplier =
      typeof options.reliability === "number"
        ? -Math.log(1 - options.reliability)
        : RELIABILITY_LEVELS[options.reliability].multiplier;
  }
  const zBits = maxZBitsForHashrate(numeric, seconds, multiplier);
  return noteFromZBits(zBits);
}

function targetFor(note: SharenoteLike): bigint {
  const resolved = ensureNote(note);
  const integerBits = Math.floor(resolved.zBits);
  const fractionalBits = resolved.zBits - integerBits;
  const baseExponent = 256 - integerBits;
  if (baseExponent < 0) {
    throw new SharenoteError("z too large; target underflow");
  }
  const scale = Math.pow(2, -fractionalBits);
  const precisionBits = 48;
  const scaleFactor = Math.round(scale * Math.pow(2, precisionBits));
  const base = 1n << BigInt(baseExponent);
  return (base * BigInt(scaleFactor)) >> BigInt(precisionBits);
}

function targetToCompact(target: bigint): number {
  if (target <= 0n) {
    throw new SharenoteError("target must be positive");
  }
  const bytes = target.toString(16).padStart(2, "0");
  const exponent = Math.ceil(bytes.length / 2);
  let mantissaBig = target;
  if (exponent > 3) {
    const shift = BigInt(8 * (exponent - 3));
    mantissaBig = target >> shift;
  } else if (exponent < 3) {
    mantissaBig = target << BigInt(8 * (3 - exponent));
  }
  let mantissa = Number(mantissaBig & 0xffffffn);
  let adjustedExponent = exponent;
  if (mantissa & 0x00800000) {
    mantissa >>= 8;
    adjustedExponent += 1;
  }
  if (adjustedExponent > 255) {
    throw new SharenoteError("target exponent overflow");
  }
  return (adjustedExponent << 24) | mantissa;
}

function sharenoteToNBits(note: SharenoteLike): string {
  const target = targetFor(note);
  const compact = targetToCompact(target);
  return compact.toString(16).padStart(8, "0");
}

function nbitsToSharenote(hex: string): Sharenote {
  const cleaned = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{8}$/.test(cleaned)) {
    throw new SharenoteError("nBits must be an 8-character hex string");
  }
  const value = Number.parseInt(cleaned, 16);
  const exponent = value >>> 24;
  const mantissa = value & 0xffffff;
  if (mantissa === 0) {
    throw new SharenoteError("mantissa must be non-zero");
  }
  const log2Target = Math.log2(mantissa) + 8 * (exponent - 3);
  const zBits = 256 - log2Target;
  return noteFromZBits(zBits);
}

function combineNotesSerial(notes: SharenoteLike[]): Sharenote {
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new SharenoteError("notes array must not be empty");
  }
  const total = notes.reduce<number>((acc, note) => acc + difficultyFromNote(note), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return noteFromZBits(0);
  }
  return noteFromZBits(zBitsFromDifficulty(total));
}

function noteDifference(minuend: SharenoteLike, subtrahend: SharenoteLike): Sharenote {
  const diff = difficultyFromNote(minuend) - difficultyFromNote(subtrahend);
  if (diff <= 0) {
    return noteFromZBits(0);
  }
  return noteFromZBits(zBitsFromDifficulty(diff));
}

function scaleNote(note: SharenoteLike, factor: number): Sharenote {
  assertFinite(factor, "factor");
  if (factor < 0) {
    throw new SharenoteError("factor must be >= 0");
  }
  if (factor === 0) {
    return noteFromZBits(0);
  }
  const scaled = difficultyFromNote(note) * factor;
  return noteFromZBits(zBitsFromDifficulty(scaled));
}

function divideNote(numerator: SharenoteLike, denominator: SharenoteLike): number {
  const den = difficultyFromNote(denominator);
  if (den <= 0) {
    throw new SharenoteError("division by zero-difficulty note");
  }
  const num = difficultyFromNote(numerator);
  return num / den;
}

function reliabilityById(id: ReliabilityId): ReliabilityLevel {
  return RELIABILITY_LEVELS[id];
}

function resolveMultiplier(
  options?: EstimateOptions
): { multiplier: number; quantile: number | null } {
  if (options?.multiplier !== undefined) {
    return { multiplier: options.multiplier, quantile: null };
  }
  if (typeof options?.reliability === "number") {
    const q = options.reliability;
    if (q <= 0 || q >= 1) {
      throw new SharenoteError("reliability must be in (0,1)");
    }
    return { multiplier: -Math.log(1 - q), quantile: q };
  }
  if (options?.reliability) {
    const level = reliabilityById(options.reliability);
    return { multiplier: level.multiplier, quantile: level.confidence ?? null };
  }
  return { multiplier: 1, quantile: null };
}

function estimateSharenote(note: SharenoteLike, seconds: number, options?: EstimateOptions): BillEstimate {
  assertFinite(seconds, "seconds");
  if (seconds <= 0) {
    throw new SharenoteError("seconds must be > 0");
  }
  const resolved = ensureNote(note);
  const { multiplier, quantile } = resolveMultiplier(options);
  const probability = probabilityPerHash(resolved);
  const expectation = expectedHashesForNote(resolved);
  const mean = requiredHashrateMean(resolved, seconds);
  const quantileRate = requiredHashrate(resolved, seconds, { multiplier });
  const resolvedPrimaryMode =
    options?.primaryMode ?? (quantile ? PrimaryMode.Quantile : PrimaryMode.Mean);
  const primary = resolvedPrimaryMode === PrimaryMode.Quantile ? quantileRate : mean;

  return {
    sharenote: resolved,
    label: resolved.label,
    zBits: resolved.zBits,
    secondsTarget: seconds,
    probabilityPerHash: probability,
    probabilityDisplay: formatProbabilityDisplay(
      resolved.zBits,
      options?.probabilityPrecision ?? 8
    ),
    expectedHashes: expectation.floatValue(),
    requiredHashrateMean: mean.floatValue(),
    requiredHashrateQuantile: quantileRate.floatValue(),
    requiredHashratePrimary: primary.floatValue(),
    requiredHashrateHuman: primary.human(),
    multiplier,
    quantile,
    primaryMode: resolvedPrimaryMode,
  };
}

function estimateSharenotes(
  notes: SharenoteLike[],
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
  const note = noteFromHashrate(numericHashrate, seconds, {
    reliability: estimateOptions.reliability,
    multiplier: estimateOptions.multiplier,
  });
  const bill = estimateSharenote(note, seconds, estimateOptions);
  return {
    sharenote: note,
    bill,
    secondsTarget: seconds,
    inputHashrateHps: numericHashrate,
    inputHashrateHuman: humanHashrate(numericHashrate),
  };
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
    const unit = match[2]?.trim() ?? undefined;
    const { exponent } = resolveHashrateUnit(unit);
    return value * Math.pow(10, exponent * 3);
  }
  return normalizeHashrateValue(input);
}

function resolveHashrateUnit(
  unit?: string | HashrateUnit
): { exponent: number; unit: HashrateUnit } {
  if (!unit) {
    return { exponent: 0, unit: HashrateUnit.Hps };
  }
  const raw = typeof unit === "string" ? unit : `${unit}`;
  let normalized = raw.toUpperCase().replace(/[_\-\s]+/g, "");
  normalized = normalized.replace(/HPS$/, "H/S").replace(/HS$/, "H/S");
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

function formatProbabilityDisplay(zBits: number, precision = 8): string {
  assertFinite(zBits, "zBits");
  return `1 / 2^${zBits.toFixed(precision)}`;
}

function getReliabilityLevels(): ReliabilityLevel[] {
  return Object.values(RELIABILITY_LEVELS);
}

function humanHashrate(hashrate: number, opts?: HumanHashrateOptions): HumanHashrate {
  assertFinite(hashrate, "hashrate");
  if (hashrate <= 0) {
    return { value: 0, unit: HashrateUnit.Hps, display: "0 H/s", exponent: 0 };
  }
  const logValue = Math.log10(hashrate);
  const unclampedIndex = Math.floor(logValue / 3);
  const index = Math.min(HASHRATE_UNITS.length - 1, Math.max(0, unclampedIndex));
  const unit = HASHRATE_UNITS[index];
  const scaled = hashrate / Math.pow(10, unit.exponent * 3);
  let displayValue: string;
  if (opts?.precision !== undefined) {
    displayValue = scaled.toFixed(Math.max(0, opts.precision));
  } else if (scaled >= 100) {
    displayValue = scaled.toFixed(0);
  } else if (scaled >= 10) {
    displayValue = scaled.toFixed(1);
  } else {
    displayValue = scaled.toFixed(2);
  }
  return {
    value: Number.isFinite(scaled) ? scaled : hashrate,
    unit: unit.unit,
    exponent: unit.exponent,
    display: `${displayValue} ${unit.unit}`,
  };
}

function formatHashCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 H/s";
  }
  const index = Math.min(
    HASH_COUNT_UNITS.length - 1,
    Math.max(0, Math.floor(Math.log10(value) / 3))
  );
  const unit = HASH_COUNT_UNITS[index];
  const scaled = value / Math.pow(10, unit.exponent * 3);
  let display: string;
  if (scaled >= 100) {
    display = scaled.toFixed(0);
  } else if (scaled >= 10) {
    display = scaled.toFixed(1);
  } else {
    display = scaled.toFixed(2);
  }
  const label = unit.prefix === "" ? "H/s" : `${unit.prefix}H/s`;
  return `${display} ${label}`;
}

function withHumanHashratePrecision(precision: number): HumanHashrateOptions {
  return { precision };
}

function withMultiplier(multiplier: number): HashrateOptions {
  return { multiplier };
}

function withReliability(reliability: ReliabilityId): HashrateOptions {
  return { reliability };
}

function withConfidence(confidence: number): HashrateOptions {
  return { reliability: confidence };
}

function withEstimateMultiplier(multiplier: number): EstimateOptions {
  return { multiplier };
}

function withEstimateReliability(reliability: ReliabilityId): EstimateOptions {
  return { reliability };
}

function withEstimateConfidence(confidence: number): EstimateOptions {
  return { reliability: confidence };
}

function withEstimatePrimaryMode(primaryMode: PrimaryMode): EstimateOptions {
  return { primaryMode };
}

function withEstimateProbabilityPrecision(
  probabilityPrecision: number
): EstimateOptions {
  return { probabilityPrecision };
}

function withPlanMultiplier(multiplier: number): Partial<HashratePlanOptions> {
  return { multiplier };
}

function withPlanReliability(
  reliability: ReliabilityId
): Partial<HashratePlanOptions> {
  return { reliability };
}

function withPlanConfidence(
  confidence: number
): Partial<HashratePlanOptions> {
  return { reliability: confidence };
}

export {
  CENT_ZBIT_STEP,
  CONTINUOUS_EXPONENT_STEP,
  MIN_CENTZ,
  MAX_CENTZ,
  RELIABILITY_LEVELS,
  ReliabilityId,
  PrimaryMode,
  HashrateUnit,
  SharenoteError,
  Sharenote,
  HashrateMeasurement,
  HashesMeasurement,
  HashrateRange,
  estimateSharenote,
  estimateSharenotes,
  planSharenoteFromHashrate,
  combineNotesSerial,
  noteDifference,
  scaleNote,
  divideNote,
  compareNotes,
  ensureNote,
  expectedHashesForZBits,
  expectedHashesForNote,
  expectedHashesMeasurement,
  formatLabel as formatNoteLabel,
  parseLabel as parseNoteLabel,
  getReliabilityLevels,
  humanHashrate,
  withHumanHashratePrecision,
  normalizeHashrateValue,
  parseHashrate,
  maxZBitsForHashrate,
  noteFromComponents,
  noteFromCentZBits,
  mustNoteFromCentZBits,
  noteFromZBits,
  mustNoteFromZBits,
  noteFromHashrate,
  zBitsFromComponents,
  probabilityFromZBits,
  probabilityPerHash,
  requiredHashrate,
  requiredHashrateMean,
  requiredHashrateQuantile,
  requiredHashrateMeasurement,
  requiredHashrateMeanMeasurement,
  requiredHashrateQuantileMeasurement,
  hashrateRangeForNote,
  withMultiplier,
  withReliability,
  withConfidence,
  withEstimateMultiplier,
  withEstimateReliability,
  withEstimateConfidence,
  withEstimatePrimaryMode,
  withEstimateProbabilityPrecision,
  withPlanMultiplier,
  withPlanReliability,
  withPlanConfidence,
  targetFor,
  sharenoteToNBits,
  nbitsToSharenote,
  formatProbabilityDisplay,
  zBitsFromDifficulty,
  difficultyFromZBits,
};

export type {
  ReliabilityLevel,
  HumanHashrate,
  HumanHashrateOptions,
  BillEstimate,
  EstimateOptions,
  HashrateOptions,
  HashrateDescriptor,
  HashrateValue,
  HashrateParseInput,
  HashratePlanOptions,
  SharenotePlan,
  HashrateRange,
};
function compareNotes(a: SharenoteLike, b: SharenoteLike): number {
  const noteA = ensureNote(a);
  const noteB = ensureNote(b);
  if (noteA.z !== noteB.z) {
    return noteA.z - noteB.z;
  }
  return noteA.cents - noteB.cents;
}
