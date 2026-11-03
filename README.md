# SharenoteJS

SharenoteJS is the reference TypeScript SDK for [Sharenote](https://sharenote.xyz) —
proof-of-work bearer notes, specified as a single family of Nostr events in
**NIP-SN**. It provides the exact Z-arithmetic that makes notes comparable and
summable, plus typed builders and parsers for every NIP-SN event kind.

- **Exact by construction.** Difficulty is accumulated as `bigint`-based dyadic
  rationals, never a `float64` accumulator — the arithmetic required by NIP-SN
  §Z-Arithmetic (A1) — through the immutable `Sharenote` value and the streaming
  `Work` accumulator. On-wire integer amounts (`amount` / `fee` / `threshold` /
  counts) are `bigint`, so they round-trip exactly across the full int64 range.
  `number` appears only in explicit display and statistical helpers.
- **Idiomatic, tree-shakeable ESM.** Flat named exports from a single entry and
  no default export, with TSDoc on every public symbol. The `Sharenote` and
  `Work` arithmetic values are deeply immutable (`readonly` fields; every method
  returns a fresh value) and the settlement `x` tag is a `readonly`
  discriminated union; the event record types (`Invoice`, `Share`, …) are plain
  mutable shapes you build up and parse back. Ships ESM + CJS + `.d.ts`.

## Installation

```bash
npm install @soprinter/sharenotejs
```

Runtime dependency: [`@noble/hashes`](https://github.com/paulmillr/noble-hashes)
(blake2b-256 for block/share identifiers, double-SHA-256 for header
verification — browser-portable, no Node `crypto`).

## API overview

The surface is organised around three domains.

### 1. Z-Arithmetic

The [`Sharenote`](src/difficulty.ts) value type is the unit of measurement. It
separates the authoritative exact difficulty from the human-readable
denomination label and the `number`-valued `zBits`, both of which are display
projections.

```ts
import { Sharenote, combine } from "@soprinter/sharenotejs";

const note = Sharenote.fromLabel("34Z10");
note.zBits;          // 34.1
note.label;          // "34Z10"
note.probabilityPerHash();

// Construct from any representation:
Sharenote.fromZBits(34.1);
Sharenote.fromComponents(34, 10);
Sharenote.fromCentiBits(3410);
Sharenote.fromDifficulty(2 ** 34.1);
Sharenote.fromNBits("19752b59");   // compact-target interop
Sharenote.fromTarget(note.target());

// Arithmetic. `combine` sums difficulties EXACTLY (bigint), never by label, and
// carries the exact sum forward so folding a combined note loses nothing (D3).
combine(["25Z00", "25Z00"]).label;             // "26Z00"
Sharenote.fromLabel("33Z53").subtract("20Z10"); // difference, clamped at 0Z00
Sharenote.fromLabel("20Z10").scale(1.5);         // 20Z68
Sharenote.fromLabel("33Z53").divide("20Z10");    // difficulty ratio (number)

// Comparison is by LABEL components (z, then centi-bits): two notes with the
// same label are equal even when their continuous zBits differ (D1).
compareSharenotes("34Z10", 34.1057);   // 0 — same label
Sharenote.fromLabel("35Z00").compareTo("34Z99"); // 1 — higher z wins

note.exactDifficulty; // { sig: bigint, exp: number } — authoritative value
Sharenote.fromExactDifficulty(note.exactDifficulty); // rebuild from exact D
note.target();        // raw 256-bit bigint target
note.toNBits();       // "..." compact nBits hex
```

Proportional payout slicing and feed aggregation live in linear difficulty
space. `Work` is the exact streaming accumulator for a pool total or an
address's slice, mirroring Go's `Work`:

```ts
import { Work } from "@soprinter/sharenotejs";

const miner = new Work().add("34Z10").add("34Z10"); // exact dyadic sum
const pool = new Work().add(miner.note()).add("35Z00");
miner.payout(pool, 312_500_000n); // exact, floored base-unit slice (bigint)
```

See also the exact toolkit (`decomposeFloatToExact`, `sumExactDifficulties`,
`zBitsFromExactDifficulty`, `exactDifficultyToNumber`).

**Hashrate, probability & planning** (display/statistical helpers, `number`-valued):

```ts
import {
  parseHashrate, formatHashrate, requiredHashrate, requiredHashrateMean,
  requiredHashrateQuantile, sharenoteFromHashrate, estimate, planFromHashrate,
  ReliabilityId, HashrateUnit,
} from "@soprinter/sharenotejs";

parseHashrate("5 GH/s");                       // 5_000_000_000
formatHashrate(2.48e9).display;                // "2.48 GH/s"
requiredHashrateMean("33Z53", 5);              // ~2.48e9 H/s
requiredHashrateQuantile("33Z53", 5, 0.95);    // ~7.43e9 H/s
requiredHashrate("33Z53", 5, { reliability: ReliabilityId.Often95 });
sharenoteFromHashrate("2.480651469 GH/s", 5).label; // "33Z53"

const plan = planFromHashrate({
  hashrate: { value: 5, unit: HashrateUnit.GHps },
  seconds: 5,
  reliability: ReliabilityId.Often95,
});
plan.sharenote.label;
plan.estimate.requiredHashrateHuman.display;
```

### 2. Events

Typed builders (`build*Tags`) and parsers (`parse*Tags`) for the NIP-SN Nostr
event kinds. Kinds are literal constants on `SharenoteKind`, and the settlement
`x` tag is modelled as a discriminated union on `confirmed`.

```ts
import {
  SharenoteKind,
  buildInvoiceTags, parseInvoiceTags, validateInvoice, createInvoice,
  buildShareTags, parseShareTags, validateShare, createShare,
  computeHeightHash, computePendingShareId, computeFinalizedShareId,
  confirmedSettlement, pendingSettlement,
  buildTelemetryTags, parseTelemetryTags, createTelemetry,
  buildRawSharenoteTags, parseRawSharenoteTags, validateHeaderHash,
  validateEvent,
} from "@soprinter/sharenotejs";

const invoice = createInvoice({
  heightHash: computeHeightHash(843000),
  blockHash: "00".repeat(32),
  height: 843000,
  amount: 312_500_000n, // bigint — exact across the full int64 range
  workers: 128n,
  shares: "58Z42",
  settlement: confirmedSettlement("9b1e…c0", 843006, "0000…b4"),
});
validateInvoice(invoice, SharenoteKind.SettledInvoice);
const tags = buildInvoiceTags(invoice);          // → Nostr event.tags
const back = parseInvoiceTags(tags);
if (back.settlement?.confirmed) back.settlement.blockHeight; // narrows to full form
```

`validateEvent` applies the whole NIP-SN validation union (A5–A16) to a raw
`{ kind, content, tags }` event — coordinate equality, 32-byte-hex block
hashes, the full A14 raw-header check (both clauses), the 35505 `chain`
requirement, identity and telemetry shape — throwing a `SharenoteError` on the
first violation:

```ts
validateEvent({ kind: SharenoteKind.UnpaidInvoice, content: "", tags });
// kind 35510 identifies its primary chain out of band:
validateEvent(rawEvent, { primaryChainId: "15" });
```

Per-domain validators (`validateShare`, `validateRawSharenoteEvent`,
`validateTelemetryEvent`, `validateMinerIdentityEvent`,
`validatePoolIdentityEvent`) are exported too, for validating one kind directly.

### 3. Identity

Miner and pool identity (replaceable kinds `10520` / `10521`).

```ts
import {
  buildMinerIdentityTags, parseMinerIdentityTags, createMinerIdentity, createChainAddress,
  buildPoolIdentityTags, buildPoolIdentityContent, parsePoolIdentityTags, parsePoolIdentityContent,
  createPoolIdentity, createPoolChain, createPayoutScheme,
} from "@soprinter/sharenotejs";

const miner = createMinerIdentity({
  chains: [createChainAddress({ chainId: "15", address: "fc1q…" })],
  preferredPayout: "pplns",
});
const minerTags = buildMinerIdentityTags(miner);
```

All validation and parsing errors throw a single `SharenoteError`.

## Migration from 1.x (`snipXX` → domain API)

2.0.0 removes the spec-numbered `snipXX` module layout and the per-module
namespaces (`snip02.*`, …) in favour of flat, domain-named exports from the
package root.

| 1.x (`snipXX`) | 2.0.0 |
|---|---|
| `snip00`: `noteFromZBits`, `noteFromComponents`, `parseNoteLabel`, `ensureNote` | `Sharenote.fromZBits`, `.fromComponents`, `.fromLabel`, `.from` |
| `snip00`: `noteFromCentZBits`, `mustNoteFromCentZBits` | `Sharenote.fromCentiBits` |
| `snip00`: `nbitsToSharenote` / `sharenoteToNBits` | `Sharenote.fromNBits` / `Sharenote#toNBits` |
| `snip00`: `targetFor` / `continuousDifficulty` | `Sharenote#target` / `zBitsFromTarget` (`Sharenote.fromTarget`) |
| `snip00`: `combineNotesSerial` | `combine` (or `Sharenote#add` / `Sharenote.combine`) |
| `snip00`: `noteDifference`, `scaleNote`, `divideNotes`/`divideNote` | `Sharenote#subtract`, `#scale`, `#divide` |
| `snip00`: `compareNotes`, `formatNoteLabel` | `compareSharenotes` (`Sharenote#compareTo`), `formatLabel` |
| `snip00`: `difficultyFromZBits` / `zBitsFromDifficulty` | `zBitsToDifficulty` / `difficultyToZBits` |
| `snip00`: `estimateSharenote`/`estimateNote`, `estimateSharenotes`/`estimateNotes` | `estimate`, `estimateMany` |
| `snip00`: `planSharenoteFromHashrate`, `noteFromHashrate`, `maxZBitsForHashrate`, `hashrateRangeForNote` | `planFromHashrate`, `sharenoteFromHashrate`, `maxZBits`, `hashrateRange` (`{ min, max }`) |
| `snip00`: `humanHashrate`, `formatProbabilityDisplay`, `getReliabilityLevels` | `formatHashrate`, `formatProbability`, `reliabilityLevels` |
| `snip00`: `requiredHashrate`, `requiredHashrateMean`, `requiredHashrateQuantile` | same names (kept); the `*Measurement` variants removed |
| `snip00`: `CENT_ZBIT_STEP`, `MIN_CENTZ`, `MAX_CENTZ` | `CENTIBIT_STEP`, `MIN_CENTIBITS`, `MAX_CENTIBITS` |
| `snip00`: `probabilityFromZBits`/`probabilityPerHash`, `expectedHashesForZBits`/`expectedHashesForNote` | `probabilityPerHash` / `expectedHashes` (note-taking free functions); `zBitsToDifficulty` for the raw `2**zBits` |
| `snip00`: `zBitsFromComponents`, `normalizeHashrateValue`, `expectedHashesMeasurement` | removed — use `Sharenote.fromComponents(...).zBits` and `parseHashrate` |
| `snip00`: `CONTINUOUS_EXPONENT_STEP` | removed — replaced by the exact dyadic toolkit (`ExactDifficulty`, `decomposeFloatToExact`, `sumExactDifficulties`, `zBitsFromExactDifficulty`, `exactDifficultyToNumber`) |
| `snip00` types: `BillEstimate`, `SharenotePlan`, `HumanHashrateOptions`, `HashratePlanOptions`, `HashrateValue`/`HashrateParseInput` | `Estimate`, `Plan`, `FormatHashrateOptions`, `PlanOptions`, `HashrateInput` |
| `snip00`: `HashrateMeasurement`/`HashesMeasurement` wrappers, `with*` option factories, `must*`/deprecated aliases | removed — helpers return plain `number`; pass option objects directly |
| `snip02`: `KIND_HASHRATE`, `Hashrate`/`Worker`, `createHashrate`/`createWorker`, `marshalTags`/`unmarshalTags` | `SharenoteKind.HashrateTelemetry`, `Telemetry`/`TelemetryWorker`, `createTelemetry`/`createTelemetryWorker`, `buildTelemetryTags`/`parseTelemetryTags` |
| `snip03`: `KIND_INVOICE`…`KIND_SHARE_PAYMENT` | `SharenoteKind.UnpaidInvoice`…`.SharePayment` |
| `snip03`: `marshal/unmarshalInvoiceTags`, `marshal/unmarshalShareTags` | `build/parseInvoiceTags`, `build/parseShareTags` |
| `snip03`: `Transaction` + `createTransaction`, `Invoice.tx`/`Share.tx` | `Settlement` union + `pendingSettlement`/`confirmedSettlement`, `.settlement` field |
| `snip03`: `computePaymentShareId` | `computeFinalizedShareId` |
| `snip04`: `KIND_SHARENOTE`, `Sharenote` (event), `createSharenote`, `marshalTags`/`unmarshalTags` | `SharenoteKind.RawSharenote`, `RawSharenote`, `createRawSharenote`, `buildRawSharenoteTags`/`parseRawSharenoteTags` |
| `snip05`: `KIND_MINER_IDENTITY`/`KIND_POOL_IDENTITY` | `SharenoteKind.MinerIdentity`/`.PoolIdentity` |
| `snip05`: `marshal/unmarshalMinerTags`, `marshal/unmarshalPoolTags`, `marshal/unmarshalPoolContent` | `build/parseMinerIdentityTags`, `build/parsePoolIdentityTags`, `build/parsePoolIdentityContent` |
| `snip05`: `Identity`, `createIdentity`, module-level `marshalTags`/`unmarshalTags` aliases | removed — use the miner identity API |

New in 2.0 (no 1.x predecessor): the exact dyadic toolkit and the `Work`
streaming accumulator with proportional `Payout`; `Sharenote.fromExactDifficulty`;
the whole-event validation union `validateEvent` with the per-domain validators
(`validateRawSharenoteEvent`, `validateTelemetryEvent`,
`validateMinerIdentityEvent`, `validatePoolIdentityEvent`); and the `isHex` /
`is32ByteHex` predicates. On-wire integer amounts (`amount` / `fee` /
`threshold` / counts) are now `bigint` rather than `number`, for exact int64
round-trips.

## Testing & tooling

```bash
npm test          # Vitest (unit, event round-trips, cross-SDK parity vectors)
npm run lint      # tsc --noEmit
npm run build     # tsup bundling (ESM + CJS + .d.ts)
```

The cross-SDK conformance vectors — `snip00_tests.json` (arithmetic),
`sdk_edge_tests.json` (the D1–D4 edge cases), and `validation_tests.json` (the
forged/control events of the validation union) — are shared byte-for-byte with
the Go and Python SDKs, asserted verbatim, and must stay green across every SDK.

## License

Creative Commons CC0 1.0 Universal
