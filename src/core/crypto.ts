/**
 * Randomness, identifiers and password hashing, using only the Web Crypto API
 * so the same code runs on Node and on Cloudflare Workers.
 */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** A uniformly random integer from 0 up to, but not including, `maxExclusive`. */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
    throw new RangeError(`randomInt needs a whole number from 1 to 2^32, got ${maxExclusive}`);
  }
  // Rejection sampling keeps every outcome equally likely.
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] as number;
    if (value < limit) return value % maxExclusive;
  }
}

/** A short random identifier for use in addresses, such as "q3Yk7Pz0aB1x". */
export function newId(): string {
  return toBase64Url(randomBytes(9));
}

/** A long random secret, such as a session token. */
export function newSecret(): string {
  return toBase64Url(randomBytes(32));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toBase64Url(new Uint8Array(digest));
}

/** Compares two byte arrays in time that does not depend on where they differ. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0;
}

/**
 * PBKDF2 with SHA-256. Cloudflare Workers refuse more than 100,000 iterations,
 * so that is what we use. The count is stored with each hash, which lets it be
 * raised later without breaking existing passwords.
 */
export const PASSWORD_ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (scheme !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || !saltText || !hashText) return false;
  const expected = fromBase64Url(hashText);
  const actual = await derive(password, fromBase64Url(saltText), iterations);
  return equalBytes(actual, expected);
}
