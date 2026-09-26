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
    'Charter circles',
    <section class="narrow">
      <h1>Charter circles</h1>
      <p>
        Nobody on {ctx.config.siteName} has the job of judging other people’s projects. When a project might break the
        charter, a small circle of members is drawn at random, like a jury, and they decide together. Each person in a
        circle has one vote. People who look after the project, have pooled into it or flagged it are never drawn.
      </p>
      <p>
        A circle is drawn when the automatic charter check finds something in a new proposal and the proposer explains
        why it still fits, or when {plural(ctx.config.flagThreshold, 'person flags', 'different people flag')} an open
        project. A majority of the circle decides. If time runs out first, the project is only stopped when more of the
        circle said it breaks the charter than said it fits.
      </p>
      <h2>Deciding now</h2>
      {list.length === 0 ? (
        <p class="quiet">No circles are sitting at the moment.</p>
      ) : (
        <ul>
          {list.map((project) => {
            const review = reviewsForProject(ctx, project.id).find((r) => r.status === 'open');
            return (
              <li>
                <a href={review ? `/circles/${review.id}` : `/projects/${project.id}`}>{project.title}</a>{' '}
                <span class="quiet">· {STATUS_NAMES[project.status]}</span>
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
    `Charter circle: ${project.title}`,
    <section class="narrow">
      <p class="quiet">
        <a href="/circles">Charter circles</a>
      </p>
      <h1>A charter circle for “{project.title}”</h1>
      <p>
        <a href={`/projects/${project.id}`}>Read the whole project</a>. {project.summary}
      </p>

      {review.reason === 'proposal' ? (
        <>
          <h2>Why this circle was drawn</h2>
          <p>When this project was suggested, the charter check noticed these words:</p>
          <ul>
            {project.concerns.map((concern) => (
              <li>
                <strong>“{concern.term}”</strong> ({ruleById(concern.rule)?.title}) in “{concern.excerpt}”
              </li>
            ))}
          </ul>
          <p>The person who suggested it explained:</p>
          <blockquote>
            <Paragraphs text={project.concern_note} />
          </blockquote>
        </>
      ) : (
        <>
          <h2>Why this circle was drawn</h2>
          <p>{plural(view.flags.length, 'person', 'people')} flagged this project. Their reasons:</p>
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
        <p class="callout">
          This circle has {plural(tally.seats, 'person', 'people')} in it, and {plural(voted, 'has', 'have')} voted so far.
          It closes on {day(config, review.deadline_at)}.
          {tally.seats === 0 && ' Nobody could be drawn yet; people will be drawn as soon as there is someone eligible.'}
        </p>
      ) : review.status === 'withdrawn' ? (
        <p class="callout">The project was stopped by the people looking after it before the circle decided.</p>
      ) : (
        <p class="callout">
          <strong>
            The circle decided that this project {review.outcome === 'fits' ? 'fits' : 'breaks'} the charter
          </strong>{' '}
          on {day(config, review.decided_at ?? review.created_at)}, with {plural(tally.fits, 'vote', 'votes')} for “fits”
          and {plural(tally.breaks, 'vote', 'votes')} for “breaks”.
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
        <form method="post" action={`/circles/${review.id}/vote`} class="stack callout">
          <Csrf c={c} />
          <h2>You have been drawn for this circle</h2>
          <p>
            Read the project and the reasons above, then decide with <a href="/charter">the charter</a> in mind. Your vote
            is anonymous. Only the totals are shown, once the circle has decided.
          </p>
          <fieldset>
            <legend>Does the project fit the charter?</legend>
            <label class="check">
              <input type="radio" name="verdict" value="fits" required /> It fits the charter
            </label>
            <label class="check">
              <input type="radio" name="verdict" value="breaks" required /> It breaks the charter
            </label>
          </fieldset>
          <label for="vote-rule">If it breaks the charter, which part?</label>
          <select id="vote-rule" name="rule">
            <option value="">Choose one</option>
            {RULES.map((rule) => (
              <option value={rule.id}>{rule.title}</option>
            ))}
          </select>
          <label for="vote-note">A note for the record (optional, anonymous)</label>
          <textarea id="vote-note" name="note" rows={3} maxlength={1000}></textarea>
          <button type="submit">Cast my vote</button>
        </form>
      )}
      {review.status === 'open' && view.seat?.vote && <p class="quiet">Thank you, your vote is in.</p>}
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
      ? `Thank you. Your vote settled it: the circle decided the project ${outcome === 'fits' ? 'fits' : 'breaks'} the charter.`
      : 'Thank you, your vote is in.',
  );
  return c.redirect(`/circles/${id}`, 303);
});
