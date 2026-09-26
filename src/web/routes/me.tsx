import { Hono } from 'hono';
import { answerInvite, invitesFor, memberGroups } from '../../services/groups.js';
import { addResources, moveOut } from '../../services/members.js';
import { memberPortions } from '../../services/pools.js';
import { projectsStewardedBy } from '../../services/projects.js';
import { openSeatsFor } from '../../services/reviews.js';
import { Csrf, Hint, STATUS_NAMES, page } from '../components.js';
import type { AppEnv } from '../env.js';
import { amountField, day, field, money } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const me = new Hono<AppEnv>();

me.get('/me', signedIn, (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member')!;
  const seats = openSeatsFor(ctx, member.id);
  const invites = invitesFor(ctx, member.id);
  const portions = memberPortions(ctx, member.id);
  const stewarded = projectsStewardedBy(ctx, member.id);
  const groups = memberGroups(ctx, member.id);
  const inPools = portions.reduce((sum, entry) => sum + entry.portion.value, 0n);

  return page(
    c,
    member.name,
    <>
      <h1>{member.name}</h1>
      <p class="quiet">
        <a href={`/people/${member.handle}`}>@{member.handle}</a> · joined {day(config, member.created_at)}
      </p>

      {seats.length > 0 && (
        <section class="callout">
          <h2>You have been drawn for a charter circle</h2>
          <ul>
            {seats.map((seat) => (
              <li>
                <a href={`/circles/${seat.review.id}`}>{seat.project.title}</a>{' '}
                {seat.voted ? '(you have voted)' : `(please decide by ${day(config, seat.review.deadline_at)})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {invites.length > 0 && (
        <section class="callout">
          <h2>Invitations</h2>
          <ul class="plain">
            {invites.map((invite) => (
              <li>
                {invite.invitedBy} invited you to join <a href={`/groups/${invite.group.handle}`}>{invite.group.name}</a>.{' '}
                <form method="post" action={`/invites/${invite.group.id}`} class="inline">
                  <Csrf c={c} />
                  <button type="submit" name="answer" value="accept" class="small">
                    Join the group
                  </button>{' '}
                  <button type="submit" name="answer" value="decline" class="small secondary">
                    No thanks
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="columns">
        <div>
          <h2>Your resources</h2>
          <p class="big">{money(config, member.balance)}</p>
          <p class="quiet">
            Available to pool. You also have {money(config, inPools)} in pools, which you can take back whenever you like.
          </p>
          {config.demoResources && (
            <form method="post" action="/me/add" class="stack">
              <Csrf c={c} />
              <label for="add-amount">Add pretend resources</label>
              <Hint>While {config.siteName} is a prototype, this is how resources arrive. Nothing real is charged.</Hint>
              <input id="add-amount" name="amount" inputmode="decimal" required maxlength={30} value="100" />
              <button type="submit" class="secondary">
                Add
              </button>
            </form>
          )}
          {member.balance > 0 && (
            <form method="post" action="/me/move-out" class="stack">
              <Csrf c={c} />
              <label for="out-amount">Move resources out</label>
              <input id="out-amount" name="amount" inputmode="decimal" required maxlength={30} />
              <button type="submit" class="secondary">
                Move out
              </button>
            </form>
          )}
        </div>
        <div>
          <h2>Your groups</h2>
          {groups.length === 0 ? (
            <p class="quiet">You are not in any groups yet.</p>
          ) : (
            <ul>
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
        </div>
      </section>

      <section>
        <h2>Your pools</h2>
        {portions.length === 0 ? (
          <p class="quiet">
            You have not put anything into a pool yet. <a href="/">Have a look around</a>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col" class="num">
                  You put in
                </th>
                <th scope="col" class="num">
                  Your portion now
                </th>
              </tr>
            </thead>
            <tbody>
              {portions.map(({ project, portion }) => (
                <tr>
                  <td>
                    <a href={`/projects/${project.id}`}>{project.title}</a>
                    {project.status !== 'open' && <span class="quiet"> · {STATUS_NAMES[project.status]}</span>}
                  </td>
                  <td class="num">{money(config, portion.putIn)}</td>
                  <td class="num">{money(config, portion.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Projects you look after</h2>
        {stewarded.length === 0 ? (
          <p class="quiet">
            None yet. <a href="/projects/new">Suggest a project</a>.
          </p>
        ) : (
          <ul>
            {stewarded.map((project) => (
              <li>
                <a href={`/projects/${project.id}`}>{project.title}</a>{' '}
                <span class="quiet">· {STATUS_NAMES[project.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  flash(c, 'ok', accept ? 'You have joined the group.' : 'Invitation declined.');
  return c.redirect('/me', 303);
});
