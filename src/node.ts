/**
 * Runs Expleate on Node, with its data in a local SQLite file. This is for
 * working on Expleate and for anyone who wants to host it themselves. The
 * public site runs on Cloudflare instead: see src/worker.ts.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { claudeReader } from './ai/claude-reader.js';
import { configFromEnv } from './config.js';
import { randomInt } from './core/crypto.js';
import type { Context } from './services/context.js';
import { readUnreadProjects } from './services/reader.js';
import { openNodeSql } from './store/node-sqlite.js';
import { migrate } from './store/schema.js';
import { createApp } from './web/app.js';

const path = process.env.DATABASE_PATH ?? 'data/expleate.db';
mkdirSync(dirname(path), { recursive: true });
const sql = openNodeSql(path);
migrate(sql);

const port = Number(process.env.PORT ?? 8787);
const config = configFromEnv({ SITE_URL: `http://localhost:${port}`, ...process.env });
// The charter reader runs only when ANTHROPIC_API_KEY is set.
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const context: Context = {
  sql,
  config,
  now: () => new Date(),
  randomInt,
  reader: apiKey
    ? claudeReader({ apiKey, model: config.readerModel, baseURL: process.env.ANTHROPIC_BASE_URL?.trim() })
    : undefined,
};
const app = createApp({ context, staticFiles: serveStatic({ root: './public' }) });

// Once an hour, the charter reader catches up on projects it has not read.
if (context.reader) {
  setInterval(() => {
    readUnreadProjects(context).catch((error: unknown) => console.error(error));
  }, 3_600_000).unref();
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${config.siteName} is running at http://localhost:${info.port}`);
});
