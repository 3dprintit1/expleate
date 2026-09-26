/**
 * Running costs, kept in the open. Caretakers record every bill with its
 * receipt, and any gifts that cover bills (the founder covers the first $200).
 * Whatever is left is shared across all live pools at exactly what it cost.
 */
import { monthlyCaps, outstanding, planShare } from '../core/costs.js';
import { newId } from '../core/crypto.js';
import { toStored } from '../core/money.js';
import { type Context, Problem, cleanLine, cleanText, nowIso } from './context.js';
import { applyUse } from './pools.js';
import { type Member, queryProjects, requireMember } from './records.js';

export function isCaretaker(ctx: Context, member: Member | undefined): boolean {
  return Boolean(member && ctx.config.caretakers.has(member.handle));
}

function requireCaretaker(ctx: Context, memberId: string): void {
  if (!isCaretaker(ctx, requireMember(ctx, memberId))) {
    throw new Problem('Only caretakers can record running costs.', 403);
  }
}

function checkDate(value: string, today: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Problem('Enter the date as year-month-day, such as 2026-10-01.', 400, 'incurredOn');
  }
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Problem('That date does not exist.', 400, 'incurredOn');
  }
  if (date > today) throw new Problem('Costs are recorded once they have been paid, so the date cannot be in the future.', 400, 'incurredOn');
  return date;
}

