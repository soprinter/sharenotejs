/**
 * The settlement `x` tag shared by invoices and shares.
 *
 * NIP-SN carries a settlement transaction in short form (`["x", txid]`, before
 * confirmation) or full form (`["x", txid, height, hash]`, once confirmed).
 * {@link Settlement} models that as a discriminated union on `confirmed`, so a
 * confirmed settlement statically carries its block anchor and an unconfirmed
 * one does not.
 */

/**
 * A settlement transaction, discriminated on whether it has confirmed.
 *
 * @example
 * ```ts
 * function anchor(s: Settlement) {
 *   // TypeScript narrows: blockHeight exists only when confirmed.
 *   return s.confirmed ? s.blockHeight : null;
 * }
 * ```
 */
export type Settlement =
  | { readonly confirmed: false; readonly txid: string }
  | {
      readonly confirmed: true;
      readonly txid: string;
      readonly blockHeight: number;
      readonly blockHash: string;
    };

/** An unconfirmed settlement (short form). */
export function pendingSettlement(txid: string): Settlement {
  return { confirmed: false, txid };
}

/** A confirmed settlement with its on-chain block anchor (full form). */
export function confirmedSettlement(
  txid: string,
  blockHeight: number,
  blockHash: string
): Settlement {
  return { confirmed: true, txid, blockHeight, blockHash };
}

/** Encode a settlement as its `x` tag. */
export function buildSettlementTag(settlement: Settlement): string[] {
  return settlement.confirmed
    ? ["x", settlement.txid, String(settlement.blockHeight), settlement.blockHash]
    : ["x", settlement.txid];
}

/**
 * Decode an `x` tag. A tag is confirmed only when it carries a parseable height
 * and a non-empty block hash; otherwise it is treated as unconfirmed.
 */
export function parseSettlementTag(tag: readonly string[]): Settlement {
  const txid = tag[1] ?? "";
  if (tag.length >= 4 && tag[3]) {
    const blockHeight = Number.parseInt(tag[2], 10);
    if (!Number.isNaN(blockHeight)) {
      return { confirmed: true, txid, blockHeight, blockHash: tag[3] };
    }
  }
  return { confirmed: false, txid };
}
