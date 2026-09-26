import { Hono, type Context as HonoContext } from 'hono';
import type { FC } from 'hono/jsx';
import { Problem } from '../../services/context.js';
import { checkPassword, signIn, signInWithProof, signOut, signUp, startSession } from '../../services/members.js';
import { drawWaitingCircles } from '../../services/reviews.js';
import { Csrf, ErrorSummary, Hint, page } from '../components.js';
import { EDGE_HEADERS } from '../edge.js';
import type { AppEnv, Form } from '../env.js';
import { field, safeNext } from '../format.js';
import { clearSessionCookie, flash, sessionToken, setSessionCookie } from '../session.js';

export const accounts = new Hono<AppEnv>();

const SLOW_DOWN = 'Too many tries from here. Please wait a minute, then try again.';

const JoinForm: FC<{ c: HonoContext<AppEnv>; form: Form; error?: string | undefined }> = ({ c, form, error }) => (
  <section class="narrow">
    <h1>Join {c.get('ctx').config.siteName}</h1>
    <p class="lead">It’s free, and it always will be.</p>
    <ErrorSummary message={error} />
    <form method="post" action="/join" class="form glass panel">
      <Csrf c={c} />
      <label for="name">Your name</label>
      <Hint>How others will see you.</Hint>
      <input id="name" name="name" required maxlength={60} autocomplete="name" value={field(form, 'name')} />
      <label for="handle">Handle</label>
      <Hint>Letters, numbers and underscores, like river_rower.</Hint>
      <input
        id="handle"
        name="handle"
        required
        maxlength={25}
        autocomplete="username"
        autocapitalize="none"
        spellcheck={false}
        value={field(form, 'handle')}
      />
      <label for="password">Password</label>
      <Hint>Ten characters or more. A few random words work well.</Hint>
      <input id="password" name="password" type="password" required minlength={10} maxlength={200} autocomplete="new-password" />
      <button type="submit">Join</button>
    </form>
    <p class="faint">
      Already a member? <a href="/sign-in">Sign in</a>
    </p>
  </section>
);

accounts.get('/join', (c) => page(c, 'Join', <JoinForm c={c} form={{}} />));

accounts.post('/join', async (c) => {
  const ctx = c.get('ctx');
  const form = c.get('form');
  try {
    let passwordHash: string | undefined;
    if (c.get('edgeAuth')) {
      if (c.req.header(EDGE_HEADERS.slowDown)) throw new Problem(SLOW_DOWN, 400);
      passwordHash = c.req.header(EDGE_HEADERS.passwordHash);
      // The edge only leaves the password unhashed when it is the wrong length, which this explains.
      if (!passwordHash) checkPassword(field(form, 'password'));
    }
    const member = await signUp(
      ctx,
      { handle: field(form, 'handle'), name: field(form, 'name'), password: field(form, 'password') },
      passwordHash,
    );
    const session = await startSession(ctx, member);
    setSessionCookie(c, session.token, session.expires);
    // A newcomer may be just who a waiting circle needs.
    drawWaitingCircles(ctx);
    flash(c, 'ok', `Welcome, ${member.name}.`);
    return c.redirect('/me', 303);
  } catch (error) {
    if (error instanceof Problem && (error.status === 400 || error.status === 409)) {
      return page(c, 'Join', <JoinForm c={c} form={form} error={error.message} />, 400);
    }
    throw error;
  }
});

const SignInForm: FC<{ c: HonoContext<AppEnv>; next: string; handle?: string; error?: string | undefined }> = ({
  c,
  next,
  handle,
  error,
}) => (
  <section class="narrow">
    <h1>Welcome back</h1>
    <ErrorSummary message={error} />
    <form method="post" action="/sign-in" class="form glass panel">
      <Csrf c={c} />
      <input type="hidden" name="next" value={next} />
      <label for="handle">Handle</label>
      <input
        id="handle"
        name="handle"
        required
        maxlength={25}
        autocomplete="username"
        autocapitalize="none"
        spellcheck={false}
        value={handle ?? ''}
      />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required maxlength={200} autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
    <p class="faint">
      New here? <a href="/join">Join</a>
    </p>
  </section>
);

accounts.get('/sign-in', (c) => {
  if (c.get('member')) return c.redirect(safeNext(c.req.query('next'), '/me'), 303);
  return page(c, 'Sign in', <SignInForm c={c} next={safeNext(c.req.query('next'), '/me')} />);
});

accounts.post('/sign-in', async (c) => {
  const ctx = c.get('ctx');
  const form = c.get('form');
  const next = safeNext(field(form, 'next'), '/me');
  try {
    let session;
    if (c.get('edgeAuth')) {
      if (c.req.header(EDGE_HEADERS.slowDown)) throw new Problem(SLOW_DOWN, 401);
      session = await signInWithProof(ctx, field(form, 'handle'), c.req.header(EDGE_HEADERS.passwordProof) ?? '');
    } else {
      session = await signIn(ctx, field(form, 'handle'), field(form, 'password'));
    }
    setSessionCookie(c, session.token, session.expires);
    return c.redirect(next, 303);
  } catch (error) {
    if (error instanceof Problem && error.status === 401) {
      return page(c, 'Sign in', <SignInForm c={c} next={next} handle={field(form, 'handle')} error={error.message} />, 401);
    }
    throw error;
  }
});

accounts.post('/sign-out', async (c) => {
  await signOut(c.get('ctx'), sessionToken(c));
  clearSessionCookie(c);
  return c.redirect('/', 303);
});
