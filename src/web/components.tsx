import type { Context as HonoContext } from 'hono';
import { raw } from 'hono/html';
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { Spirit } from '../core/charter.js';
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
  awaiting: 'Waiting for its charter circle',
  open: 'Pool open',
  review: 'Paused while a charter circle decides',
  completed: 'Completed',
  stopped: 'Stopped',
  closed: 'Closed by a charter circle',
  declined: 'Declined by a charter circle',
};

/** Renders a full page with the site's header and footer. */
export function page(c: HonoContext<AppEnv>, title: string, body: Child, status: 200 | 400 | 401 | 403 | 404 | 409 | 500 = 200) {
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
  return (
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="description"
          content="Pool resources with anyone in the world, for projects of creativity, adventure and joy."
        />
        <title>{title === config.siteName ? title : `${title} · ${config.siteName}`}</title>
        <link rel="stylesheet" href="/styles.css" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to the content
        </a>
        {config.demoResources && (
          <p class="banner">
            {config.siteName} is a prototype. The resources here are pretend for now, so nothing you pool is real money.
          </p>
        )}
        <header class="site">
          <a class="brand" href="/">
            {config.siteName}
          </a>
          <nav aria-label="Main">
            <a href="/" aria-current={here('/')}>
              Projects
            </a>
            <a href="/projects/new" aria-current={here('/projects/new')}>
              Suggest a project
            </a>
            <a href="/charter" aria-current={here('/charter')}>
              Charter
            </a>
            <a href="/costs" aria-current={here('/costs')}>
              Running costs
            </a>
            {member ? (
              <>
                <a href="/me" aria-current={here('/me')}>
                  {member.name}
                </a>
                <form method="post" action="/sign-out" class="inline">
                  <Csrf c={c} />
                  <button type="submit" class="link">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <a href="/sign-in" aria-current={here('/sign-in')}>
                  Sign in
                </a>
                <a href="/join" class="button small">
                  Join
                </a>
              </>
            )}
          </nav>
        </header>
        {flash && (
          <p class={`flash ${flash.kind}`} role={flash.kind === 'error' ? 'alert' : 'status'}>
            {flash.text}
          </p>
        )}
        <main id="main">{children}</main>
        <footer class="site">
          <p>
            {config.siteName} belongs to everyone who uses it. It takes no fees and makes no profit. Running costs are
            shared at exactly what they cost, in the open.
          </p>
          <p>
            <a href="/pooling">How pooling works</a> · <a href="/charter">The charter</a> ·{' '}
            <a href="/costs">Running costs</a> · <a href="/circles">Charter circles</a> ·{' '}
            <a href={config.sourceUrl}>Source code</a> (AGPL)
          </p>
          <p class="quiet">
            Amounts are in {config.currency.code}.
          </p>
        </footer>
      </body>
    </html>
  );
};

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

export interface Steward {
  readonly label: string;
  readonly href: string;
}

export function stewardOf(ctx: Context, project: Project): Steward {
  if (project.group_id) {
    const group = getGroup(ctx, project.group_id);
    if (group) return { label: group.name, href: `/groups/${group.handle}` };
  }
  const proposer = getMember(ctx, project.proposer_id);
  return proposer
    ? { label: proposer.name, href: `/people/${proposer.handle}` }
    : { label: 'Someone', href: '/' };
}

export const ProjectCard: FC<{ ctx: Context; project: Project }> = ({ ctx, project }) => {
  const steward = stewardOf(ctx, project);
  const finished = project.status === 'completed' || project.status === 'stopped';
  return (
    <li class="card">
      <SpiritTags spirits={project.spirits} />
      <h3>
        <a href={`/projects/${project.id}`}>{project.title}</a>
      </h3>
      <p>{project.summary}</p>
      <p class="meta">
        <StatusBadge status={project.status} />
        {finished ? (
          <span>{money(ctx.config, project.pool_used)} used for the project</span>
        ) : project.status === 'awaiting' ? (
          <span>Its pool opens if the circle agrees</span>
        ) : (
          <span>
            {plural(project.people, 'person', 'people')} · {money(ctx.config, project.pool_balance)} in the pool
          </span>
        )}
      </p>
      <p class="meta quiet">By {steward.label}</p>
    </li>
  );
};

export const ErrorSummary: FC<{ message: string | undefined }> = ({ message }) =>
  message ? (
    <p class="flash error" role="alert">
      {message}
    </p>
  ) : null;

export const Hint: FC<PropsWithChildren> = ({ children }) => <span class="hint">{children}</span>;
