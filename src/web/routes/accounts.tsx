import { Hono, type Context as HonoContext } from 'hono';
import type { FC } from 'hono/jsx';
import { Problem } from '../../services/context.js';
import { signIn, signOut, signUp } from '../../services/members.js';
import { drawWaitingCircles } from '../../services/reviews.js';
import { Csrf, ErrorSummary, Hint, page } from '../components.js';
import type { AppEnv, Form } from '../env.js';
import { field, safeNext } from '../format.js';
import { clearSessionCookie, flash, sessionToken, setSessionCookie } from '../session.js';

export const accounts = new Hono<AppEnv>();

const JoinForm: FC<{ c: HonoContext<AppEnv>; form: Form; error?: string | undefined }> = ({ c, form, error }) => (
  <section class="narrow">
    <h1>Join {c.get('ctx').config.siteName}</h1>
    <p>
      Joining is free and always will be. You will be able to suggest projects, pool resources with others, and take your
      turn in charter circles.
    </p>
    <ErrorSummary message={error} />
    <form method="post" action="/join" class="stack">
      <Csrf c={c} />
      <label for="name">Your name</label>
      <Hint>How you would like to appear to others.</Hint>
      <input id="name" name="name" required maxlength={60} autocomplete="name" value={field(form, 'name')} />
      <label for="handle">Handle</label>
      <Hint>3 to 24 letters, numbers or underscores. Your page will be at /people/your_handle.</Hint>
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
      <Hint>At least 10 characters. A few random words works well.</Hint>
      <input id="password" name="password" type="password" required minlength={10} maxlength={200} autocomplete="new-password" />
      <button type="submit">Join</button>
    </form>
    <p>
      Already a member? <a href="/sign-in">Sign in</a>.
    </p>
  </section>
);

accounts.get('/join', (c) => page(c, 'Join', <JoinForm c={c} form={{}} />));

accounts.post('/join', async (c) => {
  const ctx = c.get('ctx');
  const form = c.get('form');
  try {
    const member = await signUp(ctx, {
      handle: field(form, 'handle'),
      name: field(form, 'name'),
      password: field(form, 'password'),
    });
    const session = await signIn(ctx, member.handle, field(form, 'password'));
    setSessionCookie(c, session.token, session.expires);
    // A newcomer may be just who a waiting charter circle needs.
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
    <h1>Sign in</h1>
    <ErrorSummary message={error} />
    <form method="post" action="/sign-in" class="stack">
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
    <p>
      New here? <a href="/join">Join</a>.
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
    const session = await signIn(ctx, field(form, 'handle'), field(form, 'password'));
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
