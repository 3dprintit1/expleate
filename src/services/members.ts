import { hashPassword, newId, newSecret, sha256, verifyPassword } from '../core/crypto.js';
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

export async function signUp(ctx: Context, input: SignUpInput): Promise<Member> {
  const handle = normaliseHandle(input.handle);
  checkHandle(handle);
  const name = cleanLine(input.name, { label: 'Your name', field: 'name', max: 60 });
  const password = String(input.password ?? '');
  if (password.length < 10) throw new Problem('Passwords need at least 10 characters.', 400, 'password');
  if (password.length > 200) throw new Problem('Passwords can be at most 200 characters.', 400, 'password');

  // Hash first: it takes a moment, and nothing else should wait on it.
  const passwordHash = await hashPassword(password);

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
      passwordHash,
      member.created_at,
    );
    return member;
  });
}

let standInHash: Promise<string> | undefined;

export interface Session {
  readonly token: string;
  readonly member: Member;
  readonly expires: Date;
}

export async function signIn(ctx: Context, handleInput: string, password: string): Promise<Session> {
  const handle = normaliseHandle(handleInput);
  const row = ctx.sql.get<Member & { password_hash: string }>(
    'SELECT id, handle, name, balance, created_at, password_hash FROM members WHERE handle = ?',
    handle,
  );
  // Check a stand-in hash when there is no such person, so the time taken does
  // not reveal which handles exist.
  standInHash ??= hashPassword('not anybody’s password');
  const matches = await verifyPassword(String(password ?? ''), row?.password_hash ?? (await standInHash));
  if (!row || !matches) throw new Problem('That handle and password do not match.', 401);

  const token = newSecret();
  const now = ctx.now();
  const expires = addDays(now, ctx.config.sessionDays);
  const tokenHash = await sha256(token);
  ctx.sql.transaction(() => {
    ctx.sql.run('DELETE FROM sessions WHERE expires_at <= ?', now.toISOString());
    ctx.sql.run(
      'INSERT INTO sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      row.id,
      now.toISOString(),
      expires.toISOString(),
    );
  });
  const { password_hash: _, ...member } = row;
  return { token, member, expires };
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
