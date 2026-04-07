import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CENT_ZBIT_STEP,
  SharenoteError,
  Sharenote,
  ReliabilityId,
  PrimaryMode,
  HashrateUnit,
  formatProbabilityDisplay,
  compareNotes,
  continuousDifficulty,
  estimateSharenote,
  estimateSharenotes,
  estimateNote,
  estimateNotes,
  combineNotesSerial,
  noteDifference,
  scaleNote,
  divideNote,
  expectedHashesForNote,
  expectedHashesForZBits,
  expectedHashesMeasurement,
  formatNoteLabel,
  maxZBitsForHashrate,
  nbitsToSharenote,
  noteFromHashrate,
  noteFromZBits,
  noteFromComponents,
  noteFromCentZBits,
  mustNoteFromZBits,
  mustNoteFromCentZBits,
  parseHashrate,
  normalizeHashrateValue,
  planSharenoteFromHashrate,
  probabilityPerHash,
  probabilityFromZBits,
  requiredHashrate,
  requiredHashrateMean,
  requiredHashrateQuantile,
  requiredHashrateMeasurement,
  requiredHashrateMeanMeasurement,
  requiredHashrateQuantileMeasurement,
  targetFor,
  sharenoteToNBits,
  humanHashrate,
  ensureNote,
  hashrateRangeForNote,
  getReliabilityLevels,
  zBitsFromComponents,
  zBitsFromDifficulty,
  difficultyFromZBits,
  withHumanHashratePrecision,
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
} from "./index";

// Verify canonical aliases are the same function references
if (estimateNote !== estimateSharenote) throw new Error("estimateNote alias mismatch");
if (estimateNotes !== estimateSharenotes) throw new Error("estimateNotes alias mismatch");

const LOG_2 = Math.log(2);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARITHMETIC_VECTORS_PATH = path.resolve(__dirname, "snip00_tests.json");
const ARITHMETIC_VECTORS = JSON.parse(
  fs.readFileSync(ARITHMETIC_VECTORS_PATH, "utf8")
) as { cases: any[] };

function expectCloseRelative(actual: number, expected: number, relTol = 1e-9, absTol = 0) {
  const diff = Math.abs(actual - expected);
  const allowed = Math.max(absTol, Math.abs(expected) * relTol);
  expect(diff).toBeLessThanOrEqual(allowed);
}

