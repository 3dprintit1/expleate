/**
 * On Cloudflare the Worker at the edge does the slow part of every password
 * check, then passes the result inward in these headers. The Worker removes
 * any a visitor sends, and the site only reads them when told it sits behind
 * that Worker, so they cannot be forged from outside.
 */
export const EDGE_HEADERS = {
  /** A new password, already hashed. */
  passwordHash: 'x-expleate-password-hash',
  /** The key derived from a password and its stored salt. */
  passwordProof: 'x-expleate-password-proof',
  /** Too many tries from one place: ask the person to slow down. */
  slowDown: 'x-expleate-slow-down',
} as const;

export const EDGE_HEADER_NAMES: readonly string[] = Object.values(EDGE_HEADERS);
