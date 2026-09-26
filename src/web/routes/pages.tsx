import { Hono } from 'hono';
import { raw } from 'hono/html';
import { READER_INSTRUCTIONS } from '../../core/reader.js';
import { Problem } from '../../services/context.js';
import { memberGroups } from '../../services/groups.js';
import { projectsHostedBy } from '../../services/projects.js';
import { getMemberByHandle } from '../../services/records.js';
import { FLAG_AGAIN_DAYS } from '../../services/reviews.js';
import { ProjectCard, page } from '../components.js';
import { DOCS } from '../docs.generated.js';
import type { AppEnv } from '../env.js';
import { day, plural } from '../format.js';

export const pages = new Hono<AppEnv>();

pages.get('/charter', (c) => page(c, DOCS.charter.title, <article class="doc">{raw(DOCS.charter.html)}</article>));

pages.get('/pooling', (c) => page(c, DOCS.pooling.title, <article class="doc">{raw(DOCS.pooling.html)}</article>));

pages.get('/reader', (c) => {
  const ctx = c.get('ctx');
  const { config } = ctx;
  return page(
    c,
    'The charter reader',
    <article class="doc">
      <h1>The charter reader</h1>
      <p class="lead">
        An AI reads every project before it opens, and all news and uses after that. It looks for anything that seems to
        break <a href="/charter">the charter</a>.
      </p>
      {!ctx.reader && <p class="note">The reader is switched off on this site, so only the word check runs.</p>}
      <h2>It can only ask</h2>
      <p>The reader can’t turn anything down or close anything. When something worries it, it asks people to look:</p>
      <ul>
        <li>
          Before a project opens, the person who suggested it can reword it or explain. Then a circle of people picked at
          random decides.
        </li>
        <li>
          After a project opens, the reader can add one flag, the same as one person. It takes{' '}
          {plural(config.flagThreshold, 'flag', 'flags')} to pause a pool.
        </li>
      </ul>
      <p>
        If a circle finds that a project fits, the reader waits {FLAG_AGAIN_DAYS} days before it can flag that project
        again, like everyone else.
      </p>
      <h2>What it sees</h2>
      <p>
        Only what a project says: its title, summary, story and plans, its news, and what each use was for. Never who
        wrote them. The text goes to Anthropic, the company that makes the model the reader runs on:{' '}
        <code>{config.readerModel}</code>.
      </p>
      <p>
        Whatever the reader notices is shown to the circle, marked as the reader’s. It can be wrong, and people overrule
        it.
      </p>
      <h2>What it costs</h2>
      <p>
        Each reading costs a few cents at most. It is a running cost like hosting, and goes on the{' '}
        <a href="/costs">running costs page</a>. To keep it in check, the reader reads at most{' '}
        {config.readerDailyReads} things a day, and at most {config.readerReadsPerPerson} for any one person.
      </p>
      <details class="section glass">
        <summary>Its instructions, word for word</summary>
        <pre class="instructions">{READER_INSTRUCTIONS}</pre>
      </details>
    </article>,
  );
});

pages.get('/people/:handle', (c) => {
  const ctx = c.get('ctx');
  const person = getMemberByHandle(ctx, c.req.param('handle'));
  if (!person) throw new Problem('We couldn’t find that person.', 404);
  const groups = memberGroups(ctx, person.id);
  const hosted = projectsHostedBy(ctx, person.id).filter((p) => p.status !== 'declined');
  return page(
    c,
    person.name,
    <>
      <h1>{person.name}</h1>
      <p class="faint">
        @{person.handle} · joined {day(ctx.config, person.created_at)}
        {groups.length > 0 && (
          <>
            {' '}
            · in{' '}
            {groups.map((group, index) => (
              <>
                {index > 0 && ', '}
                <a href={`/groups/${group.handle}`}>{group.name}</a>
              </>
            ))}
          </>
        )}
      </p>
      <h2>Projects they host</h2>
      {hosted.length === 0 ? (
        <p class="quiet">None yet.</p>
      ) : (
        <ul class="cards">
          {hosted.map((project) => (
            <ProjectCard ctx={ctx} project={project} />
          ))}
        </ul>
      )}
    </>,
  );
});
