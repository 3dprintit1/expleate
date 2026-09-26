/**
 * Flags and charter circles. Anyone can flag a project they think breaks the
 * charter. Once enough different people have, the project's pool pauses and a
 * circle is drawn at random to decide. A circle also meets whenever a new
 * proposal trips the automatic charter check.
 */
import { type RuleId, isRuleId } from '../core/charter.js';
import { type Tally, type Verdict, decision, decisionAtDeadline, drawCircle, isVerdict } from '../core/circle.js';
import { newId } from '../core/crypto.js';
import { type Context, Problem, addDays, cleanText, nowIso } from './context.js';
import { settlePool } from './pools.js';
import { type Project, isSteward, queryProjects, requireProject, stewardIds } from './records.js';

export interface Review {
  readonly id: string;
  readonly project_id: string;
  readonly reason: 'proposal' | 'flags';
  readonly status: 'open' | 'decided' | 'withdrawn';
  readonly outcome: Verdict | null;
  readonly created_at: string;
  readonly deadline_at: string;
  readonly decided_at: string | null;
}

export function getReview(ctx: Context, id: string): Review | undefined {
  return ctx.sql.get<Review>('SELECT * FROM reviews WHERE id = ?', id);
}

function requireReview(ctx: Context, id: string): Review {
  const review = getReview(ctx, id);
  if (!review) throw new Problem('We could not find that charter circle.', 404);
  return review;
}

/**
 * Everyone who could sit in this circle: any member except the project's
 * stewards, people who have had a portion in its pool, people who flagged it,
 * and anyone already seated.
 */
function eligibleMembers(ctx: Context, reviewId: string, project: Project): string[] {
  const excluded = new Set(stewardIds(ctx, project));
  const add = (rows: Array<{ member_id: string }>) => rows.forEach((row) => excluded.add(row.member_id));
  add(ctx.sql.all('SELECT member_id FROM portions WHERE project_id = ?', project.id));
  add(ctx.sql.all('SELECT member_id FROM flags WHERE project_id = ? AND settled = 0', project.id));
  add(ctx.sql.all('SELECT member_id FROM seats WHERE review_id = ?', reviewId));
  return ctx.sql
    .all<{ id: string }>('SELECT id FROM members ORDER BY id')
    .map((row) => row.id)
    .filter((id) => !excluded.has(id));
}

function drawSeats(ctx: Context, reviewId: string, project: Project): number {
  const chosen = drawCircle(eligibleMembers(ctx, reviewId, project), ctx.config.circleSize, ctx.randomInt);
  for (const memberId of chosen) {
    ctx.sql.run('INSERT INTO seats (review_id, member_id) VALUES (?, ?)', reviewId, memberId);
  }
  return chosen.length;
}

/** Opens a review and draws its circle. Call inside a transaction. */
export function openReview(ctx: Context, project: Project, reason: Review['reason']): string {
  const id = newId();
  const now = ctx.now();
  ctx.sql.run(
    "INSERT INTO reviews (id, project_id, reason, status, created_at, deadline_at) VALUES (?, ?, ?, 'open', ?, ?)",
    id,
    project.id,
    reason,
    now.toISOString(),
    addDays(now, ctx.config.reviewDays).toISOString(),
  );
  drawSeats(ctx, id, project);
  return id;
}

/**
 * Circles that could not be drawn because nobody was eligible yet, such as on
 * a brand new site, are drawn as soon as there are people to draw from.
 */
export function drawWaitingCircles(ctx: Context): void {
  const waiting = ctx.sql.all<Review>(
    `SELECT r.* FROM reviews r
      WHERE r.status = 'open' AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.review_id = r.id)`,
  );
  for (const review of waiting) {
    ctx.sql.transaction(() => drawSeats(ctx, review.id, requireProject(ctx, review.project_id)));
  }
}

export interface FlagResult {
  /** True when this flag was the one that brought a circle together. */
  readonly circleDrawn: boolean;
}

