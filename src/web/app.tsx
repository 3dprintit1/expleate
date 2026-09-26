import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { Problem, type Context } from '../services/context.js';
import { drawWaitingCircles, settleDueReviews } from '../services/reviews.js';
import { page } from './components.js';
import type { AppEnv } from './env.js';
import { accounts } from './routes/accounts.js';
import { api } from './routes/api.js';
import { circles } from './routes/circles.js';
import { costs } from './routes/costs.js';
import { display } from './routes/display.js';
import { groups } from './routes/groups.js';
import { me } from './routes/me.js';
import { pages } from './routes/pages.js';
import { projects } from './routes/projects.js';
import { safeNext } from './format.js';
import { flash, sessions } from './session.js';

export interface AppOptions {
  readonly context: Context;
  /** Serves /styles.css and friends when running on Node. Cloudflare serves them itself. */
  readonly staticFiles?: MiddlewareHandler;
  /** Set on Cloudflare, where the Worker does the slow part of password checks before a request arrives. */
  readonly edgeAuth?: boolean;
}

/** Where to send someone back to after a form they sent could not be carried out. */
function backTo(url: string, referer: string | undefined): string {
  const here = new URL(url);
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.host === here.host) return safeNext(from.pathname + from.search);
    } catch {
      // Fall through to the parent path.
    }
  }
  return safeNext(here.pathname.replace(/\/[^/]*$/, ''));
}

export function createApp({ context, staticFiles, edgeAuth = false }: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'"],
        scriptSrc: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );

  if (staticFiles) {
    app.use('/styles.css', staticFiles);
    app.use('/favicon.svg', staticFiles);
    app.use('/robots.txt', staticFiles);
    app.use('/fonts/*', staticFiles);
  }

  // Circle deadlines are settled as people use the site, at most once a minute.
  let lastSweep = 0;
  app.use('*', async (c, next) => {
    c.set('ctx', context);
    c.set('edgeAuth', edgeAuth);
    const now = context.now().getTime();
    if (now - lastSweep > 60_000) {
      lastSweep = now;
      settleDueReviews(context);
      drawWaitingCircles(context);
    }
    await next();
  });

  // Room for the longest story in any script: 10,000 characters of Japanese is about 90 KB once encoded.
  app.use(
    '*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: () => {
        throw new Problem('That was too much to send in one go.', 400);
      },
    }),
  );
  app.use('*', sessions());

  app.route('/', api);
  app.route('/', projects);
  app.route('/', accounts);
  app.route('/', me);
  app.route('/', groups);
  app.route('/', circles);
  app.route('/', costs);
  app.route('/', pages);
  app.route('/', display);

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    return page(
      c,
      'Not found',
      <section class="narrow">
        <h1>We could not find that page</h1>
        <p>
          <a href="/">Back to the projects</a>
        </p>
      </section>,
      404,
    );
  });

  app.onError((error, c) => {
    const problem = error instanceof Problem ? error : undefined;
    if (!problem) console.error(error);

    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: problem?.message ?? 'Something went wrong.' }, problem?.status ?? 500);
    }
    // A form that could not be carried out: go back to it and say why.
    if (problem && c.req.method === 'POST' && problem.status !== 401 && c.get('ctx')) {
      flash(c, 'error', problem.message);
      return c.redirect(backTo(c.req.url, c.req.header('referer')), 303);
    }
    if (problem?.status === 401) {
      return c.redirect(`/sign-in?next=${encodeURIComponent(backTo(c.req.url, c.req.header('referer')))}`, 303);
    }
    if (!c.get('ctx')) return c.text('Something went wrong.', 500);
    return page(
      c,
      problem ? 'Sorry' : 'Something went wrong',
      <section class="narrow">
        <h1>{problem ? 'Sorry' : 'Something went wrong'}</h1>
        <p>{problem?.message ?? 'Something went wrong on our side. Please try again in a moment.'}</p>
        <p>
          <a href="/">Back to the projects</a>
        </p>
      </section>,
      problem?.status ?? 500,
    );
  });

  return app;
}
