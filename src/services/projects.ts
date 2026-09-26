import { type Concern, type Spirit, isSpirit, screen } from '../core/charter.js';
import { newId } from '../core/crypto.js';
import { toStored } from '../core/money.js';
import { type Reading, wantsALook } from '../core/reader.js';
import { type Context, Problem, cleanLine, cleanText, nowIso } from './context.js';
import { isGroupMember } from './groups.js';
import { settlePool } from './pools.js';
import {
  type Project,
  type ProjectStatus,
  queryProjects,
  requireHost,
  requireProject,
  saveReaderNote,
} from './records.js';
import { openReview, withdrawReviews } from './reviews.js';

export interface ProposalInput {
  readonly title: string;
  readonly summary: string;
  readonly story: string;
  readonly plans: string;
  readonly spirits: readonly string[];
  /** A rough idea of what the project needs, if the proposer wants to give one. */
  readonly hope: bigint | null;
  /** Suggest it as this group rather than as yourself. */
  readonly groupId: string | null;
  /** Why the project fits the charter, when the automatic check found something. */
  readonly concernNote: string;
  readonly agreed: boolean;
}

export type ProposalResult =
  | {
      readonly kind: 'concerns';
      /** What the word check found. */
      readonly concerns: readonly Concern[];
      /** What the charter reader made of it, if it read it. */
      readonly reading: Reading | null;
    }
  | { readonly kind: 'created'; readonly project: Project };

/** A proposal tidied up and checked, ready to be read and saved. */
export interface CleanProposal {
  readonly title: string;
  readonly summary: string;
  readonly story: string;
  readonly plans: string;
  readonly spirits: readonly Spirit[];
  readonly note: string;
}

// A prime just below 2^31: multiplying by a daily number modulo it reshuffles every day.
const SHUFFLE_PRIME = 2_147_483_647;

/** Tidies a proposal and checks everything a person can fix, before anything else happens to it. */
export function cleanProposal(input: ProposalInput): CleanProposal {
  const title = cleanLine(input.title, { label: 'A title', field: 'title', min: 3, max: 100 });
  const summary = cleanLine(input.summary, { label: 'A one-line summary', field: 'summary', min: 10, max: 200 });
  const story = cleanText(input.story, { label: 'The story', field: 'story', min: 50, max: 10_000 });
  const plans = cleanText(input.plans, { label: 'What the pool is for', field: 'plans', min: 20, max: 5_000 });
  const spirits = [...new Set(input.spirits)].filter(isSpirit);
  if (spirits.length === 0) throw new Problem('Choose at least one of creativity, adventure or joy.', 400, 'spirits');
  if (input.hope !== null && input.hope <= 0n) throw new Problem('What you hope to pool must be more than zero.', 400, 'hope');
  if (!input.agreed) throw new Problem('Please confirm that your project fits the charter.', 400, 'agreed');
  const note = cleanText(input.concernNote, { label: 'Your explanation', field: 'concernNote', min: 0, max: 2_000 });
  return { title, summary, story, plans, spirits, note };
}

/**
 * Suggests a new project. If neither the word check nor the charter reader
 * finds anything, the pool opens straight away. If either does, the proposer
 * is asked to explain, and with an explanation the project waits for a
 * charter circle. `reading` is what the charter reader made of this exact
 * proposal, or null if it did not read it.
 */
