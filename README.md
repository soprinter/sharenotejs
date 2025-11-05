# SharenoteJS

SharenoteJS is the reference TypeScript toolkit for [Sharenote](https://sharenote.xyz) clients.


## Installation

```bash
npm install @soprinter/sharenotejs
```

The package has no runtime dependencies.

---

## Quick Start

```ts
import {
  planSharenoteFromHashrate,
  estimateSharenote,
  parseHashrate,
  humanHashrate,
  ReliabilityId,
  HashrateUnit,
} from "@soprinter/sharenotejs";

const rigHashrate = parseHashrate("5 GH/s"); // 5000000000

const plan = planSharenoteFromHashrate({
  hashrate: { value: 5, unit: HashrateUnit.GHps },
  seconds: 5,
  reliability: ReliabilityId.Often95,
});

console.log(plan.sharenote.label);                    // "32Z95"
console.log(plan.bill.requiredHashrateHuman.display); // "5.00 GH/s"
console.log(humanHashrate(rigHashrate).display);      // "5.00 GH/s"

const bill = estimateSharenote("33Z53", 5, { reliability: 0.95 });
console.log(bill.probabilityDisplay);                 // "1 / 2^33.53000"
```

---

## Feature Guide

### Create Canonical Notes
Represent notes as structured objects or canonical strings so maths and presentation stay in sync.

```ts
import { noteFromComponents, parseNoteLabel, noteFromBits } from "@soprinter/sharenotejs";

const parsed = parseNoteLabel("33Z 53CZ"); // { z: 33, cents: 53 }
const note = noteFromComponents(parsed.z, parsed.cents);
console.log(note.label); // "33Z53"

const recovered = noteFromBits(note.bits);
console.log(recovered.label); // "33Z53"
```

### Translate Hashrate Inputs
Accept hashrates the way humans say them and convert back to friendlier displays when needed.

```ts
import { parseHashrate, noteFromHashrate, humanHashrate } from "@soprinter/sharenotejs";

const rig = parseHashrate("12.5 MH/s"); // 12500000
const note = noteFromHashrate(parseHashrate("2.480651469 GH/s"), 5);
console.log(note.label); // "33Z53"

const readable = humanHashrate(rig);
console.log(readable.display); // "12.5 MH/s"
```

### Plan From Hashrate
Let `planSharenoteFromHashrate` handle parsing, reliability and reporting in a single call.

```ts
import {
  planSharenoteFromHashrate,
  getReliabilityLevels,
  ReliabilityId,
  HashrateUnit,
} from "@soprinter/sharenotejs";

const plan = planSharenoteFromHashrate({
  hashrate: { value: 3.2, unit: HashrateUnit.PHps },
  seconds: 10,
  reliability: ReliabilityId.Often95,
});

console.log(plan.sharenote.label);                   // "53Z24"
console.log(plan.bill.requiredHashrateHuman.display); // "3.20 PH/s"
console.log(plan.inputHashrateHuman.display);         // "3.20 PH/s"
console.log(getReliabilityLevels().map((r) => r.label));
```

### Probability & Requirements
Quantify expectations and required hashrates for specific notes or confidence levels.

```ts
import {
  requiredHashrateMean,
  requiredHashrateQuantile,
  probabilityPerHash,
} from "@soprinter/sharenotejs";

const probability = probabilityPerHash("33Z53"); // ≈ 8.06e-11
const meanHashrate = requiredHashrateMean("33Z53", 5); // ≈ 2.48e9
const p95Hashrate = requiredHashrateQuantile("33Z53", 5, 0.95); // ≈ 7.43e9
```

### Build Estimates & Reports
Generate bill-style summaries that mix machine-readable data with human-facing strings.

```ts
import {
  estimateSharenotes,
  ReliabilityId,
  PrimaryMode,
} from "@soprinter/sharenotejs";

const bills = estimateSharenotes(["33Z53", "30Z00"], 5, {
  reliability: ReliabilityId.VeryLikely99,
  primaryMode: PrimaryMode.Quantile,
});

console.log(bills[0].requiredHashrateHuman.display); // "11.4 GH/s"
console.log(bills[0].probabilityDisplay);            // "1 / 2^33.53000"
```

### Compose Note Difficulties
Add, subtract, scale or compare proofs without leaving canonical space.

```ts
import {
  combineNotesSerial,
  noteDifference,
  scaleNote,
  divideNote,
} from "@soprinter/sharenotejs";

console.log(combineNotesSerial(["25Z00", "25Z00"]).label); // "26Z00"
console.log(noteDifference("33Z53", "20Z10").label);       // "33Z52"
console.log(scaleNote("20Z10", 1.5).label);                // "20Z68"
console.log(divideNote("33Z53", "20Z10").toFixed(4));      // "11036.5375"
```

### Compact Difficulty Interop
Convert Bitcoin-style `nBits` headers to Sharenote denominations for template analysis.

```ts
import { nbitsToSharenote } from "@soprinter/sharenotejs";

console.log(nbitsToSharenote("1d00ffff").label); // "29Z00"
console.log(nbitsToSharenote("19752b59").label); // "57Z12"
```

---

## Testing & Tooling

```bash
npm test          # Vitest unit tests
npm run lint      # TypeScript type checking
npm run build     # tsup bundling (esm + cjs + d.ts)
```

---

## License

Creative Commons CC0 1.0 Universal