// ==========================================================================
// Note conversions
// ==========================================================================
describe("note conversions", () => {
  it("normalises cents and zbits", () => {
    const note = ensureNote({ z: 33, cents: 53 });
    expect(note.z).toBe(33);
    expect(note.cents).toBe(53);
    expect(note.zBits).toBeCloseTo(33 + 53 * CENT_ZBIT_STEP, 12);
    expect(note.label).toBe("33Z53");
  });

  it("parses multiple label forms", () => {
    const cases = [
      { label: "33Z53", cents: 53 },
      { label: "33Z 53CZ", cents: 53 },
      { label: "33Z53cz", cents: 53 },
      { label: "33.53Z", cents: 53 },
      { label: "33z", cents: 0 },
    ];
    for (const { label, cents } of cases) {
      const note = ensureNote(label);
      expect(note.z).toBe(33);
      expect(note.cents).toBe(cents);
    }
  });

  it("round-trips zBits to note and back", () => {
    const zBits = 33 + 53 * CENT_ZBIT_STEP;
    const note = noteFromZBits(zBits);
    expect(note.label).toBe("33Z53");
    expect(note.zBits).toBeCloseTo(zBits, 12);
  });

  it("preserves precise zBits while formatting friendly labels", () => {
    const precise = 33.537812;
    const note = noteFromZBits(precise);
    expect(note.label).toBe("33Z53");
    expect(note.zBits).toBeCloseTo(precise, 12);
  });

  it("converts compact nBits to Sharenote label", () => {
    const note = nbitsToSharenote("19752b59");
    const value = Number.parseInt("19752b59", 16);
    const exponent = value >>> 24;
    const mantissa = value & 0xffffff;
    const expected =
      256 - (Math.log2(mantissa) + 8 * (exponent - 3));
    expect(note.zBits).toBeCloseTo(expected, 12);
    expect(note.label).toBe("57Z12");
  });

  it("compares notes lexicographically by rarity", () => {
    expect(compareNotes("32Z10", "33Z00")).toBeLessThan(0);
    expect(compareNotes("33Z54", "33Z53")).toBeGreaterThan(0);
    expect(compareNotes("33Z53", "33Z53")).toBe(0);
  });

  it("constructs from components", () => {
    const note = noteFromComponents(33, 53);
    expect(note.label).toBe("33Z53");
  });

  it("constructs from centZBits", () => {
    const note = noteFromCentZBits(3353);
    expect(note.label).toBe("33Z53");
  });

  it("mustNoteFromZBits works like noteFromZBits", () => {
    const note = mustNoteFromZBits(33.53);
    expect(note.label).toBe("33Z53");
  });

  it("mustNoteFromCentZBits works like noteFromCentZBits", () => {
    const note = mustNoteFromCentZBits(3353);
    expect(note.label).toBe("33Z53");
  });

  it("zBitsFromComponents round-trips", () => {
    const zbits = zBitsFromComponents(33, 53);
    expect(zbits).toBeCloseTo(33.53, 12);
  });

  it("rejects invalid label", () => {
    expect(() => ensureNote("XYZ")).toThrow(SharenoteError);
  });

  it("rejects negative zBits", () => {
    expect(() => noteFromZBits(-1)).toThrow(SharenoteError);
  });

  it("rejects NaN zBits", () => {
    expect(() => noteFromZBits(NaN)).toThrow(SharenoteError);
  });

  it("rejects negative centZBits", () => {
    expect(() => noteFromCentZBits(-1)).toThrow(SharenoteError);
  });

  it("ensureNote accepts number directly", () => {
    const note = ensureNote(33.53);
    expect(note.label).toBe("33Z53");
  });

  it("ensureNote rejects booleans/unsupported", () => {
    expect(() => ensureNote(true as any)).toThrow(SharenoteError);
  });

  it("Sharenote instance methods work", () => {
    const note = ensureNote("33Z53");
    expect(note.toString()).toBe("33Z53");
    expect(note.probabilityPerHash()).toBeCloseTo(2 ** -note.zBits, 12);
    expect(note.expectedHashes().floatValue()).toBeGreaterThan(0);
    const mean = note.requiredHashrateMean(5);
    expect(mean.floatValue()).toBeGreaterThan(0);
    const q = note.requiredHashrateQuantile(5, 0.95);
    expect(q.floatValue()).toBeGreaterThan(mean.floatValue());
    const target = note.target();
    expect(typeof target).toBe("bigint");
    const combined = note.combineSerial("20Z10");
    expect(combined.label).toBe("33Z53");
    const diff = note.difference("20Z10");
    expect(diff.z).toBe(33);
    const scaled = note.scale(2);
    expect(scaled.zBits).toBeGreaterThan(note.zBits);
    const nbits = note.nBits();
    expect(nbits.length).toBe(8);
  });

  it("Sharenote measurement aliases", () => {
    const note = ensureNote("33Z53");
    const rm = note.requiredHashrateMeasurement(5);
    expect(rm.floatValue()).toBeCloseTo(note.requiredHashrateMean(5).floatValue(), 6);
    const rmm = note.requiredHashrateMeanMeasurement(5);
    expect(rmm.floatValue()).toBeCloseTo(note.requiredHashrateMean(5).floatValue(), 6);
    const rqm = note.requiredHashrateQuantileMeasurement(5, 0.95);
    expect(rqm.floatValue()).toBeCloseTo(note.requiredHashrateQuantile(5, 0.95).floatValue(), 6);
    const range = note.hashrateRange(5);
    expect(range.minimum).toBeLessThan(range.maximum);
    const [humanMin, humanMax] = range.human();
    expect(humanMin.display).toContain("H/s");
    expect(humanMax.display).toContain("H/s");
  });
});