function checkReceipt(value: string): string {
  const link = value.trim();
  if (link === '') return '';
  if (link.length > 500 || !/^https:\/\/[^\s<>"]+$/.test(link)) {
    throw new Problem('Receipt links must be a web address starting with https://', 400, 'receiptUrl');
  }
  return link;
}

export interface CostInput {
  readonly incurredOn: string;
  readonly description: string;
  readonly amount: bigint;
  readonly receiptUrl: string;
}

export function recordCost(ctx: Context, memberId: string, input: CostInput): void {
  requireCaretaker(ctx, memberId);
  const today = nowIso(ctx).slice(0, 10);
  const incurredOn = checkDate(input.incurredOn, today);
  const description = cleanLine(input.description, { label: 'What the cost was for', field: 'description', min: 3, max: 200 });
  const receiptUrl = checkReceipt(input.receiptUrl);
  if (input.amount <= 0n) throw new Problem('The amount must be more than zero.', 400, 'amount');
  ctx.sql.run(
    'INSERT INTO costs (id, incurred_on, description, amount, receipt_url, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    incurredOn,
    description,
    toStored(input.amount),
    receiptUrl,
    memberId,
    nowIso(ctx),
  );
}

export interface CoverInput {
  readonly givenBy: string;
  readonly amount: bigint;
  readonly note: string;
}

/** Records someone paying running costs themselves, so the pools need not. */
export function recordCover(ctx: Context, memberId: string, input: CoverInput): void {
  requireCaretaker(ctx, memberId);
  const givenBy = cleanLine(input.givenBy, { label: 'Who is covering it', field: 'givenBy', min: 2, max: 80 });
  const note = cleanText(input.note, { label: 'The note', field: 'note', min: 0, max: 500 });
  if (input.amount <= 0n) throw new Problem('The amount must be more than zero.', 400, 'amount');
  ctx.sql.run(
    'INSERT INTO covers (id, given_by, amount, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    givenBy,
    toStored(input.amount),
    note,
    memberId,
    nowIso(ctx),
  );
}

export interface CostRow {
  readonly id: string;
  readonly incurred_on: string;
  readonly description: string;
  readonly amount: number;
  readonly receipt_url: string;
  readonly recorded_by_name: string;
}

export interface CoverRow {
  readonly id: string;
  readonly given_by: string;
  readonly amount: number;
  readonly note: string;
  readonly recorded_at: string;
}

export interface ShareRow {
  readonly id: string;
  readonly at: string;
  readonly amount: number;
  readonly pooled: number;
  readonly pools: number;
}

export interface CostsOverview {
  readonly totals: { costs: bigint; covered: bigint; shared: bigint; outstanding: bigint };
  /** Everything in live pools right now. */
  readonly pooled: bigint;
  readonly costs: readonly CostRow[];
  readonly covers: readonly CoverRow[];
  readonly shares: readonly ShareRow[];
  readonly caretakers: ReadonlyArray<{ handle: string; name: string }>;
}

function sum(ctx: Context, sql: string): bigint {
  return BigInt(ctx.sql.get<{ total: number | null }>(sql)?.total ?? 0);
}

function totals(ctx: Context): { costs: bigint; covered: bigint; shared: bigint } {
  return {
    costs: sum(ctx, 'SELECT SUM(amount) AS total FROM costs'),
    covered: sum(ctx, 'SELECT SUM(amount) AS total FROM covers'),
    shared: sum(ctx, 'SELECT SUM(amount) AS total FROM cost_shares'),
  };
}

function pooledNow(ctx: Context): bigint {
  return sum(ctx, "SELECT SUM(pool_balance) AS total FROM projects WHERE status IN ('open', 'review')");
}

export function costsOverview(ctx: Context): CostsOverview {
  const t = totals(ctx);
  const handles = [...ctx.config.caretakers];
  const caretakers = handles.length
    ? ctx.sql.all<{ handle: string; name: string }>(
        `SELECT handle, name FROM members WHERE kind = 'person' AND handle IN (${handles.map(() => '?').join(', ')}) ORDER BY name`,
        ...handles,
      )
    : [];
  return {
    totals: { ...t, outstanding: outstanding(t) },
    pooled: pooledNow(ctx),
    costs: ctx.sql.all<CostRow>(
      `SELECT c.id, c.incurred_on, c.description, c.amount, c.receipt_url, m.name AS recorded_by_name
         FROM costs c JOIN members m ON m.id = c.recorded_by ORDER BY c.incurred_on DESC, c.recorded_at DESC`,
    ),
    covers: ctx.sql.all<CoverRow>('SELECT id, given_by, amount, note, recorded_at FROM covers ORDER BY recorded_at'),
    shares: ctx.sql.all<ShareRow>('SELECT * FROM cost_shares ORDER BY at DESC'),
    caretakers,
  };
}

export interface ShareResult {
  readonly amount: bigint;
  readonly pools: number;
  readonly pooled: bigint;
}

/**
 * Shares whatever running costs are outstanding across every live pool, in
 * proportion to what each holds. In any calendar month no pool gives more than
 * the configured share of what it holds, however often this runs, so a second
 * click or a repeated scheduled run cannot take more. Runs on the first of
 * each month on Cloudflare, and caretakers can also run it by hand.
 */
export function shareRunningCosts(ctx: Context): ShareResult | null {
  return ctx.sql.transaction(() => {
    const owed = outstanding(totals(ctx));
    const live = queryProjects(
      ctx,
      "SELECT * FROM projects WHERE status IN ('open', 'review') AND pool_balance > 0 ORDER BY id",
    );
    const monthStart = `${nowIso(ctx).slice(0, 7)}-01T00:00:00.000Z`;
    const given = new Map(
      ctx.sql
        .all<{ project_id: string; total: number }>(
          "SELECT project_id, SUM(amount) AS total FROM ledger WHERE kind = 'cost_share' AND at >= ? GROUP BY project_id",
          monthStart,
        )
        .map((row) => [row.project_id, BigInt(row.total)]),
    );
    const balances = live.map((project) => BigInt(project.pool_balance));
    const caps = monthlyCaps(
      balances,
      live.map((project) => given.get(project.id) ?? 0n),
      ctx.config.maxCostSharePpm,
    );
    const parts = planShare(owed, caps);
    const amount = parts.reduce((sum, part) => sum + part, 0n);
    if (amount === 0n) return null;

    const pooled = balances.reduce((sum, balance) => sum + balance, 0n);
    const shareId = newId();
    let pools = 0;
    live.forEach((project, index) => {
      const part = parts[index] ?? 0n;
      if (part > 0n) {
        applyUse(ctx, project, part, 'cost_share', shareId, null);
        pools += 1;
      }
    });
    ctx.sql.run(
      'INSERT INTO cost_shares (id, at, amount, pooled, pools) VALUES (?, ?, ?, ?, ?)',
      shareId,
      nowIso(ctx),
      toStored(amount),
      toStored(pooled),
      pools,
    );
    return { amount, pools, pooled };
  });
}
