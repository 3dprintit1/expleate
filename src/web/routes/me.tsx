import { Hono } from 'hono';
import { answerInvite, invitesFor, memberGroups } from '../../services/groups.js';
import { addResources, moveOut } from '../../services/members.js';
import { memberPortions } from '../../services/pools.js';
import { projectsHostedBy } from '../../services/projects.js';
import { openSeatsFor } from '../../services/reviews.js';
import { Csrf, STATUS_NAMES, page } from '../components.js';
import type { AppEnv } from '../env.js';
import { amountField, day, field, money } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const me = new Hono<AppEnv>();

me.get('/me', signedIn, (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member')!;
  const seats = openSeatsFor(ctx, member.id).filter((seat) => !seat.voted);
  const invites = invitesFor(ctx, member.id);
  const portions = memberPortions(ctx, member.id);
  const hosted = projectsHostedBy(ctx, member.id);
  const groups = memberGroups(ctx, member.id);
  const inPools = portions.reduce((sum, entry) => sum + entry.portion.value, 0n);

  return page(
    c,
    member.name,
    <>
      <h1>Hello, {member.name}</h1>
      <p class="faint">
        <a href={`/people/${member.handle}`}>@{member.handle}</a> · joined {day(config, member.created_at)}
      </p>

      {seats.length > 0 && (
        <section class="note">
          <h2>You’ve been picked for a circle</h2>
          <ul class="plain">
            {seats.map((seat) => (
              <li>
                <a href={`/circles/${seat.review.id}`}>{seat.project.title}</a>
                <span class="faint"> · vote by {day(config, seat.review.deadline_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {invites.length > 0 && (
        <section class="note">
          <h2>Invitations</h2>
          <ul class="plain">
            {invites.map((invite) => (
              <li>
                {invite.invitedBy} invited you to <a href={`/groups/${invite.group.handle}`}>{invite.group.name}</a>.{' '}
                <form method="post" action={`/invites/${invite.group.id}`} class="inline">
                  <Csrf c={c} />
                  <button type="submit" name="answer" value="accept">
                    Join
                  </button>{' '}
                  <button type="submit" name="answer" value="decline" class="ghost">
                    No thanks
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div class="figures">
        <div class="figure glass">
          <b>{money(config, member.balance)}</b>
          <span>ready to put in</span>
        </div>
        <div class="figure glass">
          <b>{money(config, inPools)}</b>
          <span>in pools, yours to take back</span>
        </div>
      </div>

      <details class="section glass">
        <summary>{config.demoResources ? 'Add or move money' : 'Move money out'}</summary>
        <div class="two">
          {config.demoResources && (
            <form method="post" action="/me/add" class="form">
              <Csrf c={c} />
              <label for="add-amount">Add pretend money</label>
              <span class="hint">Nothing real is charged.</span>
              <input id="add-amount" class="amount" name="amount" inputmode="decimal" required maxlength={30} value="100" />
              <button type="submit">Add</button>
            </form>
          )}
          <form method="post" action="/me/move-out" class="form">
            <Csrf c={c} />
            <label for="out-amount">Move money out</label>
            <span class="hint">Up to {money(config, member.balance)}.</span>
            <input id="out-amount" class="amount" name="amount" inputmode="decimal" required maxlength={30} />
            <button type="submit" class="ghost">
              Move out
            </button>
          </form>
        </div>
      </details>

      <h2>Your pools</h2>
      {portions.length === 0 ? (
        <p class="quiet">
          None yet. <a href="/">Find a project you love</a>
        </p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col" class="num">
                  You put in
                </th>
                <th scope="col" class="num">
                  Your portion
                </th>
              </tr>
            </thead>
            <tbody>
              {portions.map(({ project, portion }) => (
                <tr>
                  <td>
                    <a href={`/projects/${project.id}`}>{project.title}</a>
                    {project.status !== 'open' && <span class="faint"> · {STATUS_NAMES[project.status]}</span>}
                  </td>
                  <td class="num">{money(config, portion.putIn)}</td>
                  <td class="num">{money(config, portion.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div class="two">
        <section>
          <h2>Projects you host</h2>
          {hosted.length === 0 ? (
            <p class="quiet">
              None yet. <a href="/projects/new">Suggest one</a>
            </p>
          ) : (
            <ul class="plain">
              {hosted.map((project) => (
                <li>
                  <a href={`/projects/${project.id}`}>{project.title}</a>
                  <span class="faint"> · {STATUS_NAMES[project.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Your groups</h2>
          {groups.length > 0 && (
            <ul class="plain">
              {groups.map((group) => (
                <li>
                  <a href={`/groups/${group.handle}`}>{group.name}</a>
                </li>
              ))}
            </ul>
          )}
          <p>
            <a href="/groups/new">Start a group</a>
          </p>
        </section>
      </div>

      <form method="post" action="/sign-out" class="form">
        <Csrf c={c} />
        <button type="submit" class="ghost">
          Sign out
        </button>
      </form>
    </>,
  );
});

me.post('/me/add', signedIn, (c) => {
  const ctx = c.get('ctx');
  const amount = amountField(ctx.config, c.get('form'));
  addResources(ctx, c.get('member')!.id, amount);
  flash(c, 'ok', `${money(ctx.config, amount)} added.`);
  return c.redirect('/me', 303);
});

me.post('/me/move-out', signedIn, (c) => {
  const ctx = c.get('ctx');
  const amount = amountField(ctx.config, c.get('form'));
  moveOut(ctx, c.get('member')!.id, amount);
  flash(c, 'ok', `${money(ctx.config, amount)} moved out.`);
  return c.redirect('/me', 303);
});

me.post('/invites/:groupId', signedIn, (c) => {
  const accept = field(c.get('form'), 'answer') === 'accept';
  answerInvite(c.get('ctx'), c.req.param('groupId'), c.get('member')!.id, accept);
  flash(c, 'ok', accept ? 'You’ve joined the group.' : 'Invitation declined.');
  return c.redirect('/me', 303);
});
