/**
 * Hex-string predicates shared by the event validators.
 *
 * Chain IDs and block hashes travel as hex strings on the wire; NIP-SN requires
 * strict hex parsing (A16) and a 32-byte block-hash key (A7/A9). These mirror Go
 * `isHex` / `is32ByteHex` exactly so all three SDKs accept and reject the same
 * strings.
 */

/** Whether `s` is a non-empty, even-length hex string (matches Go `isHex`). */
export function isHex(s: string): boolean {
  return s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

/** Whether `s` is exactly 64 hex characters — a 32-byte key (NIP-SN A7/A9). */
export function is32ByteHex(s: string): boolean {
  return s.length === 64 && isHex(s);
}
