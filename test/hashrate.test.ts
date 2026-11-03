import { describe, expect, it } from "vitest";

import {
  SharenoteError,
  Sharenote,
  ReliabilityId,
  PrimaryMode,
  HashrateUnit,
  parseHashrate,
  formatHashrate,
  formatHashCount,
  formatProbability,
  probabilityPerHash,
  expectedHashes,
  requiredHashrate,
  requiredHashrateMean,
  requiredHashrateQuantile,
  hashrateRange,
  maxZBits,
  sharenoteFromHashrate,
  estimate,
  estimateMany,
  planFromHashrate,
  reliabilityLevels,
} from "../src/index";

describe("parseHashrate", () => {
  it("parses human strings, descriptors, and raw numbers", () => {
    expect(parseHashrate("5 GH/s")).toBeCloseTo(5e9, 3);
    expect(parseHashrate("12.5 MH/s")).toBeCloseTo(12.5e6, 3);
    expect(parseHashrate({ value: 3.5, unit: HashrateUnit.PHps })).toBeCloseTo(3.5e15, 3);
    expect(parseHashrate({ value: 5, unit: HashrateUnit.GHps })).toBe(5e9);
    expect(parseHashrate(5e9)).toBe(5e9);
  });

  it("rejects bad input", () => {
    expect(() => parseHashrate("")).toThrow(SharenoteError);
    expect(() => parseHashrate("12 foo/s")).toThrow(SharenoteError);
    expect(() => parseHashrate(-1)).toThrow(SharenoteError);
    expect(() => parseHashrate(Number.NaN)).toThrow(SharenoteError);
    expect(() => parseHashrate({ value: -1 })).toThrow(SharenoteError);
    expect(() => parseHashrate(true as never)).toThrow(SharenoteError);
  });
});

describe("formatting", () => {
  it("formats hashrates", () => {
    expect(formatHashrate(3.2e9).unit).toBe("GH/s");
    expect(formatHashrate(3.2e9).display).toContain("3.20");
    expect(formatHashrate(500e9).display).toBe("500 GH/s");
    expect(formatHashrate(50e9).display).toBe("50.0 GH/s");
    expect(formatHashrate(0.25, { precision: 2 }).display).toBe("0.25 H/s");
    expect(formatHashrate(3.2e9, { precision: 4 }).display).toBe("3.2000 GH/s");
    expect(formatHashrate(0).display).toBe("0 H/s");
    expect(formatHashrate(-5).display).toBe("0 H/s");
  });

  it("formats hash counts and probabilities", () => {
    expect(formatHashCount(2.48e9)).toContain("GH/s");
    expect(formatHashCount(0)).toBe("0 H/s");
    expect(formatProbability(33.53, 5)).toBe("1 / 2^33.53000");
  });
});

describe("probability and required hashrate", () => {
  it("computes probability and expected hashes", () => {
    expect(probabilityPerHash("33Z53")).toBeCloseTo(2 ** -Sharenote.fromLabel("33Z53").zBits, 18);
    const hashes = expectedHashes("33Z53");
    const inverse = 1 / probabilityPerHash("33Z53");
    expect(Math.abs(hashes - inverse) / inverse).toBeLessThan(1e-9);
  });

  it("derives mean and quantile hashrate requirements", () => {
    const zBits = Sharenote.fromLabel("33Z53").zBits;
    const expectedMean = 2 ** zBits / 5;
    expect(requiredHashrateMean("33Z53", 5)).toBeCloseTo(expectedMean, 6);

    const expectedQ95 = expectedMean * -Math.log(1 - 0.95);
    expect(requiredHashrateQuantile("33Z53", 5, 0.95)).toBeCloseTo(expectedQ95, 6);
    expect(requiredHashrate("33Z53", 5, { multiplier: 2 })).toBeCloseTo(expectedMean * 2, 6);
    expect(requiredHashrate("33Z53", 5, { reliability: ReliabilityId.Often95 })).toBeGreaterThan(0);
    expect(requiredHashrate("33Z53", 5, { reliability: 0.95 })).toBeGreaterThan(0);
  });

  it("rejects bad arguments", () => {
    expect(() => requiredHashrate("33Z53", 0)).toThrow(SharenoteError);
    expect(() => requiredHashrate("33Z53", -1)).toThrow(SharenoteError);
    expect(() => requiredHashrate("33Z53", 5, { multiplier: 0 })).toThrow(SharenoteError);
    expect(() => requiredHashrate("33Z53", 5, { multiplier: -1 })).toThrow(SharenoteError);
    expect(() => requiredHashrateQuantile("33Z53", 5, 0)).toThrow(SharenoteError);
    expect(() => requiredHashrateQuantile("33Z53", 5, 1)).toThrow(SharenoteError);
  });

  it("widens the hashrate range with higher reliability", () => {
    const base = hashrateRange("33Z53", 5);
    expect(base.min).toBeLessThan(base.max);
    const often = hashrateRange("33Z53", 5, { reliability: ReliabilityId.Often95 });
    expect(often.min).toBeGreaterThan(base.min);
    expect(often.max).toBeGreaterThan(base.max);
  });

  it("the range for a derived note contains its source hashrate", () => {
    const input = parseHashrate("1000 MH/s");
    const note = sharenoteFromHashrate(input, 5);
    const range = hashrateRange(note, 5);
    expect(range.min).toBeLessThanOrEqual(input);
    expect(range.max).toBeGreaterThan(input);
    expect(sharenoteFromHashrate(range.min, 5).label).toBe(note.label);
  });
});

