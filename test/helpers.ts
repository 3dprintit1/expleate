import { expect } from 'vitest';
import { configFromEnv, type Env } from '../src/config.js';
import { newId } from '../src/core/crypto.js';
import type { CharterReader, ReaderSubject, Reading } from '../src/core/reader.js';
import type { Context } from '../src/services/context.js';
import { addResources } from '../src/services/members.js';
import type { Member } from '../src/services/records.js';
import { openNodeSql } from '../src/store/node-sqlite.js';
import { migrate } from '../src/store/schema.js';

/** A small, fast, seeded random number generator (mulberry32) for repeatable tests. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TestContext extends Context {
  advanceDays(days: number): void;
}

export function testContext(env: Env = {}, seed = 1, reader?: CharterReader): TestContext {
  const sql = openNodeSql(':memory:');
  migrate(sql);
  const random = seeded(seed);
  let now = new Date('2026-10-01T09:00:00Z');
  return {
    sql,
    config: configFromEnv({ DEMO_RESOURCES: 'true', CURRENCY: 'USD', STANDING_DAYS: '0', MAX_LIVE_PROJECTS: '100', ...env }),
    now: () => now,
    randomInt: (max) => Math.floor(random() * max),
    reader,
    advanceDays(days) {
      now = new Date(now.getTime() + days * 86_400_000);
    },
  };
}

export interface FakeReader extends CharterReader {
  /** Everything it was asked to read, in order. */
  readonly seen: ReaderSubject[];
}

/**
 * A charter reader that answers from a function instead of a model. By
 * default it finds that everything fits.
 */
export function fakeReader(answer: (subject: ReaderSubject) => Omit<Reading, 'model'> | null = () => FITS): FakeReader {
  const seen: ReaderSubject[] = [];
  return {
    model: 'test-model',
    seen,
    async read(subject) {
      seen.push(subject);
      const reading = answer(subject);
      return reading ? { ...reading, model: 'test-model' } : null;
    },
  };
}

export const FITS: Omit<Reading, 'model'> = { verdict: 'fits', summary: 'Nothing seems to break the charter.', concerns: [] };

/**
 * Adds a member directly, skipping password hashing so tests stay quick.
 * The sign-up flow itself has its own tests.
 */
export function makeMember(ctx: Context, handle: string, dollars = 0): Member {
  const member: Member = { id: newId(), handle, name: handle[0]!.toUpperCase() + handle.slice(1), balance: 0, created_at: ctx.now().toISOString() };
  ctx.sql.run(
    "INSERT INTO members (id, handle, name, password_hash, balance, created_at) VALUES (?, ?, ?, 'x', 0, ?)",
    member.id,
    member.handle,
    member.name,
    member.created_at,
  );
  if (dollars > 0) addResources(ctx, member.id, BigInt(Math.round(dollars * 100)));
  return member;
}

export function balanceOf(ctx: Context, memberId: string): number {
  return ctx.sql.get<{ balance: number }>('SELECT balance FROM members WHERE id = ?', memberId)!.balance;
}

/**
 * Resources are never created or lost: everything ever added is either in
 * someone's balance, in a pool, used by a project, shared as running costs,
 * or moved out.
 */
export function expectConservation(ctx: Context): void {
  const total = (sql: string) => ctx.sql.get<{ t: number | null }>(sql)!.t ?? 0;
  const added = total("SELECT SUM(amount) AS t FROM ledger WHERE kind = 'add'");
  const movedOut = total("SELECT SUM(amount) AS t FROM ledger WHERE kind = 'move_out'");
  const used = total("SELECT SUM(amount) AS t FROM ledger WHERE kind = 'use'");
  const shared = total("SELECT SUM(amount) AS t FROM ledger WHERE kind = 'cost_share'");
  const balances = total('SELECT SUM(balance) AS t FROM members');
  const pools = total('SELECT SUM(pool_balance) AS t FROM projects');
  expect(balances + pools + used + shared + movedOut).toBe(added);

  // Each pool's own books balance too.
  const projects = ctx.sql.all<{
    pool_balance: number;
    pool_put_in: number;
    pool_taken_back: number;
    pool_used: number;
    pool_costs: number;
    pool_returned: number;
  }>('SELECT * FROM projects');
  for (const p of projects) {
    expect(p.pool_put_in - p.pool_taken_back - p.pool_used - p.pool_costs - p.pool_returned).toBe(p.pool_balance);
  }
}

export const STORY =
  'We will spend a summer evening making paper lanterns together, then carry them through the old town at dusk with music.';
export const PLANS = 'Paper, willow sticks, LED tea-lights and the hire of the community hall for the workshop.';
