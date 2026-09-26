import type { Context as HonoContext } from 'hono';
import { raw } from 'hono/html';
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { Spirit } from '../core/charter.js';
import { toDecimalString } from '../core/money.js';
import type { Context } from '../services/context.js';
import { getGroup } from '../services/groups.js';
import { type Project, type ProjectStatus, getMember } from '../services/records.js';
import type { AppEnv } from './env.js';
import { money, plural } from './format.js';

export const SPIRIT_NAMES: Record<Spirit, string> = {
  creativity: 'Creativity',
  adventure: 'Adventure',
  joy: 'Joy',
};

export const STATUS_NAMES: Record<ProjectStatus, string> = {
  awaiting: 'Waiting for its circle',
  open: 'Open',
  review: 'Paused for a circle',
  completed: 'Completed',
  stopped: 'Stopped',
  closed: 'Closed by a circle',
  declined: 'Declined by a circle',
};

type Status = 200 | 400 | 401 | 403 | 404 | 409 | 500;

/** Renders a full page with the site's header and footer. */
export function page(c: HonoContext<AppEnv>, title: string, body: Child, status: Status = 200) {
  return c.html(
    <>
      {raw('<!DOCTYPE html>')}
      <Layout c={c} title={title}>
        {body}
      </Layout>
    </>,
    status,
  );
}

const Layout: FC<PropsWithChildren<{ c: HonoContext<AppEnv>; title: string }>> = ({ c, title, children }) => {
  const { config } = c.get('ctx');
  const member = c.get('member');
  const flash = c.get('flash');
  const path = c.req.path;
  const here = (href: string) => (path === href ? 'page' : undefined);
  const initial = member ? ([...member.name.trim()][0] ?? '?').toUpperCase() : '';
  return (
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="description"
          content="Pool together for things that bring joy. Put in what you like, and take it back if you change your mind."
        />
        <title>{title === config.siteName ? title : `${title} · ${config.siteName}`}</title>
        <link rel="preload" href="/fonts/manrope-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="stylesheet" href="/styles.css" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        {config.demoResources && <p class="banner">Prototype. The money here is pretend.</p>}
        <header class="site-header">
          <div class="bar">
            <a class="brand" href="/">
              <Logo />
              <span>{config.siteName}</span>
            </a>
            <nav class="nav" aria-label="Main">
              <a href="/" class="long" aria-current={here('/')}>
                Explore
              </a>
              <a href="/projects/new" aria-current={here('/projects/new')}>
                Suggest<span class="long"> a project</span>
              </a>
              {member ? (
                <a
                  href="/me"
                  class="avatar"
                  aria-current={here('/me')}
                  aria-label={`Your page, ${member.name}`}
                  title="Your page"
                >
                  {initial}
                </a>
              ) : (
                <>
                  <a href="/sign-in" aria-current={here('/sign-in')}>
                    Sign in
                  </a>
                  <a href="/join" class="button">
                    Join
                  </a>
                </>
              )}
            </nav>
          </div>
        </header>
        {flash && (
          <div class={`flash ${flash.kind}`} role={flash.kind === 'error' ? 'alert' : 'status'}>
            <p>{flash.text}</p>
          </div>
        )}
        <main id="main">{children}</main>
        <footer class="site-footer">
          <nav aria-label="About">
            <a href="/pooling">How pooling works</a>
            <a href="/charter">The charter</a>
            <a href="/costs">Running costs</a>
            <a href="/circles">Circles</a>
            <a href={config.sourceUrl}>Source code</a>
          </nav>
          <p>Nobody profits here. Running costs are shared at cost, in the open. Amounts are in {config.currency.code}.</p>
        </footer>
      </body>
    </html>
  );
};

export const Logo: FC = () => (
  <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <clipPath id="logo-clip">
        <circle cx="16" cy="16" r="15" />
      </clipPath>
    </defs>
    <g clip-path="url(#logo-clip)">
      <rect class="air" width="32" height="32" />
      <path class="water" d="M-4 17 q4 -3.2 8 0 t8 0 t8 0 t8 0 t8 0 V 40 H -4 Z" />
    </g>
    <circle class="rim" cx="16" cy="16" r="15.5" />
  </svg>
);

// One wavelength is 50 units, so sliding a wave 50 units along loops seamlessly.
const WAVE_FRONT = `M-100 0 q12.5 -4 25 0 ${'t25 0 '.repeat(11)}V 110 H -100 Z`;
const WAVE_BACK = `M-100 -3 q12.5 4 25 0 ${'t25 0 '.repeat(11)}V 110 H -100 Z`;

/**
 * A pool drawn as a circle of water. The level shows how much has been
 * gathered towards what the project hopes for.
 */
