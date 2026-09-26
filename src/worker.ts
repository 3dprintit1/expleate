/**
 * Runs Expleate on Cloudflare.
 *
 * Every request goes to a single Durable Object, the Commons, which keeps the
 * whole ledger in its own SQLite database and handles one request at a time.
 * A pool's balance is read, worked out and written back with nothing able to
 * run in between, which is what keeps every pool's books exact.
 *
 * Because the Commons handles one request at a time, anything slow must
 * happen before a request reaches it. The slowest thing on the site is
 * checking a password (deliberately so), so the Worker does that part here at
 * the edge, close to the person, and passes the result inward.
 */
import { DurableObject } from 'cloudflare:workers';
import { claudeReader } from './ai/claude-reader.js';
import { configFromEnv } from './config.js';
import { hashPassword, passwordProof, randomInt } from './core/crypto.js';
import type { Context } from './services/context.js';
import { shareRunningCosts } from './services/costs.js';
import { passwordSalt } from './services/members.js';
import { readUnreadProjects } from './services/reader.js';
import { drawWaitingCircles, settleDueReviews } from './services/reviews.js';
import { durableObjectSql } from './store/do-sqlite.js';
import { migrate } from './store/schema.js';
import { createApp } from './web/app.js';
import { EDGE_HEADERS, EDGE_HEADER_NAMES } from './web/edge.js';

function textSettings(env: Env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export class Commons extends DurableObject<Env> {
  private readonly services: Context;
  private readonly app: ReturnType<typeof createApp>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    const sql = durableObjectSql(state.storage);
    migrate(sql);
    const settings = textSettings(env);
    const config = configFromEnv(settings);
    // The charter reader runs only when an Anthropic API key has been set as a secret.
    const apiKey = settings.ANTHROPIC_API_KEY?.trim();
    const reader = apiKey
      ? claudeReader({ apiKey, model: config.readerModel, baseURL: settings.ANTHROPIC_BASE_URL?.trim() })
      : undefined;
    this.services = { sql, config, now: () => new Date(), randomInt, reader };
    this.app = createApp({ context: this.services, edgeAuth: true });
  }

  override async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  /** The salt for a handle, so the edge can check a password without holding up the Commons. */
  passwordSalt(handle: string): { salt: string; iterations: number } {
    return passwordSalt(this.services, handle);
  }

  /**
   * The daily round: settle charter circles whose time is up, draw any that
   * are still waiting for people, on the first of the month share running
   * costs across the pools, and let the charter reader catch up on projects
   * it has not read.
   */
  async daily(): Promise<{ settled: number; shared: number; read: number }> {
    const settled = settleDueReviews(this.services);
    drawWaitingCircles(this.services);
    const shared = this.services.now().getUTCDate() === 1 ? shareRunningCosts(this.services)?.amount ?? 0n : 0n;
    const read = await readUnreadProjects(this.services);
    return { settled, shared: Number(shared), read };
  }
}

function commons(env: Env) {
  return env.COMMONS.get(env.COMMONS.idFromName('commons'));
}

/** Tries allowed per minute, per place and per handle, before we ask people to slow down. */
async function tooMany(env: Env, keys: readonly string[]): Promise<boolean> {
  const outcomes = await Promise.all(keys.map((key) => env.AUTH_LIMIT.limit({ key })));
  return outcomes.some((outcome) => !outcome.success);
}

/**
 * Joining and signing in: rate-limit, then do the slow password work here and
 * pass only the result to the Commons.
 */
async function withPasswordWork(request: Request, env: Env, headers: Headers, path: string): Promise<Request> {
  const body = await request.text();
  const form = new URLSearchParams(body);
  const place = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const handle = (form.get('handle') ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 32);
  const keys = path === '/sign-in' && handle ? [`place:${place}`, `handle:${handle}`] : [`place:${place}`];

  if (await tooMany(env, keys)) {
    headers.set(EDGE_HEADERS.slowDown, '1');
  } else {
    const password = form.get('password') ?? '';
    if (path === '/join') {
      // A password of the wrong length is left unhashed; the site explains what is wrong.
      if (password.length >= 10 && password.length <= 200) {
        headers.set(EDGE_HEADERS.passwordHash, await hashPassword(password));
      }
    } else {
      const { salt, iterations } = await commons(env).passwordSalt(handle);
      headers.set(EDGE_HEADERS.passwordProof, await passwordProof(password.slice(0, 200), salt, iterations));
    }
  }
  // Redirects go back to the browser, which must see the new session cookie.
  return new Request(request.url, { method: 'POST', headers, body, redirect: 'manual' });
}

export default {
  async fetch(request, env) {
    // Nobody outside may pretend the edge has already checked a password.
    const headers = new Headers(request.headers);
    for (const name of EDGE_HEADER_NAMES) headers.delete(name);

    const path = new URL(request.url).pathname;
    const type = request.headers.get('content-type') ?? '';
    if (request.method === 'POST' && (path === '/join' || path === '/sign-in') && type.startsWith('application/x-www-form-urlencoded')) {
      return commons(env).fetch(await withPasswordWork(request, env, headers, path));
    }
    return commons(env).fetch(new Request(request, { headers, redirect: 'manual' }));
  },

  async scheduled(_controller, env) {
    const result = await commons(env).daily();
    console.log(
      `Daily round: ${result.settled} circles settled, ${result.shared} shared as running costs, ${result.read} projects read`,
    );
  },
} satisfies ExportedHandler<Env>;
