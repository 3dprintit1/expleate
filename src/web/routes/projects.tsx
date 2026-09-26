import { Hono, type Context as HonoContext } from 'hono';
import type { FC } from 'hono/jsx';
import { type Concern, RULES, SPIRITS, type Spirit, isSpirit, ruleById } from '../../core/charter.js';
import { parseAmount } from '../../core/money.js';
import { Problem } from '../../services/context.js';
import { memberGroups } from '../../services/groups.js';
import {
  contribute,
  poolLedger,
  poolPeople,
  portionFor,
  takeBack,
  takeBackNotes,
  useResources,
} from '../../services/pools.js';
import {
  type ListOrder,
  type ListShow,
  type ProposalInput,
  finishProject,
  listProjects,
  postUpdate,
  projectUpdates,
  proposeProject,
} from '../../services/projects.js';
import { type Project, isSteward, requireProject } from '../../services/records.js';
import { flagProject, reviewsForProject } from '../../services/reviews.js';
import {
  Csrf,
  ErrorSummary,
  Hint,
  Paragraphs,
  ProjectCard,
  SPIRIT_NAMES,
  STATUS_NAMES,
  SpiritTags,
  page,
  stewardOf,
} from '../components.js';
import type { AppEnv, Form } from '../env.js';
import { amountField, checked, day, field, fields, money, percent, plural } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const projects = new Hono<AppEnv>();

const ORDERS: Record<ListOrder, string> = { shuffled: 'Shuffled daily', newest: 'Newest', people: 'Most people' };

projects.get('/', (c) => {
  const ctx = c.get('ctx');
  const spiritParam = c.req.query('spirit') ?? '';
  const spirit: Spirit | undefined = isSpirit(spiritParam) ? spiritParam : undefined;
  const orderParam = c.req.query('order') ?? '';
  const order: ListOrder = orderParam in ORDERS ? (orderParam as ListOrder) : 'shuffled';
  const show: ListShow = c.req.query('show') === 'finished' ? 'finished' : 'live';
  const pageNumber = Math.max(0, Math.min(1000, Number.parseInt(c.req.query('page') ?? '0', 10) || 0));
  const { projects: list, more } = listProjects(ctx, { spirit, order, show, page: pageNumber });

  const link = (changes: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { spirit, order: order === 'shuffled' ? undefined : order, show: show === 'live' ? undefined : show, page: undefined, ...changes };
    for (const [key, value] of Object.entries(merged)) if (value !== undefined) params.set(key, String(value));
    const query = params.toString();
    return query ? `/?${query}` : '/';
  };

  return page(
    c,
    ctx.config.siteName,
    <>
      {pageNumber === 0 && !spirit && show === 'live' && (
        <section class="hero">
          <h1>Pool resources with anyone in the world, for projects of creativity, adventure and joy.</h1>
          <p>
            Someone suggests a project. Anyone who loves the idea can put in whatever they like. If you stop liking where
            it is heading, you can take your portion back at any time.
          </p>
          <p>
            {ctx.config.siteName} is built as though everyone already had an equal share of the world’s resources. Nobody
            profits here, and nobody’s voice counts for more than anyone else’s.
          </p>
          <p class="actions">
            <a class="button" href="/projects/new">
              Suggest a project
            </a>
            <a href="/pooling">How pooling works</a>
          </p>
        </section>
      )}
      <section>
        <h2>{show === 'finished' ? 'Finished projects' : 'Projects'}</h2>
        <nav class="filters" aria-label="Filter projects">
          <span>
            <a href={link({ spirit: undefined })} aria-current={!spirit ? 'page' : undefined}>
              All
            </a>
            {SPIRITS.map((s) => (
              <a href={link({ spirit: s })} aria-current={spirit === s ? 'page' : undefined}>
                {SPIRIT_NAMES[s]}
              </a>
            ))}
          </span>
          <span>
            {(Object.keys(ORDERS) as ListOrder[]).map((o) => (
              <a href={link({ order: o === 'shuffled' ? undefined : o })} aria-current={order === o ? 'page' : undefined}>
                {ORDERS[o]}
              </a>
            ))}
          </span>
          <span>
            <a href={link({ show: undefined })} aria-current={show === 'live' ? 'page' : undefined}>
              Live
            </a>
            <a href={link({ show: 'finished' })} aria-current={show === 'finished' ? 'page' : undefined}>
              Finished
            </a>
          </span>
        </nav>
        {list.length === 0 ? (
          <p class="empty">
            {show === 'finished' ? 'No finished projects yet.' : 'No projects here yet.'}{' '}
            <a href="/projects/new">Suggest one?</a>
          </p>
        ) : (
          <ul class="cards">
            {list.map((project) => (
              <ProjectCard ctx={ctx} project={project} />
            ))}
          </ul>
        )}
        <p class="pager">
          {pageNumber > 0 && <a href={link({ page: pageNumber - 1 || undefined })}>Previous</a>}
          {more && <a href={link({ page: pageNumber + 1 })}>More projects</a>}
        </p>
        {order === 'shuffled' && list.length > 1 && (
          <p class="quiet">The order is shuffled once a day, so every project takes its turn near the top.</p>
        )}
      </section>
    </>,
  );
});