export const Gauge: FC<{ id: string; fraction: number; label: string }> = ({ id, fraction, label }) => {
  const level = 97 - Math.max(0, Math.min(1, fraction)) * 92;
  const clip = `pool-${id}`;
  return (
    <svg class="gauge" viewBox="0 0 100 100" role="img" aria-label={label}>
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="49" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${clip})`}>
        <rect class="air" width="100" height="100" />
        <g transform={`translate(0 ${level.toFixed(1)})`}>
          <path class="wave-back" d={WAVE_BACK} />
          <path class="wave-front" d={WAVE_FRONT} />
        </g>
      </g>
      <circle class="rim" cx="50" cy="50" r="49.5" />
    </svg>
  );
};

type IconName = 'sprout' | 'drop' | 'ripple' | 'return';

const ICONS: Record<IconName, string> = {
  sprout:
    '<path d="M12 21v-8"/><path d="M12 13c0-4.4 3-7.5 7.5-7.5 0 4.4-3 7.5-7.5 7.5z"/><path d="M12 15.5C12 12 9.5 9.5 5 9.5c0 3.5 2.5 6 7 6z"/>',
  drop: '<path d="M12 3.2c3.6 4.4 6.2 7.8 6.2 11.1a6.2 6.2 0 0 1-12.4 0c0-3.3 2.6-6.7 6.2-11.1z"/>',
  ripple:
    '<circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="5.8" opacity=".7"/><circle cx="12" cy="12" r="9.4" opacity=".4"/>',
  return: '<path d="M20 19v-4.5a5 5 0 0 0-5-5H5"/><path d="m9 5.5-4 4 4 4"/>',
};

export const Icon: FC<{ name: IconName }> = ({ name }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    {raw(ICONS[name])}
  </svg>
);

export const Csrf: FC<{ c: HonoContext<AppEnv> }> = ({ c }) => <input type="hidden" name="_csrf" value={c.get('csrf')} />;

/** Writing that people typed, with paragraphs and line breaks kept and everything else escaped. */
export const Paragraphs: FC<{ text: string }> = ({ text }) => (
  <>
    {text
      .split(/\n{2,}/)
      .filter((part) => part.trim() !== '')
      .map((part) => {
        const lines = part.split('\n');
        return (
          <p>
            {lines.map((line, index) => (
              <>
                {line}
                {index < lines.length - 1 && <br />}
              </>
            ))}
          </p>
        );
      })}
  </>
);

export const SpiritTags: FC<{ spirits: readonly Spirit[] }> = ({ spirits }) => (
  <ul class="spirits" aria-label="Spirit">
    {spirits.map((spirit) => (
      <li class={`spirit ${spirit}`}>{SPIRIT_NAMES[spirit]}</li>
    ))}
  </ul>
);

export const StatusBadge: FC<{ status: ProjectStatus }> = ({ status }) =>
  status === 'open' ? null : <span class={`status ${status}`}>{STATUS_NAMES[status]}</span>;

export interface Host {
  readonly label: string;
  readonly href: string;
}

export function hostOf(ctx: Context, project: Project): Host {
  if (project.group_id) {
    const group = getGroup(ctx, project.group_id);
    if (group) return { label: group.name, href: `/groups/${group.handle}` };
  }
  const proposer = getMember(ctx, project.proposer_id);
  return proposer ? { label: proposer.name, href: `/people/${proposer.handle}` } : { label: 'Someone', href: '/' };
}

/** Everything gathered into a pool so far: what it holds now plus what it has used. */
export function gathered(project: Project): number {
  return project.pool_balance + project.pool_used + project.pool_costs;
}

export const ProjectCard: FC<{ ctx: Context; project: Project }> = ({ ctx, project }) => {
  const { config } = ctx;
  const sofar = gathered(project);
  let facts: Child;
  if (project.status === 'awaiting') {
    facts = <span>Opens if its circle agrees</span>;
  } else if (project.status === 'completed' || project.status === 'stopped') {
    facts = (
      <span>
        <strong>{money(config, project.pool_used)}</strong> used · by {hostOf(ctx, project).label}
      </span>
    );
  } else if (project.hope) {
    facts = (
      <span>
        <strong>{money(config, sofar)}</strong> of {money(config, project.hope)} ·{' '}
        {plural(project.people, 'person', 'people')}
      </span>
    );
  } else {
    facts = (
      <span>
        <strong>{money(config, project.pool_balance)}</strong> pooled · {plural(project.people, 'person', 'people')}
      </span>
    );
  }
  return (
    <li class="card glass">
      <div class="actions">
        <SpiritTags spirits={project.spirits} />
        <StatusBadge status={project.status} />
      </div>
      <h3>
        <a href={`/projects/${project.id}`}>{project.title}</a>
      </h3>
      <p>{project.summary}</p>
      <div class="card-foot">
        {project.hope ? (
          <Gauge
            id={project.id}
            fraction={sofar / project.hope}
            label={`${money(config, sofar)} of ${money(config, project.hope)} gathered`}
          />
        ) : (
          <Icon name="drop" />
        )}
        {facts}
      </div>
    </li>
  );
};

/** Ready-made amounts as soft buttons, with a box for any other amount. */
export const AmountChoice: FC<{
  config: Context['config'];
  presets: readonly bigint[];
  idPrefix: string;
  otherLabel: string;
  all?: { label: string; amount: bigint } | undefined;
}> = ({ config, presets, idPrefix, otherLabel, all }) => (
  <>
    <div class="chips" role="radiogroup" aria-label="Choose an amount">
      {presets.map((amount) => (
        <label class="chip">
          <input type="radio" name="preset" value={toDecimalString(amount, config.currency)} />
          <span>{money(config, amount)}</span>
        </label>
      ))}
      {all && all.amount > 0n && (
        <label class="chip">
          <input type="radio" name="preset" value={toDecimalString(all.amount, config.currency)} />
          <span>{all.label}</span>
        </label>
      )}
    </div>
    <label class="label" for={`${idPrefix}-amount`}>
      {otherLabel}
    </label>
    <input id={`${idPrefix}-amount`} class="amount" name="amount" inputmode="decimal" autocomplete="off" maxlength={30} />
  </>
);

/** Everyday amounts to offer as one-tap choices, in the site's currency. */
export function putInPresets(config: Context['config']): bigint[] {
  const unit = 10n ** BigInt(config.currency.digits) * (config.currency.digits === 0 ? 100n : 1n);
  return [5n, 10n, 20n, 50n].map((n) => n * unit);
}

export const ErrorSummary: FC<{ message: string | undefined }> = ({ message }) =>
  message ? (
    <div class="flash error" role="alert">
      <p>{message}</p>
    </div>
  ) : null;

export const Hint: FC<PropsWithChildren> = ({ children }) => <span class="hint">{children}</span>;
