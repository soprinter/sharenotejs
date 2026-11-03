/**
 * Z-Arithmetic: the exact proof-of-work difficulty core of NIP-SN.
 *
 * The {@link Sharenote} value type is the unit of measurement. It separates the
 * **authoritative** difficulty — an exact dyadic rational, see
 * {@link Sharenote.exactDifficulty} — from the human-readable
 * **Denomination Class** label (`34Z10`) and the `number`-valued `zBits`, both
 * of which are display projections only.
 *
 * @see {@link https://github.com/soprinter/nips/blob/master/NIP-SN.md | NIP-SN §Z-Arithmetic}
 */
import { SharenoteError, assertFinite } from "./errors.js";
import {
  type ExactDifficulty,
  decomposeFloatToExact,
  exactRatioToNumber,
  multiplyExact,
  normalizeExact,
  subtractExact,
  sumExactDifficulties,
  zBitsFromExactDifficulty,
} from "./exact.js";

/** The fractional step of one centi-bit (`cc`) in a denomination label. */
export const CENTIBIT_STEP = 0.01;
/** The smallest centi-bit component of a label. */
export const MIN_CENTIBITS = 0;
/** The largest centi-bit component of a label. */
export const MAX_CENTIBITS = 99;

const CENTIBITS_PER_BIT = Math.round(1 / CENTIBIT_STEP);

/**
 * Anything accepted where a {@link Sharenote} is expected:
 *
 * - a {@link Sharenote} (returned as-is),
 * - a denomination label `string` (e.g. `"34Z10"`, parsed by
 *   {@link Sharenote.fromLabel}),
 * - a `number`, interpreted as continuous Z-bits.
 */
export type SharenoteInput = Sharenote | string | number;

function clampCentiBits(centiBits: number): number {
  assertFinite(centiBits, "centiBits");
  const normalized = Math.trunc(Math.round(centiBits));
  if (normalized < MIN_CENTIBITS) return MIN_CENTIBITS;
  if (normalized > MAX_CENTIBITS) return MAX_CENTIBITS;
  return normalized;
}

/**
 * Format the integer-bits / centi-bits components as a denomination label.
 *
 * @example
 * ```ts
 * formatLabel(34, 10); // "34Z10"
 * ```
 */
export function formatLabel(z: number, centiBits: number): string {
  return `${z}Z${clampCentiBits(centiBits).toString().padStart(2, "0")}`;
}

/**
 * Project continuous Z-bits onto the discrete `(z, centiBits)` label floor
 * (NIP-SN §Discrete Denomination Class). Raw cents are computed with the
 * pricing-floor epsilon (`+1e-9`) and **clamped** to `[0, 99]` — there is no
 * carry to `(z+1)Z00` (decision D2). A near-integer value whose cents round to
 * `100` labels as `zZ99`, never the next whole bit, matching Go
 * `componentsFromBits` and Python `_label_components_from_zbits` byte-for-byte.
 */
function labelComponents(zBits: number): { z: number; centiBits: number } {
  let z = Math.floor(zBits);
  if (z < 0) z = 0;
  const fractional = zBits - z;
  // Floor with a tiny epsilon so float drift cannot push us below the cent.
  const rawCentiBits = Math.floor(fractional / CENTIBIT_STEP + 1e-9);
  return { z, centiBits: clampCentiBits(rawCentiBits) };
}

/** Continuous difficulty `D = 2 ** zBits`, as a `float64` (display path). */
export function zBitsToDifficulty(zBits: number): number {
  return 2 ** zBits;
}

/** Recover continuous Z-bits `B = log2(D)` from a `float64` difficulty. */
export function difficultyToZBits(difficulty: number): number {
  assertFinite(difficulty, "difficulty");
  if (difficulty <= 0) {
    throw new SharenoteError("difficulty must be > 0");
  }
  return Math.log2(difficulty);
}

const LABEL_SIMPLE = /^(\d+)Z(?:(\d{1,2})(?:CZ)?)?$/;
const LABEL_DOTTED = /^(\d+)\.(\d{1,2})Z$/;
const LABEL_DECIMAL = /^(\d+(?:\.\d+)?)Z$/;