// ---------------------------------------------------------------- suggesting

interface ProposeFormProps {
  c: HonoContext<AppEnv>;
  form: Form;
  error?: string | undefined;
  concerns?: readonly Concern[] | undefined;
}

const ProposeForm: FC<ProposeFormProps> = ({ c, form, error, concerns }) => {
  const ctx = c.get('ctx');
  const member = c.get('member')!;
  const groups = memberGroups(ctx, member.id);
  const chosen = new Set(fields(form, 'spirits'));
  return (
    <section class="narrow">
      <h1>Suggest a project</h1>
      <p>
        Tell people what you want to do and what the pool would be for. Projects are shared acts of creativity, adventure
        or joy. Please read <a href="/charter">the charter</a> first: projects have nothing to do with politics, war,
        financial gain or charity.
      </p>
      <ErrorSummary message={error} />
      {concerns && concerns.length > 0 && (
        <div class="concerns" role="alert">
          <h2>A few words caught the charter check</h2>
          <p>
            The check is only a first look at the words you used. It found these, which often mean a project is about{' '}
            {new Intl.ListFormat('en-GB', { type: 'disjunction' }).format([
              ...new Set(concerns.map((concern) => ruleById(concern.rule)?.topic ?? concern.rule)),
            ])}
            :
          </p>
          <ul>
            {concerns.map((concern) => (
              <li>
                <strong>“{concern.term}”</strong> ({ruleById(concern.rule)?.title}) in “{concern.excerpt}”
              </li>
            ))}
          </ul>
          <p>
            If that is a misunderstanding, you can reword it. Or explain below why the project still fits the charter, and
            a charter circle of people drawn at random will read your explanation and decide. Your pool opens if they agree.
          </p>
          <label for="concernNote">Why your project fits the charter</label>
          <textarea id="concernNote" name="concernNote" rows={4} maxlength={2000}>
            {field(form, 'concernNote')}
          </textarea>
        </div>
      )}
      <form method="post" action="/projects" class="stack">
        <Csrf c={c} />
        <label for="title">Title</label>
        <input id="title" name="title" required maxlength={100} value={field(form, 'title')} />

        <label for="summary">In one line</label>
        <Hint>What would someone see at a glance?</Hint>
        <input id="summary" name="summary" required maxlength={200} value={field(form, 'summary')} />

        <label for="story">The story</label>
        <Hint>What will happen, who can take part, and why it brings joy. At least 50 characters.</Hint>
        <textarea id="story" name="story" required rows={8} maxlength={10000}>
          {field(form, 'story')}
        </textarea>

        <label for="plans">What the pool is for</label>
        <Hint>
          The things the project needs: materials, tools, travel, a venue. Nobody is paid a wage or fee from a pool.
        </Hint>
        <textarea id="plans" name="plans" required rows={5} maxlength={5000}>
          {field(form, 'plans')}
        </textarea>

        <fieldset>
          <legend>Its spirit</legend>
          {SPIRITS.map((spirit) => (
            <label class="check">
              <input type="checkbox" name="spirits" value={spirit} checked={chosen.has(spirit)} /> {SPIRIT_NAMES[spirit]}
            </label>
          ))}
        </fieldset>

        <label for="hope">What you hope to pool (optional)</label>
        <Hint>A rough idea helps people know when the project has enough.</Hint>
        <input id="hope" name="hope" inputmode="decimal" maxlength={30} value={field(form, 'hope')} />

        {groups.length > 0 && (
          <>
            <label for="groupId">Suggest it as</label>
            <select id="groupId" name="groupId">
              <option value="">Yourself</option>
              {groups.map((group) => (
                <option value={group.id} selected={field(form, 'groupId') === group.id}>
                  {group.name} (everyone in the group looks after it)
                </option>
              ))}
            </select>
          </>
        )}

        <label class="check">
          <input type="checkbox" name="agreed" value="yes" checked={checked(form, 'agreed')} required /> I have read the
          charter, and this project fits it.
        </label>
        {concerns && concerns.length > 0 && <input type="hidden" name="concernNoteShown" value="yes" />}
        <button type="submit">{concerns && concerns.length > 0 ? 'Send to a charter circle' : 'Suggest it'}</button>
      </form>
    </section>
  );
};

