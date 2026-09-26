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
import { day, field } from '../format.js';
import { signedIn } from '../guards.js';
import { flash } from '../session.js';

export const groups = new Hono<AppEnv>();

const GroupForm: FC<{ c: HonoContext<AppEnv>; form: Form; error?: string | undefined }> = ({ c, form, error }) => (
  <section class="narrow">
    <h1>Start a group</h1>
    <p>
      A group can suggest projects and look after them together. Everyone in a group is equal: there are no owners or
      admins, and anyone in it can invite others.
    </p>
    <ErrorSummary message={error} />
    <form method="post" action="/groups" class="stack">
      <Csrf c={c} />
      <label for="name">Name</label>
      <input id="name" name="name" required maxlength={80} value={field(form, 'name')} />
      <label for="handle">Handle</label>
      <Hint>3 to 24 letters, numbers or underscores, for the group’s address.</Hint>
      <input id="handle" name="handle" required maxlength={25} autocapitalize="none" value={field(form, 'handle')} />
      <label for="about">About the group (optional)</label>
      <textarea id="about" name="about" rows={4} maxlength={2000}>
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
      <p class="quiet">
        @{group.handle} · started {day(ctx.config, group.created_at)}
      </p>
      {group.about && <Paragraphs text={group.about} />}
      <section class="columns">
        <div>
          <h2>People</h2>
          <ul>
            {people.map((person) => (
              <li>
                <a href={`/people/${person.handle}`}>{person.name}</a>
              </li>
            ))}
          </ul>
        </div>
        {inGroup && (
          <div>
            <form method="post" action={`/groups/${group.handle}/invite`} class="stack">
              <Csrf c={c} />
              <label for="invite-handle">Invite someone by their handle</label>
              <input id="invite-handle" name="handle" required maxlength={25} autocapitalize="none" />
              <button type="submit">Invite</button>
            </form>
            <form method="post" action={`/groups/${group.handle}/leave`} class="stack">
              <Csrf c={c} />
              <button type="submit" class="secondary">
                Leave the group
              </button>
            </form>
          </div>
        )}
      </section>
      <h2>Projects</h2>
      {list.length === 0 ? (
        <p class="quiet">
          None yet.{' '}
          {inGroup && (
            <>
              <a href="/projects/new">Suggest one</a> as {group.name}.
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
  flash(c, 'ok', `${invitee.name} is invited. They will see it on their page.`);
  return c.redirect(`/groups/${group.handle}`, 303);
});

groups.post('/groups/:handle/leave', signedIn, (c) => {
  const ctx = c.get('ctx');
  const group = requireGroupByHandle(ctx, c.req.param('handle'));
  leaveGroup(ctx, group.id, c.get('member')!.id);
  flash(c, 'ok', `You have left ${group.name}.`);
  return c.redirect('/me', 303);
});