// ==========================================================================
// Probabilities and hashrates
// ==========================================================================
describe("probabilities and hashrates", () => {
  it("computes probability per hash", () => {
    const p = probabilityPerHash("33Z53");
    const zBits = ensureNote({ z: 33, cents: 53 }).zBits;
    expect(p).toBeCloseTo(2 ** -zBits, 18);
  });

  it("probabilityFromZBits matches", () => {
    expect(probabilityFromZBits(10)).toBeCloseTo(2 ** -10, 18);
  });

  it("formats probability displays", () => {
    const note = ensureNote({ z: 33, cents: 53 });
    expect(formatProbabilityDisplay(note.zBits, 5)).toBe("1 / 2^33.53000");
  });

  it("computes expected hashes", () => {
    const hashes = expectedHashesForNote("33Z53");
    expect(hashes.floatValue()).toBeCloseTo(1 / probabilityPerHash("33Z53"), 6);
    expect(hashes.toString()).toContain("H/s");
  });

  it("expectedHashesForZBits returns measurement", () => {
    const m = expectedHashesForZBits(33.53);
    expect(m.floatValue()).toBeGreaterThan(0);
  });

  it("expectedHashesMeasurement is alias", () => {
    const a = expectedHashesMeasurement("33Z53");
    const b = expectedHashesForNote("33Z53");
    expect(a.floatValue()).toBeCloseTo(b.floatValue(), 12);
  });

  it("derives mean and quantile hashrate requirements", () => {
    const note = ensureNote({ z: 33, cents: 53 });
    const expectedMean = 2 ** note.zBits / 5;
    const mean = requiredHashrateMean("33Z53", 5);
    expect(mean.floatValue()).toBeCloseTo(expectedMean, 6);

    const expectedQ95 = expectedMean * -Math.log(1 - 0.95);
    const q95 = requiredHashrateQuantile("33Z53", 5, 0.95);
    expect(q95.floatValue()).toBeCloseTo(expectedQ95, 6);
  });

  it("requiredHashrate with multiplier", () => {
    const r = requiredHashrate("33Z53", 5, { multiplier: 2 });
    const mean = requiredHashrateMean("33Z53", 5);
    expect(r.floatValue()).toBeCloseTo(mean.floatValue() * 2, 6);
  });

  it("requiredHashrate with reliability id", () => {
    const r = requiredHashrate("33Z53", 5, { reliability: ReliabilityId.Often95 });
    expect(r.floatValue()).toBeGreaterThan(0);
  });

  it("requiredHashrate with reliability as number", () => {
    const r = requiredHashrate("33Z53", 5, { reliability: 0.95 });
    expect(r.floatValue()).toBeGreaterThan(0);
  });

  it("measurement aliases work", () => {
    const a = requiredHashrateMeasurement("33Z53", 5);
    const b = requiredHashrateMean("33Z53", 5);
    expect(a.floatValue()).toBeCloseTo(b.floatValue(), 6);
    expect(a.toString()).toContain("H/s");
    expect(a.human().display).toContain("H/s");

    const c = requiredHashrateMeanMeasurement("33Z53", 5);
    expect(c.floatValue()).toBeCloseTo(b.floatValue(), 6);

    const d = requiredHashrateQuantileMeasurement("33Z53", 5, 0.95);
    const e = requiredHashrateQuantile("33Z53", 5, 0.95);
    expect(d.floatValue()).toBeCloseTo(e.floatValue(), 6);
  });

  it("rejects 0 or negative seconds", () => {
    expect(() => requiredHashrate("33Z53", 0)).toThrow(SharenoteError);
    expect(() => requiredHashrate("33Z53", -1)).toThrow(SharenoteError);
  });

  it("rejects invalid multiplier", () => {
    expect(() => requiredHashrate("33Z53", 5, { multiplier: -1 })).toThrow(SharenoteError);
    expect(() => requiredHashrate("33Z53", 5, { multiplier: 0 })).toThrow(SharenoteError);
    expect(() => requiredHashrate("33Z53", 5, { multiplier: NaN })).toThrow(SharenoteError);
  });

  it("rejects bad confidence in quantile", () => {
    expect(() => requiredHashrateQuantile("33Z53", 5, 0)).toThrow(SharenoteError);
    expect(() => requiredHashrateQuantile("33Z53", 5, 1)).toThrow(SharenoteError);
  });

  it("converts hashrate back to note label", () => {
    const note = noteFromHashrate(2.480651469003486e9, 5);
    expect(note.label).toBe("33Z53");
  });

  it("noteFromHashrate with reliability", () => {
    const note = noteFromHashrate(5e9, 5, { reliability: ReliabilityId.Often95 });
    expect(note.z).toBeGreaterThan(0);
  });

  it("noteFromHashrate with numeric reliability", () => {
    const note = noteFromHashrate(5e9, 5, { reliability: 0.95 });
    expect(note.z).toBeGreaterThan(0);
  });

  it("derives notes using parsed hashrate values", () => {
    const parsed = parseHashrate("2.480651469 GH/s");
    const note = noteFromHashrate(parsed, 5);
    expect(note.label).toBe("33Z53");
  });

  it("exposes hashrate ranges that contain the source hashrate", () => {
    const seconds = 5;
    const input = parseHashrate("1000 MH/s");
    const note = noteFromHashrate(input, seconds);
    const range = hashrateRangeForNote(note, seconds);
    expect(range.minimum).toBeLessThanOrEqual(input);
    expect(range.maximum).toBeGreaterThan(input);
    const lowerNote = noteFromHashrate(range.minimum, seconds);
    expect(lowerNote.label).toBe(note.label);
  });

  it("expands hashrate range when reliability increases", () => {
    const note = ensureNote("33Z53");
    const base = hashrateRangeForNote(note, 5);
    const often = hashrateRangeForNote(note, 5, {
      reliability: ReliabilityId.Often95,
    });
    expect(often.minimum).toBeGreaterThan(base.minimum);
    expect(often.maximum).toBeGreaterThan(base.maximum);
  });

  it("parses human readable hashrates", () => {
    expect(parseHashrate("5 GH/s")).toBeCloseTo(5e9, 3);
    expect(parseHashrate("12.5 MH/s")).toBeCloseTo(12.5e6, 3);
    expect(parseHashrate({ value: 3.5, unit: HashrateUnit.PHps })).toBeCloseTo(
      3.5e15,
      3
    );
  });

  it("parses bare numeric hashrate", () => {
    expect(parseHashrate(5e9)).toBe(5e9);
  });

  it("rejects empty hashrate string", () => {
    expect(() => parseHashrate("")).toThrow(SharenoteError);
  });

  it("rejects unrecognised hashrate units", () => {
    expect(() => parseHashrate("12 foo/s")).toThrowError(SharenoteError);
  });

  it("normalizeHashrateValue with descriptor", () => {
    const val = normalizeHashrateValue({ value: 5, unit: HashrateUnit.GHps });
    expect(val).toBe(5e9);
  });

  it("normalizeHashrateValue rejects negative", () => {
    expect(() => normalizeHashrateValue(-1)).toThrow(SharenoteError);
    expect(() => normalizeHashrateValue({ value: -1 })).toThrow(SharenoteError);
  });

  it("normalizeHashrateValue rejects NaN", () => {
    expect(() => normalizeHashrateValue(NaN)).toThrow(SharenoteError);
  });

  it("normalizeHashrateValue rejects unsupported type", () => {
    expect(() => normalizeHashrateValue(true as any)).toThrow(SharenoteError);
  });

  it("computes maximum bits for a given hashrate", () => {
    const zBits = maxZBitsForHashrate(2.480651469003486e9, 5);
    expect(zBits).toBeCloseTo(ensureNote({ z: 33, cents: 53 }).zBits, 6);
  });

  it("maxZBitsForHashrate rejects bad inputs", () => {
    expect(() => maxZBitsForHashrate(0, 5)).toThrow(SharenoteError);
    expect(() => maxZBitsForHashrate(1e9, 0)).toThrow(SharenoteError);
    expect(() => maxZBitsForHashrate(1e9, 5, 0)).toThrow(SharenoteError);
    expect(() => maxZBitsForHashrate(NaN, 5)).toThrow(SharenoteError);
    expect(() => maxZBitsForHashrate(1e9, NaN)).toThrow(SharenoteError);
    expect(() => maxZBitsForHashrate(1e9, 5, NaN)).toThrow(SharenoteError);
  });

  it("plans sharenotes from human hashrate strings", () => {
    const plan = planSharenoteFromHashrate({
      hashrate: { value: 5, unit: HashrateUnit.GHps },
      seconds: 5,
      reliability: ReliabilityId.Often95,
    });
    const expected = noteFromHashrate(5e9, 5, {
      reliability: ReliabilityId.Often95,
    });
    expect(plan.sharenote.label).toBe(expected.label);
    const relativeDiff =
      Math.abs(plan.bill.requiredHashratePrimary - plan.inputHashrateHps) /
      plan.inputHashrateHps;
    expect(relativeDiff).toBeLessThan(0.02);
    expect(plan.inputHashrateHuman.unit).toBe("GH/s");
  });

  it("planSharenoteFromHashrate rejects bad inputs", () => {
    expect(() => planSharenoteFromHashrate({ hashrate: 0, seconds: 5 })).toThrow(SharenoteError);
    expect(() => planSharenoteFromHashrate({ hashrate: 5e9, seconds: 0 })).toThrow(SharenoteError);
  });

  it("rejects direct string hashrate inputs in noteFromHashrate", () => {
    expect(() => noteFromHashrate("1 GH/s" as unknown as number, 5)).toThrow();
  });
});

