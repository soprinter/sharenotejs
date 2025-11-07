import { describe, expect, it } from "vitest";

import {
  CENT_ZBIT_STEP,
  SharenoteError,
  ReliabilityId,
  HashrateUnit,
  formatProbabilityDisplay,
  compareNotes,
  estimateSharenote,
  combineNotesSerial,
  noteDifference,
  scaleNote,
  divideNote,
  expectedHashesForNote,
  formatNoteLabel,
  maxZBitsForHashrate,
  nbitsToSharenote,
  noteFromHashrate,
  noteFromZBits,
  parseHashrate,
  planSharenoteFromHashrate,
  probabilityPerHash,
  requiredHashrateMean,
  requiredHashrateQuantile,
  targetFor,
  humanHashrate,
  ensureNote,
} from "./index";

const LOG_2 = Math.log(2);

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
  });
});

describe("probabilities and hashrates", () => {
  it("computes probability per hash", () => {
    const p = probabilityPerHash("33Z53");
    const zBits = ensureNote({ z: 33, cents: 53 }).zBits;
    expect(p).toBeCloseTo(2 ** -zBits, 18);
  });

  it("formats probability displays", () => {
    const note = ensureNote({ z: 33, cents: 53 });
    expect(formatProbabilityDisplay(note.zBits, 5)).toBe("1 / 2^33.53000");
  });

  it("computes expected hashes", () => {
    const hashes = expectedHashesForNote("33Z53");
    expect(hashes.floatValue()).toBeCloseTo(1 / probabilityPerHash("33Z53"), 6);
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

  it("converts hashrate back to note label", () => {
    const note = noteFromHashrate(2.480651469003486e9, 5);
    expect(note.label).toBe("33Z53");
  });

  it("derives notes using parsed hashrate values", () => {
    const parsed = parseHashrate("2.480651469 GH/s");
    const note = noteFromHashrate(parsed, 5);
    expect(note.label).toBe("33Z53");
  });

  it("parses human readable hashrates", () => {
    expect(parseHashrate("5 GH/s")).toBeCloseTo(5e9, 3);
    expect(parseHashrate("12.5 MH/s")).toBeCloseTo(12.5e6, 3);
    expect(parseHashrate({ value: 3.5, unit: HashrateUnit.PHps })).toBeCloseTo(
      3.5e15,
      3
    );
  });

  it("rejects unrecognised hashrate units", () => {
    expect(() => parseHashrate("12 foo/s")).toThrowError(SharenoteError);
  });

  it("computes maximum bits for a given hashrate", () => {
    const zBits = maxZBitsForHashrate(2.480651469003486e9, 5);
    expect(zBits).toBeCloseTo(ensureNote({ z: 33, cents: 53 }).zBits, 6);
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

  it("rejects direct string hashrate inputs in noteFromHashrate", () => {
    expect(() => noteFromHashrate("1 GH/s" as unknown as number, 5)).toThrow();
  });
});

describe("target computation", () => {
  it("returns a deterministic bigint target", () => {
    const target = targetFor("33Z00");
    expect(typeof target).toBe("bigint");
    // For 33Z00 the exponent is 23 leading zeros => target close to 2^(223)
    const approxBits = Math.log(Number(target)) / LOG_2;
    expect(approxBits).toBeGreaterThan(222);
    expect(approxBits).toBeLessThan(224);
  });

  it("formats labels correctly", () => {
    expect(formatNoteLabel(57, 12)).toBe("57Z12");
  });
});

describe("utility helpers", () => {
  it("humanises hashrates", () => {
    const human = humanHashrate(3.2e9);
    expect(human.unit).toBe("GH/s");
    expect(human.display).toContain("3.20");
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

  it("shows human-readable hashrate for sharenotes", () => {
    const estimate = estimateSharenote("33Z53", 5);
    const display = estimate.requiredHashrateHuman.display;
    expect(display.endsWith(" GH/s")).toBe(true);
    expect(Number.parseFloat(display)).toBeCloseTo(2.48, 2);
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

  it("computes note differences", () => {
    const diff = noteDifference("33Z53", "20Z10");
    expect(diff.label).toBe("33Z52");
    const noteA = ensureNote({ z: 33, cents: 53 });
    const noteB = ensureNote({ z: 20, cents: 10 });
    const expected = Math.log2(2 ** noteA.zBits - 2 ** noteB.zBits);
    expect(diff.zBits).toBeCloseTo(expected, 12);
  });

  it("scales note zBits", () => {
    const scaled = scaleNote("20Z10", 1.5);
    expect(scaled.label).toBe("20Z68");
    const base = ensureNote({ z: 20, cents: 10 });
    const expected = Math.log2(2 ** base.zBits * 1.5);
    expect(scaled.zBits).toBeCloseTo(expected, 12);
  });

  it("divides note difficulties", () => {
    const ratio = divideNote("33Z53", "20Z10");
    const noteA = ensureNote({ z: 33, cents: 53 });
    const noteB = ensureNote({ z: 20, cents: 10 });
    const expected = Math.pow(2, noteA.zBits) / Math.pow(2, noteB.zBits);
    expect(ratio).toBeCloseTo(expected, 6);
  });
});
