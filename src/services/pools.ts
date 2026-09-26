import { toStored } from '../core/money.js';
import {
  PoolError,
  contribute as addToPool,
  portionFraction,
  portionValue,
  settle,
  takeBack as takeFromPool,
  use as useFromPoolMaths,
} from '../core/pool.js';
import { type Context, Problem, cleanText } from './context.js';
import {
  LIVE_STATUSES,
  type PortionRow,
  type Project,
  changeBalance,
  getPortionRow,
  poolOf,
  portionOf,
  queryProjects,
  record,
  requireProject,
  requireHost,
  savePool,
} from './records.js';

function poolMaths<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof PoolError) throw new Problem(error.message, 400, 'amount');
    throw error;
  }
}

function notOpenMessage(project: Project): string {
  switch (project.status) {
    case 'awaiting':
      return 'This project is waiting for its charter circle, so its pool is not open yet.';
    case 'review':
      return 'A charter circle is looking at this project, so its pool is paused. You can still take back your portion.';
    default:
      return 'This project has finished, so its pool is closed.';
  }
}

/** Puts resources into a project's pool. Returns what the person's portion is now worth. */
export function contribute(
  ctx: Context,
  projectId: string,
  memberId: string,
  amount: bigint,
  showName: boolean,
): bigint {
  return ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    if (project.status !== 'open') throw new Problem(notOpenMessage(project), 409);
    changeBalance(ctx, memberId, -amount);

    const row = getPortionRow(ctx, projectId, memberId);
    const next = poolMaths(() => addToPool(poolOf(project), portionOf(row), amount));
    if (row) {
      ctx.sql.run(
        'UPDATE portions SET weight = ?, cap = ?, put_in = put_in + ?, show_name = ? WHERE project_id = ? AND member_id = ?',
        next.portion.weight.toString(),
        toStored(next.portion.cap),
        toStored(amount),
        showName ? 1 : 0,
        projectId,
        memberId,
      );
    } else {
      ctx.sql.run(
        `INSERT INTO portions (project_id, member_id, weight, cap, put_in, show_name, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        projectId,
        memberId,
        next.portion.weight.toString(),
        toStored(next.portion.cap),
        toStored(amount),
        showName ? 1 : 0,
        ctx.now().toISOString(),
      );
    }
    savePool(ctx, projectId, next.pool, { putIn: amount });
    record(ctx, { kind: 'put_in', memberId, projectId, amount, poolAfter: next.pool.balance });
    return portionValue(next.pool, next.portion);
  });
}

/**
 * Takes some or all of a person's portion back out of a pool. Always allowed
 * while the pool is live, including while a charter circle is deciding.
 */
export function takeBack(ctx: Context, projectId: string, memberId: string, amount: bigint, note = ''): void {
  const why = cleanText(note, { label: 'Your note', field: 'note', min: 0, max: 500 });
  ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    if (!LIVE_STATUSES.includes(project.status)) {
      throw new Problem('This pool has already been handed back to everyone in it.', 409);
    }
    const row = getPortionRow(ctx, projectId, memberId);
    if (!row || row.weight === '0') throw new Problem('You have no portion in this pool.', 400, 'amount');

    const next = poolMaths(() => takeFromPool(poolOf(project), portionOf(row), amount));
    ctx.sql.run(
      'UPDATE portions SET weight = ?, cap = ?, taken_back = taken_back + ? WHERE project_id = ? AND member_id = ?',
      next.portion.weight.toString(),
      toStored(next.portion.cap),
      toStored(amount),
      projectId,
      memberId,
    );
    savePool(ctx, projectId, next.pool, { takenBack: amount });
    changeBalance(ctx, memberId, amount);
    record(ctx, { kind: 'take_back', memberId, projectId, amount, poolAfter: next.pool.balance, note: why });
  });
}

/**
 * Takes `amount` out of a pool for a use or a share of running costs. Every
 * portion shrinks by the same proportion. Call inside a transaction.
 */
export function applyUse(
  ctx: Context,
  project: Project,
  amount: bigint,
  kind: 'use' | 'cost_share',
  note: string,
  memberId: string | null,
): void {
  const next = poolMaths(() => useFromPoolMaths(poolOf(project), amount));
  if (next.drained) {
    // Everything has been used, so every portion is now worth nothing.
    ctx.sql.run("UPDATE portions SET weight = '0', cap = 0 WHERE project_id = ?", project.id);
  }
  savePool(ctx, project.id, next.pool, kind === 'use' ? { used: amount } : { costs: amount });
  record(ctx, { kind, memberId, projectId: project.id, amount, poolAfter: next.pool.balance, note });
}

export function cleanUseDescription(description: string): string {
  return cleanText(description, { label: 'What it was for', field: 'description', min: 3, max: 500 });
}

/** Checks that someone may record a use of a project's pool and, given an amount, that the pool can cover it. */
export function checkCanUse(ctx: Context, project: Project, memberId: string, amount?: bigint): void {
  requireHost(ctx, project, memberId);
  if (project.status !== 'open') throw new Problem(notOpenMessage(project), 409);
  if (amount !== undefined) poolMaths(() => useFromPoolMaths(poolOf(project), amount));
}

/** A host records resources used for the project. Returns the use's place in the ledger. */
export function useResources(
  ctx: Context,
  projectId: string,
  memberId: string,
  amount: bigint,
  description: string,
): string {
  const what = cleanUseDescription(description);
  return ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    checkCanUse(ctx, project, memberId);
    applyUse(ctx, project, amount, 'use', what, memberId);
    const entry = ctx.sql.get<{ id: number }>(
      "SELECT MAX(id) AS id FROM ledger WHERE project_id = ? AND kind = 'use'",
      projectId,
    );
    return String(entry?.id ?? '');
  });
}

/**
 * Hands everything left in a pool back to the people in it, each receiving
 * their fair share. Used when a project finishes or is closed. Call inside a
 * transaction.
 */
export function settlePool(ctx: Context, project: Project, reason: string): void {
  const rows = ctx.sql.all<PortionRow>(
    // Ordered by member id, which is random, so the public record of hand-backs
    // says nothing about who joined when.
    "SELECT * FROM portions WHERE project_id = ? AND weight != '0' ORDER BY member_id",
    project.id,
  );
  const pool = poolOf(project);
  const { amounts, unreturned } = settle(pool, rows.map(portionOf));

  let handedBack = 0n;
  rows.forEach((row, index) => {
    const amount = amounts[index] ?? 0n;
    ctx.sql.run(
      "UPDATE portions SET weight = '0', cap = 0, returned = returned + ? WHERE project_id = ? AND member_id = ?",
      toStored(amount),
      project.id,
      row.member_id,
    );
    if (amount > 0n) {
      handedBack += amount;
      changeBalance(ctx, row.member_id, amount);
      record(ctx, {
        kind: 'return',
        memberId: row.member_id,
        projectId: project.id,
        amount,
        poolAfter: pool.balance - handedBack,
        note: reason,
      });
    }
  });
  savePool(ctx, project.id, { balance: unreturned, weight: 0n }, { returned: handedBack });
}

export interface PortionView {
  /** What the person could take back right now. */
  readonly value: bigint;
  readonly putIn: bigint;
  readonly takenBack: bigint;
  readonly returned: bigint;
  /** Their part of the pool now, from 0 to 1. */
  readonly fraction: number;
  /** The part of the pool they brought when they first put something in, from 0 to 1. */
  readonly firstFraction: number | null;
  readonly showName: boolean;
  readonly joinedAt: string;
}

export function portionFor(ctx: Context, project: Project, memberId: string): PortionView | undefined {
  const row = getPortionRow(ctx, project.id, memberId);
  if (!row) return undefined;
  const portion = portionOf(row);
  const pool = poolOf(project);
  const first = ctx.sql.get<{ amount: number; pool_after: number }>(
    "SELECT amount, pool_after FROM ledger WHERE project_id = ? AND member_id = ? AND kind = 'put_in' ORDER BY id LIMIT 1",
    project.id,
    memberId,
  );
  return {
    value: portionValue(pool, portion),
    putIn: BigInt(row.put_in),
    takenBack: BigInt(row.taken_back),
    returned: BigInt(row.returned),
    fraction: portionFraction(pool, portion),
    firstFraction: first && first.pool_after > 0 ? first.amount / first.pool_after : null,
    showName: row.show_name === 1,
    joinedAt: row.joined_at,
  };
}

export interface MemberPortion {
  readonly project: Project;
  readonly portion: PortionView;
}

export function memberPortions(ctx: Context, memberId: string): MemberPortion[] {
  const projects = queryProjects(
    ctx,
    `SELECT p.* FROM portions o JOIN projects p ON p.id = o.project_id
      WHERE o.member_id = ? ORDER BY o.joined_at DESC`,
    memberId,
  );
  return projects.flatMap((project) => {
    const portion = portionFor(ctx, project, memberId);
    return portion ? [{ project, portion }] : [];
  });
}

export interface PublicLedgerEntry {
  readonly at: string;
  readonly kind: 'put_in' | 'take_back' | 'use' | 'cost_share' | 'return';
  readonly amount: number;
  readonly poolAfter: number | null;
  /** What a use was for. Empty for everything else, which stays anonymous. */
  readonly note: string;
  /** Who recorded a use. Null for everything else. */
  readonly by: string | null;
}

/**
 * A pool's public record. Every movement is listed so anyone can check the
 * books, but nobody's contributions are tied to their name.
 */
export function poolLedger(ctx: Context, projectId: string, limit = 200): PublicLedgerEntry[] {
  return ctx.sql
    .all<{ at: string; kind: PublicLedgerEntry['kind']; amount: number; pool_after: number | null; note: string; by_name: string | null }>(
      `SELECT l.at, l.kind, l.amount, l.pool_after, l.note, m.name AS by_name
         FROM ledger l LEFT JOIN members m ON m.id = l.member_id AND l.kind = 'use'
        WHERE l.project_id = ? ORDER BY l.id DESC LIMIT ?`,
      projectId,
      limit,
    )
    .map((row) => ({
      // The day is enough to follow the books, and a precise time would help
      // someone match a contribution to a name.
      at: row.at.slice(0, 10),
      kind: row.kind,
      amount: row.amount,
      poolAfter: row.pool_after,
      note: row.kind === 'use' ? row.note : '',
      by: row.kind === 'use' ? row.by_name : null,
    }));
}

/** Notes people left when taking their portion back, without their names. For hosts. */
export function takeBackNotes(ctx: Context, projectId: string): Array<{ at: string; note: string }> {
  return ctx.sql.all(
    "SELECT at, note FROM ledger WHERE project_id = ? AND kind = 'take_back' AND note != '' ORDER BY id DESC LIMIT 100",
    projectId,
  );
}

export interface PoolPeople {
  readonly named: Array<{ handle: string; name: string }>;
  readonly total: number;
}

/**
 * Who is in a pool now. People who asked not to be named are only counted.
 * Names are listed alphabetically: listing them in the order people joined
 * would let anyone match names to the amounts in the pool's record.
 */
export function poolPeople(ctx: Context, project: Project): PoolPeople {
  const named = ctx.sql.all<{ handle: string; name: string }>(
    `SELECT m.handle, m.name FROM portions o JOIN members m ON m.id = o.member_id
      WHERE o.project_id = ? AND o.weight != '0' AND o.show_name = 1
      ORDER BY m.name COLLATE NOCASE, m.handle LIMIT 60`,
    project.id,
  );
  return { named, total: project.people };
}