projects.get('/projects/new', signedIn, (c) => page(c, 'Suggest a project', <ProposeForm c={c} form={{}} />));

projects.post('/projects', signedIn, (c) => {
  const ctx = c.get('ctx');
  const member = c.get('member')!;
  const form = c.get('form');
  try {
    const hopeText = field(form, 'hope').trim();
    let hope: bigint | null = null;
    if (hopeText !== '') {
      const parsed = parseAmount(hopeText, ctx.config.currency);
      if (!parsed.ok) throw new Problem(`What you hope to pool: ${parsed.reason}`, 400, 'hope');
      hope = parsed.amount;
    }
    const input: ProposalInput = {
      title: field(form, 'title'),
      summary: field(form, 'summary'),
      story: field(form, 'story'),
      plans: field(form, 'plans'),
      spirits: fields(form, 'spirits'),
      hope,
      groupId: field(form, 'groupId') || null,
      concernNote: field(form, 'concernNote'),
      agreed: checked(form, 'agreed'),
    };
    const result = proposeProject(ctx, member.id, input);
    if (result.kind === 'concerns') {
      const error = field(form, 'concernNoteShown')
        ? 'Please write at least a sentence or two (20 characters or more) explaining why it fits.'
        : undefined;
      return page(c, 'Suggest a project', <ProposeForm c={c} form={form} concerns={result.concerns} error={error} />, 400);
    }
    flash(
      c,
      'ok',
      result.project.status === 'open'
        ? 'Your project is live and its pool is open.'
        : 'Thank you. A charter circle has been drawn to read your explanation.',
    );
    return c.redirect(`/projects/${result.project.id}`, 303);
  } catch (error) {
    if (error instanceof Problem && error.status === 400) {
      return page(c, 'Suggest a project', <ProposeForm c={c} form={form} error={error.message} />, 400);
    }
    throw error;
  }
});

// ---------------------------------------------------------------- one project

