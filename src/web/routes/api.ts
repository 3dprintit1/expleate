/**
 * A read-only public API, so anyone can check the books or build their own
 * way of browsing projects. Amounts are in the currency's smallest unit.
 */
import { Hono } from 'hono';
import { RULES, SPIRITS, isSpirit } from '../../core/charter.js';
import { costsOverview } from '../../services/costs.js';
import { poolLedger } from '../../services/pools.js';
import { listProjects, projectUpdates } from '../../services/projects.js';
import type { Project } from '../../services/records.js';
import { requireProject } from '../../services/records.js';
import { stewardOf } from '../components.js';
import type { AppEnv } from '../env.js';

export const api = new Hono<AppEnv>();

function summary(project: Project) {
  return {
    id: project.id,
    title: project.title,
    summary: project.summary,
    spirits: project.spirits,
    status: project.status,
    created_at: project.created_at,
    finished_at: project.finished_at,
    hope: project.hope,
    pool: {
      balance: project.pool_balance,
      put_in: project.pool_put_in,
      taken_back: project.pool_taken_back,
      used: project.pool_used,
      running_costs: project.pool_costs,
      handed_back: project.pool_returned,
      people: project.people,
    },
  };
}

api.get('/api/charter', (c) =>
  c.json({ spirits: SPIRITS, rules: RULES.map(({ id, title, summary: text }) => ({ id, title, summary: text })) }),
);

api.get('/api/projects', (c) => {
  const ctx = c.get('ctx');
  const spirit = c.req.query('spirit') ?? '';
  const page = Math.max(0, Number.parseInt(c.req.query('page') ?? '0', 10) || 0);
  const { projects, more } = listProjects(ctx, {
    spirit: isSpirit(spirit) ? spirit : undefined,
    show: c.req.query('show') === 'finished' ? 'finished' : 'live',
    order: 'newest',
    page,
    pageSize: 50,
  });
  return c.json({ currency: ctx.config.currency.code, projects: projects.map(summary), more });
});

api.get('/api/projects/:id', (c) => {
  const ctx = c.get('ctx');
  const project = requireProject(ctx, c.req.param('id'));
  return c.json({
    currency: ctx.config.currency.code,
    ...summary(project),
    story: project.story,
    plans: project.plans,
    stewards: stewardOf(ctx, project).label,
    updates: projectUpdates(ctx, project.id).map((u) => ({ body: u.body, at: u.created_at, by: u.author_name })),
    ledger: poolLedger(ctx, project.id, 1000),
  });
});

api.get('/api/costs', (c) => {
  const ctx = c.get('ctx');
  const overview = costsOverview(ctx);
  return c.json({
    currency: ctx.config.currency.code,
    totals: Object.fromEntries(Object.entries(overview.totals).map(([k, v]) => [k, Number(v)])),
    pooled: Number(overview.pooled),
    costs: overview.costs,
    covers: overview.covers,
    shares: overview.shares,
  });
});
