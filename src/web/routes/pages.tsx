import { Hono } from 'hono';
import { raw } from 'hono/html';
import { Problem } from '../../services/context.js';
import { memberGroups } from '../../services/groups.js';
import { projectsHostedBy } from '../../services/projects.js';
import { getMemberByHandle } from '../../services/records.js';
import { ProjectCard, page } from '../components.js';
import { DOCS } from '../docs.generated.js';
import type { AppEnv } from '../env.js';
import { day } from '../format.js';

export const pages = new Hono<AppEnv>();

pages.get('/charter', (c) => page(c, DOCS.charter.title, <article class="doc">{raw(DOCS.charter.html)}</article>));

pages.get('/pooling', (c) => page(c, DOCS.pooling.title, <article class="doc">{raw(DOCS.pooling.html)}</article>));

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
