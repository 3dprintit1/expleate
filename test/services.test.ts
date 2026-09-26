import { describe, expect, it } from 'vitest';
import { castVote, flagProject, openSeatsFor, settleDueReviews } from '../src/services/reviews.js';
import { contribute, portionFor, poolLedger, takeBack, useResources } from '../src/services/pools.js';
import { finishProject, listProjects, postUpdate, proposeProject, type ProposalInput } from '../src/services/projects.js';
import { answerInvite, createGroup, inviteToGroup, leaveGroup } from '../src/services/groups.js';
import { costsOverview, recordCost, recordCover, shareRunningCosts } from '../src/services/costs.js';
import { memberForToken, signIn, signOut, signUp } from '../src/services/members.js';
import { Problem } from '../src/services/context.js';
import { requireProject } from '../src/services/records.js';
import { PLANS, STORY, balanceOf, expectConservation, makeMember, testContext, type TestContext } from './helpers.js';

const dollars = (n: number) => BigInt(Math.round(n * 100));

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    title: 'The midsummer lantern walk',
    summary: 'Hundreds of paper lanterns, made together and carried through town.',
    story: STORY,
    plans: PLANS,
    spirits: ['joy', 'creativity'],
    hope: dollars(800),
    groupId: null,
    concernNote: '',
    agreed: true,
    ...overrides,
  };
}

function openProject(ctx: TestContext, proposerId: string, overrides: Partial<ProposalInput> = {}) {
  const result = proposeProject(ctx, proposerId, proposal(overrides));
  if (result.kind !== 'created') throw new Error('expected the project to be created');
  return result.project;
}

function valueOf(ctx: TestContext, projectId: string, memberId: string): number {
  const view = portionFor(ctx, requireProject(ctx, projectId), memberId);
  return Number(view?.value ?? 0n);
}

describe('pools', () => {
  it('gives everything back when nothing has been used', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 100);
    const project = openProject(ctx, amara.id);

    contribute(ctx, project.id, amara.id, dollars(100), true);
    contribute(ctx, project.id, kenji.id, dollars(100), true);
    takeBack(ctx, project.id, amara.id, dollars(100));
    takeBack(ctx, project.id, kenji.id, dollars(100));

    expect(balanceOf(ctx, amara.id)).toBe(10_000);
    expect(balanceOf(ctx, kenji.id)).toBe(10_000);
    expect(requireProject(ctx, project.id).pool_balance).toBe(0);
    expectConservation(ctx);
  });

  it('shares a use in proportion, whoever takes back first', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 300);
    const project = openProject(ctx, amara.id);

    contribute(ctx, project.id, amara.id, dollars(100), true);
    contribute(ctx, project.id, kenji.id, dollars(300), true);
    useResources(ctx, project.id, amara.id, dollars(200), 'Paper and willow for 300 lanterns');

    // Half the pool was used, so each portion is half of what was put in.
    expect(valueOf(ctx, project.id, amara.id)).toBe(5_000);
    expect(valueOf(ctx, project.id, kenji.id)).toBe(15_000);

    takeBack(ctx, project.id, amara.id, dollars(50));
    expect(valueOf(ctx, project.id, kenji.id)).toBe(15_000);
    expectConservation(ctx);
  });

  it('never lets a newcomer carry a use that happened before they joined', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 100);
    const project = openProject(ctx, amara.id);

    contribute(ctx, project.id, amara.id, dollars(100), true);
    useResources(ctx, project.id, amara.id, dollars(50), 'Hall hire deposit');
    contribute(ctx, project.id, kenji.id, dollars(100), true);

    expect(valueOf(ctx, project.id, amara.id)).toBe(5_000);
    expect(valueOf(ctx, project.id, kenji.id)).toBe(10_000);
    expectConservation(ctx);
  });

  it('refuses to take back more than a portion is worth', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, amara.id, dollars(40), true);
    expect(() => takeBack(ctx, project.id, amara.id, dollars(41))).toThrow(Problem);
    expect(() => contribute(ctx, project.id, amara.id, dollars(61), true)).toThrow(/enough resources/);
  });

  it('only lets stewards use a pool', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 100);
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, kenji.id, dollars(100), true);
    expect(() => useResources(ctx, project.id, kenji.id, dollars(10), 'Snacks for me')).toThrow(/looking after/);
  });

  it('starts people afresh after a pool is used up entirely', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 100);
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, amara.id, dollars(100), true);
    useResources(ctx, project.id, amara.id, dollars(100), 'Everything, all at once');
    contribute(ctx, project.id, kenji.id, dollars(30), true);

    expect(valueOf(ctx, project.id, amara.id)).toBe(0);
    expect(valueOf(ctx, project.id, kenji.id)).toBe(3_000);
    expect(requireProject(ctx, project.id).people).toBe(1);
    expectConservation(ctx);
  });

  it('keeps the public ledger anonymous apart from uses', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 100);
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, kenji.id, dollars(60), false);
    takeBack(ctx, project.id, kenji.id, dollars(10), 'Changed my mind about the route');
    useResources(ctx, project.id, amara.id, dollars(20), 'Tea-lights');

    const entries = poolLedger(ctx, project.id);
    expect(entries.map((e) => e.kind)).toEqual(['use', 'take_back', 'put_in']);
    expect(entries[0]).toMatchObject({ by: 'Amara', note: 'Tea-lights' });
    expect(entries[1]).toMatchObject({ by: null, note: '' });
    expect(JSON.stringify(entries)).not.toContain('Kenji');
  });
});