export function flagProject(ctx: Context, projectId: string, memberId: string, rule: string, note: string): FlagResult {
  if (!isRuleId(rule)) throw new Problem('Choose which part of the charter you think it breaks.', 400, 'rule');
  const why = cleanText(note, { label: 'Your reason', field: 'note', min: 10, max: 1000 });

  return ctx.sql.transaction(() => {
    const project = requireProject(ctx, projectId);
    if (project.status === 'review' || project.status === 'awaiting') {
      throw new Problem('A charter circle is already looking at this project.', 409);
    }
    if (project.status !== 'open') throw new Problem('This project has finished.', 409);
    if (isSteward(ctx, project, memberId)) {
      throw new Problem('You look after this project, so you cannot flag it.', 403);
    }
    if (ctx.sql.get('SELECT 1 FROM flags WHERE project_id = ? AND member_id = ? AND settled = 0', projectId, memberId)) {
      throw new Problem('You have already flagged this project.', 409);
    }
    ctx.sql.run(
      'INSERT INTO flags (id, project_id, member_id, rule, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      projectId,
      memberId,
      rule,
      why,
      nowIso(ctx),
    );

    const flags = ctx.sql.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM flags WHERE project_id = ? AND settled = 0',
      projectId,
    );
    if ((flags?.n ?? 0) < ctx.config.flagThreshold) return { circleDrawn: false };

    ctx.sql.run("UPDATE projects SET status = 'review' WHERE id = ?", projectId);
    const reviewId = openReview(ctx, project, 'flags');
    ctx.sql.run('UPDATE flags SET review_id = ? WHERE project_id = ? AND settled = 0', reviewId, projectId);
    return { circleDrawn: true };
  });
}

export function tallyOf(ctx: Context, reviewId: string): Tally {
  const row = ctx.sql.get<{ seats: number; fits: number | null; breaks: number | null }>(
    `SELECT COUNT(*) AS seats,
            SUM(CASE WHEN vote = 'fits' THEN 1 ELSE 0 END) AS fits,
            SUM(CASE WHEN vote = 'breaks' THEN 1 ELSE 0 END) AS breaks
       FROM seats WHERE review_id = ?`,
    reviewId,
  );
  return { seats: row?.seats ?? 0, fits: row?.fits ?? 0, breaks: row?.breaks ?? 0 };
}

/** Carries out a circle's decision. Call inside a transaction. */
function decide(ctx: Context, review: Review, outcome: Verdict): void {
  const project = requireProject(ctx, review.project_id);
  const now = nowIso(ctx);
  ctx.sql.run("UPDATE reviews SET status = 'decided', outcome = ?, decided_at = ? WHERE id = ?", outcome, now, review.id);

  if (review.reason === 'proposal') {
    if (outcome === 'fits') {
      ctx.sql.run("UPDATE projects SET status = 'open', opened_at = ? WHERE id = ? AND status = 'awaiting'", now, project.id);
    } else {
      ctx.sql.run("UPDATE projects SET status = 'declined', finished_at = ? WHERE id = ?", now, project.id);
    }
    return;
  }

  ctx.sql.run('UPDATE flags SET settled = 1 WHERE project_id = ? AND settled = 0', project.id);
  if (outcome === 'fits') {
    ctx.sql.run("UPDATE projects SET status = 'open' WHERE id = ? AND status = 'review'", project.id);
  } else {
    settlePool(ctx, project, 'A charter circle found that this project breaks the charter.');
    ctx.sql.run("UPDATE projects SET status = 'closed', finished_at = ? WHERE id = ?", now, project.id);
  }
}

/** Records a vote. Returns the circle's decision if this vote settled it. */
export function castVote(
  ctx: Context,
  reviewId: string,
  memberId: string,
  verdict: string,
  rule: string,
  note: string,
): Verdict | null {
  if (!isVerdict(verdict)) throw new Problem('Choose whether the project fits the charter.', 400, 'verdict');
  let brokenRule: RuleId | null = null;
  if (verdict === 'breaks') {
    if (!isRuleId(rule)) throw new Problem('Which part of the charter does it break?', 400, 'rule');
    brokenRule = rule;
  }
  const why = cleanText(note, { label: 'Your note', field: 'note', min: 0, max: 1000 });

  return ctx.sql.transaction(() => {
    const review = requireReview(ctx, reviewId);
    if (review.status !== 'open') throw new Problem('This circle has already decided.', 409);
    const seat = ctx.sql.get<{ vote: string | null }>(
      'SELECT vote FROM seats WHERE review_id = ? AND member_id = ?',
      reviewId,
      memberId,
    );
    if (!seat) throw new Problem('You are not in this circle.', 403);
    if (seat.vote) throw new Problem('You have already voted in this circle.', 409);

    ctx.sql.run(
      'UPDATE seats SET vote = ?, rule = ?, note = ?, voted_at = ? WHERE review_id = ? AND member_id = ?',
      verdict,
      brokenRule,
      why,
      nowIso(ctx),
      reviewId,
      memberId,
    );
    const outcome = decision(tallyOf(ctx, reviewId));
    if (outcome) decide(ctx, review, outcome);
    return outcome;
  });
}

