import { describe, expect, it } from "vitest";

import {
  Sharenote,
  SharenoteError,
  CENTIBIT_STEP,
  combine,
  compareSharenotes,
  formatLabel,
  zBitsFromTarget,
  zBitsToDifficulty,
  difficultyToZBits,
  decomposeFloatToExact,
  sumExactDifficulties,
  zBitsFromExactDifficulty,
  exactDifficultyToNumber,
  type ExactDifficulty,
} from "../src/index";

describe("Sharenote construction", () => {
  it("builds from components", () => {
    const note = Sharenote.fromComponents(33, 53);
    expect(note.z).toBe(33);
    expect(note.centiBits).toBe(53);
    expect(note.zBits).toBeCloseTo(33 + 53 * CENTIBIT_STEP, 12);
    expect(note.label).toBe("33Z53");
    expect(note.toString()).toBe("33Z53");
  });

  it("builds from a total centi-bit count", () => {
    expect(Sharenote.fromCentiBits(3353).label).toBe("33Z53");
  });

  it("builds from continuous zBits, deriving the label floor", () => {
    expect(Sharenote.fromZBits(33.537812).label).toBe("33Z53");
    expect(Sharenote.fromZBits(33 + 53 * CENTIBIT_STEP).zBits).toBeCloseTo(33.53, 12);
  });

  it("builds from a float64 difficulty", () => {
    const note = Sharenote.fromDifficulty(2 ** 10);
    expect(note.zBits).toBe(10);
    expect(note.label).toBe("10Z00");
  });

  it("parses every supported label form", () => {
    const cases: Array<[string, number]> = [
      ["33Z53", 53],
      ["33Z 53CZ", 53],
      ["33z53cz", 53],
      ["33.53Z", 53],
      ["33z", 0],
    ];
    for (const [label, centiBits] of cases) {
      const note = Sharenote.fromLabel(label);
      expect(note.z).toBe(33);
      expect(note.centiBits).toBe(centiBits);
    }
  });

  it("coerces strings and numbers via Sharenote.from", () => {
    expect(Sharenote.from("33Z53").label).toBe("33Z53");
    expect(Sharenote.from(33.53).label).toBe("33Z53");
    expect(Sharenote.from(Sharenote.fromLabel("33Z53")).label).toBe("33Z53");
  });

  it("rejects malformed input", () => {
    expect(() => Sharenote.fromLabel("XYZ")).toThrow(SharenoteError);
    expect(() => Sharenote.fromZBits(-1)).toThrow(SharenoteError);
    expect(() => Sharenote.fromZBits(Number.NaN)).toThrow(SharenoteError);
    expect(() => Sharenote.fromCentiBits(-1)).toThrow(SharenoteError);
    expect(() => Sharenote.fromComponents(-1, 0)).toThrow(SharenoteError);
    expect(() => Sharenote.from(true as never)).toThrow(SharenoteError);
  });

  it("clamps out-of-range centi-bits", () => {
    expect(Sharenote.fromComponents(10, 150).centiBits).toBe(99);
    expect(Sharenote.fromComponents(10, -5).centiBits).toBe(0);
  });
});

describe("queries", () => {
  it("reports probability and expected hashes", () => {
    const note = Sharenote.fromLabel("33Z53");
    expect(note.probabilityPerHash()).toBeCloseTo(2 ** -note.zBits, 18);
    expect(note.expectedHashes()).toBeCloseTo(2 ** note.zBits, 0);
    expect(note.difficulty()).toBeCloseTo(2 ** note.zBits, 0);
  });

  it("compares by continuous difficulty", () => {
    expect(compareSharenotes("32Z10", "33Z00")).toBeLessThan(0);
    expect(compareSharenotes("33Z54", "33Z53")).toBeGreaterThan(0);
    expect(compareSharenotes("33Z53", "33Z53")).toBe(0);
    expect(Sharenote.fromLabel("33Z53").compareTo("33Z54")).toBeLessThan(0);
    expect(Sharenote.fromLabel("33Z53").equals("33Z53")).toBe(true);
    expect(Sharenote.fromLabel("33Z53").equals("33Z54")).toBe(false);
  });

  it("formats labels", () => {
    expect(formatLabel(57, 12)).toBe("57Z12");
  });
});

