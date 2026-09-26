/**
 * Builds a clickable snapshot of Expleate from the example data, seen as one
 * example person, as plain files that can be put anywhere: links go between
 * the files, and buttons explain that nothing is sent. Run with
 * `npm run preview`; the files land in .preview/site.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from '../src/config.js';
import { randomInt } from '../src/core/crypto.js';
import { openNodeSql } from '../src/store/node-sqlite.js';
import { migrate } from '../src/store/schema.js';
import { createApp } from '../src/web/app.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.preview');
const dbPath = join(work, 'example.db');
const outDir = join(work, 'site');

// Fresh example data every time.
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'src/seed.ts')], {
  cwd: root,
  env: { ...process.env, DATABASE_PATH: dbPath },
  stdio: 'ignore',
});
const AS = 'tomasz';
const NAME = 'Tomasz';
const MAX_PAGES = 140;

const sql = openNodeSql(dbPath);
migrate(sql);
// Freeze the clock just after the example story ends, so nothing settles while we look around.
const last = sql.get<{ t: string }>(
  `SELECT MAX(t) AS t FROM (SELECT MAX(at) AS t FROM ledger UNION ALL SELECT MAX(created_at) FROM reviews
                            UNION ALL SELECT MAX(created_at) FROM updates UNION ALL SELECT MAX(created_at) FROM projects)`,
)!.t;
const now = new Date(new Date(last).getTime() + 3_600_000);
const app = createApp({
  context: {
    sql,
    config: configFromEnv({ SITE_URL: 'https://expleat.ing', DEMO_RESOURCES: 'true', CARETAKERS: 'demo_caretaker' }),
    now: () => now,
    randomInt,
    // A reader that is switched on but never asked: the pages show it as it would be on the live site.
    reader: { model: 'claude-opus-5', read: async () => null },
  },
});

// A tiny browser with a cookie jar.
const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function remember(response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair = ''] = header.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (/max-age=0/i.test(header) || value === '') jar.delete(name);
    else jar.set(name, value);
  }
}
async function get(path: string) {
  const response = await app.request(path, { headers: { cookie: cookieHeader() } });
  remember(response);
  return response;
}
await get('/sign-in');
const csrf = decodeURIComponent(jar.get('csrf')!);
const signIn = await app.request('/sign-in', {
  method: 'POST',
  headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: csrf, handle: AS, password: 'pool together' }),
});
remember(signIn);
if (signIn.status !== 303 || !jar.has('session')) throw new Error(`Could not sign in as ${AS}: ${signIn.status}`);
jar.delete('flash');

// Every page gets a file name. The home page, with any filters, becomes index*.html.
function fileFor(target: string): string | null {
  const url = new URL(target, 'https://expleat.ing');
  if (url.origin !== 'https://expleat.ing') return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  if (path === '/') {
    return params.length === 0 ? 'index.html' : `index-${params.map(([k, v]) => `${k}-${v}`).join('-')}.html`;
  }
  if (params.length > 0) return null;
  if (path.startsWith('/api/') || path === '/sign-out' || path.endsWith('.css') || path.endsWith('.svg')) return null;
  const name = path.slice(1).replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${name}.html`;
}

const pages = new Map<string, string>(); // file name -> path
const queue = ['/'];
const seen = new Set<string>();
while (queue.length > 0 && pages.size < MAX_PAGES) {
  const path = queue.shift()!;
  const file = fileFor(path);
  if (!file || seen.has(file)) continue;
  seen.add(file);
  const response = await get(path);
  if (response.status !== 200) continue;
  const html = await response.text();
  pages.set(file, html);
  for (const match of html.matchAll(/href="(\/[^"]*)"/g)) {
    const href = match[1]!.replace(/&amp;/g, '&').split('#')[0]!;
    if (!seen.has(fileFor(href) ?? '')) queue.push(href);
  }
}

// Rewrite each page to work from files: links to files, forms that send nothing, the preview's own notes.
const NOTE = `<div id="preview-note" popover="auto" class="preview-note" role="status">
<p><strong>Nothing is sent from this preview.</strong> It is a snapshot of Expleate with example projects. On the live site, this button does it for real.</p>
<button type="button" class="ghost" popovertarget="preview-note" popovertargetaction="hide">OK</button>
</div>`;
const BANNER = `<p class="banner">A preview with example projects, seen as ${NAME}. Links work; buttons send nothing.</p>`;

function rewrite(html: string): { head: string; body: string } {
  let out = html
    .replace(/<!DOCTYPE html>/i, '')
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/href="\/styles\.css\?v=[^"]*"/g, 'href="styles.css"')
    .replace(/href="\/favicon\.svg"/g, 'href="favicon.svg"')
    .replace(/<input type="hidden" name="_csrf" value="[^"]*"\/>/g, '')
    .replace(/<input type="hidden" name="back" value="[^"]*"\/>/g, '')
    .replace(/<form([^>]*?) method="post"([^>]*?) action="[^"]*"/g, '<form$1$2')
    .replace(/<form([^>]*?) action="[^"]*"([^>]*?) method="post"/g, '<form$1$2')
    .replace(/<button type="submit"/g, '<button type="button" popovertarget="preview-note"')
    .replace(/<button(?![^>]*\btype=)/g, '<button type="button" popovertarget="preview-note"')
    .replace(/<p class="banner">[^<]*<\/p>/, BANNER);
  out = out.replace(/href="(\/[^"]*)"/g, (_, target: string) => {
    const decoded = target.replace(/&amp;/g, '&');
    const [path, hash] = decoded.split('#') as [string, string | undefined];
    const file = fileFor(path);
    if (file && pages.has(file)) return `href="${file}${hash ? `#${hash}` : ''}"`;
    return 'aria-disabled="true"';
  });
  const head = /<head>([\s\S]*?)<\/head>/.exec(out)![1]!;
  const body = /<body>([\s\S]*?)<\/body>/.exec(out)![1]!.replace('</header>', `</header>${NOTE}`);
  return { head, body };
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'fonts'), { recursive: true });
for (const [file, html] of pages) {
  const { head, body } = rewrite(html);
  const title = /<title>[\s\S]*?<\/title>/.exec(head)![0];
  if (file === 'index.html') {
    // The main page is wrapped in a document by the host, so it carries only its title, styles and body.
    writeFileSync(join(outDir, file), `${title}\n<link rel="stylesheet" href="styles.css" />\n<link rel="icon" href="favicon.svg" type="image/svg+xml" />\n${body}\n`);
  } else {
    writeFileSync(
      join(outDir, file),
      `<!doctype html>\n<html lang="en-GB">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n${title}\n<link rel="stylesheet" href="styles.css" />\n<link rel="icon" href="favicon.svg" type="image/svg+xml" />\n</head>\n<body>\n${body}\n</body>\n</html>\n`,
    );
  }
}

const css = readFileSync(join(root, 'public/styles.css'), 'utf8').replace(/url\(\/fonts\//g, 'url(fonts/');
const extra = `
/* ------------------------------------------------------------ preview only */

.preview-note {
  display: none;
  position: fixed;
  inset: auto 1rem calc(env(safe-area-inset-bottom, 0px) + 1.5rem);
  width: min(26rem, calc(100vw - 2rem));
  margin: 0 auto;
  padding: 1.1rem 1.2rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-l);
  background: var(--glass-strong);
  color: var(--ink);
  box-shadow: inset 0 1px 0 var(--highlight), var(--shadow-lift);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  backdrop-filter: blur(20px) saturate(1.4);
}

.preview-note:popover-open {
  display: grid;
  gap: 0.8rem;
  animation: arrive 0.5s var(--spring) both;
}

.preview-note p {
  margin: 0;
}

.preview-note button {
  justify-self: end;
}

a[aria-disabled='true'] {
  color: inherit;
  text-decoration: none;
  cursor: default;
}
`;
writeFileSync(join(outDir, 'styles.css'), css + extra);
for (const font of readdirSync(join(root, 'public/fonts'))) {
  copyFileSync(join(root, 'public/fonts', font), join(outDir, 'fonts', font));
}
copyFileSync(join(root, 'public/favicon.svg'), join(outDir, 'favicon.svg'));
console.log(`${pages.size} pages written to ${outDir}. Open index.html, or publish the folder as it is.`);
