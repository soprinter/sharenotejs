import { describe, expect, it } from "vitest";

import {
  CENT_BIT_STEP,
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
  maxBitsForHashrate,
  nbitsToSharenote,
  noteFromBits,
  noteFromComponents,
  noteFromHashrate,
  parseHashrate,
  parseNoteLabel,
  planSharenoteFromHashrate,
  probabilityPerHash,
  requiredHashrateMean,
  requiredHashrateQuantile,
  targetFor,
  humanHashrate,
} from "./index";

const LOG_2 = Math.log(2);

describe("note conversions", () => {
  it("normalises cents and bits", () => {
    const note = noteFromComponents(33, 53);
    expect(note.z).toBe(33);
    expect(note.cents).toBe(53);
    expect(note.bits).toBeCloseTo(33 + 53 * CENT_BIT_STEP, 12);
    expect(note.label).toBe("33Z53");
  });

  it("parses multiple label forms", () => {
    expect(parseNoteLabel("33Z53")).toEqual({ z: 33, cents: 53 });
    expect(parseNoteLabel("33Z 53CZ")).toEqual({ z: 33, cents: 53 });
    expect(parseNoteLabel("33Z53cz")).toEqual({ z: 33, cents: 53 });
    expect(parseNoteLabel("33.53Z")).toEqual({ z: 33, cents: 53 });
    expect(parseNoteLabel("33z")).toEqual({ z: 33, cents: 0 });
  });

  it("round-trips bits to note and back", () => {
    const bits = 33 + 53 * CENT_BIT_STEP;
    expect(noteFromBits(bits).label).toBe("33Z53");
  });

  it("converts compact nBits to Sharenote label", () => {
    const note = nbitsToSharenote("19752b59");
    expect(note.bits).toBeCloseTo(57.12, 6);
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
    const bits = noteFromComponents(33, 53).bits;
    expect(p).toBeCloseTo(2 ** -bits, 18);
  });

  it("formats probability displays", () => {
    const note = noteFromComponents(33, 53);
    expect(formatProbabilityDisplay(note.bits, 5)).toBe("1 / 2^33.53000");
  });

  it("computes expected hashes", () => {
    const hashes = expectedHashesForNote("33Z53");
    expect(hashes).toBeCloseTo(1 / probabilityPerHash("33Z53"), 6);
  });

  it("derives mean and quantile hashrate requirements", () => {
    const note = noteFromComponents(33, 53);
    const expectedMean = 2 ** note.bits / 5;
    const mean = requiredHashrateMean("33Z53", 5);
    expect(mean).toBeCloseTo(expectedMean, 6);

    const expectedQ95 = expectedMean * -Math.log(1 - 0.95);
    const q95 = requiredHashrateQuantile("33Z53", 5, 0.95);
    expect(q95).toBeCloseTo(expectedQ95, 6);
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
    const bits = maxBitsForHashrate(2.480651469003486e9, 5);
    expect(bits).toBeCloseTo(noteFromComponents(33, 53).bits, 6);
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
      (2 ** estimate.bits / 5) * -Math.log(1 - 0.95);
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
    expect(combined.bits).toBeCloseTo(33.53, 6);
  });

  it("computes note differences", () => {
    const diff = noteDifference("33Z53", "20Z10");
    expect(diff.label).toBe("33Z52");
    expect(diff.bits).toBeCloseTo(33.52, 6);
  });

  it("scales note bits", () => {
    const scaled = scaleNote("20Z10", 1.5);
    expect(scaled.label).toBe("20Z68");
    expect(scaled.bits).toBeCloseTo(20.68, 6);
  });

  it("divides note difficulties", () => {
    const ratio = divideNote("33Z53", "20Z10");
    expect(ratio).toBeCloseTo(11036.537462, 6);
  });
});
