/**
 * Exact (dyadic-rational) difficulty arithmetic.
 *
 * NIP-SN §Z-Arithmetic ("Exact Accumulation") forbids using IEEE-754
 * `float64` as a *sequential accumulator* when summing proof-of-work: over
 * long runs of micro-shares, precision loss silently drops fractional hashes
 * and reopens the halt-early attack (A1).
 *
 * This module provides the exact substrate. A note's difficulty is
 * `2 ** zBits`; when `zBits` is a `float64`, `2 ** zBits` is itself a `float64`,
 * and **every finite `float64` is exactly a dyadic rational** `sig * 2 ** exp`
 * with `sig` a non-negative integer. We decompose difficulties into that form
 * and accumulate with {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt | `bigint`}
 * arithmetic, so serial aggregation carries no float accumulation drift.
 *
 * @see {@link combine} — the public aggregation entry point built on this.
 */
import { SharenoteError } from "./errors.js";

/**
 * An exact difficulty as a dyadic rational: `value === sig * 2 ** exp`, with
 * `sig` a non-negative {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt | `bigint`}.
 *
 * This is the **authoritative** difficulty representation on accounting paths;
 * `number`-valued difficulty is strictly a display projection.
 */
export interface ExactDifficulty {
  /** The integer significand. `0n` represents a difficulty of zero. */
  readonly sig: bigint;
  /** The base-2 exponent. */
  readonly exp: number;
}

const DECOMPOSE_VIEW = new DataView(new ArrayBuffer(8));

/** Decompose a finite, positive `float64` into its exact dyadic rational. */
export function decomposeFloatToExact(value: number): ExactDifficulty {
  if (!Number.isFinite(value) || value <= 0) {
    return { sig: 0n, exp: 0 };
  }
  DECOMPOSE_VIEW.setFloat64(0, value, false);
  const hi = DECOMPOSE_VIEW.getUint32(0, false);
  const lo = DECOMPOSE_VIEW.getUint32(4, false);
  const expField = (hi >>> 20) & 0x7ff;
  const mantissa = ((BigInt(hi) & 0xfffffn) << 32n) | BigInt(lo >>> 0);
  if (expField === 0) {
    // Subnormal: value = mantissa * 2^-1074.
    return normalizeExact({ sig: mantissa, exp: -1074 });
  }
  // Normal: value = (2^52 + mantissa) * 2^(expField - 1075).
  return normalizeExact({ sig: (1n << 52n) | mantissa, exp: expField - 1075 });
}

/** Strip shared trailing zero bits so equal values share a canonical form. */
export function normalizeExact(value: ExactDifficulty): ExactDifficulty {
  if (value.sig <= 0n) {
    return { sig: 0n, exp: 0 };
  }
  let sig = value.sig;
  let exp = value.exp;
  while ((sig & 1n) === 0n) {
    sig >>= 1n;
    exp += 1;
  }
  return { sig, exp };
}

/** Exactly sum dyadic-rational difficulties with `bigint` arithmetic. */
export function sumExactDifficulties(
  values: readonly ExactDifficulty[]
): ExactDifficulty {
  const terms = values.filter((v) => v.sig > 0n);
  if (terms.length === 0) {
    return { sig: 0n, exp: 0 };
  }
  let minExp = terms[0].exp;
  for (const term of terms) {
    if (term.exp < minExp) {
      minExp = term.exp;
    }
  }
  let total = 0n;
  for (const term of terms) {
    total += term.sig << BigInt(term.exp - minExp);
  }
  return normalizeExact({ sig: total, exp: minExp });
}

/** Correctly-rounded `log2` of an exact difficulty, free of float drift. */
export function zBitsFromExactDifficulty(value: ExactDifficulty): number {
  if (value.sig <= 0n) {
    throw new SharenoteError("difficulty must be > 0");
  }
  const bitLength = value.sig.toString(2).length;
  const keepBits = 63;
  const shift = bitLength - keepBits;
  if (shift <= 0) {
    return Math.log2(Number(value.sig)) + value.exp;
  }
  // Round the retained mantissa to nearest-even using the dropped low bits.
  const shiftBig = BigInt(shift);
  const dropped = value.sig & ((1n << shiftBig) - 1n);
  let top = value.sig >> shiftBig;
  const half = 1n << (shiftBig - 1n);
  if (dropped > half || (dropped === half && (top & 1n) === 1n)) {
    top += 1n;
  }
  return Math.log2(Number(top)) + shift + value.exp;
}

