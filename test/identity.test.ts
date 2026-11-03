import { describe, expect, it } from "vitest";

import {
  SharenoteError,
  SharenoteKind,
  buildMinerIdentityTags,
  parseMinerIdentityTags,
  buildPoolIdentityTags,
  parsePoolIdentityTags,
  buildPoolIdentityContent,
  parsePoolIdentityContent,
  createMinerIdentity,
  createChainAddress,
  createPoolIdentity,
  createPoolChain,
  createPayoutScheme,
  createPoolProfile,
} from "../src/index";

describe("identity kinds", () => {
  it("are replaceable 1052x kinds", () => {
    expect(SharenoteKind.MinerIdentity).toBe(10520);
    expect(SharenoteKind.PoolIdentity).toBe(10521);
  });
});

describe("miner identity (kind 10520)", () => {
  it("builds `a` tags and an optional payout hint", () => {
    const tags = buildMinerIdentityTags(
      createMinerIdentity({
        chains: [createChainAddress({ chainId: "15", address: "fc1q" }), createChainAddress({ chainId: "01", address: "bc1q" })],
        preferredPayout: "pplns",
      })
    );
    expect(tags).toEqual([["a", "15", "fc1q"], ["a", "01", "bc1q"], ["payout", "pplns"]]);

    const noPayout = buildMinerIdentityTags(createMinerIdentity({ chains: [createChainAddress({ chainId: "15", address: "fc1q" })] }));
    expect(noPayout.find((t) => t[0] === "payout")).toBeUndefined();
  });

  it("validates when building", () => {
    expect(() => buildMinerIdentityTags(createMinerIdentity())).toThrow("at least one chain");
    expect(() => buildMinerIdentityTags(createMinerIdentity({ chains: [createChainAddress({ address: "fc1q" })] }))).toThrow("chainId is required");
    expect(() => buildMinerIdentityTags(createMinerIdentity({ chains: [createChainAddress({ chainId: "15" })] }))).toThrow("address is required");
    expect(() =>
      buildMinerIdentityTags(createMinerIdentity({ chains: [createChainAddress({ chainId: "15", address: "a1" }), createChainAddress({ chainId: "15", address: "a2" })] }))
    ).toThrow("duplicate chain ID");
  });

  it("parses and requires a valid `a` tag", () => {
    const m = parseMinerIdentityTags([["d", ""], ["a", "15", "fc1q"], ["a", "01", "bc1q"], ["payout", "pps"]]);
    expect(m.chains).toHaveLength(2);
    expect(m.preferredPayout).toBe("pps");
    expect(() => parseMinerIdentityTags([["d", ""]])).toThrow("required tag 'a'");
    expect(() => parseMinerIdentityTags([["a", "15"]])).toThrow("required tag 'a'");
  });

  it("round-trips", () => {
    const parsed = parseMinerIdentityTags(
      buildMinerIdentityTags(createMinerIdentity({ chains: [createChainAddress({ chainId: "15", address: "fc1q" })], preferredPayout: "pplns" }))
    );
    expect(parsed.chains[0].chainId).toBe("15");
    expect(parsed.preferredPayout).toBe("pplns");
  });
});