describe("target and nBits", () => {
  it("produces a deterministic bigint target", () => {
    const target = Sharenote.fromLabel("33Z00").target();
    expect(typeof target).toBe("bigint");
    const approxBits = Math.log2(Number(target));
    expect(approxBits).toBeGreaterThan(222);
    expect(approxBits).toBeLessThan(224);
  });

  it("throws when z is too large for a target", () => {
    expect(() => Sharenote.fromZBits(300).target()).toThrow(SharenoteError);
  });

  it("round-trips nBits", () => {
    const nbits = Sharenote.fromLabel("33Z53").toNBits();
    expect(nbits).toMatch(/^[0-9a-f]{8}$/);
    expect(Sharenote.fromNBits("19752b59").label).toBe("57Z12");
    // 1d00ffff is Bitcoin's difficulty-1 target => zBits ~ 32.00002.
    expect(Sharenote.fromNBits("1d00ffff").label).toBe("32Z00");
  });

  it("rejects bad nBits", () => {
    expect(() => Sharenote.fromNBits("abc")).toThrow(SharenoteError);
    expect(() => Sharenote.fromNBits("19000000")).toThrow(SharenoteError); // mantissa 0
  });

  it("zBitsFromTarget inverts Sharenote.target across the range", () => {
    for (const label of ["0Z00", "10Z00", "20Z50", "33Z53", "40Z00", "50Z99", "64Z00", "80Z00"]) {
      const note = Sharenote.fromLabel(label);
      const recovered = zBitsFromTarget(note.target());
      expect(Math.abs(recovered - note.zBits)).toBeLessThanOrEqual(Math.abs(note.zBits) * 1e-6 + 1e-6);
    }
    expect(Sharenote.fromTarget(Sharenote.fromLabel("40Z00").target()).z).toBe(40);
  });

  it("zBitsFromTarget rejects non-positive targets", () => {
    expect(() => zBitsFromTarget(0n)).toThrow(SharenoteError);
    expect(() => zBitsFromTarget(-1n)).toThrow(SharenoteError);
  });
});

describe("arithmetic", () => {
  it("adds (combines) in difficulty space", () => {
    expect(combine(["25Z00", "25Z00"]).label).toBe("26Z00");
    const combined = combine(["33Z53", "20Z10"]);
    expect(combined.label).toBe("33Z53");
    const expected = Math.log2(2 ** 33.53 + 2 ** 20.1);
    expect(combined.zBits).toBeCloseTo(expected, 12);
    expect(Sharenote.fromLabel("33Z53").add("20Z10").zBits).toBeCloseTo(expected, 12);
  });

  it("rejects empty combine", () => {
    expect(() => combine([])).toThrow(SharenoteError);
  });

  it("subtracts, clamping to zero", () => {
    expect(Sharenote.fromLabel("33Z53").subtract("20Z10").label).toBe("33Z52");
    expect(Sharenote.fromLabel("10Z00").subtract("33Z53").zBits).toBe(0);
  });

  it("scales difficulty", () => {
    expect(Sharenote.fromLabel("20Z10").scale(1.5).label).toBe("20Z68");
    expect(Sharenote.fromLabel("33Z53").scale(0).label).toBe("0Z00");
    expect(() => Sharenote.fromLabel("33Z53").scale(-1)).toThrow(SharenoteError);
    expect(() => Sharenote.fromLabel("33Z53").scale(Number.NaN)).toThrow(SharenoteError);
  });

  it("divides difficulties", () => {
    const ratio = Sharenote.fromLabel("33Z53").divide("20Z10");
    expect(ratio).toBeCloseTo(2 ** (33.53 - 20.1), 6);
  });
});

