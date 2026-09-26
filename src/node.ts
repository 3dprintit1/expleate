/**
 * Runs Expleate on Node, with its data in a local SQLite file. This is for
 * working on Expleate and for anyone who wants to host it themselves. The
 * public site runs on Cloudflare instead: see src/worker.ts.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { configFromEnv } from './config.js';
import { randomInt } from './core/crypto.js';
import { openNodeSql } from './store/node-sqlite.js';
import { migrate } from './store/schema.js';
import { createApp } from './web/app.js';

const path = process.env.DATABASE_PATH ?? 'data/expleate.db';
mkdirSync(dirname(path), { recursive: true });
const sql = openNodeSql(path);
migrate(sql);

const port = Number(process.env.PORT ?? 8787);
const config = configFromEnv({ SITE_URL: `http://localhost:${port}`, ...process.env });
const app = createApp({
  context: { sql, config, now: () => new Date(), randomInt },
  staticFiles: serveStatic({ root: './public' }),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`${config.siteName} is running at http://localhost:${info.port}`);
});
