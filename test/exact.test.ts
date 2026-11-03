/**
 * Exact-arithmetic edge vectors (decisions D1–D4) from the shared contract.
 *
 * Replays `sdk_edge_tests.json` — the sibling of `snip00_tests.json`, shared
 * byte-for-byte with the Go and Python SDKs — covering note comparison by label
 * (D1), near-integer carry clamping (D2), `combine` fold-composition exactness
 * (D3), and exact integer round-trips (D4). Prefers the canonical copy in the
 * Go repo and guards that the bundled copy is byte-identical.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  Sharenote,
  Work,
  combine,
  compareSharenotes,
  exactDifficultyToNumber,
  parseInvoiceTags,
  parseShareTags,
  parsePoolIdentityTags,
  type ExactDifficulty,
} from "../src/index";

const dir = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED = path.resolve(dir, "../sdk_edge_tests.json");
const CANONICAL_CANDIDATES = [
  path.resolve(dir, "../../go-sharenote/testdata/sdk_edge_tests.json"),
];
const CANONICAL = CANONICAL_CANDIDATES.find((p) => fs.existsSync(p));
const VECTORS_PATH = CANONICAL ?? BUNDLED;

interface Operand {
  label?: string;
  z_bits?: number;
}
interface Case {
  name: string;
  decision: "D1" | "D2" | "D3" | "D4";
  operation: "compare" | "label_from_zbits" | "combine" | "integer_roundtrip";
  inputs: any;
  expected: any;
  context?: { kind: number; tag: string };
}
const FIXTURE = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8")) as { cases: Case[] };

function noteFromOperand(op: Operand): Sharenote {
  if (op.label !== undefined) return Sharenote.fromLabel(op.label);
  if (op.z_bits !== undefined) return Sharenote.fromZBits(op.z_bits);
  throw new Error(`unrecognised operand: ${JSON.stringify(op)}`);
}

/** The exact difficulty as a decimal string (the D3 vectors use `exp >= 0`). */
function exactToDecimal(e: ExactDifficulty): string {
  if (e.exp >= 0) return (e.sig << BigInt(e.exp)).toString();
  throw new Error(`fractional exact difficulty: sig=${e.sig} exp=${e.exp}`);
}

const byDecision = (d: Case["decision"]): Case[] => FIXTURE.cases.filter((c) => c.decision === d);

describe("sdk edge vectors", () => {
  it("bundled sdk_edge_tests.json is byte-identical to the canonical source", () => {
    if (!CANONICAL) return;
    expect(fs.readFileSync(BUNDLED, "utf8")).toBe(fs.readFileSync(CANONICAL, "utf8"));
  });

  describe("D1 — compare by label components", () => {
    for (const c of byDecision("D1")) {
      it(c.name, () => {
        const a = noteFromOperand(c.inputs.a);
        const b = noteFromOperand(c.inputs.b);
        expect(compareSharenotes(a, b)).toBe(c.expected.cmp);
        // equals() is the same label-component key.
        expect(a.equals(b)).toBe(c.expected.cmp === 0);
        // Order is antisymmetric (`|| 0` avoids a `-0` from negating `0`).
        expect(compareSharenotes(b, a)).toBe(-c.expected.cmp || 0);
      });
    }
  });

  describe("D2 — near-integer carry clamps to 99", () => {
    for (const c of byDecision("D2")) {
      it(c.name, () => {
        const note = Sharenote.fromZBits(c.inputs.z_bits);
        expect(note.label).toBe(c.expected.label);
        expect(note.z).toBe(c.expected.z);
        expect(note.centiBits).toBe(c.expected.cents);
      });
    }
  });

  describe("D3 — combine fold composition is exact", () => {
    for (const c of byDecision("D3")) {
      it(c.name, () => {
        const steps = c.inputs.steps as { combine: string[] }[];
        const results: Sharenote[] = [];
        for (const step of steps) {
          const operands = step.combine.map((token) =>
            token.startsWith("$") ? results[Number(token.slice(1))] : Sharenote.fromLabel(token)
          );
          results.push(combine(operands));
        }
        const final = results[c.inputs.result_step];

        expect(final.label).toBe(c.expected.label);
        expect(exactToDecimal(final.exactDifficulty)).toBe(c.expected.exact_difficulty_decimal);
        expect(final.exactDifficulty.sig.toString()).toBe(c.expected.exact_dyadic.sig);
        expect(final.exactDifficulty.exp).toBe(c.expected.exact_dyadic.exp);
        // The display difficulty is the exact value projected to float64.
        expect(exactDifficultyToNumber(final.exactDifficulty)).toBe(c.expected.difficulty);
        expect(exactToDecimal(results[0].exactDifficulty)).toBe(c.expected.intermediate_step0_decimal);
      });
    }
  });

  describe("D4 — integer round-trips are exact (bigint)", () => {
    for (const c of byDecision("D4")) {
      it(c.name, () => {
        const wire = c.inputs.wire as string;
        const tag = c.context!.tag;
        let value: bigint;
        if (tag === "amount") {
          value =
            c.context!.kind >= 35503
              ? parseShareTags([["amount", wire]]).amount
              : parseInvoiceTags([["amount", wire]]).amount;
        } else if (tag === "threshold") {
          const pool = parsePoolIdentityTags([
            ["a", "15", "fc1qpool", "0"],
            ["payout", "pps"],
            ["threshold", "15", wire],
          ]);
          value = pool.thresholds[0].amount;
        } else {
          throw new Error(`unhandled D4 tag: ${tag}`);
        }
        expect(value).toBe(BigInt(c.expected.value));
        // The lossy float64 path would NOT round-trip — that is the point of D4.
        expect(BigInt(c.expected.value)).not.toBe(BigInt(c.expected.float64_would_give));
      });
    }
  });
});

