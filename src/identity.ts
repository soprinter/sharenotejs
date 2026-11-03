/**
 * Identity events: Miner Identity ({@link SharenoteKind.MinerIdentity}, kind 10520)
 * and Pool Identity ({@link SharenoteKind.PoolIdentity}, kind 10521).
 *
 * Both are replaceable: a relay keeps only the latest event per
 * `(kind, pubkey)`, so settlement systems MUST resolve the latest identity at
 * payout time (NIP-SN A4).
 */
import { SharenoteError } from "./errors.js";
import { isHex } from "./hex.js";
import { type Tags } from "./kinds.js";

/** A chain ID paired with a receiving address on that chain. */
export interface ChainAddress {
  /** Hex-encoded chain ID. */
  chainId: string;
  /** The receiving address on that chain. */
  address: string;
}

/** The chain addresses a miner controls, for payout discovery (kind 10520). */
export interface MinerIdentity {
  /** One or more chain addresses; chain IDs MUST NOT repeat. */
  chains: ChainAddress[];
  /** The miner's preferred payout scheme hint (e.g. `"pplns"`), or empty. */
  preferredPayout: string;
}

/** A pool's payout address and fee for one chain. */
export interface PoolChain {
  /** Hex-encoded chain ID. */
  chainId: string;
  /** The pool's payout address on that chain. */
  address: string;
  /** Pool fee in basis points (`200` = 2.00%, `0` = no fee). */
  feeBps: number;
}

/** A payout scheme a pool supports, with its trailing `key:value` parameters. */
export interface PayoutScheme {
  /** One of `pps`, `fpps`, `pplns`, `prop`, `solo`. */
  scheme: string;
  /** Trailing parameters such as `n:5000` or `fee:150`. */
  params: string[];
}

/**
 * A minimum payout threshold for one chain, in the coin's base unit (its
 * smallest unit; satoshi on Bitcoin as an example). `amount` is a `bigint` for
 * exact round-trip across the full int64 range (decision D4).
 */
export interface PayoutThreshold {
  chainId: string;
  amount: bigint;
}

/** A pool's kind-0-style profile metadata (all fields optional). */
export interface PoolProfile {
  name: string;
  about: string;
  picture: string;
  website: string;
}

/** A pool's profile, accepted chains, fees, payout schemes, and policy (kind 10521). */
export interface PoolIdentity {
  profile: PoolProfile;
  /** Accepted chains; chain IDs MUST NOT repeat. */
  chains: PoolChain[];
  /** Supported payout schemes; at least one is required. */
  payouts: PayoutScheme[];
  /** Minimum accepted denomination floor (e.g. `"30z00"`), or empty. */
  minSharenote: string;
  /** Minimum payout thresholds per chain. */
  thresholds: PayoutThreshold[];
}

/** Create a {@link ChainAddress}, filling defaults for omitted fields. */
export function createChainAddress(partial?: Partial<ChainAddress>): ChainAddress {
  return { chainId: "", address: "", ...partial };
}

/** Create a {@link MinerIdentity}, filling defaults for omitted fields. */
export function createMinerIdentity(partial?: Partial<MinerIdentity>): MinerIdentity {
  return { chains: [], preferredPayout: "", ...partial };
}

/** Create a {@link PoolChain}, filling defaults for omitted fields. */
export function createPoolChain(partial?: Partial<PoolChain>): PoolChain {
  return { chainId: "", address: "", feeBps: 0, ...partial };
}

/** Create a {@link PayoutScheme}, filling defaults for omitted fields. */
export function createPayoutScheme(partial?: Partial<PayoutScheme>): PayoutScheme {
  return { scheme: "", params: [], ...partial };
}

/** Create a {@link PoolProfile}, filling defaults for omitted fields. */
export function createPoolProfile(partial?: Partial<PoolProfile>): PoolProfile {
  return { name: "", about: "", picture: "", website: "", ...partial };
}

/** Create a {@link PoolIdentity}, filling defaults for omitted fields. */
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

/**
 * Encode a {@link MinerIdentity} as Nostr event tags.
 *
 * @throws a {@link SharenoteError} when there are no chains, a chain is missing
 * its ID or address, or a chain ID repeats.
 */
