/**
 * The single error type thrown by this SDK for invalid input or malformed data.
 *
 * Every function that validates its arguments throws {@link SharenoteError}
 * (never a bare `Error`), so callers can catch one type across the whole API.
 *
 * @example
 * ```ts
 * import { Sharenote, SharenoteError } from "@soprinter/sharenotejs";
 *
 * try {
 *   Sharenote.fromLabel("not-a-label");
 * } catch (err) {
 *   if (err instanceof SharenoteError) {
 *     console.error(err.message);
 *   }
 * }
 * ```
 */
export class SharenoteError extends Error {
  override readonly name = "SharenoteError";

  constructor(message: string) {
    super(message);
    // Restore the prototype chain for instances created across transpilation
    // targets (notably when the output is downlevelled to ES5).
    Object.setPrototypeOf(this, SharenoteError.prototype);
  }
}

/** Throw a {@link SharenoteError} unless `condition` holds. Narrows the type. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new SharenoteError(message);
  }
}

/** Throw a {@link SharenoteError} unless `value` is a finite number. */
export function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new SharenoteError(`${field} must be a finite number`);
  }
}
