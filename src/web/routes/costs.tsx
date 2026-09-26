import { Hono } from 'hono';
import { Problem } from '../../services/context.js';
import { costsOverview, isCaretaker, recordCost, recordCover, shareRunningCosts } from '../../services/costs.js';
import { Csrf, Hint, page } from '../components.js';
import type { AppEnv } from '../env.js';
import { amountField, day, field, money, percent, plural } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const costs = new Hono<AppEnv>();

costs.get('/costs', (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const overview = costsOverview(ctx);
  const { totals } = overview;
  const caretaker = isCaretaker(ctx, c.get('member'));
  const maxRate = config.maxCostSharePpm / 1_000_000;
  const today = ctx.now().toISOString().slice(0, 10);

  return page(
    c,
    'Running costs',
    <>
      <section class="narrow">
        <h1>What it costs to run {config.siteName}</h1>
        <p>
          Keeping {config.siteName} online costs money: hosting, and a domain name. Every one of those costs is listed here
          with its receipt. Nobody takes a margin, a fee or a salary.
        </p>
        <p>
          Gifts listed below cover costs first. After that, what is still owed is shared across every live pool at exactly
          what it cost, once a month. Every pool gives up the same percentage of what it holds,
          and inside each pool that works like any other use, so everyone’s portion shrinks by that same small percentage.
          No single share takes more than {percent(config, maxRate)} of what is pooled; anything above that waits for the
          next month.
        </p>
        {config.demoResources && (
          <p class="callout">
            While {config.siteName} is a prototype, the resources in pools are pretend, so the shares below are pretend too.
            The real bills are being paid by the founder’s cover.
          </p>
        )}
      </section>

      <dl class="figures wide">
        <div>
          <dt>Costs so far</dt>
          <dd>{money(config, totals.costs)}</dd>
        </div>
        <div>
          <dt>Covered by gifts</dt>
          <dd>{money(config, totals.covered)}</dd>
        </div>
        <div>
          <dt>Shared across pools</dt>
          <dd>{money(config, totals.shared)}</dd>
        </div>
        <div>
          <dt>Still to share</dt>
          <dd>{money(config, totals.outstanding)}</dd>
        </div>
        <div>
          <dt>In live pools now</dt>
          <dd>{money(config, overview.pooled)}</dd>
        </div>
      </dl>

      <section>
        <h2>Every cost</h2>
        {overview.costs.length === 0 ? (
          <p class="quiet">No costs recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" class="num">
                  Amount
                </th>
                <th scope="col">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {overview.costs.map((cost) => (
                <tr>
                  <td>{day(config, cost.incurred_on)}</td>
                  <td>
                    {cost.description} <span class="quiet">(recorded by {cost.recorded_by_name})</span>
                  </td>
                  <td class="num">{money(config, cost.amount)}</td>
                  <td>{cost.receipt_url ? <a href={cost.receipt_url} rel="nofollow noopener">Receipt</a> : <span class="quiet">None yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="columns">
        <div>
          <h2>Gifts covering costs</h2>
          {overview.covers.length === 0 ? (
            <p class="quiet">None recorded yet.</p>
          ) : (
            <ul>
              {overview.covers.map((cover) => (
                <li>
                  <strong>{cover.given_by}</strong>: {money(config, cover.amount)}
                  {cover.note && <> · {cover.note}</>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2>Caretakers</h2>
          <p class="quiet">
            The people who pay the bills and record them here. Caretakers have no say over projects or circles.
          </p>
          {overview.caretakers.length === 0 ? (
            <p class="quiet">None yet.</p>
          ) : (
            <ul>
              {overview.caretakers.map((person) => (
                <li>
                  <a href={`/people/${person.handle}`}>{person.name}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2>Shares so far</h2>
        {overview.shares.length === 0 ? (
          <p class="quiet">No running costs have been shared yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" class="num">
                  Shared
                </th>
                <th scope="col" class="num">
                  Of everything pooled
                </th>
                <th scope="col" class="num">
                  Pools
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.shares.map((share) => (
                <tr>
                  <td>{day(config, share.at)}</td>
                  <td class="num">{money(config, share.amount)}</td>
                  <td class="num">{percent(config, share.amount / share.pooled)}</td>
                  <td class="num">{share.pools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {caretaker && (
        <section class="steward-tools">
          <h2>For caretakers</h2>
          <div class="columns">
            <form method="post" action="/costs/cost" class="stack">
              <Csrf c={c} />
              <h3>Record a cost</h3>
              <label for="cost-date">Date paid</label>
              <input id="cost-date" name="incurredOn" type="date" required max={today} value={today} />
              <label for="cost-what">What it was for</label>
              <Hint>For example: Cloudflare Workers Paid plan, October.</Hint>
              <input id="cost-what" name="description" required maxlength={200} />
              <label for="cost-amount">Amount</label>
              <input id="cost-amount" name="amount" inputmode="decimal" required maxlength={30} />
              <label for="cost-receipt">Link to the receipt (optional)</label>
              <input id="cost-receipt" name="receiptUrl" type="url" maxlength={500} placeholder="https://" />
              <button type="submit">Record the cost</button>
            </form>
            <form method="post" action="/costs/cover" class="stack">
              <Csrf c={c} />
              <h3>Record a gift that covers costs</h3>
              <label for="cover-by">Who is covering it</label>
              <input id="cover-by" name="givenBy" required maxlength={80} placeholder="The founder" />
              <label for="cover-amount">Amount</label>
              <input id="cover-amount" name="amount" inputmode="decimal" required maxlength={30} />
              <label for="cover-note">Note (optional)</label>
              <input id="cover-note" name="note" maxlength={500} />
              <button type="submit">Record the gift</button>
            </form>
          </div>
          <form method="post" action="/costs/share" class="stack">
            <Csrf c={c} />
            <h3>Share what is owed now</h3>
            <p class="quiet">
              This happens by itself on the first of each month. Use it if you need to share sooner. Right now{' '}
              {money(config, totals.outstanding)} is waiting to be shared.
            </p>
            <button type="submit" class="secondary">
              Share running costs now
            </button>
          </form>
        </section>
      )}
    </>,
  );
});

costs.post('/costs/cost', signedIn, (c) => {
  const ctx = c.get('ctx');
  const form = c.get('form');
  recordCost(ctx, c.get('member')!.id, {
    incurredOn: field(form, 'incurredOn'),
    description: field(form, 'description'),
    amount: amountField(ctx.config, form),
    receiptUrl: field(form, 'receiptUrl'),
  });
  flash(c, 'ok', 'The cost is recorded for everyone to see.');
  return c.redirect('/costs', 303);
});

costs.post('/costs/cover', signedIn, (c) => {
  const ctx = c.get('ctx');
  const form = c.get('form');
  recordCover(ctx, c.get('member')!.id, {
    givenBy: field(form, 'givenBy'),
    amount: amountField(ctx.config, form),
    note: field(form, 'note'),
  });
  flash(c, 'ok', 'The gift is recorded. Thank you.');
  return c.redirect('/costs', 303);
});

costs.post('/costs/share', signedIn, (c) => {
  const ctx = c.get('ctx');
  if (!isCaretaker(ctx, c.get('member'))) throw new Problem('Only caretakers can share running costs.', 403);
  const result = shareRunningCosts(ctx);
  flash(
    c,
    'ok',
    result
      ? `${money(ctx.config, result.amount)} was shared across ${plural(result.pools, 'pool', 'pools')}.`
      : 'There was nothing to share: either nothing is owed, or nothing is pooled.',
  );
  return c.redirect('/costs', 303);
});