describe("low-level difficulty helpers", () => {
  it("round-trips zBits and difficulty", () => {
    expect(difficultyToZBits(zBitsToDifficulty(33.53))).toBeCloseTo(33.53, 12);
  });

  it("rejects non-positive difficulty", () => {
    expect(() => difficultyToZBits(0)).toThrow(SharenoteError);
    expect(() => difficultyToZBits(-1)).toThrow(SharenoteError);
    expect(() => difficultyToZBits(Number.NaN)).toThrow(SharenoteError);
  });
});

describe("exact serial aggregation", () => {
  it("retains terms a float accumulator would drop", () => {
    const combined = combine(["53Z00", "0Z00"]);
    const exact = combined.exactDifficulty;
    expect(exact.sig).toBe((1n << 53n) + 1n);
    expect(exact.exp).toBe(0);

    const naive = zBitsToDifficulty(53) + zBitsToDifficulty(0);
    expect(naive).toBe(Number(1n << 53n));
    expect(exactDifficultyToNumber(exact)).toBe(Number(1n << 53n));
    expect(exact.sig).not.toBe(1n << 53n);
  });

  it("sums many unit notes to an exact integer difficulty", () => {
    const combined = combine(Array.from({ length: 1024 }, () => "0Z00"));
    expect(exactDifficultyToNumber(combined.exactDifficulty)).toBe(1024);
    expect(combined.zBits).toBe(10);
    expect(combined.label).toBe("10Z00");
  });

  it("is order-independent bit-for-bit", () => {
    const labels = ["42Z76", "34Z76", "33Z53", "35Z14", "1Z00", "60Z99"];
    const forward = combine(labels);
    const reversed = combine([...labels].reverse());
    expect(reversed.zBits).toBe(forward.zBits);
    expect(reversed.exactDifficulty.sig).toBe(forward.exactDifficulty.sig);
    expect(reversed.exactDifficulty.exp).toBe(forward.exactDifficulty.exp);
  });

  it("matches an independent BigInt computation", () => {
    const labels = ["12Z01", "12Z99", "13Z50", "14Z75", "15Z25"];
    const combined = combine(labels);
    const terms: ExactDifficulty[] = labels.map((label) =>
      decomposeFloatToExact(zBitsToDifficulty(Sharenote.fromLabel(label).zBits))
    );
    const independent = sumExactDifficulties(terms);
    expect(combined.exactDifficulty.sig).toBe(independent.sig);
    expect(combined.exactDifficulty.exp).toBe(independent.exp);
    expect(combined.zBits).toBe(zBitsFromExactDifficulty(independent));
  });

  it("treats exact difficulty as authoritative; zBits as display", () => {
    const combined = combine(["1Z00", "1Z00"]);
    expect(combined.exactDifficulty.sig).toBe(1n);
    expect(combined.exactDifficulty.exp).toBe(2);
    expect(combined.zBits).toBe(2);
  });

  it("derives an exact difficulty losslessly for a plain note", () => {
    const note = Sharenote.fromComponents(33, 53);
    expect(note.exactDifficulty.sig).toBeGreaterThan(0n);
    expect(exactDifficultyToNumber(note.exactDifficulty)).toBeCloseTo(note.difficulty(), 0);
  });
});

/**
 * Cross-SDK parity-fuzz regressions for the scale / subtract exactness hole and
 * the ratio double-round. All expected `sig`/`exp`/hex values below are
 * byte-identical to the Go SDK (`big.Rat`) and Python SDK (`Fraction`).
 */