/**
 * An immutable unit of proof-of-work difficulty — a Sharenote.
 *
 * Construct one with a static factory (never `new`); arithmetic and queries are
 * instance methods that return fresh values. The exact difficulty is carried
 * through aggregation ({@link combine}); `zBits`, `label`, and
 * {@link difficulty} are display projections derived from it.
 *
 * @example
 * ```ts
 * import { Sharenote, combine } from "@soprinter/sharenotejs";
 *
 * const note = Sharenote.fromLabel("34Z10");
 * note.label;      // "34Z10"
 * note.zBits;      // 34.1
 *
 * combine(["25Z00", "25Z00"]).label; // "26Z00" — summed in difficulty space
 * ```
 */
export class Sharenote {
  /** Integer Z-bits component of the denomination label. */
  readonly z: number;
  /** Centi-bits (`00`–`99`) component of the denomination label. */
  readonly centiBits: number;
  /**
   * Continuous Z-bits, `log2(difficulty)`. A **display** value — authoritative
   * difficulty is {@link exactDifficulty}; never accumulate this across shares.
   */
  readonly zBits: number;

  readonly #exact: ExactDifficulty | undefined;

  private constructor(
    z: number,
    centiBits: number,
    zBits: number,
    exact?: ExactDifficulty
  ) {
    this.z = z;
    this.centiBits = centiBits;
    this.zBits = zBits;
    this.#exact = exact;
  }

  /** Coerce a {@link SharenoteInput} to a {@link Sharenote}. */
  static from(input: SharenoteInput): Sharenote {
    if (input instanceof Sharenote) {
      return input;
    }
    if (typeof input === "string") {
      return Sharenote.fromLabel(input);
    }
    if (typeof input === "number") {
      return Sharenote.fromZBits(input);
    }
    throw new SharenoteError("unsupported Sharenote input");
  }

  /** Build from integer-bits and centi-bits components (e.g. `34`, `10`). */
  static fromComponents(z: number, centiBits: number): Sharenote {
    if (!Number.isInteger(z) || z < 0) {
      throw new SharenoteError("z must be a non-negative integer");
    }
    const normalized = clampCentiBits(centiBits);
    return new Sharenote(z, normalized, z + normalized * CENTIBIT_STEP);
  }

  /** Build from a total centi-bit count (e.g. `3410` → `34Z10`). */
  static fromCentiBits(totalCentiBits: number): Sharenote {
    assertFinite(totalCentiBits, "centiBits");
    if (totalCentiBits < 0) {
      throw new SharenoteError("centi-bit value must be non-negative");
    }
    const z = Math.floor(totalCentiBits / CENTIBITS_PER_BIT);
    return Sharenote.fromComponents(z, totalCentiBits % CENTIBITS_PER_BIT);
  }

  /** Build from continuous Z-bits; the label floor is derived from it. */
  static fromZBits(zBits: number): Sharenote {
    assertFinite(zBits, "zBits");
    if (zBits < 0) {
      throw new SharenoteError("zBits must be non-negative");
    }
    const { z, centiBits } = labelComponents(zBits);
    return new Sharenote(z, centiBits, zBits);
  }

  /**
   * Build a note that carries an exact accumulated difficulty (NIP-SN A1). The
   * stored {@link ExactDifficulty} is authoritative; `zBits`, `label`, and
   * {@link difficulty} are derived from it for display. A zero (or negative)
   * difficulty yields the zero note (`0Z00`). This is the factory behind
   * {@link combine} and {@link Work.note}.
   */
  static fromExactDifficulty(exact: ExactDifficulty): Sharenote {
    const normalized = normalizeExact(exact);
    if (normalized.sig <= 0n) {
      return Sharenote.fromZBits(0);
    }
    const zBits = zBitsFromExactDifficulty(normalized);
    const { z, centiBits } = labelComponents(zBits);
    return new Sharenote(z, centiBits, zBits, normalized);
  }

  /** Build from a continuous `float64` difficulty `D` (`zBits = log2(D)`). */
  static fromDifficulty(difficulty: number): Sharenote {
    return Sharenote.fromZBits(difficultyToZBits(difficulty));
  }

  /**
   * Parse a denomination label. Accepts the canonical `34Z10` form plus the
   * friendly variants `34Z 10CZ`, `34.10Z`, and a bare `34Z` (zero cents).
   */
  static fromLabel(label: string): Sharenote {
    const cleaned = label.trim().toUpperCase().replace(/\s+/g, "");

    const simple = cleaned.match(LABEL_SIMPLE);
    if (simple) {
      return Sharenote.fromComponents(
        Number.parseInt(simple[1], 10),
        simple[2] ? Number.parseInt(simple[2], 10) : 0
      );
    }

    const dotted = cleaned.match(LABEL_DOTTED);
    if (dotted) {
      const centiBits = dotted[2].padEnd(2, "0").slice(0, 2);
      return Sharenote.fromComponents(
        Number.parseInt(dotted[1], 10),
        Number.parseInt(centiBits, 10)
      );
    }

    const decimal = cleaned.match(LABEL_DECIMAL);
    if (decimal) {
      return Sharenote.fromZBits(Number.parseFloat(decimal[1]));
    }

    throw new SharenoteError(`unrecognised Sharenote label: "${label}"`);
  }