describe("hashrate <-> note", () => {
  it("recovers a note from hashrate (number, string, descriptor)", () => {
    expect(sharenoteFromHashrate(2.480651469003486e9, 5).label).toBe("33Z53");
    expect(sharenoteFromHashrate("2.480651469 GH/s", 5).label).toBe("33Z53");
    expect(sharenoteFromHashrate({ value: 2.480651469003486, unit: HashrateUnit.GHps }, 5).label).toBe("33Z53");
    expect(sharenoteFromHashrate(5e9, 5, { reliability: ReliabilityId.Often95 }).z).toBeGreaterThan(0);
    expect(sharenoteFromHashrate(5e9, 5, { reliability: 0.95 }).z).toBeGreaterThan(0);
  });

  it("computes the maximum zBits for a hashrate", () => {
    expect(maxZBits(2.480651469003486e9, 5)).toBeCloseTo(Sharenote.fromLabel("33Z53").zBits, 6);
    expect(() => maxZBits(0, 5)).toThrow(SharenoteError);
    expect(() => maxZBits(1e9, 0)).toThrow(SharenoteError);
    expect(() => maxZBits(1e9, 5, 0)).toThrow(SharenoteError);
    expect(() => maxZBits(Number.NaN, 5)).toThrow(SharenoteError);
  });
});

describe("estimate and plan", () => {
  it("builds a bill estimate", () => {
    const bill = estimate("33Z53", 5, { reliability: 0.95 });
    expect(bill.label).toBe("33Z53");
    expect(bill.requiredHashratePrimary).toBeCloseTo((2 ** bill.zBits / 5) * -Math.log(1 - 0.95), 6);
    expect(bill.requiredHashrateHuman.unit).toBe("GH/s");
    expect(bill.probabilityDisplay.startsWith("1 / 2^")).toBe(true);
    expect(bill.quantile).toBeCloseTo(0.95, 6);
    expect(bill.primaryMode).toBe(PrimaryMode.Quantile);
  });

  it("honours estimate options", () => {
    expect(estimate("33Z53", 5, { multiplier: 2 }).multiplier).toBe(2);
    expect(estimate("33Z53", 5, { reliability: ReliabilityId.VeryLikely99 }).quantile).toBeCloseTo(0.99, 6);
    expect(estimate("33Z53", 5, { primaryMode: PrimaryMode.Mean }).primaryMode).toBe(PrimaryMode.Mean);
    expect(estimate("33Z53", 5, { probabilityPrecision: 3 }).probabilityDisplay).toMatch(/^1 \/ 2\^\d+\.\d{3}$/);
    expect(() => estimate("33Z53", 0)).toThrow(SharenoteError);
    expect(() => estimate("33Z53", 5, { reliability: 0 })).toThrow(SharenoteError);
  });

  it("estimates many notes", () => {
    const bills = estimateMany(["33Z53", "20Z10"], 5);
    expect(bills.map((b) => b.label)).toEqual(["33Z53", "20Z10"]);
  });

  it("plans a note from a rig's hashrate", () => {
    const plan = planFromHashrate({
      hashrate: { value: 5, unit: HashrateUnit.GHps },
      seconds: 5,
      reliability: ReliabilityId.Often95,
    });
    expect(plan.sharenote.label).toBe(sharenoteFromHashrate(5e9, 5, { reliability: ReliabilityId.Often95 }).label);
    expect(plan.inputHashrateHuman.unit).toBe("GH/s");
    const relDiff = Math.abs(plan.estimate.requiredHashratePrimary - plan.inputHashrate) / plan.inputHashrate;
    expect(relDiff).toBeLessThan(0.02);
    expect(() => planFromHashrate({ hashrate: 0, seconds: 5 })).toThrow(SharenoteError);
    expect(() => planFromHashrate({ hashrate: 5e9, seconds: 0 })).toThrow(SharenoteError);
  });

  it("exposes all reliability levels", () => {
    expect(reliabilityLevels()).toHaveLength(5);
  });
});
