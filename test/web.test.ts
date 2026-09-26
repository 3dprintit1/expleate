import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderDocs } from '../scripts/build-docs.js';
import { createApp } from '../src/web/app.js';
import { testContext, type TestContext } from './helpers.js';

type App = ReturnType<typeof createApp>;

/** A tiny browser: keeps cookies between requests and fills in the form token. */
class Browser {
  cookies = new Map<string, string>();

  constructor(private readonly app: App) {}

  private remember(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    return cookie ? { cookie, ...extra } : extra;
  }

  async get(path: string): Promise<Response> {
    const response = await this.app.request(path, { headers: this.headers() });
    this.remember(response);
    return response;
  }

  async post(path: string, fields: Record<string, string | string[]>, options: { token?: string; origin?: string } = {}) {
    if (!this.cookies.has('csrf')) await this.get('/');
    const body = new URLSearchParams();
    body.set('_csrf', options.token ?? decodeURIComponent(this.cookies.get('csrf') ?? ''));
    for (const [key, value] of Object.entries(fields)) {
      for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
    }
    const extra: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (options.origin) extra.origin = options.origin;
    const response = await this.app.request(path, { method: 'POST', body, headers: this.headers(extra) });
    this.remember(response);
    return response;
  }

  async text(path: string): Promise<string> {
    return (await this.get(path)).text();
  }
}

const STORY =
  'Every Saturday in October we meet on the beach at sunrise, swim for ten minutes and warm up with tea and toast.';

let ctx: TestContext;
let app: App;

beforeEach(() => {
  ctx = testContext({ CARETAKERS: 'keeper' });
  app = createApp({ context: ctx });
});

async function joined(handle: string): Promise<Browser> {
  const browser = new Browser(app);
  const response = await browser.post('/join', { handle, name: handle, password: 'pool together please' });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/me');
  return browser;
}

async function proposed(browser: Browser, fields: Record<string, string | string[]> = {}): Promise<string> {
  const response = await browser.post('/projects', {
    title: 'Sea swim at sunrise',
    summary: 'A sunrise swim for anyone, with hot tea on the beach after.',
    story: STORY,
    plans: 'Two big flasks, a camping stove, tea, bread and a pile of spare towels.',
    spirits: ['joy', 'adventure'],
    agreed: 'yes',
    ...fields,
  });
  expect(response.status).toBe(303);
  return response.headers.get('location')!;
}