  /** Recover a note from a Bitcoin-style compact `nBits` hex string. */
  static fromNBits(hex: string): Sharenote {
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
    return Sharenote.fromZBits(256 - log2Target);
  }

  /** Recover a note from a raw 256-bit target (`zBits = 256 - log2(T)`). */
  static fromTarget(target: bigint): Sharenote {
    return Sharenote.fromZBits(zBitsFromTarget(target));
  }

  /**
   * Sum notes by adding their difficulties exactly (NIP-SN §Z-Arithmetic).
   * The result carries the exact `bigint`-accumulated difficulty; see
   * {@link combine} for the free-function form.
   */
  static combine(notes: readonly SharenoteInput[]): Sharenote {
    if (!Array.isArray(notes) || notes.length === 0) {
      throw new SharenoteError("notes array must not be empty");
    }
    // Accumulate each note's AUTHORITATIVE exact difficulty, never a value
    // re-derived from its display `zBits`. A note that is itself the result of
    // a previous `combine` carries its stored exact sum (see
    // {@link exactDifficulty}); folding it in preserves the exact total rather
    // than collapsing it back onto its label floor (decision D3 / NIP-SN A1).
    const exact = sumExactDifficulties(
      notes.map((note) => Sharenote.from(note).exactDifficulty)
    );
    return Sharenote.fromExactDifficulty(exact);
  }

  /** The denomination class label, e.g. `"34Z10"`. */
  get label(): string {
    return formatLabel(this.z, this.centiBits);
  }

  /**
   * The exact difficulty as a dyadic rational — the authoritative value on
   * accounting paths. A combined note carries its exact accumulated sum; any
   * other note derives it losslessly from its `float64` difficulty.
   */
  get exactDifficulty(): ExactDifficulty {
    return this.#exact ?? decomposeFloatToExact(zBitsToDifficulty(this.zBits));
  }

  /** Continuous difficulty `D = 2 ** zBits`, as a `float64` (display only). */
  difficulty(): number {
    return zBitsToDifficulty(this.zBits);
  }

  /** Probability that a single random hash clears this difficulty (`2 ** -zBits`). */
  probabilityPerHash(): number {
    return 2 ** -this.zBits;
  }

  /** Expected number of hashes to find one share at this difficulty. */
  expectedHashes(): number {
    return 2 ** this.zBits;
  }

  /** The raw 256-bit target this denomination corresponds to. */
  target(): bigint {
    const integerBits = Math.floor(this.zBits);
    const fractionalBits = this.zBits - integerBits;
    const baseExponent = 256 - integerBits;
    if (baseExponent < 0) {
      throw new SharenoteError("z too large; target underflow");
    }
    const scale = 2 ** -fractionalBits;
    const precisionBits = 48;
    const scaleFactor = Math.round(scale * 2 ** precisionBits);
    const base = 1n << BigInt(baseExponent);
    return (base * BigInt(scaleFactor)) >> BigInt(precisionBits);
  }

  /** Encode as a Bitcoin-style compact `nBits` 8-character hex string. */
  toNBits(): string {
    return targetToCompact(this.target()).toString(16).padStart(8, "0");
  }

  /** Aggregate this note with others by exact difficulty sum. */
  add(...others: SharenoteInput[]): Sharenote {
    return Sharenote.combine([this, ...others]);
  }

  /**
   * Subtract another note's difficulty from this one, clamping to `0Z00` when
   * the result would be non-positive.
   *
   * The difference is carried as an EXACT dyadic difficulty, not re-derived from
   * a `float64` — so a subtracted note folds into {@link combine} with zero
   * precision loss (NIP-SN A1). Matches Go `Note.Sub` (`big.Rat`) and Python
   * `difference` (`Fraction`). A positive result below one hash (negative
   * Z-bits) is out of range and rejected rather than snapped to `0Z00`.
   */
  subtract(other: SharenoteInput): Sharenote {
    const diff = subtractExact(
      this.exactDifficulty,
      Sharenote.from(other).exactDifficulty
    );
    if (diff.sig <= 0n) {
      return Sharenote.fromZBits(0);
    }
    if (zBitsFromExactDifficulty(diff) < 0) {
      throw new SharenoteError("zBits must be non-negative");
    }
    return Sharenote.fromExactDifficulty(diff);
  }

