import { describe, expect, it } from "vitest";

import {
  SharenoteError,
  SharenoteKind,
  buildTelemetryTags,
  parseTelemetryTags,
  createTelemetry,
  createTelemetryWorker,
} from "../src/index";

describe("telemetry (kind 35502)", () => {
  it("is kind 35502", () => {
    expect(SharenoteKind.HashrateTelemetry).toBe(35502);
  });

  describe("buildTelemetryTags", () => {
    it("emits an address-only tag", () => {
      expect(buildTelemetryTags(createTelemetry({ address: "fc1q" }))).toEqual([["a", "fc1q"]]);
    });

    it("emits an aggregate `all` tag with inline msn, taking priority over `h`", () => {
      const tags = buildTelemetryTags(
        createTelemetry({ address: "fc1q", totalHashrate: "5000", hashrate: "1000", meanSharenote: "33z55" })
      );
      expect(tags).toContainEqual(["all", "5000", "msn:33z55"]);
      expect(tags.find((t) => t[0] === "h")).toBeUndefined();
    });

    it("falls back to an `h` tag with inline msn", () => {
      const tags = buildTelemetryTags(createTelemetry({ address: "fc1q", hashrate: "1000", meanSharenote: "30z00" }));
      expect(tags).toContainEqual(["h", "1000", "msn:30z00"]);
      expect(tags.find((t) => t[0] === "all")).toBeUndefined();
    });

    it("encodes a full worker, omitting crsn when zero", () => {
      const full = buildTelemetryTags(
        createTelemetry({
          address: "fc1q",
          workers: [
            createTelemetryWorker({
              name: "rig01", hashrate: "2500", sharenote: "33z53", meanSharenote: "33z50",
              countSharenotes: 42, countRejectedSharenotes: 3, meanTimeSec: "4.2",
              lastAcceptedUnix: 1700000000, userAgent: "bmminer/2.0",
            }),
          ],
        })
      );
      const tag = full.find((t) => t[0] === "w:rig01")!;
      expect(tag).toEqual(expect.arrayContaining(["h:2500", "sn:33z53", "msn:33z50", "csn:42", "crsn:3", "mt:4.2", "lsn:1700000000", "ua:bmminer/2.0"]));

      const minimal = buildTelemetryTags(createTelemetry({ address: "fc1q", workers: [createTelemetryWorker({ name: "rig01" })] }));
      const minTag = minimal.find((t) => t[0] === "w:rig01")!;
      expect(minTag).toContain("csn:0");
      expect(minTag.some((f) => f.startsWith("crsn:"))).toBe(false);
    });

    it("preserves worker order and skips blank names", () => {
      const tags = buildTelemetryTags(
        createTelemetry({
          address: "fc1q",
          workers: [createTelemetryWorker({ name: "rig01" }), createTelemetryWorker({ name: "  " }), createTelemetryWorker({ name: "rig02" })],
        })
      );
      expect(tags.filter((t) => t[0].startsWith("w:")).map((t) => t[0])).toEqual(["w:rig01", "w:rig02"]);
    });

    it("throws when address is missing", () => {
      expect(() => buildTelemetryTags(createTelemetry())).toThrow(SharenoteError);
    });
  });

  describe("parseTelemetryTags", () => {
    it("requires an address", () => {
      expect(() => parseTelemetryTags([["h", "1000"]])).toThrow(SharenoteError);
      expect(() => parseTelemetryTags([])).toThrow(SharenoteError);
    });

    it("extracts the aggregate msn, preferring `all` over `h`", () => {
      const hr = parseTelemetryTags([["a", "fc1q"], ["all", "5000", "msn:33z55"], ["h", "1000", "msn:30z00"]]);
      expect(hr.totalHashrate).toBe("5000");
      expect(hr.meanSharenote).toBe("33z55");
    });

    it("ignores malformed worker fields", () => {
      const hr = parseTelemetryTags([["a", "fc1q"], ["w:", "h:100"], ["w:rig01", "unknown:v", "nocolon", "h:", "sn:33z53"]]);
      expect(hr.workers).toHaveLength(1);
      expect(hr.workers[0].hashrate).toBe("");
      expect(hr.workers[0].sharenote).toBe("33z53");
    });
  });

  it("round-trips a full snapshot", () => {
    const telemetry = createTelemetry({
      address: "fc1qtest", totalHashrate: "5000", meanSharenote: "33z55",
      workers: [
        createTelemetryWorker({ name: "rig01", hashrate: "2500", countSharenotes: 42, countRejectedSharenotes: 3, userAgent: "bmminer/2.0" }),
        createTelemetryWorker({ name: "rig02", hashrate: "2500", countSharenotes: 38 }),
      ],
    });
    const parsed = parseTelemetryTags(buildTelemetryTags(telemetry));
    expect(parsed.address).toBe("fc1qtest");
    expect(parsed.meanSharenote).toBe("33z55");
    expect(parsed.workers).toHaveLength(2);
    expect(parsed.workers[0].countRejectedSharenotes).toBe(3);
    expect(parsed.workers[0].userAgent).toBe("bmminer/2.0");
  });
});