describe("pool identity (kind 10521)", () => {
  it("builds chains, schemes, floor, and thresholds", () => {
    const tags = buildPoolIdentityTags(
      createPoolIdentity({
        chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 150 }), createPoolChain({ chainId: "01", address: "bc1q", feeBps: 0 })],
        payouts: [createPayoutScheme({ scheme: "pps", params: ["fee:300"] }), createPayoutScheme({ scheme: "pplns", params: ["fee:150", "n:5000"] })],
        minSharenote: "30z00",
        thresholds: [{ chainId: "15", amount: 100000n }],
      })
    );
    expect(tags).toEqual(
      expect.arrayContaining([
        ["a", "15", "fc1q", "150"], ["a", "01", "bc1q", "0"],
        ["payout", "pps", "fee:300"], ["payout", "pplns", "fee:150", "n:5000"],
        ["sharenote", "30z00"], ["threshold", "15", "100000"],
      ])
    );
  });

  it("validates when building", () => {
    expect(() => buildPoolIdentityTags(createPoolIdentity({ payouts: [createPayoutScheme({ scheme: "pps" })] }))).toThrow("at least one chain");
    expect(() => buildPoolIdentityTags(createPoolIdentity({ chains: [createPoolChain({ chainId: "15", address: "fc1q" })] }))).toThrow("at least one payout");
    expect(() =>
      buildPoolIdentityTags(createPoolIdentity({ chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: -1 })], payouts: [createPayoutScheme({ scheme: "pps" })] }))
    ).toThrow("fee must be non-negative");
    expect(() =>
      buildPoolIdentityTags(createPoolIdentity({ chains: [createPoolChain({ chainId: "15", address: "fc1q" })], payouts: [createPayoutScheme()] }))
    ).toThrow("payout scheme is required");
  });

  it("parses, defaulting an invalid fee to zero", () => {
    const p = parsePoolIdentityTags([["d", ""], ["a", "15", "fc1q", "nan"], ["payout", "pplns", "n:5000"], ["sharenote", "30z00"], ["threshold", "15", "100000"]]);
    expect(p.chains[0].feeBps).toBe(0);
    expect(p.payouts[0].params).toEqual(["n:5000"]);
    expect(p.minSharenote).toBe("30z00");
    expect(p.thresholds[0].amount).toBe(100000n);
    expect(() => parsePoolIdentityTags([["a", "15", "fc1q"], ["payout", "pps"]])).toThrow("required tag 'a'");
  });

  it("builds and parses profile content", () => {
    const identity = createPoolIdentity({
      profile: createPoolProfile({ name: "TestPool", about: "A test pool" }),
      chains: [createPoolChain({ chainId: "15", address: "fc1q", feeBps: 200 })],
      payouts: [createPayoutScheme({ scheme: "pps" })],
    });
    const content = buildPoolIdentityContent(identity);
    expect(JSON.parse(content)).toMatchObject({ name: "TestPool", about: "A test pool" });

    expect(buildPoolIdentityContent(createPoolIdentity())).toBe("");

    const target = createPoolIdentity();
    parsePoolIdentityContent('{"name":"TestPool","about":"desc"}', target);
    expect(target.profile.name).toBe("TestPool");
    expect(target.profile.picture).toBe("");
  });

  it("round-trips a full pool identity", () => {
    const identity = createPoolIdentity({
      profile: createPoolProfile({ name: "AlphaPool", website: "https://alpha.io" }),
      chains: [createPoolChain({ chainId: "15", address: "fc1qpool", feeBps: 200 }), createPoolChain({ chainId: "01", address: "bc1q", feeBps: 150 })],
      payouts: [createPayoutScheme({ scheme: "pplns", params: ["n:10000"] })],
      minSharenote: "30z00",
      thresholds: [{ chainId: "15", amount: 100000n }, { chainId: "01", amount: 50000n }],
    });
    const parsed = parsePoolIdentityTags(buildPoolIdentityTags(identity));
    parsePoolIdentityContent(buildPoolIdentityContent(identity), parsed);
    expect(parsed.chains).toHaveLength(2);
    expect(parsed.payouts[0].params).toEqual(["n:10000"]);
    expect(parsed.thresholds).toHaveLength(2);
    expect(parsed.profile.name).toBe("AlphaPool");
  });
});

// `SharenoteError` is the single error type surfaced across identity helpers.
it("throws SharenoteError on invalid identity input", () => {
  expect(() => buildMinerIdentityTags(createMinerIdentity())).toThrow(SharenoteError);
  expect(() => buildPoolIdentityTags(createPoolIdentity())).toThrow(SharenoteError);
});
