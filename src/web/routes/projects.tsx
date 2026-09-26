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
import { type Project, isHost, requireProject } from '../../services/records.js';
import { flagProject, reviewsForProject } from '../../services/reviews.js';
import {
  AmountChoice,
  Csrf,
  ErrorSummary,
  Gauge,
  Hint,
  Icon,
  Paragraphs,
  ProjectCard,
  SPIRIT_NAMES,
  STATUS_NAMES,
  SpiritTags,
  StatusBadge,
  gathered,
  hostOf,
  page,
  putInPresets,
} from '../components.js';
import type { AppEnv, Form } from '../env.js';
import { amountField, checked, day, field, fields, money, plural } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const projects = new Hono<AppEnv>();

// ---------------------------------------------------------------- the home page

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
  const firstView = pageNumber === 0 && !spirit && show === 'live' && order === 'shuffled';

  const link = (changes: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = {
      spirit,
      order: order === 'shuffled' ? undefined : order,
      show: show === 'live' ? undefined : show,
      page: undefined,
      ...changes,
    };
    for (const [key, value] of Object.entries(merged)) if (value !== undefined) params.set(key, String(value));
    const query = params.toString();
    return `${query ? `/?${query}` : '/'}#projects`;
  };

  return page(
    c,
    ctx.config.siteName,
    <>
      {firstView && (
        <>
          <section class="hero">
            <div>
              <h1>Pool together for things that bring joy.</h1>
              <p class="lead">
                Suggest a project, or put something into one you love. If you change your mind, take your portion back.
                Nobody makes a profit.
              </p>
              <div class="actions">
                <a class="button" href="#projects">
                  Explore projects
                </a>
                <a class="button ghost" href="/projects/new">
                  Suggest a project
                </a>
              </div>
              <p class="worldview">
                Built as if everyone already had an equal share of the world. <a href="/charter">Read the charter</a>
              </p>
            </div>
            <div class="hero-pool" aria-hidden="true">
              <Gauge id="hero" fraction={0.62} label="" />
            </div>
          </section>
          <ol class="steps" aria-label="How it works">
            <li class="glass">
              <Icon name="sprout" />
              Someone suggests a project.
            </li>
            <li class="glass">
              <Icon name="drop" />
              Anyone puts in what they like.
            </li>
            <li class="glass">
              <Icon name="ripple" />
              Every use of the pool is public.
            </li>
            <li class="glass">
              <Icon name="return" />
              Leave any time with your portion.
            </li>
          </ol>
        </>
      )}
      <section id="projects">
        <div class="toolbar">
          <h2>{show === 'finished' ? 'Finished projects' : 'Projects'}</h2>
          <nav class="filters" aria-label="Show projects about">
            <a href={link({ spirit: undefined })} aria-current={!spirit ? 'page' : undefined}>
              All
            </a>
            {SPIRITS.map((s) => (
              <a href={link({ spirit: s })} aria-current={spirit === s ? 'page' : undefined}>
                {SPIRIT_NAMES[s]}
              </a>
            ))}
          </nav>
        </div>
        {list.length === 0 ? (
          <div class="empty glass">
            <p>{show === 'finished' ? 'No finished projects yet.' : 'Nothing here yet.'}</p>
            <a class="button" href="/projects/new">
              Suggest the first one
            </a>
          </div>
        ) : (
          <ul class="cards">
            {list.map((project) => (
              <ProjectCard ctx={ctx} project={project} />
            ))}
          </ul>
        )}
        <p class="pager">
          {pageNumber > 0 && (
            <a class="button ghost" href={link({ page: pageNumber - 1 || undefined })}>
              Previous
            </a>
          )}
          {more && (
            <a class="button ghost" href={link({ page: pageNumber + 1 })}>
              More projects
            </a>
          )}
        </p>
        <p class="faint">
          {(Object.keys(ORDERS) as ListOrder[]).map((o, index) => (
            <>
              {index > 0 && ' · '}
              {order === o ? (
                <strong>{ORDERS[o]}</strong>
              ) : (
                <a href={link({ order: o === 'shuffled' ? undefined : o })}>{ORDERS[o]}</a>
              )}
            </>
          ))}
          {' · '}
          {show === 'finished' ? (
            <a href={link({ show: undefined })}>Live projects</a>
          ) : (
            <a href={link({ show: 'finished' })}>Finished projects</a>
          )}
        </p>
      </section>
    </>,
  );
});

