/**
 * Where the charter reader meets the rest of Expleate.
 *
 * Reading takes a few seconds, so it always happens before the synchronous
 * work that saves anything: read first, then check and write in one
 * transaction. The reader never blocks anything on its own. Before a project
 * opens, its concerns send the project to a circle once the proposer has
 * explained. After a project opens, its concerns about news or a use count as
 * one flag.
 */
import { formatAmount } from '../core/money.js';
import { type Reading, type ReaderSubject, wantsALook } from '../core/reader.js';
import { type Context, Problem } from './context.js';
import { isGroupMember } from './groups.js';
import { checkCanUse, cleanUseDescription, useResources } from './pools.js';
import {
  type ProposalInput,
  type ProposalResult,
  checkCanPostUpdate,
  cleanNews,
  cleanProposal,
  postUpdate,
  proposeProject,
} from './projects.js';
import {
  READER_ID,
  type Project,
  type ReaderSubjectKind,
  proposalWasRead,
  queryProjects,
  requireProject,
  saveReaderNote,
} from './records.js';
import { type FlagResult, readerFlag } from './reviews.js';

/** How long reader_usage keeps its daily counts. */
const USAGE_DAYS = 30;

type Turn = 'granted' | 'person-limit' | 'daily-limit';

/**
 * Takes one of today's readings for something a person wrote. There is a
 * limit for each person and one for everyone together, which caps what the
 * reader costs. The reader's own catch-up reading counts only towards the
 * limit for everyone.
 */
function takeReading(ctx: Context, memberId: string): Turn {
  const now = ctx.now();
  const day = now.toISOString().slice(0, 10);
  return ctx.sql.transaction(() => {
    const oldest = new Date(now.getTime() - USAGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    ctx.sql.run('DELETE FROM reader_usage WHERE day < ?', oldest);
    const everyone = ctx.sql.get<{ n: number | null }>('SELECT SUM(reads) AS n FROM reader_usage WHERE day = ?', day);
    if ((everyone?.n ?? 0) >= ctx.config.readerDailyReads) return 'daily-limit';
    if (memberId !== READER_ID) {
      const mine = ctx.sql.get<{ reads: number }>(
        'SELECT reads FROM reader_usage WHERE day = ? AND member_id = ?',
        day,
        memberId,
      );
      if ((mine?.reads ?? 0) >= ctx.config.readerReadsPerPerson) return 'person-limit';
    }
    ctx.sql.run(
      `INSERT INTO reader_usage (day, member_id, reads) VALUES (?, ?, 1)
       ON CONFLICT (day, member_id) DO UPDATE SET reads = reads + 1`,
      day,
      memberId,
    );
    return 'granted';
  });
}

/** Asks the reader to read something, if it is switched on and today's limits allow. */
async function readIfWeCan(ctx: Context, memberId: string, subject: ReaderSubject): Promise<Reading | null> {
  if (!ctx.reader || takeReading(ctx, memberId) !== 'granted') return null;
  return ctx.reader.read(subject);
}

function about(project: Project): { title: string; summary: string } {
  return { title: project.title, summary: project.summary };
}

/**
 * Keeps what the reader made of something, and flags the project when the
 * reader wants a second look. Returns the flag, if there was one. Call inside
 * a transaction.
 */
function afterReading(
  ctx: Context,
  projectId: string,
  subject: ReaderSubjectKind,
  subjectId: string | null,
  reading: Reading,
  what: string,
): FlagResult | null {
  saveReaderNote(ctx, projectId, subject, subjectId, reading);
  const first = reading.concerns[0];
  if (!wantsALook(reading) || !first) return null;
  return readerFlag(ctx, requireProject(ctx, projectId), first.rule, `The charter reader read ${what} and noted: ${reading.summary}`);
}

/**
 * Suggests a project, with the charter reader reading it first. Someone who
 * has used up their readings for the day is asked to come back tomorrow, so
 * nobody can wear the reader out to slip a proposal past it. When everyone's
 * readings are used up, the word check runs alone and the reader catches up
 * later.
 */
export async function suggestProject(ctx: Context, memberId: string, input: ProposalInput): Promise<ProposalResult> {
  const clean = cleanProposal(input);
  if (input.groupId && !isGroupMember(ctx, input.groupId, memberId)) {
    throw new Problem('You can only suggest projects for groups you are in.', 403, 'groupId');
  }
  let reading: Reading | null = null;
  if (ctx.reader) {
    const turn = takeReading(ctx, memberId);
    if (turn === 'person-limit') {
      throw new Problem('You have sent a lot of suggestions today. Please try again tomorrow.', 400);
    }
    if (turn === 'granted') {
      reading = await ctx.reader.read({
        kind: 'proposal',
        title: clean.title,
        summary: clean.summary,
        story: clean.story,
        plans: clean.plans,
      });
    }
  }
  return proposeProject(ctx, memberId, input, reading);
}

export interface ReadResult {
  /** The charter reader's flag, if it flagged the project. */
  readonly flagged: FlagResult | null;
}

/** Hosts share news, and the charter reader reads it. */
export async function shareNews(ctx: Context, projectId: string, memberId: string, body: string): Promise<ReadResult> {
  const text = cleanNews(body);
  const project = requireProject(ctx, projectId);
  checkCanPostUpdate(ctx, project, memberId);
  const reading = await readIfWeCan(ctx, memberId, { kind: 'news', project: about(project), text });
  return ctx.sql.transaction(() => {
    const id = postUpdate(ctx, projectId, memberId, text);
    return { flagged: reading ? afterReading(ctx, projectId, 'news', id, reading, 'news the hosts shared') : null };
  });
}

/** Hosts record a use of the pool, and the charter reader reads what it was for. */
export async function recordUse(
  ctx: Context,
  projectId: string,
  memberId: string,
  amount: bigint,
  description: string,
): Promise<ReadResult> {
  const what = cleanUseDescription(description);
  const project = requireProject(ctx, projectId);
  checkCanUse(ctx, project, memberId, amount);
  const reading = await readIfWeCan(ctx, memberId, {
    kind: 'use',
    project: about(project),
    amount: formatAmount(amount, ctx.config.currency),
    description: what,
  });
  return ctx.sql.transaction(() => {
    const entry = useResources(ctx, projectId, memberId, amount, what);
    return { flagged: reading ? afterReading(ctx, projectId, 'use', entry, reading, 'a use of the pool') : null };
  });
}

/**
 * Reads open projects the reader has not read yet: ones suggested while it
 * was unavailable or out of readings, or before it was switched on. Stops at
 * the first reading that fails, to try again next time. Returns how many it
 * read.
 */
export async function readUnreadProjects(ctx: Context, limit = 10): Promise<number> {
  if (!ctx.reader) return 0;
  const unread = queryProjects(
    ctx,
    `SELECT * FROM projects p
      WHERE p.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM reader_notes n WHERE n.project_id = p.id AND n.subject = 'proposal')
      ORDER BY p.created_at, p.id LIMIT ?`,
    limit,
  );
  let read = 0;
  for (const project of unread) {
    const reading = await readIfWeCan(ctx, READER_ID, {
      kind: 'proposal',
      title: project.title,
      summary: project.summary,
      story: project.story,
      plans: project.plans,
    });
    if (!reading) break;
    ctx.sql.transaction(() => {
      if (!proposalWasRead(ctx, project.id)) afterReading(ctx, project.id, 'proposal', null, reading, 'this project');
    });
    read += 1;
  }
  return read;
}
