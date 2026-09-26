import { type Concern, type Spirit, isSpirit, screen } from '../core/charter.js';
import { newId } from '../core/crypto.js';
import { toStored } from '../core/money.js';
import { type Context, Problem, cleanLine, cleanText, nowIso } from './context.js';
import { isGroupMember } from './groups.js';
import { settlePool } from './pools.js';
import { type Project, type ProjectStatus, queryProjects, requireProject, requireSteward } from './records.js';
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
  | { readonly kind: 'concerns'; readonly concerns: readonly Concern[] }
  | { readonly kind: 'created'; readonly project: Project };

// A prime just below 2^31: multiplying by a daily number modulo it reshuffles every day.
const SHUFFLE_PRIME = 2_147_483_647;

/**
 * Suggests a new project. If the charter check finds nothing, the pool opens
 * straight away. If it finds something, the proposer is asked to explain, and
 * with an explanation the project waits for a charter circle.
 */
export function proposeProject(ctx: Context, memberId: string, input: ProposalInput): ProposalResult {
  const title = cleanLine(input.title, { label: 'A title', field: 'title', min: 3, max: 100 });
  const summary = cleanLine(input.summary, { label: 'A one-line summary', field: 'summary', min: 10, max: 200 });
  const story = cleanText(input.story, { label: 'The story', field: 'story', min: 50, max: 10_000 });
  const plans = cleanText(input.plans, { label: 'What the pool is for', field: 'plans', min: 20, max: 5_000 });
  const spirits = [...new Set(input.spirits)].filter(isSpirit) as Spirit[];
  if (spirits.length === 0) throw new Problem('Choose at least one of creativity, adventure or joy.', 400, 'spirits');
  if (input.hope !== null && input.hope <= 0n) throw new Problem('What you hope to pool must be more than zero.', 400, 'hope');
  if (!input.agreed) throw new Problem('Please confirm that your project fits the charter.', 400, 'agreed');
  const note = cleanText(input.concernNote, { label: 'Your explanation', field: 'concernNote', min: 0, max: 2_000 });

  const concerns = screen({ title, summary, story, plans });
  if (concerns.length > 0 && [...note].length < 20) return { kind: 'concerns', concerns };

  return ctx.sql.transaction(() => {
    if (input.groupId && !isGroupMember(ctx, input.groupId, memberId)) {
      throw new Problem('You can only suggest projects for groups you are in.', 403, 'groupId');
    }
    const id = newId();
    const now = nowIso(ctx);
    const status: ProjectStatus = concerns.length > 0 ? 'awaiting' : 'open';
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
      concerns.length > 0 ? note : '',
      1 + ctx.randomInt(SHUFFLE_PRIME - 1),
      now,
      status === 'open' ? now : null,
    );
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

/** Projects someone looks after, on their own or through a group. */
export function projectsStewardedBy(ctx: Context, memberId: string): Project[] {
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

/** Stewards keep everyone in the pool up to date on where the project is heading. */
export function postUpdate(ctx: Context, projectId: string, memberId: string, body: string): void {
  const text = cleanText(body, { label: 'The update', field: 'body', min: 2, max: 5_000 });
  ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    requireSteward(ctx, project, memberId);
    if (project.status === 'closed' || project.status === 'declined') {
      throw new Problem('This project was closed by a charter circle.', 409);
    }
    ctx.sql.run(
      'INSERT INTO updates (id, project_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      projectId,
      memberId,
      text,
      nowIso(ctx),
    );
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
 * Stewards finish a project: either it happened, or it is not going ahead.
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
    requireSteward(ctx, project, memberId);
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