  /**
   * Scale this note's difficulty by a non-negative `factor`.
   *
   * The scaled difficulty is carried EXACTLY: this note's authoritative dyadic
   * difficulty is multiplied by the exact dyadic of the `float64` `factor`, and
   * the product of two dyadic rationals is itself dyadic — so a scaled note
   * folds into {@link combine} with zero precision loss (NIP-SN A1). Matches Go
   * `Note.Scale` (`big.Rat`) and Python `scale` (`Fraction`). A `factor` of `0`
   * yields `0Z00`; a positive `factor` that drives the difficulty below one hash
   * (negative Z-bits) is out of range and rejected rather than snapped to `0Z00`.
   */
  scale(factor: number): Sharenote {
    assertFinite(factor, "factor");
    if (factor < 0) {
      throw new SharenoteError("factor must be >= 0");
    }
    if (factor === 0) {
      return Sharenote.fromZBits(0);
    }
    const scaled = multiplyExact(
      this.exactDifficulty,
      decomposeFloatToExact(factor)
    );
    // `scaled.sig` is necessarily > 0 here: a valid note's exactDifficulty is
    // >= 1 and `factor` > 0 is guaranteed above, so multiplyExact cannot yield
    // a zero product. The only out-of-range case is a sub-one-hash (negative
    // Z-bits) result, rejected next.
    if (zBitsFromExactDifficulty(scaled) < 0) {
      throw new SharenoteError("zBits must be non-negative");
    }
    return Sharenote.fromExactDifficulty(scaled);
  }

  /**
   * The difficulty ratio `this / other` as a plain `number`.
   *
   * The ratio of the two notes' EXACT difficulties, rounded to `float64`
   * exactly once (round-to-nearest, ties to even) — never by dividing two
   * display floats, which would round twice. Matches Go `Note.Ratio`
   * (`big.Rat.Float64`) and Python `ratio` (`float(Fraction)`).
   */
  divide(other: SharenoteInput): number {
    const denominator = Sharenote.from(other).exactDifficulty;
    if (denominator.sig <= 0n) {
      throw new SharenoteError("division by zero-difficulty note");
    }
    return exactRatioToNumber(this.exactDifficulty, denominator);
  }

  /** Order against another note by label components `(z, centiBits)`: `-1`, `0`, or `1`. */
  compareTo(other: SharenoteInput): number {
    return compareSharenotes(this, other);
  }

  /**
   * Whether two notes carry the **same denomination label** (decision D1): equal
   * integer bits `z` and centi-bits. Two notes whose continuous `zBits` differ
   * but round to the same label are equal — the label, not the continuous
   * value, is the comparison key.
   */
  equals(other: SharenoteInput): boolean {
    const o = Sharenote.from(other);
    return this.z === o.z && this.centiBits === o.centiBits;
  }

  /** The denomination label; lets a note interpolate directly into strings. */
  toString(): string {
    return this.label;
  }
}

/**
 * Sum notes by adding their difficulties exactly — the free-function form of
 * {@link Sharenote.combine}. Aggregation must happen in linear difficulty
 * space, never by summing labels (NIP-SN §Z-Arithmetic).
 *
 * @example
 * ```ts
 * import { combine } from "@soprinter/sharenotejs";
 *
 * combine(["25Z00", "25Z00"]).label;       // "26Z00"
 * combine(Array(1024).fill("0Z00")).label; // "10Z00"
 * ```
 */
export function combine(notes: readonly SharenoteInput[]): Sharenote {
  return Sharenote.combine(notes);
}

/**
 * An exact, streaming accumulator of proof-of-work in linear difficulty space
 * (NIP-SN A1). It is the tool for summing many shares — a block's whole pool
 * total, or one address's slice — without the `float64` drift forbidden on
 * accounting paths: every term is added as an exact dyadic rational
 * ({@link ExactDifficulty}) with `bigint` arithmetic, so the total is
 * independent of insertion order and loses nothing.
 *
 * Mirrors Go `Work`: build an accumulator, {@link add} notes, recover a
 * denomination with {@link note}, and slice a reward with {@link payout}.
 *
 * @example
 * ```ts
 * import { Work } from "@soprinter/sharenotejs";
 *
 * const miner = new Work().add("34Z10").add("34Z10");
 * const pool = new Work().add(miner.note()).add("35Z00");
 * miner.payout(pool, 312_500_000n); // exact, floored base-unit slice
 * ```
 */
