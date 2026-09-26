/**
 * Groups let people suggest and look after projects together. Everyone in a
 * group is equal: there are no owners or admins, and any member can invite.
 */
import { newId } from '../core/crypto.js';
import { type Context, Problem, cleanLine, cleanText, nowIso } from './context.js';
import { checkHandle, normaliseHandle } from './members.js';
import { type Member, getMemberByHandle } from './records.js';

export interface Group {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly about: string;
  readonly created_at: string;
}

export interface GroupInput {
  readonly handle: string;
  readonly name: string;
  readonly about: string;
}

export function createGroup(ctx: Context, memberId: string, input: GroupInput): Group {
  const handle = normaliseHandle(input.handle);
  checkHandle(handle);
  const name = cleanLine(input.name, { label: 'The group’s name', field: 'name', max: 80 });
  const about = cleanText(input.about, { label: 'About the group', field: 'about', min: 0, max: 2000 });

  return ctx.sql.transaction(() => {
    if (ctx.sql.get('SELECT 1 FROM groups WHERE handle = ?', handle)) {
      throw new Problem('A group already has that handle.', 409, 'handle');
    }
    const group: Group = { id: newId(), handle, name, about, created_at: nowIso(ctx) };
    ctx.sql.run(
      'INSERT INTO groups (id, handle, name, about, created_at) VALUES (?, ?, ?, ?, ?)',
      group.id,
      group.handle,
      group.name,
      group.about,
      group.created_at,
    );
    ctx.sql.run(
      'INSERT INTO group_members (group_id, member_id, joined_at) VALUES (?, ?, ?)',
      group.id,
      memberId,
      group.created_at,
    );
    return group;
  });
}

export function getGroup(ctx: Context, id: string): Group | undefined {
  return ctx.sql.get<Group>('SELECT * FROM groups WHERE id = ?', id);
}

export function getGroupByHandle(ctx: Context, handle: string): Group | undefined {
  return ctx.sql.get<Group>('SELECT * FROM groups WHERE handle = ?', normaliseHandle(handle));
}

export function requireGroupByHandle(ctx: Context, handle: string): Group {
  const group = getGroupByHandle(ctx, handle);
  if (!group) throw new Problem('We could not find that group.', 404);
  return group;
}

export function isGroupMember(ctx: Context, groupId: string, memberId: string): boolean {
  return Boolean(
    ctx.sql.get('SELECT 1 FROM group_members WHERE group_id = ? AND member_id = ?', groupId, memberId),
  );
}

export function groupMembers(ctx: Context, groupId: string): Member[] {
  return ctx.sql.all<Member>(
    `SELECT m.id, m.handle, m.name, m.balance, m.created_at
       FROM group_members g JOIN members m ON m.id = g.member_id
      WHERE g.group_id = ? ORDER BY g.joined_at`,
    groupId,
  );
}

export function memberGroups(ctx: Context, memberId: string): Group[] {
  return ctx.sql.all<Group>(
    `SELECT g.* FROM group_members gm JOIN groups g ON g.id = gm.group_id
      WHERE gm.member_id = ? ORDER BY g.name`,
    memberId,
  );
}

export function inviteToGroup(ctx: Context, groupId: string, fromId: string, handle: string): Member {
  return ctx.sql.transaction(() => {
    if (!isGroupMember(ctx, groupId, fromId)) throw new Problem('Only members of a group can invite people.', 403);
    const invitee = getMemberByHandle(ctx, handle);
    if (!invitee) throw new Problem('Nobody has that handle.', 404, 'handle');
    if (isGroupMember(ctx, groupId, invitee.id)) throw new Problem(`${invitee.name} is already in this group.`, 409, 'handle');
    if (ctx.sql.get('SELECT 1 FROM group_invites WHERE group_id = ? AND member_id = ?', groupId, invitee.id)) {
      throw new Problem(`${invitee.name} has already been invited.`, 409, 'handle');
    }
    ctx.sql.run(
      'INSERT INTO group_invites (group_id, member_id, invited_by, created_at) VALUES (?, ?, ?, ?)',
      groupId,
      invitee.id,
      fromId,
      nowIso(ctx),
    );
    return invitee;
  });
}

export interface Invite {
  readonly group: Group;
  readonly invitedBy: string;
}

export function invitesFor(ctx: Context, memberId: string): Invite[] {
  return ctx.sql
    .all<Group & { invited_by_name: string }>(
      `SELECT g.*, m.name AS invited_by_name
         FROM group_invites i
         JOIN groups g ON g.id = i.group_id
         JOIN members m ON m.id = i.invited_by
        WHERE i.member_id = ? ORDER BY i.created_at`,
      memberId,
    )
    .map(({ invited_by_name, ...group }) => ({ group, invitedBy: invited_by_name }));
}

export function answerInvite(ctx: Context, groupId: string, memberId: string, accept: boolean): void {
  ctx.sql.transaction(() => {
    const removed = ctx.sql.run('DELETE FROM group_invites WHERE group_id = ? AND member_id = ?', groupId, memberId);
    if (removed === 0) throw new Problem('That invitation is no longer open.', 404);
    if (accept && !isGroupMember(ctx, groupId, memberId)) {
      ctx.sql.run(
        'INSERT INTO group_members (group_id, member_id, joined_at) VALUES (?, ?, ?)',
        groupId,
        memberId,
        nowIso(ctx),
      );
    }
  });
}

export function leaveGroup(ctx: Context, groupId: string, memberId: string): void {
  ctx.sql.transaction(() => {
    if (!isGroupMember(ctx, groupId, memberId)) throw new Problem('You are not in this group.', 400);
    const count = ctx.sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', groupId);
    const active = ctx.sql.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM projects WHERE group_id = ? AND status IN ('awaiting', 'open', 'review')",
      groupId,
    );
    if ((count?.n ?? 0) <= 1 && (active?.n ?? 0) > 0) {
      throw new Problem(
        'You are the last person in this group and it still looks after a project. Invite someone else first, or finish the project.',
        409,
      );
    }
    ctx.sql.run('DELETE FROM group_members WHERE group_id = ? AND member_id = ?', groupId, memberId);
  });
}