/** Settles every circle whose time is up. Returns how many were settled. */
export function settleDueReviews(ctx: Context): number {
  const due = ctx.sql.all<{ id: string }>(
    "SELECT id FROM reviews WHERE status = 'open' AND deadline_at <= ? ORDER BY deadline_at",
    nowIso(ctx),
  );
  for (const { id } of due) {
    ctx.sql.transaction(() => {
      const review = requireReview(ctx, id);
      if (review.status === 'open') decide(ctx, review, decisionAtDeadline(tallyOf(ctx, id)));
    });
  }
  return due.length;
}

/** Closes any open review when a project's stewards stop it. Call inside a transaction. */
export function withdrawReviews(ctx: Context, projectId: string): void {
  ctx.sql.run(
    "UPDATE reviews SET status = 'withdrawn', decided_at = ? WHERE project_id = ? AND status = 'open'",
    nowIso(ctx),
    projectId,
  );
  ctx.sql.run('UPDATE flags SET settled = 1 WHERE project_id = ? AND settled = 0', projectId);
}

export interface Seat {
  readonly review: Review;
  readonly project: Project;
  readonly voted: boolean;
}

/** The circles someone has been drawn for that are still deciding. */
export function openSeatsFor(ctx: Context, memberId: string): Seat[] {
  const rows = ctx.sql.all<Review & { vote: string | null }>(
    `SELECT r.*, s.vote FROM seats s JOIN reviews r ON r.id = s.review_id
      WHERE s.member_id = ? AND r.status = 'open' ORDER BY r.deadline_at`,
    memberId,
  );
  return rows.map(({ vote, ...review }) => ({
    review,
    project: requireProject(ctx, review.project_id),
    voted: vote !== null,
  }));
}

export interface ReviewView {
  readonly review: Review;
  readonly project: Project;
  readonly flags: Array<{ rule: RuleId; note: string; created_at: string }>;
  readonly tally: Tally;
  /** The viewer's own seat, if they were drawn. */
  readonly seat: { vote: Verdict | null } | null;
  /** Notes from people in the circle, shown once it has decided. */
  readonly notes: Array<{ vote: Verdict; rule: RuleId | null; note: string }>;
}

export function reviewView(ctx: Context, reviewId: string, viewerId: string | undefined): ReviewView {
  const review = requireReview(ctx, reviewId);
  const project = requireProject(ctx, review.project_id);
  const flags = ctx.sql.all<{ rule: RuleId; note: string; created_at: string }>(
    'SELECT rule, note, created_at FROM flags WHERE review_id = ? ORDER BY created_at',
    reviewId,
  );
  const seat = viewerId
    ? ctx.sql.get<{ vote: Verdict | null }>(
        'SELECT vote FROM seats WHERE review_id = ? AND member_id = ?',
        reviewId,
        viewerId,
      ) ?? null
    : null;
  const notes =
    review.status === 'decided'
      ? ctx.sql.all<{ vote: Verdict; rule: RuleId | null; note: string }>(
          "SELECT vote, rule, note FROM seats WHERE review_id = ? AND vote IS NOT NULL AND note != '' ORDER BY voted_at",
          reviewId,
        )
      : [];
  return { review, project, flags, tally: tallyOf(ctx, reviewId), seat, notes };
}

export function reviewsForProject(ctx: Context, projectId: string): Review[] {
  return ctx.sql.all<Review>('SELECT * FROM reviews WHERE project_id = ? ORDER BY created_at DESC', projectId);
}

/** Projects with open reviews, for listing on the circles page. */
export function projectsUnderReview(ctx: Context): Project[] {
  return queryProjects(ctx, "SELECT * FROM projects WHERE status IN ('awaiting', 'review') ORDER BY created_at");
}
