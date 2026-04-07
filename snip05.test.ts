import { describe, it, expect } from "vitest";
import {
  KIND_MINER_IDENTITY, KIND_POOL_IDENTITY,
  marshalMinerTags, unmarshalMinerTags,
  marshalPoolTags, unmarshalPoolTags,
  marshalPoolContent, unmarshalPoolContent,
  marshalTags, unmarshalTags,
  createMinerIdentity, createChainAddress,
  createPoolIdentity, createPoolChain, createPayoutScheme, createPoolProfile,
  createIdentity,
} from "./snip05";

describe("snip05", () => {
  describe("constants", () => {
    it("KIND_MINER_IDENTITY = 35520", () => {
      expect(KIND_MINER_IDENTITY).toBe(10520);
    });

    it("KIND_POOL_IDENTITY = 35521", () => {
      expect(KIND_POOL_IDENTITY).toBe(10521);
    });
  });

  // ===================== Miner Identity =====================

  describe("miner marshal", () => {
    it("single chain", () => {
      const tags = marshalMinerTags(createMinerIdentity({
        chains: [createChainAddress({ chainId: "15", address: "fc1qtest" })],
      }));
      expect(tags[0]).toEqual(["a", "15", "fc1qtest"]);
      expect(tags).toContainEqual(["a", "15", "fc1qtest"]);
    });

    it("multi chain", () => {
      const tags = marshalMinerTags(createMinerIdentity({
        chains: [
          createChainAddress({ chainId: "15", address: "fc1q" }),
          createChainAddress({ chainId: "01", address: "bc1q" }),
        ],
      }));
      expect(tags).toContainEqual(["a", "15", "fc1q"]);
      expect(tags).toContainEqual(["a", "01", "bc1q"]);
    });

    it("with preferred payout", () => {
      const tags = marshalMinerTags(createMinerIdentity({
        chains: [createChainAddress({ chainId: "15", address: "fc1q" })],
        preferredPayout: "pplns",
      }));
      expect(tags).toContainEqual(["payout", "pplns"]);
    });

    it("no payout tag when empty", () => {
      const tags = marshalMinerTags(createMinerIdentity({
        chains: [createChainAddress({ chainId: "15", address: "fc1q" })],
      }));
      expect(tags.find(t => t[0] === "payout")).toBeUndefined();
    });

    it("throws on no chains", () => {
      expect(() => marshalMinerTags(createMinerIdentity())).toThrow("at least one chain");
    });

    it("throws on missing chainId", () => {
      expect(() => marshalMinerTags(createMinerIdentity({
        chains: [createChainAddress({ address: "fc1q" })],
      }))).toThrow("chainId is required");
    });

    it("throws on missing address", () => {
      expect(() => marshalMinerTags(createMinerIdentity({
        chains: [createChainAddress({ chainId: "15" })],
      }))).toThrow("address is required");
    });

    it("throws on duplicate chain id", () => {
      expect(() => marshalMinerTags(createMinerIdentity({
        chains: [
          createChainAddress({ chainId: "15", address: "a1" }),
          createChainAddress({ chainId: "15", address: "a2" }),
        ],
      }))).toThrow("duplicate chain ID");
    });
  });

  describe("miner unmarshal", () => {
    it("single chain", () => {
      const m = unmarshalMinerTags([["d", ""], ["a", "15", "fc1qtest"]]);
      expect(m.chains).toHaveLength(1);
      expect(m.chains[0].chainId).toBe("15");
      expect(m.chains[0].address).toBe("fc1qtest");
    });

    it("multi chain", () => {
      const m = unmarshalMinerTags([["d", ""], ["a", "15", "fc1q"], ["a", "01", "bc1q"]]);
      expect(m.chains).toHaveLength(2);
    });

    it("with payout", () => {
      const m = unmarshalMinerTags([["d", ""], ["a", "15", "fc1q"], ["payout", "pps"]]);
      expect(m.preferredPayout).toBe("pps");
    });

    it("throws on no a tag", () => {
      expect(() => unmarshalMinerTags([["d", ""]])).toThrow("required tag 'a'");
    });

    it("short a tag skipped", () => {
      expect(() => unmarshalMinerTags([["a", "15"]])).toThrow("required tag 'a'");
    });
  });

  describe("miner round-trip", () => {
    it("multi chain with payout", () => {
      const m = createMinerIdentity({
        chains: [
          createChainAddress({ chainId: "15", address: "fc1q" }),
          createChainAddress({ chainId: "01", address: "bc1q" }),
        ],
        preferredPayout: "pplns",
      });
      const parsed = unmarshalMinerTags(marshalMinerTags(m));
      expect(parsed.chains).toHaveLength(2);
      expect(parsed.preferredPayout).toBe("pplns");
    });
  });

  // ===================== Pool Identity =====================

  describe("pool marshal", () => {
    it("simple pps pool", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 200 })],
        payouts: [createPayoutScheme({ scheme: "pps" })],
      }));
      expect(tags[0]).toEqual(["a", "15", "fc1q", "200"]);
      expect(tags).toContainEqual(["a", "15", "fc1q", "200"]);
      expect(tags).toContainEqual(["payout", "pps"]);
    });

    it("multi chain different fees", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [
          createPoolChain({ chainId: "15", address: "fc1q", feeBps: 150 }),
          createPoolChain({ chainId: "01", address: "bc1q", feeBps: 200 }),
        ],
        payouts: [createPayoutScheme({ scheme: "pplns", params: ["n:10000"] })],
      }));
      expect(tags).toContainEqual(["a", "15", "fc1q", "150"]);
      expect(tags).toContainEqual(["a", "01", "bc1q", "200"]);
    });

    it("pplns with params", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 100 })],
        payouts: [createPayoutScheme({ scheme: "pplns", params: ["n:5000"] })],
      }));
      expect(tags).toContainEqual(["payout", "pplns", "n:5000"]);
    });

    it("multi scheme", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 150 })],
        payouts: [
          createPayoutScheme({ scheme: "pps", params: ["fee:300"] }),
          createPayoutScheme({ scheme: "pplns", params: ["fee:150", "n:5000"] }),
        ],
      }));
      expect(tags).toContainEqual(["payout", "pps", "fee:300"]);
      expect(tags).toContainEqual(["payout", "pplns", "fee:150", "n:5000"]);
    });

    it("with sharenote floor", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 200 })],
        payouts: [createPayoutScheme({ scheme: "pps" })],
        minSharenote: "30z00",
      }));
      expect(tags).toContainEqual(["sharenote", "30z00"]);
    });

    it("with thresholds", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [
          createPoolChain({ chainId: "15", address: "fc1q", feeBps: 200 }),
          createPoolChain({ chainId: "01", address: "bc1q", feeBps: 150 }),
        ],
        payouts: [createPayoutScheme({ scheme: "pps" })],
        thresholds: [
          { chainId: "15", amount: 100000 },
          { chainId: "01", amount: 50000 },
        ],
      }));
      expect(tags).toContainEqual(["threshold", "15", "100000"]);
      expect(tags).toContainEqual(["threshold", "01", "50000"]);
    });

    it("zero fee", () => {
      const tags = marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 0 })],
        payouts: [createPayoutScheme({ scheme: "prop" })],
      }));
      expect(tags).toContainEqual(["a", "15", "fc1q", "0"]);
    });

    it("throws on no chains", () => {
      expect(() => marshalPoolTags(createPoolIdentity({
        payouts: [createPayoutScheme({ scheme: "pps" })],
      }))).toThrow("at least one chain");
    });

    it("throws on no payouts", () => {
      expect(() => marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q" })],
      }))).toThrow("at least one payout");
    });

    it("throws on negative fee", () => {
      expect(() => marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: -1 })],
        payouts: [createPayoutScheme({ scheme: "pps" })],
      }))).toThrow("fee must be non-negative");
    });

    it("throws on duplicate chain", () => {
      expect(() => marshalPoolTags(createPoolIdentity({
        chains: [
          createPoolChain({ chainId: "15", address: "a1", feeBps: 100 }),
          createPoolChain({ chainId: "15", address: "a2", feeBps: 200 }),
        ],
        payouts: [createPayoutScheme({ scheme: "pps" })],
      }))).toThrow("duplicate chain ID");
    });

    it("throws on empty scheme", () => {
      expect(() => marshalPoolTags(createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q" })],
        payouts: [createPayoutScheme()],
      }))).toThrow("payout scheme is required");
    });
  });

  describe("pool unmarshal", () => {
    it("simple", () => {
      const p = unmarshalPoolTags([["d", ""], ["a", "15", "fc1q", "200"], ["payout", "pps"]]);
      expect(p.chains).toHaveLength(1);
      expect(p.chains[0].feeBps).toBe(200);
      expect(p.payouts[0].scheme).toBe("pps");
    });

    it("payout params", () => {
      const p = unmarshalPoolTags([["d", ""], ["a", "15", "fc1q", "100"], ["payout", "pplns", "n:5000"]]);
      expect(p.payouts[0].params).toEqual(["n:5000"]);
    });

    it("sharenote parsed", () => {
      const p = unmarshalPoolTags([
        ["d", ""], ["a", "15", "fc1q", "0"], ["payout", "pps"], ["sharenote", "30z00"],
      ]);
      expect(p.minSharenote).toBe("30z00");
    });

    it("thresholds parsed", () => {
      const p = unmarshalPoolTags([
        ["d", ""], ["a", "15", "fc1q", "200"], ["payout", "pps"],
        ["threshold", "15", "100000"],
      ]);
      expect(p.thresholds).toHaveLength(1);
      expect(p.thresholds[0].amount).toBe(100000);
    });

    it("throws on no a tag", () => {
      expect(() => unmarshalPoolTags([["d", ""], ["payout", "pps"]])).toThrow("required tag 'a'");
    });

    it("3-element a tag skipped (needs 4 for pool)", () => {
      expect(() => unmarshalPoolTags([["a", "15", "fc1q"], ["payout", "pps"]]))
        .toThrow("required tag 'a'");
    });

    it("invalid fee defaults to zero", () => {
      const p = unmarshalPoolTags([["d", ""], ["a", "15", "fc1q", "nan"], ["payout", "pps"]]);
      expect(p.chains[0].feeBps).toBe(0);
    });
  });

  describe("pool content", () => {
    it("marshal full profile", () => {
      const p = createPoolIdentity({
        profile: createPoolProfile({
          name: "TestPool", about: "A test pool",
          picture: "https://pic.png", website: "https://pool.io",
        }),
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 200 })],
        payouts: [createPayoutScheme({ scheme: "pps" })],
      });
      const content = marshalPoolContent(p);
      const d = JSON.parse(content);
      expect(d.name).toBe("TestPool");
      expect(d.about).toBe("A test pool");
    });

    it("marshal empty profile returns empty string", () => {
      const p = createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q" })],
        payouts: [createPayoutScheme({ scheme: "pps" })],
      });
      expect(marshalPoolContent(p)).toBe("");
    });

    it("marshal partial profile omits empty fields", () => {
      const p = createPoolIdentity({
        profile: createPoolProfile({ name: "Pool" }),
      });
      const content = marshalPoolContent(p);
      const d = JSON.parse(content);
      expect(d.name).toBe("Pool");
      expect(d.about).toBeUndefined();
    });

    it("unmarshal content", () => {
      const p = createPoolIdentity();
      unmarshalPoolContent('{"name":"TestPool","about":"desc"}', p);
      expect(p.profile.name).toBe("TestPool");
      expect(p.profile.about).toBe("desc");
      expect(p.profile.picture).toBe("");
    });

    it("unmarshal empty content", () => {
      const p = createPoolIdentity();
      unmarshalPoolContent("", p);
      expect(p.profile.name).toBe("");
    });
  });

  describe("pool round-trip", () => {
    it("pps pool with profile", () => {
      const p = createPoolIdentity({
        profile: createPoolProfile({ name: "AlphaPool", website: "https://alpha.io" }),
        chains: [createPoolChain({ chainId: "15", address: "fc1qpool", feeBps: 200 })],
        payouts: [createPayoutScheme({ scheme: "pps" })],
        minSharenote: "30z00",
      });
      const tags = marshalPoolTags(p);
      const content = marshalPoolContent(p);
      const parsed = unmarshalPoolTags(tags);
      unmarshalPoolContent(content, parsed);

      expect(parsed.chains[0].feeBps).toBe(200);
      expect(parsed.payouts[0].scheme).toBe("pps");
      expect(parsed.minSharenote).toBe("30z00");
      expect(parsed.profile.name).toBe("AlphaPool");
    });

    it("multi chain pplns with thresholds", () => {
      const p = createPoolIdentity({
        chains: [
          createPoolChain({ chainId: "15", address: "fc1q", feeBps: 150 }),
          createPoolChain({ chainId: "01", address: "bc1q", feeBps: 200 }),
        ],
        payouts: [createPayoutScheme({ scheme: "pplns", params: ["n:10000"] })],
        thresholds: [
          { chainId: "15", amount: 100000 },
          { chainId: "01", amount: 50000 },
        ],
      });
      const parsed = unmarshalPoolTags(marshalPoolTags(p));
      expect(parsed.chains).toHaveLength(2);
      expect(parsed.payouts[0].params).toEqual(["n:10000"]);
      expect(parsed.thresholds).toHaveLength(2);
    });

    it("multi scheme", () => {
      const p = createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 150 })],
        payouts: [
          createPayoutScheme({ scheme: "pps", params: ["fee:300"] }),
          createPayoutScheme({ scheme: "pplns", params: ["fee:150", "n:5000"] }),
        ],
      });
      const parsed = unmarshalPoolTags(marshalPoolTags(p));
      expect(parsed.payouts).toHaveLength(2);
      expect(parsed.payouts[1].params).toEqual(["fee:150", "n:5000"]);
    });

    it("solo pool", () => {
      const p = createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 100 })],
        payouts: [createPayoutScheme({ scheme: "solo" })],
        minSharenote: "34z00",
      });
      const parsed = unmarshalPoolTags(marshalPoolTags(p));
      expect(parsed.payouts[0].scheme).toBe("solo");
      expect(parsed.payouts[0].params).toEqual([]);
    });
  });

  // ===================== Backwards Compatibility =====================

  describe("backwards compat", () => {
    it("marshalTags produces a tag", () => {
      const tags = marshalTags(createIdentity({ chainId: "15", address: "fc1q" }));
      expect(tags).toContainEqual(["a", "15", "fc1q"]);
    });

    it("unmarshalTags returns first chain", () => {
      const id = unmarshalTags([["d", ""], ["a", "15", "fc1qtest"]]);
      expect(id.chainId).toBe("15");
      expect(id.address).toBe("fc1qtest");
    });
  });
});