export function buildMinerIdentityTags(identity: MinerIdentity): Tags {
  if (!identity.chains.length) {
    throw new SharenoteError("at least one chain address is required");
  }
  const seen = new Set<string>();
  const tags: string[][] = [];

  for (const chain of identity.chains) {
    if (!chain.chainId) throw new SharenoteError("chainId is required");
    if (!chain.address) throw new SharenoteError(`address is required for chain ${chain.chainId}`);
    if (seen.has(chain.chainId)) throw new SharenoteError(`duplicate chain ID: ${chain.chainId}`);
    seen.add(chain.chainId);
    tags.push(["a", chain.chainId, chain.address]);
  }
  if (identity.preferredPayout) {
    tags.push(["payout", identity.preferredPayout]);
  }
  return tags;
}

/**
 * Decode Nostr event tags into a {@link MinerIdentity}.
 *
 * @throws a {@link SharenoteError} when no valid `a` tag is present.
 */
export function parseMinerIdentityTags(tags: Tags): MinerIdentity {
  const identity = createMinerIdentity();
  const seen = new Set<string>();

  for (const tag of tags) {
    if (tag.length < 2) continue;
    if (tag[0] === "a" && tag.length >= 3) {
      if (!seen.has(tag[1])) {
        seen.add(tag[1]);
        identity.chains.push({ chainId: tag[1], address: tag[2] });
      }
    } else if (tag[0] === "payout") {
      identity.preferredPayout = tag[1];
    }
  }
  if (!identity.chains.length) {
    throw new SharenoteError("required tag 'a' with chainId and address not found");
  }
  return identity;
}

/**
 * Encode a {@link PoolIdentity}'s tags.
 *
 * @throws a {@link SharenoteError} when there are no chains or payout schemes, a
 * fee is negative, a chain ID repeats, or a scheme name is empty.
 */
export function buildPoolIdentityTags(identity: PoolIdentity): Tags {
  if (!identity.chains.length) throw new SharenoteError("at least one chain is required");
  if (!identity.payouts.length) throw new SharenoteError("at least one payout scheme is required");

  const seen = new Set<string>();
  const tags: string[][] = [];

  for (const chain of identity.chains) {
    if (!chain.chainId) throw new SharenoteError("chainId is required");
    if (!chain.address) throw new SharenoteError(`address is required for chain ${chain.chainId}`);
    if (chain.feeBps < 0) throw new SharenoteError(`fee must be non-negative for chain ${chain.chainId}`);
    if (seen.has(chain.chainId)) throw new SharenoteError(`duplicate chain ID: ${chain.chainId}`);
    seen.add(chain.chainId);
    tags.push(["a", chain.chainId, chain.address, String(chain.feeBps)]);
  }
  for (const payout of identity.payouts) {
    if (!payout.scheme) throw new SharenoteError("payout scheme is required");
    tags.push(["payout", payout.scheme, ...payout.params]);
  }
  if (identity.minSharenote) {
    tags.push(["sharenote", identity.minSharenote]);
  }
  for (const threshold of identity.thresholds) {
    tags.push(["threshold", threshold.chainId, String(threshold.amount)]);
  }
  return tags;
}

/** Encode a {@link PoolIdentity}'s profile as the event `content` (JSON or empty). */
export function buildPoolIdentityContent(identity: PoolIdentity): string {
  const { name, about, picture, website } = identity.profile;
  if (!name && !about && !picture && !website) return "";
  const out: Record<string, string> = {};
  if (name) out.name = name;
  if (about) out.about = about;
  if (picture) out.picture = picture;
  if (website) out.website = website;
  return JSON.stringify(out);
}

/**
 * Decode Nostr event tags into a {@link PoolIdentity}.
 *
 * @throws a {@link SharenoteError} when no valid four-element `a` tag is present.
 */
export function parsePoolIdentityTags(tags: Tags): PoolIdentity {
  const identity = createPoolIdentity();
  const seen = new Set<string>();

  for (const tag of tags) {
    if (tag.length < 2) continue;
    const key = tag[0];
    if (key === "a" && tag.length >= 4) {
      if (!seen.has(tag[1])) {
        seen.add(tag[1]);
        const fee = Number.parseInt(tag[3], 10);
        identity.chains.push({
          chainId: tag[1],
          address: tag[2],
          feeBps: Number.isNaN(fee) ? 0 : fee,
        });
      }
    } else if (key === "payout") {
      identity.payouts.push({ scheme: tag[1], params: tag.length > 2 ? tag.slice(2) : [] });
    } else if (key === "sharenote") {
      identity.minSharenote = tag[1];
    } else if (key === "threshold" && tag.length >= 3) {
      let amount: bigint;
      try {
        amount = BigInt(tag[2].trim());
      } catch {
        amount = 0n;
      }
      identity.thresholds.push({ chainId: tag[1], amount });
    }
  }
  if (!identity.chains.length) {
    throw new SharenoteError("required tag 'a' with chain and address not found");
  }
  return identity;
}