/** Best-effort `float64` of an exact difficulty (single rounding, no drift). */
export function exactDifficultyToNumber(value: ExactDifficulty): number {
  if (value.sig <= 0n) {
    return 0;
  }
  const bitLength = value.sig.toString(2).length;
  const keepBits = 53;
  const shift = bitLength - keepBits;
  if (shift <= 0) {
    return Number(value.sig) * 2 ** value.exp;
  }
  return Number(value.sig >> BigInt(shift)) * 2 ** (shift + value.exp);
}

/**
 * Exactly multiply two dyadic-rational difficulties. The product of two dyadics
 * (`sigA * 2^expA` and `sigB * 2^expB`) is itself dyadic, so the result loses
 * nothing — the exact substrate behind {@link Sharenote.scale}, mirroring Go's
 * `big.Rat.Mul` and Python's `Fraction` multiplication.
 */
export function multiplyExact(
  a: ExactDifficulty,
  b: ExactDifficulty
): ExactDifficulty {
  if (a.sig <= 0n || b.sig <= 0n) {
    return { sig: 0n, exp: 0 };
  }
  return normalizeExact({ sig: a.sig * b.sig, exp: a.exp + b.exp });
}

/**
 * Exactly subtract dyadic-rational difficulty `b` from `a`. The difference of
 * two dyadics is dyadic, computed with `bigint` arithmetic and no drift; a zero
 * or negative result collapses to the zero difficulty. The exact substrate
 * behind {@link Sharenote.subtract}, mirroring Go's `big.Rat.Sub` and Python's
 * `Fraction` subtraction.
 */
export function subtractExact(
  a: ExactDifficulty,
  b: ExactDifficulty
): ExactDifficulty {
  if (b.sig <= 0n) {
    return normalizeExact(a);
  }
  if (a.sig <= 0n) {
    return { sig: 0n, exp: 0 };
  }
  const minExp = Math.min(a.exp, b.exp);
  const total =
    (a.sig << BigInt(a.exp - minExp)) - (b.sig << BigInt(b.exp - minExp));
  return normalizeExact({ sig: total, exp: minExp });
}

/**
 * The exact ratio `num / den` rounded to `float64` exactly **once**
 * (round-to-nearest, ties to even) — the correctly-rounded value of the real
 * quotient, matching Go's `big.Rat.Float64` and Python's `float(Fraction)`.
 * This avoids the extra rounding of dividing two display floats. `den` must
 * carry positive difficulty.
 */
export function exactRatioToNumber(
  num: ExactDifficulty,
  den: ExactDifficulty
): number {
  if (den.sig <= 0n) {
    throw new SharenoteError("division by zero-difficulty note");
  }
  if (num.sig <= 0n) {
    return 0;
  }
  // Fold the shared power-of-two factor into a single positive rational n / d.
  const e = num.exp - den.exp;
  let n = num.sig;
  let d = den.sig;
  if (e >= 0) {
    n <<= BigInt(e);
  } else {
    d <<= BigInt(-e);
  }
  // Extract a 54-bit quotient (the 53-bit mantissa plus one guard bit) together
  // with a sticky remainder, then round to 53 bits exactly once.
  let shift = n.toString(2).length - d.toString(2).length - 53;
  const extract = (sh: number): { q: bigint; sticky: boolean } => {
    if (sh >= 0) {
      const scaledD = d << BigInt(sh);
      return { q: n / scaledD, sticky: n % scaledD !== 0n };
    }
    const scaledN = n << BigInt(-sh);
    return { q: scaledN / d, sticky: scaledN % d !== 0n };
  };
  let { q, sticky } = extract(shift);
  while (q >= 1n << 54n) {
    shift += 1;
    ({ q, sticky } = extract(shift));
  }
  while (q < 1n << 53n) {
    shift -= 1;
    ({ q, sticky } = extract(shift));
  }
  let mantissa = q >> 1n;
  const roundBit = q & 1n;
  if (roundBit === 1n && (sticky || (mantissa & 1n) === 1n)) {
    mantissa += 1n;
  }
  let exponent = shift + 1;
  if (mantissa === 1n << 53n) {
    mantissa >>= 1n;
    exponent += 1;
  }
  return Number(mantissa) * 2 ** exponent;
}
