/**
 * The NIP-SN validation union against the shared negative/control fixture.
 *
 * Replays `validation_tests.json` — forged events every `validate()` MUST
 * reject, plus genuinely-valid control events it MUST accept — through
 * {@link validateEvent}. The fixture is shared byte-for-byte with the Go and
 * Python SDKs; this test prefers the canonical copy in the Go repo and guards
 * that the bundled copy is byte-identical.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SharenoteError, validateEvent, type Tags } from "../src/index";

const dir = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED = path.resolve(dir, "../validation_tests.json");
const CANONICAL_CANDIDATES = [
  path.resolve(dir, "../../go-sharenote/testdata/validation_tests.json"),
];
const CANONICAL = CANONICAL_CANDIDATES.find((p) => fs.existsSync(p));
const VECTORS_PATH = CANONICAL ?? BUNDLED;

interface Case {
  name: string;
  assertion: string;
  kind: number;
  expect: "reject" | "accept";
  check: string;
  reason: string;
  event: { kind: number; content: string; tags: Tags };
  primary_chain_id?: string;
}
const FIXTURE = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8")) as { cases: Case[] };

describe("validation union (validation_tests.json)", () => {
  it("bundled validation_tests.json is byte-identical to the canonical source", () => {
    if (!CANONICAL) return;
    expect(fs.readFileSync(BUNDLED, "utf8")).toBe(fs.readFileSync(CANONICAL, "utf8"));
  });

  for (const c of FIXTURE.cases) {
    it(`${c.expect}: ${c.name} [${c.assertion} / ${c.check}]`, () => {
      const run = () => validateEvent(c.event, { primaryChainId: c.primary_chain_id });
      if (c.expect === "reject") {
        expect(run).toThrow(SharenoteError);
      } else {
        expect(run).not.toThrow();
      }
    });
  }
});
