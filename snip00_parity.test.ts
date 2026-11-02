/**
 * SNIP-00 cross-SDK parity + exact-aggregation tests.
 *
 * These load the CANONICAL shared vectors that live in the Go SDK repo
 * (go-sharenote/snip00/snip00_tests.json) and assert the JS SDK produces the
 * same results — the vectors are the shared parity source for every SDK.
 *
 * It also exercises the exact (rational / BigInt) serial aggregation added per
 * SNIP-00 Appendix C, proving the combine path does not accumulate float drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  combineNotesSerial,
  noteDifference,
  scaleNote,
  divideNotes,
  divideNote,
  ensureNote,
  noteFromComponents,
  decomposeFloatToExact,
  sumExactDifficulties,
  zBitsFromExactDifficulty,
  exactDifficultyToNumber,
  difficultyFromZBits,
} from "./index";
import type { ExactDifficulty } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer the canonical shared vectors from the sibling Go SDK repo; fall back to
// the bundled copy so the package test still runs standalone.
const CANONICAL_PATH = path.resolve(
  __dirname,
  "../go-sharenote/snip00/snip00_tests.json"
);
const LOCAL_PATH = path.resolve(__dirname, "snip00_tests.json");
const canonicalExists = fs.existsSync(CANONICAL_PATH);
const VECTORS_PATH = canonicalExists ? CANONICAL_PATH : LOCAL_PATH;
const VECTORS = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8")) as {
  cent_step: number;
  cases: any[];
};

function expectCloseRelative(actual: number, expected: number, relTol = 1e-9, absTol = 0) {
  const diff = Math.abs(actual - expected);
  const allowed = Math.max(absTol, Math.abs(expected) * relTol);
  expect(diff).toBeLessThanOrEqual(allowed);
}

describe("snip00 canonical parity", () => {
  it("bundled vectors match the canonical go-sharenote source", () => {
    if (!canonicalExists) {
      // Nothing to compare against in this checkout; skip silently.
      return;
    }
    const canonical = fs.readFileSync(CANONICAL_PATH, "utf8");
    const local = fs.readFileSync(LOCAL_PATH, "utf8");
    expect(local).toBe(canonical);
  });

  for (const testCase of VECTORS.cases.filter((c) => c.operation === "add")) {
    it(`add: ${testCase.name}`, () => {
      const labels = testCase.inputs.map((i: any) => i.label);
      const result = combineNotesSerial(labels);
      expect(result.label).toBe(testCase.expected.label);
      expect(result.zBits).toBeCloseTo(testCase.expected.z_bits, 6);
      const difficulty = difficultyFromZBits(result.zBits);
      expectCloseRelative(difficulty, testCase.expected.difficulty, 1e-9, 1e-6);
      expectCloseRelative(
        result.probabilityPerHash(),
        testCase.expected.probability_per_hash,
        1e-9,
        1e-18
      );
    });
  }

  for (const testCase of VECTORS.cases.filter((c) => c.operation === "subtract")) {
    it(`subtract: ${testCase.name}`, () => {
      const result = noteDifference(
        testCase.inputs.minuend.label,
        testCase.inputs.subtrahend.label
      );
      expect(result.label).toBe(testCase.expected.label);
      expect(result.zBits).toBeCloseTo(testCase.expected.z_bits, 6);
    });
  }

  for (const testCase of VECTORS.cases.filter((c) => c.operation === "scale")) {
    it(`scale: ${testCase.name}`, () => {
      const result = scaleNote(testCase.inputs.note.label, testCase.inputs.factor);
      // No clamp: result follows difficulty * factor straight through log2.
      expect(result.label).toBe(testCase.expected.label);
      expect(result.zBits).toBeCloseTo(testCase.expected.z_bits, 6);
    });
  }

  for (const testCase of VECTORS.cases.filter((c) => c.operation === "divide")) {
    it(`divide: ${testCase.name}`, () => {
      const ratio = divideNotes(
        testCase.inputs.numerator.label,
        testCase.inputs.denominator.label
      );
      expectCloseRelative(ratio, testCase.expected.ratio, 1e-9, 1e-12);
      // Deprecated alias must stay behaviourally identical.
      expect(divideNote(
        testCase.inputs.numerator.label,
        testCase.inputs.denominator.label
      )).toBe(ratio);
    });
  }
});

describe("snip00 exact serial aggregation", () => {
  it("accumulates difficulties with no float drift (retains dropped terms)", () => {
    // 53Z00 has difficulty 2^53; a 0Z00 note has difficulty 1. A float64
    // accumulator loses the +1 (ULP at 2^53 is 2), collapsing to exactly 2^53.
    // Exact BigInt accumulation retains it: 2^53 + 1.
    const combined = combineNotesSerial(["53Z00", "0Z00"]);
    const exact = combined.difficultyExact();
    expect(exact.sig).toBe((1n << 53n) + 1n);
    expect(exact.exp).toBe(0);

    // Sanity: a naive float reduce would have dropped the term.
    const naive = difficultyFromZBits(53) + difficultyFromZBits(0);
    expect(naive).toBe(Number(1n << 53n)); // 2^53 + 1 rounds back to 2^53
    expect(exactDifficultyToNumber(exact)).toBe(Number(1n << 53n)); // float view rounds too
    expect(exact.sig).not.toBe(1n << 53n); // but the exact sum did not
  });

  it("sums many unit notes to an exact integer difficulty", () => {
    const notes = Array.from({ length: 1024 }, () => "0Z00");
    const combined = combineNotesSerial(notes);
    // 1024 unit difficulties sum to exactly 2^10 -> 10Z00.
    expect(exactDifficultyToNumber(combined.difficultyExact())).toBe(1024);
    expect(combined.zBits).toBe(10);
    expect(combined.label).toBe("10Z00");
  });

  it("is order-independent (exact sums commute bit-for-bit)", () => {
    const labels = ["42Z76", "34Z76", "33Z53", "35Z14", "1Z00", "60Z99"];
    const forward = combineNotesSerial(labels);
    const reversed = combineNotesSerial([...labels].reverse());
    const shuffled = combineNotesSerial([
      "33Z53",
      "60Z99",
      "1Z00",
      "42Z76",
      "35Z14",
      "34Z76",
    ]);
    // Exact accumulation => identical zBits regardless of input order.
    expect(reversed.zBits).toBe(forward.zBits);
    expect(shuffled.zBits).toBe(forward.zBits);
    expect(reversed.difficultyExact().sig).toBe(forward.difficultyExact().sig);
    expect(reversed.difficultyExact().exp).toBe(forward.difficultyExact().exp);
  });

  it("stored exact sum matches an independent BigInt computation", () => {
    const labels = ["12Z01", "12Z99", "13Z50", "14Z75", "15Z25"];
    const combined = combineNotesSerial(labels);

    const terms: ExactDifficulty[] = labels.map((label) =>
      decomposeFloatToExact(difficultyFromZBits(ensureNote(label).zBits))
    );
    const independent = sumExactDifficulties(terms);

    expect(combined.difficultyExact().sig).toBe(independent.sig);
    expect(combined.difficultyExact().exp).toBe(independent.exp);
    expect(combined.zBits).toBe(zBitsFromExactDifficulty(independent));
  });

  it("derives zBits purely as display; exact difficulty is authoritative", () => {
    const combined = combineNotesSerial(["1Z00", "1Z00"]);
    // 2 + 2 = 4 exactly -> 2Z00, zBits 2.
    expect(combined.difficultyExact().sig).toBe(1n);
    expect(combined.difficultyExact().exp).toBe(2);
    expect(combined.zBits).toBe(2);
  });

  it("Sharenote.difficultyExact round-trips a plain note losslessly", () => {
    const note = noteFromComponents(33, 53);
    const exact = note.difficultyExact();
    // The float64 difficulty is itself a dyadic rational -> reconstructs exactly.
    expect(exactDifficultyToNumber(exact)).toBeCloseTo(
      difficultyFromZBits(note.zBits),
      0
    );
    expect(exact.sig).toBeGreaterThan(0n);
  });
});
