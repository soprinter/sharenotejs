/**
 * SNIP-05: Sharenote Identity Event Helpers (Kinds 35520-35521).
 *
 * Provides types and marshal/unmarshal functions for miner identity
 * events (Kind 35520) and pool identity events (Kind 35521).
 */

export const KIND_MINER_IDENTITY = 10520;
export const KIND_POOL_IDENTITY = 10521;

export type Tags = string[][];

// --- Miner Identity (Kind 35520) ---

export interface ChainAddress {
  chainId: string;
  address: string;
}

export interface MinerIdentity {
  chains: ChainAddress[];
  preferredPayout: string;
}

export function createChainAddress(partial?: Partial<ChainAddress>): ChainAddress {
  return { chainId: "", address: "", ...partial };
}

export function createMinerIdentity(partial?: Partial<MinerIdentity>): MinerIdentity {
  return { chains: [], preferredPayout: "", ...partial };
}

export function marshalMinerTags(m: MinerIdentity): Tags {
  if (!m.chains.length) {
    throw new Error("at least one chain address is required");
  }

  const seen = new Set<string>();
  const tags: Tags = [];

  for (const c of m.chains) {
    if (!c.chainId) throw new Error("chainId is required");
    if (!c.address) throw new Error(`address is required for chain ${c.chainId}`);
    if (seen.has(c.chainId)) throw new Error(`duplicate chain ID: ${c.chainId}`);
    seen.add(c.chainId);
    tags.push(["a", c.chainId, c.address]);
  }

  if (m.preferredPayout) {
    tags.push(["payout", m.preferredPayout]);
  }

  return tags;
}

export function unmarshalMinerTags(tags: Tags): MinerIdentity {
  const m = createMinerIdentity();
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!tag.length || tag.length < 2) continue;
    if (tag[0] === "a" && tag.length >= 3) {
      if (!seen.has(tag[1])) {
        seen.add(tag[1]);
        m.chains.push({ chainId: tag[1], address: tag[2] });
      }
    } else if (tag[0] === "payout") {
      m.preferredPayout = tag[1];
    }
  }
  if (!m.chains.length) {
    throw new Error("required tag 'a' with chainId and address not found");
  }
  return m;
}

// --- Pool Identity (Kind 35521) ---

export interface PoolChain {
  chainId: string;
  address: string;
  feeBps: number; // fee in basis points (200 = 2.00%)
}

export interface PayoutScheme {
  scheme: string; // "pps", "fpps", "pplns", "prop", "solo"
  params: string[]; // key:value pairs
}

export interface PayoutThreshold {
  chainId: string;
  amount: number; // minimum payout in satoshis
}

export interface PoolProfile {
  name: string;
  about: string;
  picture: string;
  website: string;
}

export interface PoolIdentity {
  profile: PoolProfile;
  chains: PoolChain[];
  payouts: PayoutScheme[];
  minSharenote: string;
  thresholds: PayoutThreshold[];
}

export function createPoolChain(partial?: Partial<PoolChain>): PoolChain {
  return { chainId: "", address: "", feeBps: 0, ...partial };
}

export function createPayoutScheme(partial?: Partial<PayoutScheme>): PayoutScheme {
  return { scheme: "", params: [], ...partial };
}

export function createPoolProfile(partial?: Partial<PoolProfile>): PoolProfile {
  return { name: "", about: "", picture: "", website: "", ...partial };
}

export function createPoolIdentity(partial?: Partial<PoolIdentity>): PoolIdentity {
  return {
    profile: createPoolProfile(),
    chains: [],
    payouts: [],
    minSharenote: "",
    thresholds: [],
    ...partial,
  };
}

export function marshalPoolTags(p: PoolIdentity): Tags {
  if (!p.chains.length) throw new Error("at least one chain is required");
  if (!p.payouts.length) throw new Error("at least one payout scheme is required");

  const seen = new Set<string>();
  const tags: Tags = [];

  for (const c of p.chains) {
    if (!c.chainId) throw new Error("chainId is required");
    if (!c.address) throw new Error(`address is required for chain ${c.chainId}`);
    if (c.feeBps < 0) throw new Error(`fee must be non-negative for chain ${c.chainId}`);
    if (seen.has(c.chainId)) throw new Error(`duplicate chain ID: ${c.chainId}`);
    seen.add(c.chainId);
    tags.push(["a", c.chainId, c.address, String(c.feeBps)]);
  }

  for (const ps of p.payouts) {
    if (!ps.scheme) throw new Error("payout scheme is required");
    tags.push(["payout", ps.scheme, ...ps.params]);
  }

  if (p.minSharenote) {
    tags.push(["sharenote", p.minSharenote]);
  }

  for (const th of p.thresholds) {
    tags.push(["threshold", th.chainId, String(th.amount)]);
  }

  return tags;
}

export function marshalPoolContent(p: PoolIdentity): string {
  const prof = p.profile;
  if (!prof.name && !prof.about && !prof.picture && !prof.website) return "";
  const d: Record<string, string> = {};
  if (prof.name) d.name = prof.name;
  if (prof.about) d.about = prof.about;
  if (prof.picture) d.picture = prof.picture;
  if (prof.website) d.website = prof.website;
  return JSON.stringify(d);
}

export function unmarshalPoolTags(tags: Tags): PoolIdentity {
  const p = createPoolIdentity();
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!tag.length || tag.length < 2) continue;
    const k = tag[0];
    if (k === "a" && tag.length >= 4) {
      if (!seen.has(tag[1])) {
        seen.add(tag[1]);
        const fee = parseInt(tag[3], 10);
        p.chains.push({
          chainId: tag[1], address: tag[2],
          feeBps: isNaN(fee) ? 0 : fee,
        });
      }
    } else if (k === "payout") {
      const ps: PayoutScheme = { scheme: tag[1], params: tag.length > 2 ? tag.slice(2) : [] };
      p.payouts.push(ps);
    } else if (k === "sharenote") {
      p.minSharenote = tag[1];
    } else if (k === "threshold" && tag.length >= 3) {
      const amt = parseInt(tag[2], 10);
      p.thresholds.push({ chainId: tag[1], amount: isNaN(amt) ? 0 : amt });
    }
  }
  if (!p.chains.length) {
    throw new Error("required tag 'a' with chain and address not found");
  }
  return p;
}

export function unmarshalPoolContent(content: string, p: PoolIdentity): void {
  if (!content) return;
  const d = JSON.parse(content);
  p.profile.name = d.name || "";
  p.profile.about = d.about || "";
  p.profile.picture = d.picture || "";
  p.profile.website = d.website || "";
}

// --- Backwards-compatible aliases ---

export type Identity = ChainAddress;

export function createIdentity(partial?: Partial<ChainAddress>): ChainAddress {
  return createChainAddress(partial);
}

export function marshalTags(ident: ChainAddress): Tags {
  return marshalMinerTags(createMinerIdentity({ chains: [ident] }));
}

export function unmarshalTags(tags: Tags): ChainAddress {
  const m = unmarshalMinerTags(tags);
  return m.chains[0];
}
