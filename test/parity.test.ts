/**
 * Cross-SDK parity against the canonical shared conformance vectors.
 *
 * The vectors in `go-sharenote/snip00/snip00_tests.json` are the shared
 * contract for every Sharenote SDK. We prefer the canonical sibling copy and
 * fall back to the bundled one so the package test still runs standalone; a
 * guard asserts the bundled copy is byte-identical to the canonical source.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Sharenote, combine } from "../src/index";

const dir = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED = path.resolve(dir, "../snip00_tests.json");
// The canonical copy lives in the sibling Go SDK repo; tolerate both its
// current and historical locations so the parity guard actually runs.
const CANONICAL_CANDIDATES = [
  path.resolve(dir, "../../go-sharenote/testdata/snip00_tests.json"),
  path.resolve(dir, "../../go-sharenote/snip00/snip00_tests.json"),
];
const CANONICAL = CANONICAL_CANDIDATES.find((p) => fs.existsSync(p));
const canonicalExists = CANONICAL !== undefined;
const VECTORS_PATH = canonicalExists ? CANONICAL! : BUNDLED;

interface Vector {
  name: string;
  operation: "add" | "subtract" | "scale" | "divide";
  inputs: any;
  expected: { label?: string; z_bits?: number; difficulty?: number; probability_per_hash?: number; ratio?: number };
}

const VECTORS = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8")) as { cases: Vector[] };

function expectClose(actual: number, expected: number, relTol = 1e-9, absTol = 0): void {
  const allowed = Math.max(absTol, Math.abs(expected) * relTol);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(allowed);
}

const byOp = (op: Vector["operation"]): Vector[] => VECTORS.cases.filter((c) => c.operation === op);

describe("conformance vectors", () => {
  it("bundled vectors are byte-identical to the canonical source", () => {
    if (!canonicalExists) return;
    expect(fs.readFileSync(BUNDLED, "utf8")).toBe(fs.readFileSync(CANONICAL!, "utf8"));
  });

  for (const vector of byOp("add")) {
    it(`add: ${vector.name}`, () => {
      const result = combine(vector.inputs.map((i: { label: string }) => i.label));
      expect(result.label).toBe(vector.expected.label);
      expect(result.zBits).toBeCloseTo(vector.expected.z_bits!, 6);
      expectClose(result.difficulty(), vector.expected.difficulty!, 1e-9, 1e-6);
      expectClose(result.probabilityPerHash(), vector.expected.probability_per_hash!, 1e-9, 1e-18);
    });
  }

  for (const vector of byOp("subtract")) {
    it(`subtract: ${vector.name}`, () => {
      const result = Sharenote.from(vector.inputs.minuend.label).subtract(vector.inputs.subtrahend.label);
      expect(result.label).toBe(vector.expected.label);
      expect(result.zBits).toBeCloseTo(vector.expected.z_bits!, 6);
    });
  }

  for (const vector of byOp("scale")) {
    it(`scale: ${vector.name}`, () => {
      const result = Sharenote.from(vector.inputs.note.label).scale(vector.inputs.factor);
      expect(result.label).toBe(vector.expected.label);
      expect(result.zBits).toBeCloseTo(vector.expected.z_bits!, 6);
    });
  }

  for (const vector of byOp("divide")) {
    it(`divide: ${vector.name}`, () => {
      const ratio = Sharenote.from(vector.inputs.numerator.label).divide(vector.inputs.denominator.label);
      expectClose(ratio, vector.expected.ratio!, 1e-9, 1e-12);
    });
  }
});
