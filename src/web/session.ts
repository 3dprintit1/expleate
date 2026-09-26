import type { Context as HonoContext, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { newSecret } from '../core/crypto.js';
import { memberForToken } from '../services/members.js';
import { Problem } from '../services/context.js';
import type { AppEnv, Flash, Form } from './env.js';

const SESSION = 'session';
const CSRF = 'csrf';
const FLASH = 'flash';

function secure(c: HonoContext): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export function setSessionCookie(c: HonoContext<AppEnv>, token: string, expires: Date): void {
  setCookie(c, SESSION, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: secure(c),
    path: '/',
    expires,
  });
}

export function clearSessionCookie(c: HonoContext<AppEnv>): void {
  deleteCookie(c, SESSION, { path: '/', secure: secure(c) });
}

export function sessionToken(c: HonoContext<AppEnv>): string | undefined {
  return getCookie(c, SESSION);
}

/** Leaves a short message to show on the next page, after a redirect. */
export function flash(c: HonoContext<AppEnv>, kind: Flash['kind'], text: string): void {
  setCookie(c, FLASH, JSON.stringify({ kind, text }), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: secure(c),
    path: '/',
    maxAge: 60,
  });
}

function readFlash(c: HonoContext<AppEnv>): Flash | undefined {
  const raw = getCookie(c, FLASH);
  if (!raw) return undefined;
  deleteCookie(c, FLASH, { path: '/', secure: secure(c) });
  try {
    const parsed = JSON.parse(raw) as Partial<Flash>;
    if ((parsed.kind === 'ok' || parsed.kind === 'error') && typeof parsed.text === 'string') {
      return { kind: parsed.kind, text: parsed.text.slice(0, 500) };
    }
  } catch {
    // An unreadable message is simply dropped.
  }
  return undefined;
}

function sameOrigin(c: HonoContext): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

/**
 * Sets up each request: who is signed in, the anti-forgery token, any message
 * left by the last page, and, for form posts, the submitted fields.
 *
 * Forms are protected against cross-site forgery twice over: the browser must
 * send a matching token from a cookie and a hidden field, and when it tells us
 * where the request came from, that must be this site.
 */
export function sessions(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    c.set('member', await memberForToken(ctx, getCookie(c, SESSION)));
    c.set('flash', readFlash(c));

    let csrf = getCookie(c, CSRF);
    if (!csrf || !/^[\w-]{20,100}$/.test(csrf)) {
      csrf = newSecret();
      setCookie(c, CSRF, csrf, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: secure(c),
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    c.set('csrf', csrf);

    c.set('form', {});
    if (c.req.method === 'POST' && !c.req.path.startsWith('/api/')) {
      const body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
      const form: Form = {};
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') form[key] = value;
        else if (Array.isArray(value)) form[key] = value.filter((v): v is string => typeof v === 'string');
      }
      if (!sameOrigin(c) || form._csrf !== csrf) {
        throw new Problem('That form had expired. Please go back, refresh the page and try again.', 403);
      }
      c.set('form', form);
    }
    await next();
  };
}