/** Merge pool profile metadata parsed from the event `content` into `identity`. */
export function parsePoolIdentityContent(content: string, identity: PoolIdentity): void {
  if (!content) return;
  const parsed = JSON.parse(content) as Partial<PoolProfile>;
  identity.profile.name = parsed.name || "";
  identity.profile.about = parsed.about || "";
  identity.profile.picture = parsed.picture || "";
  identity.profile.website = parsed.website || "";
}

/**
 * Validate a Miner Identity (kind 10520) event's raw tags against NIP-SN A5 and
 * A16 — reading tags directly so duplicate / malformed chain IDs that a
 * deduplicating parser would hide are still caught. Requires at least one `a`
 * tag of exactly three elements `["a", chain_id, address]`, valid hex chain IDs
 * (A16) with no duplicates, non-empty addresses, and at most one `payout` tag.
 *
 * @throws a {@link SharenoteError} on the first violation.
 */
export function validateMinerIdentityEvent(tags: Tags): void {
  const seen = new Set<string>();
  let addressCount = 0;
  let payoutCount = 0;

  for (const tag of tags) {
    if (!tag.length) continue;
    if (tag[0] === "a") {
      addressCount += 1;
      if (tag.length !== 3) {
        throw new SharenoteError("miner identity a tag must have exactly three elements (A5)");
      }
      const chainId = tag[1];
      if (!isHex(chainId)) {
        throw new SharenoteError(`chain ID "${chainId}" is not valid hex (A16)`);
      }
      if (seen.has(chainId)) {
        throw new SharenoteError(`duplicate chain ID "${chainId}" (A5)`);
      }
      seen.add(chainId);
      if (!tag[2]) {
        throw new SharenoteError("miner identity address is empty (A5)");
      }
    } else if (tag[0] === "payout") {
      payoutCount += 1;
    }
  }

  if (addressCount === 0) {
    throw new SharenoteError("miner identity needs at least one a tag (A5)");
  }
  if (payoutCount > 1) {
    throw new SharenoteError("miner identity allows at most one payout tag (A5)");
  }
}

/**
 * Validate a Pool Identity (kind 10521) event against NIP-SN A6 and A16.
 * Requires at least one `a` tag of exactly four elements `["a", chain_id,
 * address, fee_bps]` with a non-negative integer fee, valid hex chain IDs (A16)
 * with no duplicates, at least one `payout` scheme, a `pplns` scheme carrying
 * `n:<window>`, and — when non-empty — `content` that is valid JSON.
 *
 * @throws a {@link SharenoteError} on the first violation.
 */
export function validatePoolIdentityEvent(content: string, tags: Tags): void {
  if (content) {
    try {
      JSON.parse(content);
    } catch {
      throw new SharenoteError("pool identity content must be valid JSON (A6)");
    }
  }

  const seen = new Set<string>();
  let addressCount = 0;
  let payoutCount = 0;

  for (const tag of tags) {
    if (!tag.length) continue;
    if (tag[0] === "a") {
      addressCount += 1;
      if (tag.length !== 4) {
        throw new SharenoteError("pool identity a tag must have exactly four elements (A6)");
      }
      const chainId = tag[1];
      if (!isHex(chainId)) {
        throw new SharenoteError(`chain ID "${chainId}" is not valid hex (A16)`);
      }
      if (seen.has(chainId)) {
        throw new SharenoteError(`duplicate chain ID "${chainId}" (A6)`);
      }
      seen.add(chainId);
      if (!tag[2]) {
        throw new SharenoteError("pool identity address is empty (A6)");
      }
      const fee = Number.parseInt(tag[3], 10);
      if (!Number.isInteger(fee) || fee < 0 || !/^\d+$/.test(tag[3])) {
        throw new SharenoteError(`pool fee "${tag[3]}" must be a non-negative integer (A6)`);
      }
    } else if (tag[0] === "payout") {
      payoutCount += 1;
      const scheme = tag[1] ?? "";
      if (!scheme) {
        throw new SharenoteError("pool identity payout tag needs a scheme (A6)");
      }
      if (scheme === "pplns" && !tag.slice(2).some((p) => p.startsWith("n:"))) {
        throw new SharenoteError("pplns payout scheme must carry an n:<window> parameter (A6)");
      }
    }
  }

  if (addressCount === 0) {
    throw new SharenoteError("pool identity needs at least one a tag (A6)");
  }
  if (payoutCount === 0) {
    throw new SharenoteError("pool identity needs at least one payout scheme (A6)");
  }
}
