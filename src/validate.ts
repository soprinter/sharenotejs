/**
 * The NIP-SN validation union, applied to a whole Nostr event.
 *
 * {@link validateEvent} dispatches a raw `{ kind, content, tags }` event to the
 * right domain validator and enforces the shared MUST-set
 * (`followup/VALIDATION-CONTRACT.md`): coordinate equality, 32-byte-hex block
 * hashes, the full A14 raw-header check (both clauses), the 35505 `chain`
 * requirement (D5), identity chain-hex / `pplns` rules, and telemetry shape. A
 * forged event throws a {@link SharenoteError}; a valid one returns cleanly.
 */
import { SharenoteError } from "./errors.js";
import { SharenoteKind, type Tags } from "./kinds.js";
import {
  parseInvoiceTags,
  parseShareTags,
  validateInvoice,
  validateShare,
} from "./events/accounting.js";
import { validateRawSharenoteEvent } from "./events/mint.js";
import { validateTelemetryEvent } from "./events/telemetry.js";
import {
  validateMinerIdentityEvent,
  validatePoolIdentityEvent,
} from "./identity.js";

/** A raw Nostr event, as consumed by {@link validateEvent}. */
export interface NostrEventLike {
  readonly kind: number;
  readonly content?: string;
  readonly tags: Tags;
}

/** Options for {@link validateEvent}. */
export interface ValidateEventOptions {
  /**
   * The primary chain's hex ID for a Raw Sharenote (kind 35510), known out of
   * band. Forwarded to the A14 primary-present / primary-first checks.
   */
  readonly primaryChainId?: string;
}

/**
 * Validate a NIP-SN event against the full MUST-set for its kind. Throws a
 * {@link SharenoteError} describing the first violation; returns cleanly for a
 * valid event.
 *
 * @throws a {@link SharenoteError} for a forged/invalid event, or an
 *   unsupported kind.
 */
export function validateEvent(event: NostrEventLike, opts?: ValidateEventOptions): void {
  switch (event.kind) {
    case SharenoteKind.UnpaidInvoice:
    case SharenoteKind.SettledInvoice:
      validateInvoice(parseInvoiceTags(event.tags), event.kind);
      return;
    case SharenoteKind.PendingShare:
    case SharenoteKind.FinalizedShare:
    case SharenoteKind.SharePayment:
      validateShare(parseShareTags(event.tags), event.kind);
      return;
    case SharenoteKind.HashrateTelemetry:
      validateTelemetryEvent(event.tags);
      return;
    case SharenoteKind.RawSharenote:
      validateRawSharenoteEvent(event.tags, { primaryChainId: opts?.primaryChainId });
      return;
    case SharenoteKind.MinerIdentity:
      validateMinerIdentityEvent(event.tags);
      return;
    case SharenoteKind.PoolIdentity:
      validatePoolIdentityEvent(event.content ?? "", event.tags);
      return;
    default:
      throw new SharenoteError(`unsupported event kind: ${event.kind}`);
  }
}
