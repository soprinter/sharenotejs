/**
 * `@soprinter/sharenotejs` — the reference TypeScript SDK for the Sharenote
 * protocol (NIP-SN: Proof-of-Work Bearer Notes).
 *
 * The public API is organised around three domains:
 *
 * 1. **Z-Arithmetic** — the exact difficulty core: the {@link Sharenote} value
 *    type, exact `bigint` aggregation ({@link combine}), targets, `nBits`, and
 *    the hashrate / probability / planning helpers.
 * 2. **Events** — typed builders and parsers for the NIP-SN Nostr event kinds:
 *    telemetry, pool accounting (invoices and shares), and raw minting / AuxPoW.
 * 3. **Identity** — miner and pool identity events.
 *
 * Everything is a named export; there is no default export, and the package is
 * side-effect-free for tree-shaking.
 *
 * @packageDocumentation
 */

// Errors
export { SharenoteError } from "./errors.js";

// Z-Arithmetic: difficulty core
export {
  Sharenote,
  type SharenoteInput,
  Work,
  combine,
  compareSharenotes,
  formatLabel,
  zBitsFromTarget,
  zBitsToDifficulty,
  difficultyToZBits,
  CENTIBIT_STEP,
  MIN_CENTIBITS,
  MAX_CENTIBITS,
} from "./difficulty.js";

// Hex predicates (chain IDs, block hashes)
export { isHex, is32ByteHex } from "./hex.js";

// Z-Arithmetic: exact (dyadic-rational) difficulty toolkit
export {
  type ExactDifficulty,
  decomposeFloatToExact,
  normalizeExact,
  sumExactDifficulties,
  multiplyExact,
  subtractExact,
  zBitsFromExactDifficulty,
  exactDifficultyToNumber,
  exactRatioToNumber,
} from "./exact.js";

// Z-Arithmetic: hashrate, probability, and planning
export {
  ReliabilityId,
  PrimaryMode,
  HashrateUnit,
  type ReliabilityLevel,
  type HashrateDescriptor,
  type HashrateInput,
  type HumanHashrate,
  type FormatHashrateOptions,
  type HashrateOptions,
  type EstimateOptions,
  type PlanOptions,
  type HashrateRange,
  type Estimate,
  type Plan,
  RELIABILITY_LEVELS,
  reliabilityLevels,
  parseHashrate,
  formatHashrate,
  formatHashCount,
  formatProbability,
  probabilityPerHash,
  expectedHashes,
  requiredHashrate,
  requiredHashrateMean,
  requiredHashrateQuantile,
  hashrateRange,
  maxZBits,
  sharenoteFromHashrate,
  estimate,
  estimateMany,
  planFromHashrate,
} from "./hashrate.js";

// Event kinds and the shared tag representation
export { SharenoteKind, type Tags } from "./kinds.js";

// Events: settlement (the shared `x` tag)
export {
  type Settlement,
  pendingSettlement,
  confirmedSettlement,
  buildSettlementTag,
  parseSettlementTag,
} from "./events/settlement.js";

// Events: pool accounting (invoices and shares)
export {
  type Invoice,
  type Share,
  createInvoice,
  createShare,
  computeHeightHash,
  computePendingShareId,
  computeFinalizedShareId,
  buildInvoiceTags,
  parseInvoiceTags,
  buildShareTags,
  parseShareTags,
  validateInvoice,
  validateShare,
} from "./events/accounting.js";

// Events: hashrate telemetry
export {
  type Telemetry,
  type TelemetryWorker,
  createTelemetry,
  createTelemetryWorker,
  buildTelemetryTags,
  parseTelemetryTags,
  validateTelemetryEvent,
} from "./events/telemetry.js";

// Events: raw Sharenote minting / AuxPoW
export {
  type RawSharenote,
  type AuxBlock,
  type ValidateRawSharenoteOptions,
  createRawSharenote,
  createAuxBlock,
  buildRawSharenoteTags,
  parseRawSharenoteTags,
  validateHeaderHash,
  validateRawSharenoteEvent,
  validateLabel,
} from "./events/mint.js";

// Identity: miner and pool
export {
  type ChainAddress,
  type MinerIdentity,
  type PoolChain,
  type PayoutScheme,
  type PayoutThreshold,
  type PoolProfile,
  type PoolIdentity,
  createChainAddress,
  createMinerIdentity,
  createPoolChain,
  createPayoutScheme,
  createPoolProfile,
  createPoolIdentity,
  buildMinerIdentityTags,
  parseMinerIdentityTags,
  buildPoolIdentityTags,
  parsePoolIdentityTags,
  buildPoolIdentityContent,
  parsePoolIdentityContent,
  validateMinerIdentityEvent,
  validatePoolIdentityEvent,
} from "./identity.js";

// Validation: the NIP-SN MUST-set applied to a whole event
export {
  type NostrEventLike,
  type ValidateEventOptions,
  validateEvent,
} from "./validate.js";