export function proposeProject(
  ctx: Context,
  memberId: string,
  input: ProposalInput,
  reading: Reading | null = null,
): ProposalResult {
  const { title, summary, story, plans, spirits, note } = cleanProposal(input);

  const concerns = screen({ title, summary, story, plans });
  const needsLook = concerns.length > 0 || wantsALook(reading);
  if (needsLook && [...note].length < 20) return { kind: 'concerns', concerns, reading };

  return ctx.sql.transaction(() => {
    if (input.groupId && !isGroupMember(ctx, input.groupId, memberId)) {
      throw new Problem('You can only suggest projects for groups you are in.', 403, 'groupId');
    }
    const id = newId();
    const now = nowIso(ctx);
    const status: ProjectStatus = needsLook ? 'awaiting' : 'open';
    ctx.sql.run(
      `INSERT INTO projects (id, title, summary, story, plans, spirits, hope, proposer_id, group_id, status,
                             concerns, concern_note, shuffle_key, created_at, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      summary,
      story,
      plans,
      spirits.join(' '),
      input.hope === null ? null : toStored(input.hope),
      memberId,
      input.groupId,
      status,
      JSON.stringify(concerns),
      needsLook ? note : '',
      1 + ctx.randomInt(SHUFFLE_PRIME - 1),
      now,
      status === 'open' ? now : null,
    );
    if (reading) saveReaderNote(ctx, id, 'proposal', null, reading);
    const project = requireProject(ctx, id);
    if (status === 'awaiting') openReview(ctx, project, 'proposal');
    return { kind: 'created', project };
  });
}

export type ListOrder = 'shuffled' | 'newest' | 'people';
export type ListShow = 'live' | 'finished';

export interface ListOptions {
  readonly spirit?: Spirit | undefined;
  readonly order?: ListOrder;
  readonly show?: ListShow;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Lists projects. The default order is a shuffle that changes every day, so
 * every project takes its turn near the top. There is deliberately no way to
 * sort by how much a pool holds.
 */
export function listProjects(ctx: Context, options: ListOptions = {}): { projects: Project[]; more: boolean } {
  const pageSize = options.pageSize ?? 24;
  const page = Math.max(0, options.page ?? 0);
  const where =
    options.show === 'finished' ? ["status IN ('completed', 'stopped')"] : ["status IN ('open', 'review', 'awaiting')"];
  const params: (string | number)[] = [];
  if (options.spirit) {
    where.push("(' ' || spirits || ' ') LIKE ?");
    params.push(`% ${options.spirit} %`);
  }

  let orderBy: string;
  switch (options.order ?? 'shuffled') {
    case 'newest':
      orderBy = options.show === 'finished' ? 'finished_at DESC' : 'created_at DESC';
      break;
    case 'people':
      orderBy = 'people DESC, created_at DESC';
      break;
    default: {
      const day = Math.floor(ctx.now().getTime() / 86_400_000);
      const multiplier = 1 + ((day * 48_271) % (SHUFFLE_PRIME - 1));
      orderBy = `(shuffle_key * ${multiplier}) % ${SHUFFLE_PRIME}, id`;
    }
  }

  const rows = queryProjects(
    ctx,
    `SELECT * FROM projects WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params,
    pageSize + 1,
    page * pageSize,
  );
  return { projects: rows.slice(0, pageSize), more: rows.length > pageSize };
}

/** Projects someone hosts, on their own or through a group. */
export function projectsHostedBy(ctx: Context, memberId: string): Project[] {
  return queryProjects(
    ctx,
    `SELECT * FROM projects
      WHERE (group_id IS NULL AND proposer_id = ?)
         OR group_id IN (SELECT group_id FROM group_members WHERE member_id = ?)
      ORDER BY created_at DESC`,
    memberId,
    memberId,
  );
}

export function projectsOfGroup(ctx: Context, groupId: string): Project[] {
  return queryProjects(ctx, 'SELECT * FROM projects WHERE group_id = ? ORDER BY created_at DESC', groupId);
}

export interface Update {
  readonly id: string;
  readonly body: string;
  readonly created_at: string;
  readonly author_name: string;
  readonly author_handle: string;
}

export function cleanNews(body: string): string {
  return cleanText(body, { label: 'The update', field: 'body', min: 2, max: 5_000 });
}

/** Checks that someone may share news on a project. */
export function checkCanPostUpdate(ctx: Context, project: Project, memberId: string): void {
  requireHost(ctx, project, memberId);
  if (project.status === 'closed' || project.status === 'declined') {
    throw new Problem('This project was closed by a charter circle.', 409);
  }
}

/** Hosts keep everyone in the pool up to date on where the project is heading. Returns the news's id. */
export function postUpdate(ctx: Context, projectId: string, memberId: string, body: string): string {
  const text = cleanNews(body);
  return ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    checkCanPostUpdate(ctx, project, memberId);
    const id = newId();
    ctx.sql.run(
      'INSERT INTO updates (id, project_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      projectId,
      memberId,
      text,
      nowIso(ctx),
    );
    return id;
  });
}

export function projectUpdates(ctx: Context, projectId: string): Update[] {
  return ctx.sql.all<Update>(
    `SELECT u.id, u.body, u.created_at, m.name AS author_name, m.handle AS author_handle
       FROM updates u JOIN members m ON m.id = u.author_id
      WHERE u.project_id = ? ORDER BY u.created_at DESC`,
    projectId,
  );
}

/**
 * Hosts finish a project: either it happened, or it is not going ahead.
 * Whatever is left in the pool goes back to the people in it.
 */
export function finishProject(
  ctx: Context,
  projectId: string,
  memberId: string,
  outcome: string,
  note: string,
): void {
  if (outcome !== 'completed' && outcome !== 'stopped') throw new Problem('Choose how the project ended.', 400, 'outcome');
  const closing = cleanText(note, { label: 'A closing note', field: 'note', min: 10, max: 3_000 });

  ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    requireHost(ctx, project, memberId);
    if (!['awaiting', 'open', 'review'].includes(project.status)) {
      throw new Problem('This project has already finished.', 409);
    }
    if (outcome === 'completed' && project.status !== 'open') {
      throw new Problem('Only a project with an open pool can be marked as completed.', 409);
    }
    withdrawReviews(ctx, projectId);
    settlePool(
      ctx,
      project,
      outcome === 'completed'
        ? 'The project is complete, and what was left in the pool came back.'
        : 'The project stopped, and what was left in the pool came back.',
    );
    ctx.sql.run(
      'UPDATE projects SET status = ?, closing_note = ?, finished_at = ? WHERE id = ?',
      outcome,
      closing,
      nowIso(ctx),
      projectId,
    );
  });
}