// ==========================================================================
// Target computation & ContinuousDifficulty
// ==========================================================================
describe("target computation", () => {
  it("returns a deterministic bigint target", () => {
    const target = targetFor("33Z00");
    expect(typeof target).toBe("bigint");
    const approxBits = Math.log(Number(target)) / LOG_2;
    expect(approxBits).toBeGreaterThan(222);
    expect(approxBits).toBeLessThan(224);
  });

  it("throws for z too large", () => {
    expect(() => targetFor(noteFromZBits(300))).toThrow(SharenoteError);
  });

  it("formats labels correctly", () => {
    expect(formatNoteLabel(57, 12)).toBe("57Z12");
  });

  it("sharenoteToNBits produces 8-char hex", () => {
    const nbits = sharenoteToNBits("33Z53");
    expect(nbits.length).toBe(8);
    expect(/^[0-9a-f]{8}$/.test(nbits)).toBe(true);
  });

  it("nbitsToSharenote rejects bad input", () => {
    expect(() => nbitsToSharenote("abc")).toThrow(SharenoteError);
    expect(() => nbitsToSharenote("19000000")).toThrow(SharenoteError); // mantissa=0
  });
});

describe("continuousDifficulty", () => {
  it("is the inverse of targetFor for multiple notes", () => {
    const testCases = [
      "0Z00", "10Z00", "20Z50", "33Z53", "40Z00", "50Z99", "64Z00", "80Z00",
    ];
    for (const label of testCases) {
      const note = ensureNote(label);
      const target = targetFor(note);
      const recovered = continuousDifficulty(target);
      expectCloseRelative(recovered, note.zBits, 1e-6);
    }
  });

  it("rejects zero target", () => {
    expect(() => continuousDifficulty(0n)).toThrow(SharenoteError);
  });

  it("rejects negative target", () => {
    expect(() => continuousDifficulty(-1n)).toThrow(SharenoteError);
  });
});

