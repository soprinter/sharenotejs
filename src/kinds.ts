/**
 * NIP-SN Nostr event kinds and the shared tag representation.
 */

/**
 * The Nostr event kinds defined by NIP-SN.
 *
 * Kinds `10520`–`10521` are **replaceable** (NIP-01 range 10000–19999): a relay
 * keeps only the latest event per `(kind, pubkey)`. Kinds `35500`–`35515` are
 * **addressable** (range 30000–39999): a relay keeps the latest per
 * `(kind, pubkey, d)`.
 *
 * @example
 * ```ts
 * import { SharenoteKind } from "@soprinter/sharenotejs";
 *
 * event.kind === SharenoteKind.RawSharenote; // 35510
 * ```
 */
export const SharenoteKind = {
  /** Chain addresses a miner controls (replaceable). */
  MinerIdentity: 10520,
  /** A pool's profile, chains, fees, and payout schemes (replaceable). */
  PoolIdentity: 10521,
  /** A secured block's total reward, miners not yet paid. */
  UnpaidInvoice: 35500,
  /** The invoice's payout transaction, confirmed. */
  SettledInvoice: 35501,
  /** Live per-farm and per-worker hashrate and share metrics. */
  HashrateTelemetry: 35502,
  /** An unconfirmed per-worker payout slice. */
  PendingShare: 35503,
  /** A consolidated unpaid slice per address. */
  FinalizedShare: 35504,
  /** A confirmed payout with on-chain transaction data. */
  SharePayment: 35505,
  /** A raw block header and its merged-mining branches. */
  RawSharenote: 35510,
  /** Encrypted operator↔miner messages (optional). */
  OperatorMessage: 35515,
} as const;

/** A NIP-SN event kind — one of the values of {@link SharenoteKind}. */
export type SharenoteKind = (typeof SharenoteKind)[keyof typeof SharenoteKind];

/**
 * A Nostr event's `tags`: an array of string arrays, where `tag[0]` is the tag
 * name and the remaining entries are its values (NIP-01).
 */
export type Tags = readonly (readonly string[])[];
