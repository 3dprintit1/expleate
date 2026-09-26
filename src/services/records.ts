/**
 * Reading and writing the records every service shares: members, projects,
 * pools, portions and the ledger. Keeping them here means the services can
 * use each other without circular imports.
 */
import type { Concern, Spirit } from '../core/charter.js';
import { newId } from '../core/crypto.js';
import type { Pool, Portion } from '../core/pool.js';
import { toStored } from '../core/money.js';
import type { ReaderConcern, ReaderVerdict, Reading } from '../core/reader.js';
import { type Context, Problem, nowIso } from './context.js';

/** The charter reader's own member record, which holds its flags. */
export const READER_ID = 'charter-reader';

export interface Member {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly balance: number;
  readonly created_at: string;
}

const MEMBER_COLUMNS = 'id, handle, name, balance, created_at';

export function getMember(ctx: Context, id: string): Member | undefined {
  return ctx.sql.get<Member>(`SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ?`, id);
}

export function requireMember(ctx: Context, id: string): Member {
  const member = getMember(ctx, id);
  if (!member) throw new Problem('We could not find that person.', 404);
  return member;
}

/** Finds a person by their handle. The charter reader is not a person, so it is never found this way. */
export function getMemberByHandle(ctx: Context, handle: string): Member | undefined {
  return ctx.sql.get<Member>(
    `SELECT ${MEMBER_COLUMNS} FROM members WHERE handle = ? AND kind = 'person'`,
    handle.trim().replace(/^@/, '').toLowerCase(),
  );
}

/**
 * When a member can first flag projects and be drawn for a circle. Waiting a
 * little stops anyone opening accounts just to pause a project or fill a
 * circle.
 */
export function standingFrom(ctx: Context, member: Pick<Member, 'created_at'>): Date {
  return new Date(new Date(member.created_at).getTime() + ctx.config.standingDays * 86_400_000);
}

export function hasStanding(ctx: Context, member: Pick<Member, 'created_at'>): boolean {
  return standingFrom(ctx, member) <= ctx.now();
}

export type ProjectStatus = 'awaiting' | 'open' | 'review' | 'completed' | 'stopped' | 'closed' | 'declined';

/** Statuses in which a project still holds a live pool. */
export const LIVE_STATUSES: readonly ProjectStatus[] = ['open', 'review'];

interface ProjectRow {
  id: string;
  title: string;
  summary: string;
  story: string;
  plans: string;
  spirits: string;
  hope: number | null;
  proposer_id: string;
  group_id: string | null;
  status: ProjectStatus;
  concerns: string;
  concern_note: string;
  closing_note: string;
  shuffle_key: number;
  created_at: string;
  opened_at: string | null;
  finished_at: string | null;
  pool_balance: number;
  pool_weight: string;
  pool_put_in: number;
  pool_taken_back: number;
  pool_used: number;
  pool_costs: number;
  pool_returned: number;
  people: number;
}

export interface Project extends Omit<ProjectRow, 'spirits' | 'concerns'> {
  readonly spirits: readonly Spirit[];
  readonly concerns: readonly Concern[];
}

function toProject(row: ProjectRow): Project {
  return {
    ...row,
    spirits: row.spirits.split(' ').filter(Boolean) as Spirit[],
    concerns: JSON.parse(row.concerns) as Concern[],
  };
}

export function getProject(ctx: Context, id: string): Project | undefined {
  const row = ctx.sql.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
  return row ? toProject(row) : undefined;
}

export function requireProject(ctx: Context, id: string): Project {
  const project = getProject(ctx, id);
  if (!project) throw new Problem('We could not find that project.', 404);
  return project;
}

export function queryProjects(ctx: Context, sql: string, ...params: (string | number)[]): Project[] {
  return ctx.sql.all<ProjectRow>(sql, ...params).map(toProject);
}

/**
 * The people who host a project: whoever suggested it, or every member
 * of the group that suggested it.
 */
export function hostIds(ctx: Context, project: Project): string[] {
  if (!project.group_id) return [project.proposer_id];
  return ctx.sql
    .all<{ member_id: string }>('SELECT member_id FROM group_members WHERE group_id = ?', project.group_id)
    .map((row) => row.member_id);
}

export function isHost(ctx: Context, project: Project, memberId: string): boolean {
  return hostIds(ctx, project).includes(memberId);
}

export function requireHost(ctx: Context, project: Project, memberId: string): void {
  if (!isHost(ctx, project, memberId)) {
    throw new Problem("Only the project's hosts can do that.", 403);
  }
}

export function poolOf(project: Project): Pool {
  return { balance: BigInt(project.pool_balance), weight: BigInt(project.pool_weight) };
}

export interface PoolTotals {
  readonly putIn?: bigint;
  readonly takenBack?: bigint;
  readonly used?: bigint;
  readonly costs?: bigint;
  readonly returned?: bigint;
}

