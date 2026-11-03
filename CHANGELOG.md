# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Cross-SDK remediation for behavioural parity with the Go and Python SDKs against
the frozen shared contract (`sdk_edge_tests.json`, `validation_tests.json`).

### Added

- **`Work`** — an exact, `bigint`-backed streaming accumulator of proof-of-work
  with a proportional, floored `Payout`, mirroring Go's `Work`/`Work.Payout`
  (NIP-SN A1/A11). `Sharenote.fromExactDifficulty` rebuilds a note from an exact
  difficulty.
- **Validation union.** `validateEvent` applies the full NIP-SN MUST-set
  (A5–A16) to a whole `{ kind, content, tags }` event, backed by per-domain
  validators `validateRawSharenoteEvent` (full A14 — both header-hash clauses,
  shape, ordering), `validateTelemetryEvent` (A15), `validateMinerIdentityEvent`
  / `validatePoolIdentityEvent` (A5/A6/A16). `is32ByteHex` / `isHex` predicates.
- `test/exact.test.ts` and `test/validation.test.ts` load the two shared edge /
  validation fixtures (canonical copy preferred, byte-identity guarded).

### Changed

- **`combine` is exact under composition (D3).** Folding a note that is itself
  the result of a previous `combine` now reads its stored exact difficulty
  rather than re-decomposing `2**zBits`, so the exact sum is preserved (A1).
- **Note comparison orders by label components (D1).** `compareSharenotes`,
  `Sharenote#compareTo`, and `#equals` compare `(z, centiBits)`; two notes with
  the same label are equal even when their continuous `zBits` differ.
- **Near-integer labels clamp, never carry (D2).** `labelComponents` clamps raw
  cents to `[0, 99]` (no `(z+1)Z00` carry), matching Go/Python.
- **Integer amounts are `bigint` (D4).** `Invoice.amount`/`workers`,
  `Share.amount`/`fee`/`shareCount`/`totalShareCount`, and
  `PayoutThreshold.amount` round-trip exactly across the full int64 range.
- **35505 requires an explicit `chain` (D5).** `buildShareTags(share, kind)`
  and `validateShare`/`validateEvent` reject a Share Payment without a `chain`
  tag — no silent default.
- **Invoice/share validation** adds the 32-byte-hex block-hash check (A7/A9),
  the raw-header leading-zero bound (A14 clause 2), and A8/A13 settlement checks.
- Amount/fee/threshold documentation uses "the coin's base unit" (satoshi only
  as a Bitcoin example); on-wire tag names are unchanged (D8).
- `package.json` `exports` nests per-condition `{ types, default }` so the CJS
  build resolves its own `.d.cts` types. Migration table completed; `readonly`
  claims in the README tightened to match the code.

## [2.0.0] - 2026-11-02

Baseline release of the redesigned, idiomatic TypeScript SDK for the Sharenote
protocol (NIP-SN). The public API is reorganised around domain concepts rather
than spec numbers, delivered as flat, tree-shakeable named exports from a single
entry point with no default export and TSDoc on every public symbol.

### Added

- **Z-Arithmetic.** An immutable `Sharenote` value type built via static
  factories (`fromLabel`, `fromZBits`, `fromComponents`, `fromCentiBits`,
  `fromDifficulty`, `fromNBits`, `fromTarget`, `from`) with instance arithmetic
  (`add`, `subtract`, `scale`, `divide`, `compareTo`, `equals`) and queries
  (`target`, `toNBits`, `probabilityPerHash`, `expectedHashes`). Difficulty is
  accumulated exactly as `bigint`-based dyadic rationals (`combine`,
  `exactDifficulty`, and the `ExactDifficulty` toolkit); `number` is exposed only
  through explicit display helpers (`difficulty`, `zBitsToDifficulty`,
  `difficultyToZBits`, `zBitsFromTarget`).
- **Hashrate & planning.** `parseHashrate`, `formatHashrate`, `formatHashCount`,
  `formatProbability`, `probabilityPerHash`, `expectedHashes`, `requiredHashrate`
  (+ `Mean`/`Quantile`), `hashrateRange`, `maxZBits`, `sharenoteFromHashrate`,
  `estimate`, `estimateMany`, `planFromHashrate`, and the `ReliabilityId` /
  `PrimaryMode` / `HashrateUnit` enums.
- **Events.** Typed `build*Tags` / `parse*Tags` builders and parsers for every
  NIP-SN kind — telemetry, pool accounting (invoices and shares), and raw
  minting / AuxPoW — plus `validateInvoice`, `validateShare`,
  `validateHeaderHash`, and `validateLabel`. Kinds are literal constants on
  `SharenoteKind`; the settlement `x` tag is a `Settlement` discriminated union
  (`confirmedSettlement` / `pendingSettlement`). Block and share identifiers
  (`computeHeightHash`, `computePendingShareId`, `computeFinalizedShareId`) use
  blake2b-256 and match the Go and Python SDKs byte-for-byte.
- **Identity.** Miner and pool identity builders, parsers, and profile-content
  helpers (`build*/parse*MinerIdentityTags`, `build*/parse*PoolIdentityTags`,
  `build*/parse*PoolIdentityContent`).
- A single `SharenoteError` type thrown across all validation and parsing.

### Changed

- Source reorganised from the spec-numbered `snipXX` files into domain modules
  under `src/` (`difficulty`, `exact`, `hashrate`, `kinds`, `events/*`,
  `identity`), re-exported from `src/index.ts`. `package.json` `build` now points
  at `src/index.ts`; `exports`/`types` are unchanged (`dist/index.*`).
- `strict` TypeScript across the codebase; `moduleResolution` set to `Bundler`.
- Cross-SDK conformance vectors (`snip00_tests.json`) are asserted verbatim
  against the redesigned API and remain green.

### Removed

- The `snipXX` module layout and per-module namespaces (`snip02.*`, …); the
  `must*` factories, `with*` option factories, deprecated `estimateSharenote` /
  `divideNote` aliases, the `HashrateMeasurement` / `HashesMeasurement` wrapper
  classes, and the legacy `snip05` identity aliases. See the migration table in
  the README for replacements.