describe('finishing projects', () => {
  it('hands back what is left, fairly, when a project completes', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara', 100);
    const kenji = makeMember(ctx, 'kenji', 100);
    const siobhan = makeMember(ctx, 'siobhan', 100);
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, kenji.id, dollars(10), true);
    contribute(ctx, project.id, siobhan.id, dollars(20), true);
    useResources(ctx, project.id, amara.id, dollars(10), 'Willow');

    finishProject(ctx, project.id, amara.id, 'completed', 'What a night. Thank you all for the lanterns.');

    const done = requireProject(ctx, project.id);
    expect(done.status).toBe('completed');
    expect(done.pool_balance).toBe(0);
    // 20 of 30 is left, so each person gets two thirds of what they put in.
    expect(balanceOf(ctx, kenji.id)).toBe(10_000 - 1_000 + 667);
    expect(balanceOf(ctx, siobhan.id)).toBe(10_000 - 2_000 + 1_333);
    expectConservation(ctx);
  });

  it('only lets stewards finish a project', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara');
    const kenji = makeMember(ctx, 'kenji');
    const project = openProject(ctx, amara.id);
    expect(() => finishProject(ctx, project.id, kenji.id, 'stopped', 'I would like it to stop please.')).toThrow(/looking after/);
  });
});