const PoolBox: FC<{ c: HonoContext<AppEnv>; project: Project; steward: boolean }> = ({ c, project, steward }) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member');
  const portion = member ? portionFor(ctx, project, member.id) : undefined;
  const people = poolPeople(ctx, project);
  const pooledSoFar = project.pool_balance + project.pool_used + project.pool_costs;
  const live = project.status === 'open' || project.status === 'review';
  const others = people.total - people.named.length;

  return (
    <aside class="pool" aria-labelledby="pool-heading">
      <h2 id="pool-heading">The pool</h2>
      <dl class="figures">
        <div>
          <dt>In the pool now</dt>
          <dd>{money(config, project.pool_balance)}</dd>
        </div>
        <div>
          <dt>Used for the project</dt>
          <dd>{money(config, project.pool_used)}</dd>
        </div>
        {project.pool_costs > 0 && (
          <div>
            <dt>
              <a href="/costs">Running costs</a> shared
            </dt>
            <dd>{money(config, project.pool_costs)}</dd>
          </div>
        )}
        {project.pool_returned > 0 && (
          <div>
            <dt>Handed back at the end</dt>
            <dd>{money(config, project.pool_returned)}</dd>
          </div>
        )}
        <div>
          <dt>People in the pool</dt>
          <dd>{people.total.toLocaleString('en-GB')}</dd>
        </div>
      </dl>
      {project.hope !== null && (
        <p class="hope">
          <progress max={project.hope} value={Math.min(pooledSoFar, project.hope)}>
            {percent(config, pooledSoFar / project.hope)}
          </progress>
          {money(config, pooledSoFar)} pooled of the {money(config, project.hope)} they hope for.
        </p>
      )}
      {people.named.length > 0 && (
        <p class="people">
          In this pool:{' '}
          {people.named.map((person, index) => (
            <>
              {index > 0 && ', '}
              <a href={`/people/${person.handle}`}>{person.name}</a>
            </>
          ))}
          {others > 0 && ` and ${plural(others, 'other', 'others')}`}.
        </p>
      )}

      {portion && (portion.value > 0n || live) && portion.putIn > 0n && (
        <div class="yours">
          <h3>Your portion</h3>
          <p class="big">{money(config, portion.value)}</p>
          <p>
            You put in {money(config, portion.putIn)}
            {portion.takenBack > 0n && `, and have taken back ${money(config, portion.takenBack)}`}
            {portion.returned > 0n && `, and ${money(config, portion.returned)} was handed back when it ended`}.
            {portion.firstFraction !== null &&
              ` When you first put something in, you brought ${percent(config, portion.firstFraction)} of the pool.`}
          </p>
          {live && portion.value > 0n && (
            <form method="post" action={`/projects/${project.id}/take-back`} class="stack">
              <Csrf c={c} />
              <label for="take-amount">Take back</label>
              <Hint>Up to {money(config, portion.value)}, any time.</Hint>
              <input id="take-amount" name="amount" inputmode="decimal" required maxlength={30} />
              <label for="take-note">Tell the stewards why (optional, anonymous)</label>
              <input id="take-note" name="note" maxlength={500} />
              <button type="submit" class="secondary">
                Take back
              </button>
            </form>
          )}
        </div>
      )}

      {project.status === 'open' &&
        (member ? (
          <form method="post" action={`/projects/${project.id}/contribute`} class="stack contribute">
            <Csrf c={c} />
            <h3>Put something in</h3>
            <label for="put-amount">How much</label>
            <Hint>You have {money(config, member.balance)} available.</Hint>
            <input id="put-amount" name="amount" inputmode="decimal" required maxlength={30} />
            <label class="check">
              <input type="checkbox" name="showName" value="yes" checked={portion ? portion.showName : true} /> Show my
              name among the people in this pool (never the amount)
            </label>
            <button type="submit">Put in</button>
            {member.balance === 0 && config.demoResources && (
              <p class="quiet">
                You have no resources yet. <a href="/me">Add some pretend ones</a> to try it out.
              </p>
            )}
          </form>
        ) : (
          <p>
            <a href={`/sign-in?next=/projects/${project.id}`}>Sign in</a> or <a href="/join">join</a> to put something in.
          </p>
        ))}

      {project.status === 'open' && member && !steward && (
        <p class="quiet">
          <a href={`/projects/${project.id}/flag`}>Does this project break the charter?</a>
        </p>
      )}
    </aside>
  );
};

const LEDGER_WORDS = {
  put_in: 'Put in',
  take_back: 'Taken back',
  use: 'Used',
  cost_share: 'Running costs',
  return: 'Handed back',
} as const;

