import {
  PASSWORD_ITERATIONS,
  hashPassword,
  newId,
  newSecret,
  parsePasswordHash,
  proofMatches,
  randomBytes,
  sha256,
  toBase64Url,
  verifyPassword,
} from '../core/crypto.js';
import { MAX_AMOUNT } from '../core/money.js';
import { type Context, Problem, addDays, cleanLine, nowIso } from './context.js';
import { type Member, changeBalance, record } from './records.js';

const HANDLE = /^[a-z0-9_]{3,24}$/;

const RESERVED = new Set([
  'admin',
  'api',
  'caretaker',
  'caretakers',
  'charter',
  'costs',
  'expleate',
  'expleating',
  'founder',
  'help',
  'join',
  'me',
  'new',
  'pooling',
  'root',
  'support',
  'system',
]);

export function normaliseHandle(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function checkHandle(handle: string): void {
  if (!HANDLE.test(handle)) {
    throw new Problem('Handles are 3 to 24 characters long: letters, numbers and underscores.', 400, 'handle');
  }
  if (RESERVED.has(handle)) throw new Problem('That handle is reserved. Please choose another.', 400, 'handle');
}

export interface SignUpInput {
  readonly handle: string;
  readonly name: string;
  readonly password: string;
}

/** Checks a new password before anything slow happens to it. */
export function checkPassword(password: string): void {
  if (password.length < 10) throw new Problem('Passwords need at least 10 characters.', 400, 'password');
  if (password.length > 200) throw new Problem('Passwords can be at most 200 characters.', 400, 'password');
}

/**
 * Creates an account. On Cloudflare the password arrives already hashed by
 * the Worker at the edge, as `passwordHash`; anywhere else it is hashed here.
 */
export async function signUp(ctx: Context, input: SignUpInput, passwordHash?: string): Promise<Member> {
  const handle = normaliseHandle(input.handle);
  checkHandle(handle);
  const name = cleanLine(input.name, { label: 'Your name', field: 'name', max: 60 });
  let hash: string;
  if (passwordHash !== undefined) {
    if (!parsePasswordHash(passwordHash)) throw new Error('A password hashed at the edge was not in the expected form.');
    hash = passwordHash;
  } else {
    const password = String(input.password ?? '');
    checkPassword(password);
    // Hash first: it takes a moment, and nothing else should wait on it.
    hash = await hashPassword(password);
  }

  return ctx.sql.transaction(() => {
    if (ctx.sql.get('SELECT 1 FROM members WHERE handle = ?', handle)) {
      throw new Problem('Someone already has that handle.', 409, 'handle');
    }
    const member: Member = { id: newId(), handle, name, balance: 0, created_at: nowIso(ctx) };
    ctx.sql.run(
      'INSERT INTO members (id, handle, name, password_hash, balance, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      member.id,
      member.handle,
      member.name,
      hash,
      member.created_at,
    );
    return member;
  });
}

export interface Session {
  readonly token: string;
  readonly member: Member;
  readonly expires: Date;
}

/** Opens a session for someone who has just joined or whose password has been checked. */
export async function startSession(ctx: Context, member: Member): Promise<Session> {
  const token = newSecret();
  const tokenHash = await sha256(token);
  const now = ctx.now();
  const expires = addDays(now, ctx.config.sessionDays);
  ctx.sql.transaction(() => {
    ctx.sql.run('DELETE FROM sessions WHERE expires_at <= ?', now.toISOString());
    ctx.sql.run(
      'INSERT INTO sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      member.id,
      now.toISOString(),
      expires.toISOString(),
    );
  });
  return { token, member, expires };
}

interface MemberWithPassword extends Member {
  readonly password_hash: string;
}

function memberWithPassword(ctx: Context, handleInput: string): MemberWithPassword | undefined {
  return ctx.sql.get<MemberWithPassword>(
    "SELECT id, handle, name, balance, created_at, password_hash FROM members WHERE handle = ? AND kind = 'person'",
    normaliseHandle(handleInput),
  );
}

function withoutPassword(row: MemberWithPassword): Member {
  const { password_hash: _, ...member } = row;
  return member;
}

// A stand-in for people who do not exist, so neither the time taken nor the
// salt handed to the edge reveals which handles exist. It matches nothing. It
// is made on first use, because Cloudflare allows randomness only inside a
// request, never while a module loads.
let standIn: string | undefined;
function standInHash(): string {
  standIn ??= `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(randomBytes(16))}$${toBase64Url(randomBytes(32))}`;
  return standIn;
}

export async function signIn(ctx: Context, handleInput: string, password: string): Promise<Session> {
  const row = memberWithPassword(ctx, handleInput);
  const matches = await verifyPassword(String(password ?? ''), row?.password_hash ?? standInHash());
  if (!row || !matches) throw new Problem('That handle and password do not match.', 401);
  // Read the member again: the check above took a moment, and their record may have changed.
  const fresh = memberWithPassword(ctx, handleInput);
  if (!fresh) throw new Problem('That handle and password do not match.', 401);
  return startSession(ctx, withoutPassword(fresh));
}

/**
 * The salt and work factor for a handle, so the Worker at the edge can do the
 * slow part of checking a password without holding up everyone else.
 */
export function passwordSalt(ctx: Context, handleInput: string): { salt: string; iterations: number } {
  const parsed = parsePasswordHash(memberWithPassword(ctx, handleInput)?.password_hash ?? standInHash());
  if (!parsed) throw new Error('A stored password hash could not be read.');
  return { salt: parsed.salt, iterations: parsed.iterations };
}

/** Signs someone in with the key the edge derived from their password and salt. */
export async function signInWithProof(ctx: Context, handleInput: string, proof: string): Promise<Session> {
  const row = memberWithPassword(ctx, handleInput);
  if (!row || !proofMatches(proof, row.password_hash)) {
    throw new Problem('That handle and password do not match.', 401);
  }
  return startSession(ctx, withoutPassword(row));
}

export async function memberForToken(ctx: Context, token: string | undefined): Promise<Member | undefined> {
  if (!token || token.length > 100) return undefined;
  const tokenHash = await sha256(token);
  return ctx.sql.get<Member>(
    `SELECT m.id, m.handle, m.name, m.balance, m.created_at
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
    tokenHash,
    nowIso(ctx),
  );
}

export async function signOut(ctx: Context, token: string | undefined): Promise<void> {
  if (!token || token.length > 100) return;
  const tokenHash = await sha256(token);
  ctx.sql.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}

/** The most pretend resources someone can add in one go while demo resources are on. */
function demoLimit(ctx: Context): bigint {
  return 100_000n * 10n ** BigInt(ctx.config.currency.digits);
}

/**
 * Adds pretend resources while Expleate is a prototype. Once real money is
 * connected, this is where a payment would arrive.
 */
export function addResources(ctx: Context, memberId: string, amount: bigint): void {
  if (!ctx.config.demoResources) throw new Problem('Adding resources is switched off here.', 403);
  if (amount <= 0n) throw new Problem('The amount must be more than zero.', 400, 'amount');
  if (amount > demoLimit(ctx)) throw new Problem('That is more than can be added in one go.', 400, 'amount');
  ctx.sql.transaction(() => {
    const balance = changeBalance(ctx, memberId, amount);
    if (balance > MAX_AMOUNT) throw new Problem('That would be more than can be held.', 400, 'amount');
    record(ctx, { kind: 'add', memberId, amount });
  });
}

/** Moves resources out of Expleate. While it is a prototype, they simply disappear. */
export function moveOut(ctx: Context, memberId: string, amount: bigint): void {
  if (amount <= 0n) throw new Problem('The amount must be more than zero.', 400, 'amount');
  ctx.sql.transaction(() => {
    changeBalance(ctx, memberId, -amount);
    record(ctx, { kind: 'move_out', memberId, amount });
  });
}
