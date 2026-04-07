import { describe, it, expect } from "vitest";
import {
  marshalTags, unmarshalTags,
  createHashrate, createWorker,
  KIND_HASHRATE,
} from "./snip02";

describe("snip02", () => {
  describe("constants", () => {
    it("KIND_HASHRATE = 35502", () => {
      expect(KIND_HASHRATE).toBe(35502);
    });
  });

  describe("marshalTags", () => {
    it("address only produces single tag", () => {
      const tags = marshalTags(createHashrate({ address: "fc1q" }));
      expect(tags).toEqual([["a", "fc1q"]]);
    });

    it("totalHashrate with msn", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q", totalHashrate: "5000", meanSharenote: "33z55",
      }));
      expect(tags).toContainEqual(["all", "5000", "msn:33z55"]);
    });

    it("totalHashrate without msn", () => {
      const tags = marshalTags(createHashrate({ address: "fc1q", totalHashrate: "5000" }));
      expect(tags).toContainEqual(["all", "5000"]);
    });

    it("h tag when no totalHashrate", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q", hashrate: "1000", meanSharenote: "30z00",
      }));
      expect(tags.find(t => t[0] === "h")).toBeTruthy();
      expect(tags.find(t => t[0] === "all")).toBeUndefined();
      expect(tags).toContainEqual(["h", "1000", "msn:30z00"]);
    });

    it("h tag without msn", () => {
      const tags = marshalTags(createHashrate({ address: "fc1q", hashrate: "1000" }));
      expect(tags).toContainEqual(["h", "1000"]);
    });

    it("totalHashrate takes priority over hashrate", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q", totalHashrate: "5000", hashrate: "1000",
      }));
      expect(tags.find(t => t[0] === "all")).toBeTruthy();
      expect(tags.find(t => t[0] === "h")).toBeUndefined();
    });

    it("throws on missing address", () => {
      expect(() => marshalTags(createHashrate())).toThrow("address is required");
    });

    it("worker with all fields", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q",
        workers: [createWorker({
          name: "rig01", hashrate: "2500", sharenote: "33z53",
          meanSharenote: "33z50", countSharenotes: 42,
          countRejectedSharenotes: 3, meanTimeSec: "4.2",
          lastAcceptedUnix: 1700000000, userAgent: "bmminer/2.0",
        })],
      }));
      const wTag = tags.find(t => t[0] === "w:rig01")!;
      expect(wTag).toBeTruthy();
      expect(wTag).toContain("h:2500");
      expect(wTag).toContain("sn:33z53");
      expect(wTag).toContain("msn:33z50");
      expect(wTag).toContain("csn:42");
      expect(wTag).toContain("crsn:3");
      expect(wTag).toContain("mt:4.2");
      expect(wTag).toContain("lsn:1700000000");
      expect(wTag).toContain("ua:bmminer/2.0");
    });

    it("worker with minimal fields", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q", workers: [createWorker({ name: "rig01" })],
      }));
      const wTag = tags.find(t => t[0] === "w:rig01")!;
      expect(wTag).toContain("csn:0");
      expect(wTag.some(f => f.startsWith("h:"))).toBe(false);
      expect(wTag.some(f => f.startsWith("crsn:"))).toBe(false);
    });

    it("blank worker name skipped", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q", workers: [createWorker({ name: "  " })],
      }));
      expect(tags.some(t => t[0].startsWith("w:"))).toBe(false);
    });

    it("multiple workers in order", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q",
        workers: [
          createWorker({ name: "rig01" }),
          createWorker({ name: "rig02" }),
          createWorker({ name: "rig03" }),
        ],
      }));
      const wTags = tags.filter(t => t[0].startsWith("w:"));
      expect(wTags).toHaveLength(3);
      expect(wTags[0][0]).toBe("w:rig01");
      expect(wTags[1][0]).toBe("w:rig02");
      expect(wTags[2][0]).toBe("w:rig03");
    });

    it("crsn omitted when zero", () => {
      const tags = marshalTags(createHashrate({
        address: "fc1q",
        workers: [createWorker({ name: "rig01", countRejectedSharenotes: 0 })],
      }));
      const wTag = tags.find(t => t[0] === "w:rig01")!;
      expect(wTag.some(f => f.startsWith("crsn:"))).toBe(false);
    });
  });

  describe("unmarshalTags", () => {
    it("throws on missing address", () => {
      expect(() => unmarshalTags([["h", "1000"]])).toThrow("missing address tag");
    });

    it("throws on empty tags", () => {
      expect(() => unmarshalTags([])).toThrow("missing address tag");
    });

    it("skips empty tag arrays", () => {
      const hr = unmarshalTags([[], ["a", "fc1q"]]);
      expect(hr.address).toBe("fc1q");
    });

    it("all tag extracts msn", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["all", "5000", "msn:33z55"]]);
      expect(hr.totalHashrate).toBe("5000");
      expect(hr.meanSharenote).toBe("33z55");
    });

    it("all tag without msn", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["all", "5000"]]);
      expect(hr.totalHashrate).toBe("5000");
      expect(hr.meanSharenote).toBe("");
    });

    it("h tag provides msn when all absent", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["h", "1000", "msn:30z00"]]);
      expect(hr.hashrate).toBe("1000");
      expect(hr.meanSharenote).toBe("30z00");
    });

    it("all msn takes priority over h msn", () => {
      const hr = unmarshalTags([
        ["a", "fc1q"], ["all", "5000", "msn:33z55"], ["h", "1000", "msn:30z00"],
      ]);
      expect(hr.meanSharenote).toBe("33z55");
    });

    it("w: prefix only is skipped", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["w:", "h:100"]]);
      expect(hr.workers).toHaveLength(0);
    });

    it("unknown worker fields ignored", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["w:rig01", "unknown:val", "h:100"]]);
      expect(hr.workers).toHaveLength(1);
      expect(hr.workers[0].hashrate).toBe("100");
    });

    it("worker field without colon ignored", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["w:rig01", "nocolon", "h:100"]]);
      expect(hr.workers[0].hashrate).toBe("100");
    });

    it("worker field with empty value ignored", () => {
      const hr = unmarshalTags([["a", "fc1q"], ["w:rig01", "h:", "sn:33z53"]]);
      expect(hr.workers[0].hashrate).toBe("");
      expect(hr.workers[0].sharenote).toBe("33z53");
    });
  });

  describe("round-trip", () => {
    it("full round-trip", () => {
      const hr = createHashrate({
        address: "fc1qtest",
        totalHashrate: "5000",
        meanSharenote: "33z55",
        workers: [
          createWorker({
            name: "rig01", hashrate: "2500", sharenote: "33z53",
            meanSharenote: "33z50", countSharenotes: 42,
            countRejectedSharenotes: 3, meanTimeSec: "4.2",
            lastAcceptedUnix: 1700000000, userAgent: "bmminer/2.0",
          }),
          createWorker({ name: "rig02", hashrate: "2500", countSharenotes: 38 }),
        ],
      });
      const parsed = unmarshalTags(marshalTags(hr));

      expect(parsed.address).toBe("fc1qtest");
      expect(parsed.totalHashrate).toBe("5000");
      expect(parsed.meanSharenote).toBe("33z55");
      expect(parsed.workers).toHaveLength(2);
      expect(parsed.workers[0].name).toBe("rig01");
      expect(parsed.workers[0].countSharenotes).toBe(42);
      expect(parsed.workers[0].countRejectedSharenotes).toBe(3);
      expect(parsed.workers[0].userAgent).toBe("bmminer/2.0");
    });

    it("address only round-trip", () => {
      const parsed = unmarshalTags(marshalTags(createHashrate({ address: "fc1q" })));
      expect(parsed.address).toBe("fc1q");
      expect(parsed.workers).toHaveLength(0);
      expect(parsed.totalHashrate).toBe("");
    });

    it("no workers round-trip", () => {
      const parsed = unmarshalTags(marshalTags(
        createHashrate({ address: "fc1q", totalHashrate: "1000" }),
      ));
      expect(parsed.totalHashrate).toBe("1000");
      expect(parsed.workers).toHaveLength(0);
    });
  });
});