/** Saves a pool's new state, adds to its running totals and recounts its people. */
export function savePool(ctx: Context, projectId: string, pool: Pool, totals: PoolTotals): void {
  ctx.sql.run(
    `UPDATE projects SET
       pool_balance = ?, pool_weight = ?,
       pool_put_in = pool_put_in + ?, pool_taken_back = pool_taken_back + ?,
       pool_used = pool_used + ?, pool_costs = pool_costs + ?, pool_returned = pool_returned + ?,
       people = (SELECT COUNT(*) FROM portions WHERE project_id = ? AND weight != '0')
     WHERE id = ?`,
    toStored(pool.balance),
    pool.weight.toString(),
    toStored(totals.putIn ?? 0n),
    toStored(totals.takenBack ?? 0n),
    toStored(totals.used ?? 0n),
    toStored(totals.costs ?? 0n),
    toStored(totals.returned ?? 0n),
    projectId,
    projectId,
  );
}

export interface PortionRow {
  project_id: string;
  member_id: string;
  weight: string;
  cap: number;
  put_in: number;
  taken_back: number;
  returned: number;
  show_name: number;
  joined_at: string;
}

export function getPortionRow(ctx: Context, projectId: string, memberId: string): PortionRow | undefined {
  return ctx.sql.get<PortionRow>('SELECT * FROM portions WHERE project_id = ? AND member_id = ?', projectId, memberId);
}

export function portionOf(row: PortionRow | undefined): Portion {
  return row ? { weight: BigInt(row.weight), cap: BigInt(row.cap) } : { weight: 0n, cap: 0n };
}

export type LedgerKind = 'add' | 'move_out' | 'put_in' | 'take_back' | 'use' | 'cost_share' | 'return';

export interface LedgerEntry {
  readonly kind: LedgerKind;
  readonly amount: bigint;
  readonly memberId?: string | null;
  readonly projectId?: string | null;
  readonly poolAfter?: bigint | null;
  readonly note?: string;
}

/** Every movement of resources is written down, and nothing is ever rubbed out. */
export function record(ctx: Context, entry: LedgerEntry): void {
  ctx.sql.run(
    'INSERT INTO ledger (at, kind, member_id, project_id, amount, pool_after, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nowIso(ctx),
    entry.kind,
    entry.memberId ?? null,
    entry.projectId ?? null,
    toStored(entry.amount),
    entry.poolAfter === undefined || entry.poolAfter === null ? null : toStored(entry.poolAfter),
    entry.note ?? '',
  );
}

export function changeBalance(ctx: Context, memberId: string, delta: bigint): bigint {
  const member = requireMember(ctx, memberId);
  const next = BigInt(member.balance) + delta;
  if (next < 0n) throw new Problem('You do not have enough resources for that.', 400, 'amount');
  ctx.sql.run('UPDATE members SET balance = ? WHERE id = ?', toStored(next), memberId);
  return next;
}

export type ReaderSubjectKind = 'proposal' | 'news' | 'use';

export interface ReaderNote {
  readonly id: string;
  readonly project_id: string;
  readonly subject: ReaderSubjectKind;
  /** The news or the ledger entry the note is about. */
  readonly subject_id: string | null;
  readonly verdict: ReaderVerdict;
  readonly summary: string;
  readonly concerns: readonly ReaderConcern[];
  readonly model: string;
  readonly created_at: string;
}

/** Keeps what the charter reader made of something, including when it found nothing wrong. */
export function saveReaderNote(
  ctx: Context,
  projectId: string,
  subject: ReaderSubjectKind,
  subjectId: string | null,
  reading: Reading,
): void {
  ctx.sql.run(
    `INSERT INTO reader_notes (id, project_id, subject, subject_id, verdict, summary, concerns, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    projectId,
    subject,
    subjectId,
    reading.verdict,
    reading.summary,
    JSON.stringify(reading.concerns),
    reading.model,
    nowIso(ctx),
  );
}

/** What the charter reader noticed about a project, newest first. Notes that found nothing wrong are left out. */
export function readerConcerns(ctx: Context, projectId: string): ReaderNote[] {
  return ctx.sql
    .all<Omit<ReaderNote, 'concerns'> & { concerns: string }>(
      "SELECT * FROM reader_notes WHERE project_id = ? AND verdict != 'fits' ORDER BY created_at DESC, id",
      projectId,
    )
    .map((row) => ({ ...row, concerns: JSON.parse(row.concerns) as ReaderConcern[] }));
}

/** True once the charter reader has read what a project's proposer wrote. */
export function proposalWasRead(ctx: Context, projectId: string): boolean {
  return ctx.sql.get("SELECT 1 FROM reader_notes WHERE project_id = ? AND subject = 'proposal'", projectId) !== undefined;
}
