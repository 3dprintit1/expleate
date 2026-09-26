import { Hono, type Context as HonoContext } from 'hono';
import type { FC } from 'hono/jsx';
import { Problem } from '../../services/context.js';
import {
  createGroup,
  groupMembers,
  inviteToGroup,
  isGroupMember,
  leaveGroup,
  requireGroupByHandle,
} from '../../services/groups.js';
import { projectsOfGroup } from '../../services/projects.js';
import { Csrf, ErrorSummary, Hint, Paragraphs, ProjectCard, page } from '../components.js';
import type { AppEnv, Form } from '../env.js';
import { day, field, plural } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const groups = new Hono<AppEnv>();

const GroupForm: FC<{ c: HonoContext<AppEnv>; form: Form; error?: string | undefined }> = ({ c, form, error }) => (
  <section class="narrow">
    <h1>Start a group</h1>
    <p class="lead">Host projects together.</p>
    <p class="faint">Everyone in a group is equal, and anyone in it can invite others.</p>
    <ErrorSummary message={error} />
    <form method="post" action="/groups" class="form glass panel">
      <Csrf c={c} />
      <label for="name">Name</label>
      <input id="name" name="name" required maxlength={80} placeholder="The Underpass Painters" value={field(form, 'name')} />
      <label for="handle">Handle</label>
      <Hint>Letters, numbers and underscores, for the group’s address.</Hint>
      <input id="handle" name="handle" required maxlength={25} autocapitalize="none" value={field(form, 'handle')} />
      <label for="about">About the group (optional)</label>
      <textarea id="about" name="about" rows={3} maxlength={2000}>
        {field(form, 'about')}
      </textarea>
      <button type="submit">Start the group</button>
    </form>
  </section>
);

groups.get('/groups/new', signedIn, (c) => page(c, 'Start a group', <GroupForm c={c} form={{}} />));

groups.post('/groups', signedIn, (c) => {
  const form = c.get('form');
  try {
    const group = createGroup(c.get('ctx'), c.get('member')!.id, {
      handle: field(form, 'handle'),
      name: field(form, 'name'),
      about: field(form, 'about'),
    });
    flash(c, 'ok', 'Your group is ready. Invite people to join it.');
    return c.redirect(`/groups/${group.handle}`, 303);
  } catch (error) {
    if (error instanceof Problem && (error.status === 400 || error.status === 409)) {
      return page(c, 'Start a group', <GroupForm c={c} form={form} error={error.message} />, 400);
    }
    throw error;
  }
});

groups.get('/groups/:handle', (c) => {
  const ctx = c.get('ctx');
  const member = c.get('member');
  const group = requireGroupByHandle(ctx, c.req.param('handle'));
  const people = groupMembers(ctx, group.id);
  const inGroup = member ? isGroupMember(ctx, group.id, member.id) : false;
  const list = projectsOfGroup(ctx, group.id);

  return page(
    c,
    group.name,
    <>
      <h1>{group.name}</h1>
      <p class="faint">
        @{group.handle} · {plural(people.length, 'person', 'people')} · started {day(ctx.config, group.created_at)}
      </p>
      {group.about && (
        <div class="narrow">
          <Paragraphs text={group.about} />
        </div>
      )}
      <p>
        {people.map((person, index) => (
          <>
            {index > 0 && ', '}
            <a href={`/people/${person.handle}`}>{person.name}</a>
          </>
        ))}
      </p>

      {inGroup && (
        <details class="section glass">
          <summary>Invite someone, or leave</summary>
          <div class="two">
            <form method="post" action={`/groups/${group.handle}/invite`} class="form">
              <Csrf c={c} />
              <label for="invite-handle">Their handle</label>
              <input id="invite-handle" name="handle" required maxlength={25} autocapitalize="none" />
              <button type="submit">Invite</button>
            </form>
            <form method="post" action={`/groups/${group.handle}/leave`} class="form">
              <Csrf c={c} />
              <span class="label">Leave {group.name}</span>
              <span class="hint">The group carries on without you.</span>
              <button type="submit" class="ghost">
                Leave
              </button>
            </form>
          </div>
        </details>
      )}

      <h2>Projects</h2>
      {list.length === 0 ? (
        <p class="quiet">
          None yet.
          {inGroup && (
            <>
              {' '}
              <a href="/projects/new">Suggest one</a>
            </>
          )}
        </p>
      ) : (
        <ul class="cards">
          {list.map((project) => (
            <ProjectCard ctx={ctx} project={project} />
          ))}
        </ul>
      )}
    </>,
  );
});

groups.post('/groups/:handle/invite', signedIn, (c) => {
  const ctx = c.get('ctx');
  const group = requireGroupByHandle(ctx, c.req.param('handle'));
  const invitee = inviteToGroup(ctx, group.id, c.get('member')!.id, field(c.get('form'), 'handle'));
  flash(c, 'ok', `${invitee.name} is invited.`);
  return c.redirect(`/groups/${group.handle}`, 303);
});

groups.post('/groups/:handle/leave', signedIn, (c) => {
  const ctx = c.get('ctx');
  const group = requireGroupByHandle(ctx, c.req.param('handle'));
  leaveGroup(ctx, group.id, c.get('member')!.id);
  flash(c, 'ok', `You’ve left ${group.name}.`);
  return c.redirect('/me', 303);
});