projects.get('/projects/:id', (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member');
  const project = requireProject(ctx, c.req.param('id'));
  const steward = member ? isSteward(ctx, project, member.id) : false;
  const by = stewardOf(ctx, project);
  const updates = projectUpdates(ctx, project.id);
  const ledger = poolLedger(ctx, project.id);
  const openReview = reviewsForProject(ctx, project.id).find((review) => review.status === 'open');
  const notes = steward ? takeBackNotes(ctx, project.id) : [];

  return page(
    c,
    project.title,
    <article class="project">
      <header class="project-head">
        <SpiritTags spirits={project.spirits} />
        <h1>{project.title}</h1>
        <p class="summary">{project.summary}</p>
        <p class="quiet">
          Suggested by <a href={by.href}>{by.label}</a> on {day(config, project.created_at)}
        </p>
        {project.status !== 'open' && (
          <p class={`status-banner ${project.status}`}>
            <strong>{STATUS_NAMES[project.status]}.</strong>{' '}
            {openReview && (
              <>
                A circle of people drawn at random is deciding whether it fits the charter.{' '}
                <a href={`/circles/${openReview.id}`}>See the circle</a>.
              </>
            )}
            {(project.status === 'completed' || project.status === 'stopped' || project.status === 'closed') &&
              'Whatever was left in the pool has been handed back to the people in it.'}
          </p>
        )}
        {project.closing_note && (
          <blockquote class="closing">
            <Paragraphs text={project.closing_note} />
          </blockquote>
        )}
      </header>
      <div class="columns">
        <div class="story">
          <h2>The story</h2>
          <Paragraphs text={project.story} />
          <h2>What the pool is for</h2>
          <Paragraphs text={project.plans} />

          <h2>Updates</h2>
          {updates.length === 0 ? (
            <p class="quiet">No updates yet.</p>
          ) : (
            <ol class="updates">
              {updates.map((update) => (
                <li>
                  <p class="quiet">
                    <a href={`/people/${update.author_handle}`}>{update.author_name}</a>, {day(config, update.created_at)}
                  </p>
                  <Paragraphs text={update.body} />
                </li>
              ))}
            </ol>
          )}

          <h2>The pool’s record</h2>
          <p class="quiet">
            Every movement in and out of this pool. Uses show what they were for. Everything else stays anonymous.
          </p>
          {ledger.length === 0 ? (
            <p class="quiet">Nothing yet.</p>
          ) : (
            <table class="ledger">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                  <th scope="col" class="num">
                    Amount
                  </th>
                  <th scope="col" class="num">
                    Pool after
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr class={entry.kind}>
                    <td>{day(config, entry.at)}</td>
                    <td>
                      {LEDGER_WORDS[entry.kind]}
                      {entry.kind === 'use' && (
                        <>
                          : {entry.note} <span class="quiet">({entry.by})</span>
                        </>
                      )}
                    </td>
                    <td class="num">
                      {entry.kind === 'put_in' ? '+' : '−'}
                      {money(config, entry.amount)}
                    </td>
                    <td class="num">{entry.poolAfter === null ? '' : money(config, entry.poolAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <PoolBox c={c} project={project} steward={steward} />
      </div>

      {steward && (project.status === 'open' || project.status === 'review' || project.status === 'awaiting') && (
        <section class="steward-tools" aria-labelledby="steward-heading">
          <h2 id="steward-heading">For the people looking after this project</h2>
          {project.status === 'open' && (
            <form method="post" action={`/projects/${project.id}/use`} class="stack">
              <Csrf c={c} />
              <h3>Record a use</h3>
              <p class="quiet">
                Everyone in the pool will see what it was for. Uses go to the project itself, never to anyone as pay.
              </p>
              <label for="use-amount">Amount</label>
              <input id="use-amount" name="amount" inputmode="decimal" required maxlength={30} />
              <label for="use-what">What it was for</label>
              <input id="use-what" name="description" required maxlength={500} />
              <button type="submit">Record the use</button>
            </form>
          )}
          <form method="post" action={`/projects/${project.id}/updates`} class="stack">
            <Csrf c={c} />
            <h3>Post an update</h3>
            <p class="quiet">Tell people how it is going and where it is heading, so they can decide whether to stay in.</p>
            <label for="update-body">Update</label>
            <textarea id="update-body" name="body" rows={4} required maxlength={5000}></textarea>
            <button type="submit">Post the update</button>
          </form>
          <form method="post" action={`/projects/${project.id}/finish`} class="stack">
            <Csrf c={c} />
            <h3>Finish the project</h3>
            <p class="quiet">Whatever is left in the pool goes back to everyone in it, in fair shares.</p>
            <fieldset>
              <legend>How did it end?</legend>
              {project.status === 'open' && (
                <label class="check">
                  <input type="radio" name="outcome" value="completed" required /> It happened. We are done.
                </label>
              )}
              <label class="check">
                <input type="radio" name="outcome" value="stopped" required /> It is not going ahead.
              </label>
            </fieldset>
            <label for="finish-note">A closing note for everyone</label>
            <textarea id="finish-note" name="note" rows={3} required maxlength={3000}></textarea>
            <button type="submit" class="secondary">
              Finish the project
            </button>
          </form>
          {notes.length > 0 && (
            <>
              <h3>Why people took their portions back</h3>
              <ul>
                {notes.map((note) => (
                  <li>
                    “{note.note}” <span class="quiet">({day(config, note.at)})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </article>,
  );
});

projects.post('/projects/:id/contribute', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const form = c.get('form');
  const amount = amountField(ctx.config, form);
  const value = contribute(ctx, id, c.get('member')!.id, amount, checked(form, 'showName'));
  flash(c, 'ok', `Thank you. You put in ${money(ctx.config, amount)}, and your portion is now ${money(ctx.config, value)}.`);
  return c.redirect(`/projects/${id}`, 303);
});

projects.post('/projects/:id/take-back', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const form = c.get('form');
  const amount = amountField(ctx.config, form);
  takeBack(ctx, id, c.get('member')!.id, amount, field(form, 'note'));
  flash(c, 'ok', `${money(ctx.config, amount)} is back with you.`);
  return c.redirect(`/projects/${id}`, 303);
});

projects.post('/projects/:id/use', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const form = c.get('form');
  useResources(ctx, id, c.get('member')!.id, amountField(ctx.config, form), field(form, 'description'));
  flash(c, 'ok', 'The use is recorded for everyone to see.');
  return c.redirect(`/projects/${id}`, 303);
});

projects.post('/projects/:id/updates', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  postUpdate(ctx, id, c.get('member')!.id, field(c.get('form'), 'body'));
  flash(c, 'ok', 'Your update is posted.');
  return c.redirect(`/projects/${id}`, 303);
});

projects.post('/projects/:id/finish', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const form = c.get('form');
  finishProject(ctx, id, c.get('member')!.id, field(form, 'outcome'), field(form, 'note'));
  flash(c, 'ok', 'The project is finished, and what was left in the pool has gone back to everyone in it.');
  return c.redirect(`/projects/${id}`, 303);
});

// ---------------------------------------------------------------- flagging

const FlagForm: FC<{ c: HonoContext<AppEnv>; project: Project; error?: string | undefined; form: Form }> = ({
  c,
  project,
  error,
  form,
}) => (
  <section class="narrow">
    <h1>Does this project break the charter?</h1>
    <p>
      If you think <a href={`/projects/${project.id}`}>{project.title}</a> breaks <a href="/charter">the charter</a>, say
      which part and why. When {plural(c.get('ctx').config.flagThreshold, 'person flags', 'different people flag')} a
      project, its pool pauses and a circle of people drawn at random decides. Your name is never shown to the stewards
      or the circle.
    </p>
    <ErrorSummary message={error} />
    <form method="post" action={`/projects/${project.id}/flag`} class="stack">
      <Csrf c={c} />
      <fieldset>
        <legend>Which part of the charter?</legend>
        {RULES.map((rule) => (
          <label class="check">
            <input type="radio" name="rule" value={rule.id} required checked={field(form, 'rule') === rule.id} />{' '}
            <strong>{rule.title}.</strong> {rule.summary}
          </label>
        ))}
      </fieldset>
      <label for="flag-note">Why you think so</label>
      <textarea id="flag-note" name="note" rows={4} required maxlength={1000}>
        {field(form, 'note')}
      </textarea>
      <button type="submit">Flag the project</button>
    </form>
  </section>
);

projects.get('/projects/:id/flag', signedIn, (c) => {
  const project = requireProject(c.get('ctx'), c.req.param('id'));
  return page(c, 'Flag a project', <FlagForm c={c} project={project} form={{}} />);
});

projects.post('/projects/:id/flag', signedIn, (c) => {
  const ctx = c.get('ctx');
  const project = requireProject(ctx, c.req.param('id'));
  const form = c.get('form');
  try {
    const result = flagProject(ctx, project.id, c.get('member')!.id, field(form, 'rule'), field(form, 'note'));
    flash(
      c,
      'ok',
      result.circleDrawn
        ? 'Thank you. Enough people have flagged this project that a charter circle has been drawn, and its pool is paused.'
        : 'Thank you. Your flag is recorded.',
    );
    return c.redirect(`/projects/${project.id}`, 303);
  } catch (error) {
    if (error instanceof Problem && error.status === 400) {
      return page(c, 'Flag a project', <FlagForm c={c} project={project} form={form} error={error.message} />, 400);
    }
    throw error;
  }
});
