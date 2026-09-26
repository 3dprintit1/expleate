import { Hono } from 'hono';
import { RULES, ruleById } from '../../core/charter.js';
import { castVote, projectsUnderReview, reviewView, reviewsForProject } from '../../services/reviews.js';
import { Csrf, Paragraphs, STATUS_NAMES, page } from '../components.js';
import type { AppEnv } from '../env.js';
import { day, field, plural } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const circles = new Hono<AppEnv>();

circles.get('/circles', (c) => {
  const ctx = c.get('ctx');
  const list = projectsUnderReview(ctx);
  return page(
    c,
    'Circles',
    <section class="narrow">
      <h1>Circles</h1>
      <p class="lead">Nobody here has the job of judging projects.</p>
      <p>
        When a project might break the charter, a few members are picked at random to decide, like a jury. Each has one
        vote. Nobody who hosts the project, has put money into it or flagged it can be picked.
      </p>
      <p class="faint">
        A majority decides. If time runs out first, a project stops only if more people said it breaks the charter than
        said it fits.
      </p>
      <h2>Deciding now</h2>
      {list.length === 0 ? (
        <p class="quiet">No circles are sitting.</p>
      ) : (
        <ul class="plain">
          {list.map((project) => {
            const review = reviewsForProject(ctx, project.id).find((r) => r.status === 'open');
            return (
              <li>
                <a href={review ? `/circles/${review.id}` : `/projects/${project.id}`}>{project.title}</a>
                <span class="faint"> · {STATUS_NAMES[project.status]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>,
  );
});

circles.get('/circles/:id', (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member');
  const view = reviewView(ctx, c.req.param('id'), member?.id);
  const { review, project, tally } = view;
  const voted = tally.fits + tally.breaks;

  return page(
    c,
    `Circle: ${project.title}`,
    <section class="narrow">
      <a class="back" href="/circles">
        ← Circles
      </a>
      <h1>A circle for “{project.title}”</h1>
      <p class="lead">
        {project.summary} <a href={`/projects/${project.id}`}>Read the project</a>
      </p>

      <h2>Why it met</h2>
      {review.reason === 'proposal' ? (
        <>
          <p>The charter check noticed:</p>
          <ul>
            {project.concerns.map((concern) => (
              <li>
                <strong>“{concern.term}”</strong> in “{concern.excerpt}”
              </li>
            ))}
          </ul>
          <p>The person who suggested it says:</p>
          <blockquote>
            <Paragraphs text={project.concern_note} />
          </blockquote>
        </>
      ) : (
        <>
          <p>{plural(view.flags.length, 'person', 'people')} flagged it:</p>
          <ul>
            {view.flags.map((flag) => (
              <li>
                <strong>{ruleById(flag.rule)?.title}.</strong> {flag.note}
              </li>
            ))}
          </ul>
        </>
      )}

      {review.status === 'open' ? (
        <p class="note">
          {plural(tally.seats, 'person', 'people')} in this circle · {plural(voted, 'vote', 'votes')} so far · closes{' '}
          {day(config, review.deadline_at)}
          {tally.seats === 0 && '. Nobody could be picked yet. People will be picked as soon as someone can be.'}
        </p>
      ) : review.status === 'withdrawn' ? (
        <p class="note">The hosts stopped the project before the circle decided.</p>
      ) : (
        <p class="note">
          <strong>The circle decided it {review.outcome === 'fits' ? 'fits' : 'breaks'} the charter.</strong>{' '}
          {plural(tally.fits, 'vote', 'votes')} for fits, {plural(tally.breaks, 'vote', 'votes')} for breaks.
        </p>
      )}

      {view.notes.length > 0 && (
        <>
          <h2>What the circle said</h2>
          <ul>
            {view.notes.map((note) => (
              <li>
                {note.vote === 'fits' ? 'Fits' : `Breaks (${ruleById(note.rule ?? '')?.title ?? 'the charter'})`}: “
                {note.note}”
              </li>
            ))}
          </ul>
        </>
      )}

      {review.status === 'open' && view.seat && !view.seat.vote && (
        <form method="post" action={`/circles/${review.id}/vote`} class="form glass panel">
          <Csrf c={c} />
          <h2>You’ve been picked</h2>
          <p class="quiet">
            Read the project, then decide with <a href="/charter">the charter</a> in mind. Your vote is private. Only the
            totals are shown, once the circle has decided.
          </p>
          <div class="choices" role="radiogroup" aria-label="Your vote">
            <label class="choice">
              <input type="radio" name="verdict" value="fits" required />
              <span>
                <strong>It fits the charter</strong>
              </span>
            </label>
            <label class="choice">
              <input type="radio" name="verdict" value="breaks" required />
              <span>
                <strong>It breaks the charter</strong>
              </span>
            </label>
          </div>
          <label for="vote-rule">If it breaks it, which rule?</label>
          <select id="vote-rule" name="rule">
            <option value="">Choose a rule</option>
            {RULES.map((rule) => (
              <option value={rule.id}>{rule.title}</option>
            ))}
          </select>
          <label for="vote-note">Anything to add? (optional)</label>
          <textarea id="vote-note" name="note" rows={3} maxlength={1000}></textarea>
          <button type="submit">Vote</button>
        </form>
      )}
      {review.status === 'open' && view.seat?.vote && <p class="quiet">Thanks, your vote is in.</p>}
    </section>,
  );
});

circles.post('/circles/:id/vote', signedIn, (c) => {
  const form = c.get('form');
  const id = c.req.param('id');
  const outcome = castVote(c.get('ctx'), id, c.get('member')!.id, field(form, 'verdict'), field(form, 'rule'), field(form, 'note'));
  flash(
    c,
    'ok',
    outcome
      ? `Thanks. Your vote settled it: the project ${outcome === 'fits' ? 'fits' : 'breaks'} the charter.`
      : 'Thanks, your vote is in.',
  );
  return c.redirect(`/circles/${id}`, 303);
});