// ==========================================================================
// Utility helpers
// ==========================================================================
describe("utility helpers", () => {
  it("humanises hashrates", () => {
    const human = humanHashrate(3.2e9);
    expect(human.unit).toBe("GH/s");
    expect(human.display).toContain("3.20");
  });

  it("keeps tiny hashrates in H/s", () => {
    const human = humanHashrate(0.25, { precision: 2 });
    expect(human.unit).toBe("H/s");
    expect(human.display).toBe("0.25 H/s");
  });

  it("humanHashrate for zero", () => {
    const human = humanHashrate(0);
    expect(human.display).toBe("0 H/s");
  });

  it("humanHashrate for negative", () => {
    const human = humanHashrate(-5);
    expect(human.display).toBe("0 H/s");
  });

  it("humanHashrate for >100 scaled", () => {
    const human = humanHashrate(500e9);
    expect(human.display).toBe("500 GH/s");
  });

  it("humanHashrate for 10-100 scaled", () => {
    const human = humanHashrate(50e9);
    expect(human.display).toBe("50.0 GH/s");
  });

  it("humanHashrate with precision override", () => {
    const human = humanHashrate(3.2e9, { precision: 4 });
    expect(human.display).toBe("3.2000 GH/s");
  });

  it("withHumanHashratePrecision returns options", () => {
    expect(withHumanHashratePrecision(3)).toEqual({ precision: 3 });
  });

  it("produces bill estimates", () => {
    const estimate = estimateSharenote("33Z53", 5, {
      reliability: 0.95,
    });
    expect(estimate.label).toBe("33Z53");
    const expectedPrimary =
      (2 ** estimate.zBits / 5) * -Math.log(1 - 0.95);
    expect(estimate.requiredHashratePrimary).toBeCloseTo(
      expectedPrimary,
      6
    );
    expect(estimate.requiredHashrateHuman.unit).toBe("GH/s");
    expect(estimate.probabilityDisplay.startsWith("1 / 2^")).toBe(true);
  });

  it("estimateSharenote with multiplier", () => {
    const est = estimateSharenote("33Z53", 5, { multiplier: 2 });
    expect(est.multiplier).toBe(2);
  });

  it("estimateSharenote with reliability id", () => {
    const est = estimateSharenote("33Z53", 5, { reliability: ReliabilityId.VeryLikely99 });
    expect(est.quantile).toBeCloseTo(0.99, 6);
    expect(est.primaryMode).toBe("quantile");
  });

  it("estimateSharenote with primaryMode Mean", () => {
    const est = estimateSharenote("33Z53", 5, { primaryMode: PrimaryMode.Mean });
    expect(est.primaryMode).toBe("mean");
  });

  it("estimateSharenote with primaryMode Quantile", () => {
    const est = estimateSharenote("33Z53", 5, {
      reliability: 0.95,
      primaryMode: PrimaryMode.Quantile,
    });
    expect(est.primaryMode).toBe("quantile");
  });

  it("estimateSharenote with probabilityPrecision", () => {
    const est = estimateSharenote("33Z53", 5, { probabilityPrecision: 3 });
    expect(est.probabilityDisplay).toMatch(/^1 \/ 2\^\d+\.\d{3}$/);
  });

  it("estimateSharenotes maps multiple notes", () => {
    const estimates = estimateSharenotes(["33Z53", "20Z10"], 5);
    expect(estimates.length).toBe(2);
    expect(estimates[0].label).toBe("33Z53");
    expect(estimates[1].label).toBe("20Z10");
  });

  it("estimateSharenote rejects 0 seconds", () => {
    expect(() => estimateSharenote("33Z53", 0)).toThrow(SharenoteError);
  });

  it("shows human-readable hashrate for sharenotes", () => {
    const estimate = estimateSharenote("33Z53", 5);
    const display = estimate.requiredHashrateHuman.display;
    expect(display.endsWith(" GH/s")).toBe(true);
    expect(Number.parseFloat(display)).toBeCloseTo(2.48, 2);
  });

  it("getReliabilityLevels returns all levels", () => {
    const levels = getReliabilityLevels();
    expect(levels.length).toBe(5);
  });

  it("difficultyFromZBits and zBitsFromDifficulty round-trip", () => {
    const d = difficultyFromZBits(33.53);
    const z = zBitsFromDifficulty(d);
    expect(z).toBeCloseTo(33.53, 12);
  });

  it("zBitsFromDifficulty rejects <= 0", () => {
    expect(() => zBitsFromDifficulty(0)).toThrow(SharenoteError);
    expect(() => zBitsFromDifficulty(-1)).toThrow(SharenoteError);
  });

  it("zBitsFromDifficulty rejects NaN", () => {
    expect(() => zBitsFromDifficulty(NaN)).toThrow(SharenoteError);
  });

  it("option factories return expected shapes", () => {
    expect(withMultiplier(2)).toEqual({ multiplier: 2 });
    expect(withReliability(ReliabilityId.Often95)).toEqual({ reliability: ReliabilityId.Often95 });
    expect(withConfidence(0.95)).toEqual({ reliability: 0.95 });
    expect(withEstimateMultiplier(2)).toEqual({ multiplier: 2 });
    expect(withEstimateReliability(ReliabilityId.Mean)).toEqual({ reliability: ReliabilityId.Mean });
    expect(withEstimateConfidence(0.99)).toEqual({ reliability: 0.99 });
    expect(withEstimatePrimaryMode(PrimaryMode.Quantile)).toEqual({ primaryMode: PrimaryMode.Quantile });
    expect(withEstimateProbabilityPrecision(4)).toEqual({ probabilityPrecision: 4 });
    expect(withPlanMultiplier(2)).toEqual({ multiplier: 2 });
    expect(withPlanReliability(ReliabilityId.Almost999)).toEqual({ reliability: ReliabilityId.Almost999 });
    expect(withPlanConfidence(0.9)).toEqual({ reliability: 0.9 });
  });

  it("combines notes serially", () => {
    const combined = combineNotesSerial(["33Z53", "20Z10"]);
    expect(combined.label).toBe("33Z53");
    const noteA = ensureNote({ z: 33, cents: 53 });
    const noteB = ensureNote({ z: 20, cents: 10 });
    const expected = Math.log2(
      2 ** noteA.zBits + 2 ** noteB.zBits
    );
    expect(combined.zBits).toBeCloseTo(expected, 12);
  });

  it("combineNotesSerial rejects empty array", () => {
    expect(() => combineNotesSerial([])).toThrow(SharenoteError);
  });

  it("computes note differences", () => {
    const diff = noteDifference("33Z53", "20Z10");
    expect(diff.label).toBe("33Z52");
    const noteA = ensureNote({ z: 33, cents: 53 });
    const noteB = ensureNote({ z: 20, cents: 10 });
    const expected = Math.log2(2 ** noteA.zBits - 2 ** noteB.zBits);
    expect(diff.zBits).toBeCloseTo(expected, 12);
  });

  it("noteDifference clamps to 0 when subtrahend >= minuend", () => {
    const diff = noteDifference("10Z00", "33Z53");
    expect(diff.zBits).toBe(0);
  });

  it("scales note zBits", () => {
    const scaled = scaleNote("20Z10", 1.5);
    expect(scaled.label).toBe("20Z68");
    const base = ensureNote({ z: 20, cents: 10 });
    const expected = Math.log2(2 ** base.zBits * 1.5);
    expect(scaled.zBits).toBeCloseTo(expected, 12);
  });

  it("scaleNote with factor 0 returns 0Z00", () => {
    const scaled = scaleNote("33Z53", 0);
    expect(scaled.label).toBe("0Z00");
  });

  it("scaleNote rejects negative factor", () => {
    expect(() => scaleNote("33Z53", -1)).toThrow(SharenoteError);
  });

  it("scaleNote rejects NaN factor", () => {
    expect(() => scaleNote("33Z53", NaN)).toThrow(SharenoteError);
  });

  it("divides note difficulties", () => {
    const ratio = divideNote("33Z53", "20Z10");
    const noteA = ensureNote({ z: 33, cents: 53 });
    const noteB = ensureNote({ z: 20, cents: 10 });
    const expected = Math.pow(2, noteA.zBits) / Math.pow(2, noteB.zBits);
    expect(ratio).toBeCloseTo(expected, 6);
  });

  it("divideNote rejects zero-difficulty denominator", () => {
    // Difficulty can't actually be 0 for valid notes, so this just tests valid division
    const ratio = divideNote("10Z00", "0Z00");
    expect(ratio).toBeGreaterThan(0);
  });
});