describe('the charter check and circles', () => {
  it('asks for an explanation, then waits for a circle', () => {
    const ctx = testContext();
    const proposer = makeMember(ctx, 'mateo');
    const circle = ['priya', 'kenji', 'ingrid', 'lena', 'tomasz'].map((h) => makeMember(ctx, h));

    const story = `${STORY} It is a homemade space opera called The Nebula Wars, shot on the moors.`;
    const first = proposeProject(ctx, proposer.id, proposal({ story }));
    expect(first.kind).toBe('concerns');
    if (first.kind === 'concerns') expect(first.concerns.map((c) => c.term)).toContain('Wars');

    const second = proposeProject(
      ctx,
      proposer.id,
      proposal({ story, concernNote: 'It is a made-up space adventure film with cardboard spaceships, nothing to do with real war.' }),
    );
    if (second.kind !== 'created') throw new Error('expected a project');
    expect(second.project.status).toBe('awaiting');

    const seated = circle.filter((m) => openSeatsFor(ctx, m.id).length > 0);
    expect(seated).toHaveLength(5);
    castVote(ctx, openSeatsFor(ctx, seated[0]!.id)[0]!.review.id, seated[0]!.id, 'fits', '', '');
    castVote(ctx, openSeatsFor(ctx, seated[1]!.id)[0]!.review.id, seated[1]!.id, 'breaks', 'war', 'Too close to war for me.');
    expect(requireProject(ctx, second.project.id).status).toBe('awaiting');
    const reviewId = openSeatsFor(ctx, seated[2]!.id)[0]!.review.id;
    castVote(ctx, reviewId, seated[2]!.id, 'fits', '', '');
    castVote(ctx, reviewId, seated[3]!.id, 'fits', '', 'Cardboard spaceships are fine by me.');

    expect(requireProject(ctx, second.project.id).status).toBe('open');
    expect(() => castVote(ctx, reviewId, seated[4]!.id, 'breaks', 'war', '')).toThrow(/already decided/);
  });

  it('pauses a flagged pool, still allows taking back, and closes it if the circle agrees', () => {
    const ctx = testContext({ FLAG_THRESHOLD: '2', CIRCLE_SIZE: '3' });
    const amara = makeMember(ctx, 'amara');
    const kenji = makeMember(ctx, 'kenji', 100);
    const flaggers = [makeMember(ctx, 'priya'), makeMember(ctx, 'lena')];
    const others = ['ingrid', 'tomasz', 'aroha'].map((h) => makeMember(ctx, h));
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, kenji.id, dollars(100), true);
    useResources(ctx, project.id, amara.id, dollars(40), 'Lanterns');

    expect(flagProject(ctx, project.id, flaggers[0]!.id, 'gain', 'The plans now say they will sell the lanterns.')).toEqual({ circleDrawn: false });
    expect(() => flagProject(ctx, project.id, flaggers[0]!.id, 'gain', 'Flagging a second time.')).toThrow(/already flagged/);
    expect(() => flagProject(ctx, project.id, amara.id, 'gain', 'Flagging my own project.')).toThrow(/look after/);
    expect(flagProject(ctx, project.id, flaggers[1]!.id, 'gain', 'Selling lanterns is financial gain.')).toEqual({ circleDrawn: true });

    expect(requireProject(ctx, project.id).status).toBe('review');
    expect(() => contribute(ctx, project.id, kenji.id, dollars(1), true)).toThrow(/paused/);
    takeBack(ctx, project.id, kenji.id, dollars(10));

    // Nobody who flagged it, looks after it or has pooled into it sits in the circle.
    for (const person of [amara, kenji, ...flaggers]) expect(openSeatsFor(ctx, person.id)).toHaveLength(0);
    const seated = others.filter((m) => openSeatsFor(ctx, m.id).length > 0);
    expect(seated).toHaveLength(3);
    const reviewId = openSeatsFor(ctx, seated[0]!.id)[0]!.review.id;
    castVote(ctx, reviewId, seated[0]!.id, 'breaks', 'gain', '');
    castVote(ctx, reviewId, seated[1]!.id, 'breaks', 'gain', '');

    const closed = requireProject(ctx, project.id);
    expect(closed.status).toBe('closed');
    expect(closed.pool_balance).toBe(0);
    expect(balanceOf(ctx, kenji.id)).toBe(10_000 - 4_000);
    expectConservation(ctx);
  });

  it('gives the benefit of the doubt when a circle runs out of time without a majority', () => {
    const ctx = testContext({ FLAG_THRESHOLD: '1', CIRCLE_SIZE: '3', REVIEW_DAYS: '7' });
    const amara = makeMember(ctx, 'amara');
    const lena = makeMember(ctx, 'lena');
    ['ingrid', 'tomasz', 'aroha'].forEach((h) => makeMember(ctx, h));
    const project = openProject(ctx, amara.id);
    flagProject(ctx, project.id, lena.id, 'spirit', 'This does not sound joyful to me at all.');

    ctx.advanceDays(6);
    expect(settleDueReviews(ctx)).toBe(0);
    ctx.advanceDays(2);
    expect(settleDueReviews(ctx)).toBe(1);
    expect(requireProject(ctx, project.id).status).toBe('open');
    // Their flag is settled, so they may flag again if things change.
    expect(flagProject(ctx, project.id, lena.id, 'spirit', 'Flagging again after the new plans.')).toEqual({ circleDrawn: true });
  });
});

describe('groups', () => {
  it('makes every member of a group a steward of its projects', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara');
    const kenji = makeMember(ctx, 'kenji', 50);
    const group = createGroup(ctx, amara.id, { handle: 'lantern_folk', name: 'Lantern Folk', about: '' });
    const project = openProject(ctx, amara.id, { groupId: group.id });
    contribute(ctx, project.id, kenji.id, dollars(50), true);

    expect(() => useResources(ctx, project.id, kenji.id, dollars(5), 'Glue')).toThrow(/looking after/);
    inviteToGroup(ctx, group.id, amara.id, 'kenji');
    answerInvite(ctx, group.id, kenji.id, true);
    useResources(ctx, project.id, kenji.id, dollars(5), 'Glue');
    postUpdate(ctx, project.id, kenji.id, 'Glue bought. The workshop is on Saturday.');

    expect(() => leaveGroup(ctx, group.id, amara.id)).not.toThrow();
    expect(() => leaveGroup(ctx, group.id, kenji.id)).toThrow(/last person/);
    expectConservation(ctx);
  });
});