export class Work {
  #exact: ExactDifficulty = { sig: 0n, exp: 0 };

  /** Add a note's exact difficulty to the accumulator; returns `this` for chaining. */
  add(note: SharenoteInput): this {
    return this.addExact(Sharenote.from(note).exactDifficulty);
  }

  /** Add an exact difficulty directly to the accumulator; returns `this`. */
  addExact(exact: ExactDifficulty): this {
    this.#exact = sumExactDifficulties([this.#exact, exact]);
    return this;
  }

  /** The accumulated difficulty as an exact dyadic rational. */
  get exactDifficulty(): ExactDifficulty {
    return this.#exact;
  }

  /** Whether no positive work has been accumulated. */
  isZero(): boolean {
    return this.#exact.sig <= 0n;
  }

  /** Convert the accumulated work into its denomination; empty yields `0Z00`. */
  note(): Sharenote {
    return Sharenote.fromExactDifficulty(this.#exact);
  }

  /**
   * This accumulator's exact proportional slice of `amount` under the NIP-SN
   * payout law `payout = amount * (this work / total work)`, computed with
   * `bigint` arithmetic and **floored** to a whole number of base units.
   *
   * `total` must be a superset of this work and carry positive difficulty.
   * Flooring every recipient's slice guarantees the slices never exceed the
   * invoice total (share-sum conservation, A11). An empty accumulator pays `0n`.
   *
   * @throws a {@link SharenoteError} when `total` work is not positive.
   */
  payout(total: Work, amount: bigint): bigint {
    const totalExact = total.#exact;
    if (totalExact.sig <= 0n) {
      throw new SharenoteError("total work must be positive");
    }
    const w = this.#exact;
    if (w.sig <= 0n) {
      return 0n;
    }
    // share = amount * (wSig * 2^wExp) / (tSig * 2^tExp)
    //       = amount * wSig * 2^(wExp - tExp) / tSig, floored.
    let numerator = amount * w.sig;
    let denominator = totalExact.sig;
    const expDiff = w.exp - totalExact.exp;
    if (expDiff >= 0) {
      numerator <<= BigInt(expDiff);
    } else {
      denominator <<= BigInt(-expDiff);
    }
    // bigint division truncates toward zero; non-negative shares make that the floor.
    return numerator / denominator;
  }
}

/**
 * Order two notes by their **denomination label components** (decision D1):
 * integer bits `z` first, then centi-bits. Two notes with the same label are
 * EQUAL (`0`) even when their continuous `zBits` differ. This matches how
 * denomination labels sort and the Go `Note.Cmp` / Python `compare`
 * implementations — not a continuous-`zBits` comparison, which would order two
 * notes that share a label.
 */
export function compareSharenotes(a: SharenoteInput, b: SharenoteInput): number {
  const left = Sharenote.from(a);
  const right = Sharenote.from(b);
  if (left.z !== right.z) return left.z < right.z ? -1 : 1;
  if (left.centiBits < right.centiBits) return -1;
  if (left.centiBits > right.centiBits) return 1;
  return 0;
}

/**
 * Recover continuous Z-bits from a raw 256-bit target — the inverse of
 * {@link Sharenote.target} (`zBits = 256 - log2(T)`). Used for continuous
 * ledger accounting so pools account for physical entropy without truncation.
 */
export function zBitsFromTarget(target: bigint): number {
  if (target <= 0n) {
    throw new SharenoteError("target must be positive");
  }
  const value = Number(target);
  if (!Number.isFinite(value) || value <= 0) {
    throw new SharenoteError("target overflows float64");
  }
  const zBits = 256 - Math.log2(value);
  if (!Number.isFinite(zBits) || zBits < 0) {
    throw new SharenoteError("target produces invalid zBits");
  }
  return zBits;
}

function targetToCompact(target: bigint): number {
  if (target <= 0n) {
    throw new SharenoteError("target must be positive");
  }
  const bytes = target.toString(16).padStart(2, "0");
  const exponent = Math.ceil(bytes.length / 2);
  let mantissaBig = target;
  if (exponent > 3) {
    mantissaBig = target >> BigInt(8 * (exponent - 3));
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
