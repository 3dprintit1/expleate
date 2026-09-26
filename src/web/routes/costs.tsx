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
        <h1>Running costs</h1>
        <p class="lead">Keeping {config.siteName} online costs money. Every bill is here, and nobody takes a cut.</p>
        <p>
          Gifts pay first. After that, what is owed is shared across all live pools once a month: the same small share of
          each pool, never more than {percent(config, maxRate)} at a time.
        </p>
        {config.demoResources && (
          <p class="note">While {config.siteName} is a prototype, pools hold pretend money. The real bills are paid by gifts.</p>
        )}
      </section>

      <div class="figures">
        <div class="figure glass">
          <b>{money(config, totals.costs)}</b>
          <span>bills so far</span>
        </div>
        <div class="figure glass">
          <b>{money(config, totals.covered)}</b>
          <span>paid by gifts</span>
        </div>
        <div class="figure glass">
          <b>{money(config, totals.shared)}</b>
          <span>shared by pools</span>
        </div>
        <div class="figure glass">
          <b>{money(config, totals.outstanding)}</b>
          <span>still owed</span>
        </div>
      </div>

      <h2>Bills</h2>
      {overview.costs.length === 0 ? (
        <p class="quiet">No bills yet.</p>
      ) : (
        <div class="table-wrap">
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
                  <td>{cost.description}</td>
                  <td class="num">{money(config, cost.amount)}</td>
                  <td>
                    {cost.receipt_url ? (
                      <a href={cost.receipt_url} rel="nofollow noopener">
                        Receipt
                      </a>
                    ) : (
                      <span class="faint">Not linked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div class="two">
        <section>
          <h2>Gifts</h2>
          {overview.covers.length === 0 ? (
            <p class="quiet">None yet.</p>
          ) : (
            <ul class="plain">
              {overview.covers.map((cover) => (
                <li>
                  <strong>{cover.given_by}</strong>, {money(config, cover.amount)}
                  {cover.note && <span class="faint"> · {cover.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Shares</h2>
          {overview.shares.length === 0 ? (
            <p class="quiet">None yet.</p>
          ) : (
            <ul class="plain">
              {overview.shares.map((share) => (
                <li>
                  {day(config, share.at)}: <strong>{money(config, share.amount)}</strong>
                  <span class="faint">
                    {' '}
                    · {percent(config, share.amount / share.pooled)} of every pool · {plural(share.pools, 'pool', 'pools')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p class="faint">
        Caretakers pay the bills and record them here. They have no say over projects or circles.
        {overview.caretakers.length > 0 && (
          <>
            {' '}
            Caretakers:{' '}
            {overview.caretakers.map((person, index) => (
              <>
                {index > 0 && ', '}
                <a href={`/people/${person.handle}`}>{person.name}</a>
              </>
            ))}
            .
          </>
        )}
      </p>

      {caretaker && (
        <details class="section glass">
          <summary>Caretaker tools</summary>
          <div class="two">
            <form method="post" action="/costs/cost" class="form">
              <Csrf c={c} />
              <h3>Record a bill</h3>
              <label for="cost-date">Date paid</label>
              <input id="cost-date" name="incurredOn" type="date" required max={today} value={today} />
              <label for="cost-what">What for?</label>
              <input id="cost-what" name="description" required maxlength={200} placeholder="Cloudflare Workers, October" />
              <label for="cost-amount">Amount</label>
              <input id="cost-amount" class="amount" name="amount" inputmode="decimal" required maxlength={30} />
              <label for="cost-receipt">Receipt link (optional)</label>
              <input id="cost-receipt" name="receiptUrl" type="url" maxlength={500} placeholder="https://" />
              <button type="submit">Record the bill</button>
            </form>
            <form method="post" action="/costs/cover" class="form">
              <Csrf c={c} />
              <h3>Record a gift</h3>
              <label for="cover-by">From</label>
              <input id="cover-by" name="givenBy" required maxlength={80} placeholder="The founder" />
              <label for="cover-amount">Amount</label>
              <input id="cover-amount" class="amount" name="amount" inputmode="decimal" required maxlength={30} />
              <label for="cover-note">Note (optional)</label>
              <input id="cover-note" name="note" maxlength={500} />
              <button type="submit">Record the gift</button>
            </form>
          </div>
          <form method="post" action="/costs/share" class="form">
            <Csrf c={c} />
            <h3>Share what is owed now</h3>
            <Hint>This happens by itself on the first of each month. {money(config, totals.outstanding)} is owed.</Hint>
            <button type="submit" class="ghost">
              Share now
            </button>
          </form>
        </details>
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
  flash(c, 'ok', 'Bill recorded.');
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
  flash(c, 'ok', 'Gift recorded. Thank you.');
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
      ? `${money(ctx.config, result.amount)} shared across ${plural(result.pools, 'pool', 'pools')}.`
      : 'Nothing to share right now.',
  );
  return c.redirect('/costs', 303);
});