describe("Work — streaming accumulator and proportional payout", () => {
  it("folds a combined note's exact difficulty forward (D3 shape)", () => {
    // combine([53Z00, 1Z00]) == 2^53 + 2, folded with 1Z00 == 2^53 + 4.
    const step0 = combine(["53Z00", "1Z00"]);
    const folded = new Work().add(step0).add("1Z00");
    expect(exactToDecimal(folded.exactDifficulty)).toBe("9007199254740996");
    expect(folded.note().label).toBe("53Z00");
  });

  it("sums unit notes exactly and recovers a denomination", () => {
    const work = new Work();
    for (let i = 0; i < 1024; i++) work.add("0Z00");
    expect(exactDifficultyToNumber(work.exactDifficulty)).toBe(1024);
    expect(work.note().label).toBe("10Z00");
  });

  it("is an empty accumulator by default", () => {
    const work = new Work();
    expect(work.isZero()).toBe(true);
    expect(work.note().label).toBe("0Z00");
  });

  it("slices a reward proportionally, floored to base units", () => {
    const a = new Work().add("34Z00");
    const b = new Work().add("34Z00");
    const total = new Work().addExact(a.exactDifficulty).addExact(b.exactDifficulty);
    expect(total.note().label).toBe("35Z00");
    // Equal work => equal halves.
    expect(a.payout(total, 1000n)).toBe(500n);
    expect(b.payout(total, 1000n)).toBe(500n);
    // Flooring: an odd amount never over-allocates (500 + 500 <= 1001).
    expect(a.payout(total, 1001n)).toBe(500n);
  });

  it("floors an uneven split so slices never exceed the total", () => {
    const a = new Work().add("34Z00"); // 2^34
    const b = new Work().add("35Z00"); // 2^35
    const total = new Work().addExact(a.exactDifficulty).addExact(b.exactDifficulty); // 3 * 2^34
    const amount = 100n;
    const pa = a.payout(total, amount); // floor(100/3) = 33
    const pb = b.payout(total, amount); // floor(200/3) = 66
    expect(pa).toBe(33n);
    expect(pb).toBe(66n);
    expect(pa + pb).toBeLessThanOrEqual(amount);
  });

  it("rejects a non-positive total and pays zero for empty work", () => {
    const empty = new Work();
    const some = new Work().add("20Z00");
    expect(() => some.payout(empty, 1000n)).toThrow(/total work must be positive/);
    expect(empty.payout(some, 1000n)).toBe(0n);
  });
});