describe('running costs', () => {
  it('covers the first costs from the founder, then shares the rest across pools in proportion', () => {
    const ctx = testContext({ CARETAKERS: 'founder_alan', MAX_COST_SHARE_PPM: '1000000' });
    const founder = makeMember(ctx, 'founder_alan');
    const amara = makeMember(ctx, 'amara', 1_000);
    const one = openProject(ctx, amara.id);
    const two = openProject(ctx, amara.id, { title: 'Stargazing on the machair' });
    contribute(ctx, one.id, amara.id, dollars(300), true);
    contribute(ctx, two.id, amara.id, dollars(100), true);

    recordCover(ctx, founder.id, { givenBy: 'The founder', amount: dollars(200), note: 'The first $200 is on me.' });
    recordCost(ctx, founder.id, { incurredOn: '2026-09-30', description: 'Workers Paid plan, September', amount: dollars(5), receiptUrl: '' });
    expect(shareRunningCosts(ctx)).toBeNull();

    recordCost(ctx, founder.id, { incurredOn: '2026-10-01', description: 'A big month', amount: dollars(204), receiptUrl: 'https://example.com/invoice/1' });
    const share = shareRunningCosts(ctx);
    expect(share).toEqual({ amount: dollars(9), pools: 2, pooled: dollars(400) });
    // Three quarters of the pooled resources are in the first pool, so it carries three quarters of the cost.
    expect(requireProject(ctx, one.id).pool_costs).toBe(675);
    expect(requireProject(ctx, two.id).pool_costs).toBe(225);
    expect(costsOverview(ctx).totals.outstanding).toBe(0n);
    expectConservation(ctx);
  });

  it('takes no more than the limit in one share and carries the rest over', () => {
    const ctx = testContext({ CARETAKERS: 'founder_alan', MAX_COST_SHARE_PPM: '20000' });
    const founder = makeMember(ctx, 'founder_alan');
    const amara = makeMember(ctx, 'amara', 100);
    const project = openProject(ctx, amara.id);
    contribute(ctx, project.id, amara.id, dollars(100), true);
    recordCost(ctx, founder.id, { incurredOn: '2026-09-30', description: 'Hosting', amount: dollars(5), receiptUrl: '' });

    expect(shareRunningCosts(ctx)?.amount).toBe(dollars(2));
    expect(costsOverview(ctx).totals.outstanding).toBe(dollars(3));
  });

  it('only lets caretakers record costs', () => {
    const ctx = testContext({ CARETAKERS: 'founder_alan' });
    const amara = makeMember(ctx, 'amara');
    expect(() =>
      recordCost(ctx, amara.id, { incurredOn: '2026-09-30', description: 'Hosting', amount: dollars(5), receiptUrl: '' }),
    ).toThrow(/caretakers/);
  });
});

describe('listing', () => {
  it('shuffles by day, and never offers an order by money', () => {
    const ctx = testContext();
    const amara = makeMember(ctx, 'amara');
    for (let i = 0; i < 12; i++) openProject(ctx, amara.id, { title: `Project number ${i}` });
    const today = listProjects(ctx).projects.map((p) => p.title);
    expect(listProjects(ctx).projects.map((p) => p.title)).toEqual(today);
    ctx.advanceDays(1);
    expect(listProjects(ctx).projects.map((p) => p.title)).not.toEqual(today);
    expect(listProjects(ctx, { pageSize: 5 }).more).toBe(true);
  });
});

describe('accounts', () => {
  it('signs up, signs in and out', async () => {
    const ctx = testContext();
    const member = await signUp(ctx, { handle: '@Amara', name: 'Amara', password: 'lanterns at dusk' });
    expect(member.handle).toBe('amara');
    await expect(signUp(ctx, { handle: 'amara', name: 'Another', password: 'lanterns at dusk' })).rejects.toThrow(/already has/);
    await expect(signIn(ctx, 'amara', 'wrong password!')).rejects.toThrow(/do not match/);
    await expect(signIn(ctx, 'nobody', 'lanterns at dusk')).rejects.toThrow(/do not match/);

    const session = await signIn(ctx, 'AMARA', 'lanterns at dusk');
    expect((await memberForToken(ctx, session.token))?.id).toBe(member.id);
    await signOut(ctx, session.token);
    expect(await memberForToken(ctx, session.token)).toBeUndefined();
  });
});