describe('the site', () => {
  it('shows the projects page with protective headers', async () => {
    const response = await new Browser(app).get('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Pool resources with anyone in the world');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('renders the charter and the pooling guide from their Markdown', async () => {
    const browser = new Browser(app);
    expect(await browser.text('/charter')).toContain('No financial gain');
    expect(await browser.text('/pooling')).toContain('Why the rule is counted this way');
  });

  it('keeps the generated docs in step with the Markdown', () => {
    const current = readFileSync(new URL('../src/web/docs.generated.ts', import.meta.url), 'utf8');
    expect(current, 'Run `npm run docs` after editing CHARTER.md or docs/pooling.md').toBe(renderDocs());
  });

  it('answers unknown pages with a friendly 404', async () => {
    const browser = new Browser(app);
    expect((await browser.get('/nowhere')).status).toBe(404);
    expect((await browser.get('/projects/nothing-here')).status).toBe(404);
    expect((await browser.get('/api/nowhere')).status).toBe(404);
  });
});

describe('accounts', () => {
  it('joins, signs out and signs back in', async () => {
    const browser = await joined('amara');
    expect(await browser.text('/me')).toContain('Your resources');
    await browser.post('/sign-out', {});
    expect((await browser.get('/me')).headers.get('location')).toBe('/sign-in?next=%2Fme');
    const bad = await browser.post('/sign-in', { handle: 'amara', password: 'not the password', next: '/me' });
    expect(bad.status).toBe(401);
    const good = await browser.post('/sign-in', { handle: 'amara', password: 'pool together please', next: '//evil.example' });
    expect(good.headers.get('location')).toBe('/me');
  });

  it('explains what is wrong with a sign-up', async () => {
    const response = await new Browser(app).post('/join', { handle: 'x', name: 'X', password: 'pool together please' });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Handles are 3 to 24 characters long');
  });
});

describe('forms', () => {
  it('refuses a form without the right token, and changes nothing', async () => {
    const browser = await joined('amara');
    const response = await browser.post('/me/add', { amount: '100' }, { token: 'forged-token-forged-token' });
    expect(response.status).toBe(303);
    expect(await browser.text('/me')).toContain('That form had expired');
    expect(ctx.sql.get<{ balance: number }>("SELECT balance FROM members WHERE handle = 'amara'")?.balance).toBe(0);
  });

  it('refuses a form sent from another site', async () => {
    const browser = await joined('amara');
    await browser.post('/me/add', { amount: '100' }, { origin: 'https://elsewhere.example' });
    expect(ctx.sql.get<{ balance: number }>("SELECT balance FROM members WHERE handle = 'amara'")?.balance).toBe(0);
  });

  it('sends people who are not signed in to sign in first', async () => {
    const response = await new Browser(app).post('/me/add', { amount: '100' });
    expect(response.headers.get('location')).toMatch(/^\/sign-in\?next=/);
  });
});

describe('pooling through the site', () => {
  it('puts in, uses, takes back, and says so when asking for too much', async () => {
    const amara = await joined('amara');
    await amara.post('/me/add', { amount: '100' });
    const path = await proposed(amara);

    await amara.post(`${path}/contribute`, { amount: '40', showName: 'yes' });
    await amara.post(`${path}/use`, { amount: '10', description: 'Two flasks and a camping stove' });
    await amara.post(`${path}/take-back`, { amount: '5', note: '' });
    const page = await amara.text(path);
    expect(page).toContain('Two flasks and a camping stove');
    expect(page).toContain('<p class="big">$25</p>');

    await amara.post(`${path}/take-back`, { amount: '500' });
    expect(await amara.text(path)).toContain('That is more than your portion of this pool.');

    await amara.post(`${path}/contribute`, { amount: '1.234' });
    expect(await amara.text(path)).toContain('thousands separator or a decimal point');
  });

  it('shows no names or amounts for people who asked not to be named', async () => {
    const amara = await joined('amara');
    const kenji = await joined('kenji');
    await kenji.post('/me/add', { amount: '50' });
    const path = await proposed(amara);
    await kenji.post(`${path}/contribute`, { amount: '12.34' });
    const page = await new Browser(app).text(path);
    expect(page).not.toContain('kenji');
    const api = (await (await new Browser(app).get(`/api${path}`)).json()) as { ledger: Array<Record<string, unknown>> };
    expect(JSON.stringify(api)).not.toContain('kenji');
    expect(api.ledger[0]).toMatchObject({ kind: 'put_in', amount: 1234, by: null });
  });

  it('asks for an explanation when the charter check finds something', async () => {
    const mateo = await joined('mateo');
    const fields = {
      title: 'The Nebula Wars',
      summary: 'A homemade space opera with cardboard spaceships.',
      story: `${STORY} Then we film The Nebula Wars on the moors.`,
      plans: 'Cardboard, paint, a smoke machine and a projector for the premiere.',
      spirits: 'creativity',
      agreed: 'yes',
    };
    const first = await mateo.post('/projects', fields);
    expect(first.status).toBe(400);
    const text = await first.text();
    expect(text).toContain('A few words caught the charter check');
    expect(text).toContain('war or the military');

    const second = await mateo.post('/projects', {
      ...fields,
      concernNote: 'It is a made-up film with cardboard spaceships and has nothing to do with real war.',
    });
    expect(second.status).toBe(303);
    expect(await mateo.text(second.headers.get('location')!)).toContain('Waiting for its charter circle');
  });
});

describe('running costs', () => {
  it('shows the costs page to everyone, and only lets caretakers record costs', async () => {
    const amara = await joined('amara');
    await amara.post('/costs/cost', { incurredOn: '2026-09-30', description: 'Hosting', amount: '5' });
    expect(await amara.text('/costs')).toContain('Only caretakers can record running costs.');

    const keeper = await joined('keeper');
    await keeper.post('/costs/cover', { givenBy: 'The founder', amount: '200', note: 'The first $200.' });
    await keeper.post('/costs/cost', { incurredOn: '2026-09-30', description: 'Workers Paid plan', amount: '5' });
    const page = await new Browser(app).text('/costs');
    expect(page).toContain('Workers Paid plan');
    expect(page).toContain('The founder');
    const api = (await (await new Browser(app).get('/api/costs')).json()) as { totals: Record<string, number> };
    expect(api.totals).toEqual({ costs: 500, covered: 20_000, shared: 0, outstanding: 0 });
  });
});
