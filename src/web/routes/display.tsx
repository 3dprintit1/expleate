import { Hono } from 'hono';
import { DisplayForm, page } from '../components.js';
import type { AppEnv } from '../env.js';
import { field, safeNext } from '../format.js';
import { setPreference } from '../session.js';

export const display = new Hono<AppEnv>();

/** The same choices as the header's display button, for browsers that cannot open it. */
display.get('/display', (c) =>
  page(
    c,
    'Display settings',
    <section class="narrow">
      <h1>Display settings</h1>
      <p class="lead">Choose light or dark colours, and whether things on the page move.</p>
      <div class="glass panel">
        <DisplayForm c={c} back="/display" />
      </div>
      <p class="faint">
        Auto follows your device. Your choice is kept in a cookie on this browser only. <a href="/">Back to the projects</a>
      </p>
    </section>,
  ),
);

display.post('/display', (c) => {
  const form = c.get('form');
  const theme = field(form, 'theme');
  if (theme === 'light' || theme === 'dark') setPreference(c, 'theme', theme);
  else if (theme === 'auto') setPreference(c, 'theme', null);
  const motion = field(form, 'motion');
  if (motion === 'still') setPreference(c, 'motion', 'still');
  else if (motion === 'gentle') setPreference(c, 'motion', null);
  return c.redirect(safeNext(field(form, 'back')), 303);
});