describe("exact arithmetic survives scale, subtract, and ratio (fuzz regression)", () => {
  // IEEE-754 big-endian hex of a float64 — the canonical encoding the parity
  // fuzz compares (identical to the Go / Python runners' `ratio_hex`).
  const f64hex = (v: number): string => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, false);
    return dv.getBigUint64(0, false).toString(16).padStart(16, "0");
  };

  it("scale carries the exact product and folds into combine with zero loss", () => {
    // Start from an already-exact note whose difficulty is 2**53 + 1 — a value
    // with 54 significant bits, so it does NOT fit a float64 mantissa.
    const base = combine(["53Z00", "0Z00"]);
    expect(base.exactDifficulty.sig).toBe((1n << 53n) + 1n);
    expect(base.exactDifficulty.exp).toBe(0);

    // Scaling by 3 MUST keep the full 55-bit significand (3 * (2**53 + 1)) —
    // the old float path collapsed it to a 53-bit mantissa (losing the + 3).
    const scaled = base.scale(3);
    expect(scaled.exactDifficulty.sig).toBe(27021597764222979n);
    expect(scaled.exactDifficulty.exp).toBe(0);

    // The scaled note folds into `combine` as an EXACT term: the result is the
    // exact dyadic sum of the scaled difficulty and 1Z00's (2**1).
    const combined = combine([scaled, "1Z00"]);
    const expected = sumExactDifficulties([
      scaled.exactDifficulty,
      decomposeFloatToExact(zBitsToDifficulty(1)),
    ]);
    expect(combined.exactDifficulty.sig).toBe(expected.sig);
    expect(combined.exactDifficulty.exp).toBe(expected.exp);
    expect(combined.exactDifficulty.sig).toBe(27021597764222981n);
    expect(combined.exactDifficulty.exp).toBe(0);

    // Guard against regressing to the float-collapsing scale, which re-derives
    // the difficulty from the note's display `zBits` and loses the low bits.
    const collapsed = Sharenote.fromDifficulty(base.difficulty() * 3);
    expect(scaled.exactDifficulty).not.toEqual(collapsed.exactDifficulty);
  });

  it("subtract carries the exact difference and folds into combine with zero loss", () => {
    // 2**7.3 - 2**5.1 is not exactly representable as a float64; the exact
    // difference has 54 significant bits that a float subtraction would drop.
    const diff = Sharenote.fromLabel("7Z30").subtract("5Z10");
    expect(diff.label).toBe("6Z94");
    expect(diff.exactDifficulty.sig).toBe(17351487518213693n);
    expect(diff.exactDifficulty.exp).toBe(-47);

    const combined = combine([diff, "4Z00"]);
    const expected = sumExactDifficulties([
      diff.exactDifficulty,
      decomposeFloatToExact(zBitsToDifficulty(4)),
    ]);
    expect(combined.exactDifficulty.sig).toBe(expected.sig);
    expect(combined.exactDifficulty.exp).toBe(expected.exp);
    expect(combined.exactDifficulty.sig).toBe(19603287331898941n);
    expect(combined.exactDifficulty.exp).toBe(-47);

    // The old float-collapsing subtract would have carried a different, lossy
    // significand.
    const collapsed = Sharenote.fromDifficulty(
      Sharenote.fromLabel("7Z30").difficulty() - Sharenote.fromLabel("5Z10").difficulty()
    );
    expect(diff.exactDifficulty).not.toEqual(collapsed.exactDifficulty);

    // A non-positive difference still clamps to the zero note.
    expect(Sharenote.fromLabel("10Z00").subtract("33Z53").zBits).toBe(0);
  });

  it("ratio rounds the exact quotient once, like Go's big.Rat.Float64", () => {
    // Boundary case: operands with large integer difficulties whose float64
    // display values are lossy. Dividing two display floats (the old path)
    // rounds twice and lands one ULP away; rounding the exact rational once
    // matches Go and Python.
    const a = combine(["7Z00", "16Z00", "31Z00"]); // difficulty 16777729 * 2**7
    const b = combine(["28Z00", "48Z00"]); //          difficulty  1048577 * 2**28
    const ratio = a.divide(b);

    // Go `big.Rat(a/b).Float64()` and Python `float(Fraction(a)/Fraction(b))`.
    expect(f64hex(ratio)).toBe("3ee0001f0ffe0f00");
    expect(ratio).toBe(7.629620540467851e-6);

    // The pre-fix path divided the two display floats (each already a lossy
    // `2 ** zBits`), rounding twice and landing one ULP higher.
    const doubleRounded = a.difficulty() / b.difficulty();
    expect(f64hex(doubleRounded)).toBe("3ee0001f0ffe0f02");
    expect(ratio).not.toBe(doubleRounded);
  });
});