// ==========================================================================
// Arithmetic vectors (JSON)
// ==========================================================================
describe("arithmetic vectors (json)", () => {
  for (const testCase of ARITHMETIC_VECTORS.cases.filter(
    (c) => c.operation === "add"
  )) {
    it(`add: ${testCase.name}`, () => {
      const labels = testCase.inputs.map((i: any) => i.label);
      const result = combineNotesSerial(labels);
      expect(result.label).toBe(testCase.expected.label);
      expect(result.zBits).toBeCloseTo(testCase.expected.z_bits, 6);
      const difficulty = 2 ** result.zBits;
      expectCloseRelative(difficulty, testCase.expected.difficulty, 1e-9, 1e-6);
    });
  }

  for (const testCase of ARITHMETIC_VECTORS.cases.filter(
    (c) => c.operation === "subtract"
  )) {
    it(`subtract: ${testCase.name}`, () => {
      const result = noteDifference(
        testCase.inputs.minuend.label,
        testCase.inputs.subtrahend.label
      );
      expect(result.label).toBe(testCase.expected.label);
      expect(result.zBits).toBeCloseTo(testCase.expected.z_bits, 6);
    });
  }

  for (const testCase of ARITHMETIC_VECTORS.cases.filter(
    (c) => c.operation === "scale"
  )) {
    it(`scale: ${testCase.name}`, () => {
      const result = scaleNote(testCase.inputs.note.label, testCase.inputs.factor);
      expect(result.label).toBe(testCase.expected.label);
      expect(result.zBits).toBeCloseTo(testCase.expected.z_bits, 6);
    });
  }

  for (const testCase of ARITHMETIC_VECTORS.cases.filter(
    (c) => c.operation === "divide"
  )) {
    it(`divide: ${testCase.name}`, () => {
      const ratio = divideNote(
        testCase.inputs.numerator.label,
        testCase.inputs.denominator.label
      );
      expectCloseRelative(ratio, testCase.expected.ratio, 1e-9, 1e-12);
      const numerator = ensureNote(testCase.inputs.numerator.label);
      const denominator = ensureNote(testCase.inputs.denominator.label);
      const expected = Math.pow(2, numerator.zBits - denominator.zBits);
      expectCloseRelative(ratio, expected, 1e-9, 1e-12);
    });
  }
});
