import type { MiddlewareHandler } from 'hono';
import { Problem } from '../services/context.js';
import type { AppEnv } from './env.js';

/** Sends people who are not signed in to the sign-in page, and back again afterwards. */
export const signedIn: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('member')) {
    if (c.req.method === 'GET') return c.redirect(`/sign-in?next=${encodeURIComponent(c.req.path)}`, 303);
    throw new Problem('Please sign in first.', 401);
  }
  await next();
};
