/**
 * Runs Expleate on Cloudflare.
 *
 * Every request goes to a single Durable Object, the Commons, which keeps the
 * whole ledger in its own SQLite database and handles one request at a time.
 * A pool's balance is read, worked out and written back with nothing able to
 * run in between, which is what keeps every pool's books exact.
 */
import { DurableObject } from 'cloudflare:workers';
import { configFromEnv } from './config.js';
import { randomInt } from './core/crypto.js';
import type { Context } from './services/context.js';
import { shareRunningCosts } from './services/costs.js';
import { drawWaitingCircles, settleDueReviews } from './services/reviews.js';
import { durableObjectSql } from './store/do-sqlite.js';
import { migrate } from './store/schema.js';
import { createApp } from './web/app.js';

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
    this.services = { sql, config: configFromEnv(textSettings(env)), now: () => new Date(), randomInt };
    this.app = createApp({ context: this.services });
  }

  override async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  /**
   * The daily round: settle charter circles whose time is up, draw any that
   * are still waiting for people, and on the first of the month share running
   * costs across the pools.
   */
  daily(): { settled: number; shared: number } {
    const settled = settleDueReviews(this.services);
    drawWaitingCircles(this.services);
    const shared = this.services.now().getUTCDate() === 1 ? shareRunningCosts(this.services)?.amount ?? 0n : 0n;
    return { settled, shared: Number(shared) };
  }
}

function commons(env: Env) {
  return env.COMMONS.get(env.COMMONS.idFromName('commons'));
}

export default {
  fetch(request, env) {
    return commons(env).fetch(request);
  },
  async scheduled(_controller, env) {
    const result = await commons(env).daily();
    console.log(`Daily round: ${result.settled} circles settled, ${result.shared} shared as running costs`);
  },
} satisfies ExportedHandler<Env>;