// ---------------------------------------------------------------- suggesting a project

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
  const topics = concerns
    ? new Intl.ListFormat('en-GB', { type: 'disjunction' }).format([
        ...new Set(concerns.map((concern) => ruleById(concern.rule)?.topic ?? concern.rule)),
      ])
    : '';
  return (
    <section class="narrow">
      <h1>Suggest a project</h1>
      <p class="lead">Something people can make, explore or enjoy together.</p>
      <p class="faint">
        It can’t involve politics, war, profit or charity. <a href="/charter">Read the charter</a>
      </p>
      <ErrorSummary message={error} />
      <form method="post" action="/projects" class="form glass panel">
        <Csrf c={c} />
        {concerns && concerns.length > 0 && (
          <div class="note" role="alert">
            <h2>Some words need a second look</h2>
            <p>These often mean a project is about {topics}:</p>
            <ul>
              {concerns.map((concern) => (
                <li>
                  <strong>“{concern.term}”</strong> in “{concern.excerpt}”
                </li>
              ))}
            </ul>
            <p>
              Reword them, or tell us why the project fits. A circle of people picked at random will read your reason and
              decide.
            </p>
            <label class="label" for="concernNote">
              Why it fits
            </label>
            <textarea id="concernNote" name="concernNote" rows={3} maxlength={2000}>
              {field(form, 'concernNote')}
            </textarea>
            <input type="hidden" name="concernNoteShown" value="yes" />
          </div>
        )}

        <label for="title">Title</label>
        <input
          id="title"
          name="title"
          required
          maxlength={100}
          placeholder="A mural of every bird in the valley"
          value={field(form, 'title')}
        />

        <label for="summary">In one line</label>
        <input
          id="summary"
          name="summary"
          required
          maxlength={200}
          placeholder="Painting all 64 birds seen in our valley"
          value={field(form, 'summary')}
        />

        <label for="story">What will happen?</label>
        <Hint>Who can join in, and why it will be a joy.</Hint>
        <textarea id="story" name="story" required rows={7} maxlength={10000}>
          {field(form, 'story')}
        </textarea>

        <label for="plans">What will the pool pay for?</label>
        <Hint>Materials, tools, travel, a place. Never wages.</Hint>
        <textarea id="plans" name="plans" required rows={4} maxlength={5000}>
          {field(form, 'plans')}
        </textarea>

        <label for="hope">How much do you hope to gather?</label>
        <Hint>A rough guess is fine.</Hint>
        <input id="hope" name="hope" class="amount" inputmode="decimal" required maxlength={30} value={field(form, 'hope')} />

        <fieldset>
          <legend class="label">Its spirit</legend>
          <div class="chips">
            {SPIRITS.map((spirit) => (
              <label class="chip">
                <input type="checkbox" name="spirits" value={spirit} checked={chosen.has(spirit)} />
                <span>{SPIRIT_NAMES[spirit]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {groups.length > 0 && (
          <>
            <label for="groupId">Host it as</label>
            <select id="groupId" name="groupId">
              <option value="">Yourself</option>
              {groups.map((group) => (
                <option value={group.id} selected={field(form, 'groupId') === group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </>
        )}

        <label class="check">
          <input type="checkbox" name="agreed" value="yes" checked={checked(form, 'agreed')} required />
          <span>It fits the charter.</span>
        </label>
        <button type="submit">{concerns && concerns.length > 0 ? 'Send to a circle' : 'Suggest it'}</button>
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
    if (hopeText === '') throw new Problem('How much do you hope to gather? A rough guess is fine.', 400, 'hope');
    const hope = parseAmount(hopeText, ctx.config.currency);
    if (!hope.ok) throw new Problem(`How much you hope to gather: ${hope.reason}`, 400, 'hope');
    const input: ProposalInput = {
      title: field(form, 'title'),
      summary: field(form, 'summary'),
      story: field(form, 'story'),
      plans: field(form, 'plans'),
      spirits: fields(form, 'spirits'),
      hope: hope.amount,
      groupId: field(form, 'groupId') || null,
      concernNote: field(form, 'concernNote'),
      agreed: checked(form, 'agreed'),
    };
    const result = proposeProject(ctx, member.id, input);
    if (result.kind === 'concerns') {
      const error = field(form, 'concernNoteShown') ? 'Please give a reason of at least 20 characters.' : undefined;
      return page(c, 'Suggest a project', <ProposeForm c={c} form={form} concerns={result.concerns} error={error} />, 400);
    }
    flash(c, 'ok', result.project.status === 'open' ? 'Your project is live.' : 'Thanks. A circle has been picked to read your reason.');
    return c.redirect(`/projects/${result.project.id}`, 303);
  } catch (error) {
    if (error instanceof Problem && error.status === 400) {
      return page(c, 'Suggest a project', <ProposeForm c={c} form={form} error={error.message} />, 400);
    }
    throw error;
  }
});

// ---------------------------------------------------------------- one project

const PoolCard: FC<{ c: HonoContext<AppEnv>; project: Project }> = ({ c, project }) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member');
  const portion = member ? portionFor(ctx, project, member.id) : undefined;
  const people = poolPeople(ctx, project);
  const sofar = gathered(project);
  const live = project.status === 'open' || project.status === 'review';
  const others = people.total - people.named.length;
  const kept = portion ? portion.putIn - portion.takenBack - portion.returned : 0n;
  const shrunk = portion ? kept - portion.value > 1n : false;

  return (
    <aside class="pool glass" aria-label="The pool">
      {project.hope !== null && (
        <Gauge
          id={project.id}
          fraction={sofar / project.hope}
          label={`${money(config, sofar)} of ${money(config, project.hope)} gathered`}
        />
      )}
      <div class="pool-figure">
        <span class="big">{money(config, project.pool_balance)}</span>
        <span class="quiet">in the pool</span>
        <p class="pool-facts">
          <span>{plural(people.total, 'person', 'people')}</span>
          {project.pool_used > 0 && <span>{money(config, project.pool_used)} used</span>}
          {project.pool_costs > 0 && <span>{money(config, project.pool_costs)} running costs</span>}
          {project.pool_returned > 0 && <span>{money(config, project.pool_returned)} handed back</span>}
        </p>
        {project.hope !== null && (
          <p class="faint">
            {money(config, sofar)} of {money(config, project.hope)} gathered
          </p>
        )}
      </div>
      {people.named.length > 0 && (
        <p class="faint">
          With{' '}
          {people.named.map((person, index) => (
            <>
              {index > 0 && ', '}
              <a href={`/people/${person.handle}`}>{person.name}</a>
            </>
          ))}
          {others > 0 && ` and ${plural(others, 'other', 'others')}`}
        </p>
      )}

      {project.status === 'open' &&
        (member ? (
          <form method="post" action={`/projects/${project.id}/contribute`} class="form">
            <Csrf c={c} />
            <hr class="divider" />
            <h3>Put something in</h3>
            <AmountChoice config={config} presets={putInPresets(config)} idPrefix="put" otherLabel="Or another amount" />
            <label class="check">
              <input type="checkbox" name="showName" value="yes" checked={portion ? portion.showName : true} />
              <span>Show my name here, never the amount</span>
            </label>
            <button type="submit">Put in</button>
            <p class="faint">
              You have {money(config, member.balance)} ready to put in.
              {member.balance === 0 && config.demoResources && (
                <>
                  {' '}
                  <a href="/me">Add pretend money</a>
                </>
              )}
            </p>
          </form>
        ) : (
          <p class="actions">
            <a class="button" href="/join">
              Join to put something in
            </a>
            <a href={`/sign-in?next=/projects/${project.id}`}>Sign in</a>
          </p>
        ))}

      {portion && portion.putIn > 0n && (live || portion.value > 0n) && (
        <div class="portion">
          <hr class="divider" />
          <h3>Your portion</h3>
          <p class="big">{money(config, portion.value)}</p>
          <p class="faint">
            You put in {money(config, portion.putIn)}
            {portion.takenBack > 0n && ` and took back ${money(config, portion.takenBack)}`}.
            {shrunk && ' The project has used part of the pool, and every portion shrank by the same share.'}
          </p>
          {live && portion.value > 0n && (
            <details>
              <summary>Take some back</summary>
              <form method="post" action={`/projects/${project.id}/take-back`} class="form">
                <Csrf c={c} />
                <AmountChoice
                  config={config}
                  presets={[]}
                  idPrefix="take"
                  otherLabel={`Or an amount up to ${money(config, portion.value)}`}
                  all={{ label: `All of it, ${money(config, portion.value)}`, amount: portion.value }}
                />
                <label for="take-note">Tell the hosts why (optional)</label>
                <Hint>They see the note, never your name.</Hint>
                <input id="take-note" name="note" maxlength={500} />
                <button type="submit" class="ghost">
                  Take back
                </button>
              </form>
            </details>
          )}
        </div>
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

const HostTools: FC<{ c: HonoContext<AppEnv>; project: Project }> = ({ c, project }) => {
  const ctx = c.get('ctx');
  const notes = takeBackNotes(ctx, project.id);
  return (
    <details class="section glass host-tools">
      <summary>Host tools</summary>
      {project.status === 'open' && (
        <form method="post" action={`/projects/${project.id}/use`} class="form">
          <Csrf c={c} />
          <h3>Record a use</h3>
          <Hint>Everyone sees what it was for. Pools pay for the project, never for people.</Hint>
          <label for="use-amount">Amount</label>
          <input id="use-amount" class="amount" name="amount" inputmode="decimal" required maxlength={30} />
          <label for="use-what">What for?</label>
          <input id="use-what" name="description" required maxlength={500} placeholder="Twelve tins of paint" />
          <button type="submit">Record the use</button>
        </form>
      )}
      <form method="post" action={`/projects/${project.id}/updates`} class="form">
        <Csrf c={c} />
        <h3>Share news</h3>
        <Hint>Tell people where the project is heading, so they can decide whether to stay in.</Hint>
        <label for="update-body" class="visually-hidden">
          News
        </label>
        <textarea id="update-body" name="body" rows={3} required maxlength={5000}></textarea>
        <button type="submit">Share</button>
      </form>
      <form method="post" action={`/projects/${project.id}/finish`} class="form">
        <Csrf c={c} />
        <h3>Finish the project</h3>
        <Hint>What is left in the pool goes back to everyone in it, in fair shares.</Hint>
        <div class="choices">
          {project.status === 'open' && (
            <label class="choice">
              <input type="radio" name="outcome" value="completed" required />
              <span>It happened</span>
            </label>
          )}
          <label class="choice">
            <input type="radio" name="outcome" value="stopped" required />
            <span>It is not going ahead</span>
          </label>
        </div>
        <label for="finish-note">A last word for everyone</label>
        <textarea id="finish-note" name="note" rows={3} required maxlength={3000}></textarea>
        <button type="submit" class="ghost">
          Finish
        </button>
      </form>
      {notes.length > 0 && (
        <>
          <h3>Why people took money back</h3>
          <ul>
            {notes.map((note) => (
              <li>
                “{note.note}” <span class="faint">{day(ctx.config, note.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
};

projects.get('/projects/:id', (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  const member = c.get('member');
  const project = requireProject(ctx, c.req.param('id'));
  const host = member ? isHost(ctx, project, member.id) : false;
  const by = hostOf(ctx, project);
  const updates = projectUpdates(ctx, project.id);
  const ledger = poolLedger(ctx, project.id);
  const openReview = reviewsForProject(ctx, project.id).find((review) => review.status === 'open');
  const finished = project.status === 'completed' || project.status === 'stopped' || project.status === 'closed';

  return page(
    c,
    project.title,
    <article>
      <a class="back" href="/">
        ← All projects
      </a>
      <header class="project-head">
        <div class="actions">
          <SpiritTags spirits={project.spirits} />
          <StatusBadge status={project.status} />
        </div>
        <h1>{project.title}</h1>
        <p class="lead">{project.summary}</p>
        <p class="faint">
          Hosted by <a href={by.href}>{by.label}</a> · {day(config, project.created_at)}
        </p>
        {project.status !== 'open' && (
          <p class={`status-line ${project.status}`}>
            <strong>{STATUS_NAMES[project.status]}.</strong>{' '}
            {openReview && (
              <>
                A few people picked at random are deciding whether it fits the charter.{' '}
                <a href={`/circles/${openReview.id}`}>See the circle</a>
              </>
            )}
            {finished && 'What was left in the pool has gone back to the people in it.'}
          </p>
        )}
        {project.closing_note && (
          <blockquote>
            <Paragraphs text={project.closing_note} />
          </blockquote>
        )}
      </header>

      <div class="layout">
        <PoolCard c={c} project={project} />
        <div class="story">
          <h2>The idea</h2>
          <Paragraphs text={project.story} />
          <h2>What the pool pays for</h2>
          <Paragraphs text={project.plans} />

          {updates.length > 0 && (
            <>
              <h2>News</h2>
              <ol class="updates">
                {updates.map((update) => (
                  <li>
                    <p class="faint">
                      <a href={`/people/${update.author_handle}`}>{update.author_name}</a> ·{' '}
                      {day(config, update.created_at)}
                    </p>
                    <Paragraphs text={update.body} />
                  </li>
                ))}
              </ol>
            </>
          )}

          <details class="section glass">
            <summary>Every movement in and out of the pool</summary>
            {ledger.length === 0 ? (
              <p class="faint">Nothing yet.</p>
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
                      <th scope="col" class="num">
                        Pool after
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => (
                      <tr>
                        <td>{day(config, entry.at)}</td>
                        <td>
                          {LEDGER_WORDS[entry.kind]}
                          {entry.kind === 'use' && (
                            <>
                              : {entry.note} <span class="faint">({entry.by})</span>
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
              </div>
            )}
            <p class="faint">Names never appear here, except on uses, which show the host who recorded them.</p>
          </details>

          {host && (project.status === 'open' || project.status === 'review' || project.status === 'awaiting') && (
            <HostTools c={c} project={project} />
          )}

          {project.status === 'open' && !host && (
            <p class="report faint">
              Does this project break the charter? <a href={`/projects/${project.id}/flag`}>Tell us</a>
            </p>
          )}
        </div>
      </div>
    </article>,
  );
});

projects.post('/projects/:id/contribute', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const form = c.get('form');
  const amount = amountField(ctx.config, form);
  const value = contribute(ctx, id, c.get('member')!.id, amount, checked(form, 'showName'));
  flash(c, 'ok', `Thank you. Your portion is now ${money(ctx.config, value)}.`);
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
  flash(c, 'ok', 'Use recorded. Everyone can see it.');
  return c.redirect(`/projects/${id}`, 303);
});

projects.post('/projects/:id/updates', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  postUpdate(ctx, id, c.get('member')!.id, field(c.get('form'), 'body'));
  flash(c, 'ok', 'News shared.');
  return c.redirect(`/projects/${id}`, 303);
});

projects.post('/projects/:id/finish', signedIn, (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const form = c.get('form');
  finishProject(ctx, id, c.get('member')!.id, field(form, 'outcome'), field(form, 'note'));
  flash(c, 'ok', 'Project finished. What was left has gone back to everyone in the pool.');
  return c.redirect(`/projects/${id}`, 303);
});

// ---------------------------------------------------------------- flagging

const FlagForm: FC<{ c: HonoContext<AppEnv>; project: Project; error?: string | undefined; form: Form }> = ({
  c,
  project,
  error,
  form,
}) => {
  const threshold = c.get('ctx').config.flagThreshold;
  return (
    <section class="narrow">
      <a class="back" href={`/projects/${project.id}`}>
        ← {project.title}
      </a>
      <h1>Does this break the charter?</h1>
      <p class="lead">Tell us which rule, and why.</p>
      <p class="faint">
        When {plural(threshold, 'person flags', 'people flag')} a project, its pool pauses and a circle picked at random
        decides. Nobody sees your name.
      </p>
      <ErrorSummary message={error} />
      <form method="post" action={`/projects/${project.id}/flag`} class="form glass panel">
        <Csrf c={c} />
        <fieldset>
          <legend class="label">Which rule?</legend>
          <div class="choices">
            {RULES.map((rule) => (
              <label class="choice">
                <input type="radio" name="rule" value={rule.id} required checked={field(form, 'rule') === rule.id} />
                <span>
                  <strong>{rule.title}</strong>
                  <small>{rule.summary}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label for="flag-note">Why?</label>
        <textarea id="flag-note" name="note" rows={3} required maxlength={1000}>
          {field(form, 'note')}
        </textarea>
        <button type="submit">Flag it</button>
      </form>
    </section>
  );
};

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
        ? 'Thanks. Enough people have flagged it, so the pool is paused and a circle has been picked.'
        : 'Thanks. Your flag is in.',
    );
    return c.redirect(`/projects/${project.id}`, 303);
  } catch (error) {
    if (error instanceof Problem && error.status === 400) {
      return page(c, 'Flag a project', <FlagForm c={c} project={project} form={form} error={error.message} />, 400);
    }
    throw error;
  }
});
