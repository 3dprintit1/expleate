/**
 * Fills a local database with example people, groups and projects, so there
 * is something to explore while working on Expleate. Never run it against the
 * real site. Every example person's password is "pool together".
 *
 *   npm run seed
 *   CARETAKERS=demo_caretaker npm run dev
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { configFromEnv } from './config.js';
import { randomInt } from './core/crypto.js';
import type { Context } from './services/context.js';
import { recordCost, recordCover } from './services/costs.js';
import { answerInvite, createGroup, inviteToGroup } from './services/groups.js';
import { addResources, signUp } from './services/members.js';
import { contribute, takeBack, useResources } from './services/pools.js';
import { finishProject, postUpdate, proposeProject, type ProposalInput } from './services/projects.js';
import type { Member } from './services/records.js';
import { castVote, flagProject, openSeatsFor } from './services/reviews.js';
import { openNodeSql } from './store/node-sqlite.js';
import { migrate } from './store/schema.js';

const path = process.env.DATABASE_PATH ?? 'data/expleate.db';
mkdirSync(dirname(path), { recursive: true });
const sql = openNodeSql(path);
migrate(sql);

if (sql.get("SELECT 1 FROM members WHERE kind = 'person' LIMIT 1")) {
  console.log(`${path} already has people in it, so nothing was added. Delete it to start afresh.`);
  process.exit(0);
}

// A clock that starts a month ago and moves forward as the story unfolds.
let clock = Date.now() - 30 * 86_400_000;
const later = (hours: number) => {
  clock += hours * 3_600_000;
};
const ctx: Context = {
  sql,
  config: configFromEnv({ ...process.env, CARETAKERS: 'demo_caretaker', DEMO_RESOURCES: 'true' }),
  now: () => new Date(clock),
  randomInt,
};
const $ = (n: number) => BigInt(Math.round(n * 100));

const people: Record<string, Member> = {};
const names = {
  amara: 'Amara',
  kenji: 'Kenji',
  siobhan: 'Siobhán',
  mateo: 'Mateo',
  priya: 'Priya',
  seun: 'Oluwaseun',
  ingrid: 'Ingrid',
  lena: 'Lena',
  tomasz: 'Tomasz',
  aroha: 'Aroha',
  farid: 'Farid',
  mei: 'Mei',
  demo_caretaker: 'Demo caretaker',
};
for (const [handle, name] of Object.entries(names)) {
  people[handle] = await signUp(ctx, { handle, name, password: 'pool together' });
  addResources(ctx, people[handle].id, $(500));
}
const p = (handle: keyof typeof names) => people[handle]!.id;

function propose(by: keyof typeof names, input: Omit<ProposalInput, 'agreed' | 'concernNote' | 'groupId'> & { groupId?: string; concernNote?: string }) {
  const result = proposeProject(ctx, p(by), { agreed: true, concernNote: '', groupId: null, ...input });
  if (result.kind !== 'created') {
    throw new Error(`"${input.title}" tripped the charter check: ${result.concerns.map((c) => c.term).join(', ')}`);
  }
  later(3);
  return result.project;
}

// Groups
const painters = createGroup(ctx, p('siobhan'), {
  handle: 'underpass_painters',
  name: 'The Underpass Painters',
  about: 'Neighbours who would rather look at birds than bare concrete on the walk to the station.',
});
inviteToGroup(ctx, painters.id, p('siobhan'), 'mateo');
answerInvite(ctx, painters.id, p('mateo'), true);

const singers = createGroup(ctx, p('seun'), {
  handle: 'ballykeel_singers',
  name: 'Ballykeel Singers',
  about: 'A village choir that got carried away.',
});
inviteToGroup(ctx, singers.id, p('seun'), 'mei');
answerInvite(ctx, singers.id, p('mei'), true);

// Projects
const mural = propose('siobhan', {
  groupId: painters.id,
  title: 'A mural of every bird in the valley',
  summary: 'Painting all 64 birds seen in our valley along the railway underpass.',
  story:
    'The underpass by the station is 90 metres of grey concrete. We want to paint every bird that has been seen in the valley, life-size, from the wren to the grey heron, with their names in English and in Irish.\n\nAnyone can pick up a brush on the painting weekends. Children from the primary school are drawing the smallest birds.',
  plans: 'Exterior masonry paint in twelve colours, brushes and rollers, and hire of a scaffold tower for two weekends.',
  spirits: ['creativity'],
  hope: $(1_200),
});

const danube = propose('tomasz', {
  title: 'Rowing the length of the Danube in a boat we built',
  summary: 'Four friends, one homemade rowing boat, 2,850 kilometres from the Black Forest to the Black Sea.',
  story:
    'We have been building a four-person rowing boat in a garage in Gdańsk all winter. This summer we want to row it the whole length of the Danube, camping on the banks and keeping a daily logbook with sketches that anyone can follow.',
  plans: 'Marine plywood and epoxy to finish the hull, oars, life jackets, river maps, a repair kit and camping gear.',
  spirits: ['adventure'],
  hope: $(3_000),
});

const lanterns = propose('amara', {
  title: 'The midsummer lantern walk',
  summary: 'Hundreds of paper lanterns, made together and carried through the old town at dusk.',
  story:
    'On the longest day of the year we will spend the afternoon making paper lanterns together in the community hall, then carry them through the old town at dusk with a brass band. Everyone is welcome, and every lantern is free to make and to keep.',
  plans: 'Tissue paper, willow sticks, glue, LED tea-lights, and the hire of the community hall for an afternoon.',
  spirits: ['joy', 'creativity'],
  hope: $(800),
});

const piano = propose('kenji', {
  title: 'A street piano on the harbour wall',
  summary: 'An old upright piano, painted bright blue, for anyone who walks past.',
  story:
    'There is a sheltered corner of the harbour wall where people sit and eat chips. We would like to put a piano there from May to September for anyone to play, with a waterproof cover for the nights.',
  plans: 'A second-hand upright piano, paint, a fitted waterproof cover, two tunings over the summer and a van to move it.',
  spirits: ['joy'],
  hope: $(650),
});

const stars = propose('ingrid', {
  title: 'Stargazing on the machair',
  summary: 'Two telescopes and hot chocolate on the darkest beach in the Hebrides.',
  story:
    'Once a month through the winter, on the clearest night we can find, we will set up two telescopes on the machair and show whoever turns up the rings of Saturn, the moons of Jupiter and, if we are lucky, the northern lights.',
  plans: 'Two good second-hand telescopes, red torches, flasks, blankets and ferry fares for the telescopes.',
  spirits: ['adventure', 'joy'],
  hope: null,
});

const opera = propose('seun', {
  groupId: singers.id,
  title: 'An opera written by the whole village',
  summary: 'Everyone in Ballykeel writes a line, and the choir turns it into a one-night opera.',
  story:
    'A postbox outside the shop will collect one line from anyone in the village. Over the winter the choir will stitch the lines together into a short opera and perform it once, on the green, on the first warm evening of spring.',
  plans: 'Sheet music printing, hire of a small stage and lights for the green, and costumes from the charity shop.',
  spirits: ['creativity', 'joy'],
  hope: $(900),
});

const kites = propose('farid', {
  title: 'Kite day on the dunes',
  summary: 'A day of making and flying kites, with a giant octopus kite for everyone.',
  story:
    'We will build kites together in the morning and fly them on the dunes in the afternoon. The centrepiece is a nine-metre octopus kite that takes six people to launch.',
  plans: 'Ripstop fabric, carbon rods, line, a big spool for the octopus and sandwiches for the builders.',
  spirits: ['joy'],
  hope: $(400),
});

const ride = propose('lena', {
  title: 'A midnight bike ride under the full moon',
  summary: 'A slow ride through the city at midnight with lights on every spoke.',
  story:
    'On the next full moon, anyone with a bike can join a slow, gentle ride through the empty streets at midnight. We will hand out spoke lights so the whole ride glows, and finish with a flask of tea by the river.',
  plans: 'Spoke lights for 200 bikes, a few spare helmets, flasks and a lot of tea.',
  spirits: ['adventure', 'joy'],
  hope: $(500),
});

// People pool into projects over a few weeks.
const pour: Array<[keyof typeof names, { id: string }, number]> = [
  ['kenji', mural, 40], ['priya', mural, 120], ['aroha', mural, 25], ['lena', mural, 60], ['ingrid', mural, 80],
  ['farid', danube, 150], ['mei', danube, 200], ['amara', danube, 75], ['siobhan', danube, 30],
  ['kenji', lanterns, 20], ['priya', lanterns, 35], ['tomasz', lanterns, 50], ['aroha', lanterns, 15], ['mateo', lanterns, 40], ['seun', lanterns, 25],
  ['amara', piano, 60], ['ingrid', piano, 45], ['farid', piano, 20], ['lena', piano, 100],
  ['tomasz', stars, 90], ['aroha', stars, 60], ['priya', stars, 40],
  ['kenji', opera, 55], ['lena', opera, 30], ['ingrid', opera, 70],
  ['amara', kites, 30], ['mateo', kites, 45], ['mei', kites, 25], ['priya', kites, 60], ['aroha', kites, 20],
  ['amara', ride, 30], ['kenji', ride, 25], ['tomasz', ride, 40],
];
for (const [who, project, amount] of pour) {
  contribute(ctx, project.id, p(who), $(amount), who !== 'priya');
  later(5);
}

useResources(ctx, mural.id, p('siobhan'), $(240), 'Exterior masonry paint in twelve colours');
later(20);
postUpdate(ctx, mural.id, p('mateo'), 'We have sketched 41 of the 64 birds so far. The kingfisher is causing arguments about which blue to use. First painting weekend is the 14th: bring old clothes.');
later(30);
useResources(ctx, mural.id, p('mateo'), $(60), 'Scaffold tower hire for the first weekend');
later(10);

useResources(ctx, danube.id, p('tomasz'), $(310), 'Marine plywood and two litres of epoxy');
later(6);
postUpdate(ctx, danube.id, p('tomasz'), 'The hull is sealed and floats in the harbour without leaking, which is more than we expected. Oars are next.');
later(12);
takeBack(ctx, danube.id, p('siobhan'), $(5), 'Still love it, just need a little back for the mural weekend.');
later(8);

useResources(ctx, lanterns.id, p('amara'), $(62.4), 'Tissue paper and willow for 300 lanterns');
later(24);

useResources(ctx, kites.id, p('farid'), $(96.5), 'Ripstop fabric, carbon rods and line');
later(6);
useResources(ctx, kites.id, p('farid'), $(18), 'Sandwiches and squash for the builders');
later(30);
finishProject(ctx, kites.id, p('farid'), 'completed', 'Forty kites made, the octopus flew for nearly an hour, and nobody lost a finger. Thank you all. What was left has gone back to you.');
later(6);

useResources(ctx, piano.id, p('kenji'), $(120), 'A second-hand upright piano from a school clear-out');
later(20);

// A project that drifts, is flagged by three people, and waits for its circle.
postUpdate(ctx, ride.id, p('lena'), 'Lots of you have asked whether we could turn the ride into a demonstration for more cycle lanes, and route it past the town hall. We think we will.');
later(6);
flagProject(ctx, ride.id, p('seun'), 'politics', 'The latest update turns this into a demonstration outside the town hall. That is politics, however much I like cycle lanes.');
later(2);
flagProject(ctx, ride.id, p('mei'), 'politics', 'A demonstration about cycle lanes is a political campaign.');
later(2);
flagProject(ctx, ride.id, p('ingrid'), 'politics', 'The ride used to be about the full moon. It has become about lobbying the council.');

// Costs, kept in the open.
clock = Date.now() - 2 * 86_400_000;
recordCover(ctx, p('demo_caretaker'), { givenBy: 'The founder', amount: $(200), note: 'Covers the first $200 of running costs.' });
recordCost(ctx, p('demo_caretaker'), {
  incurredOn: new Date(clock).toISOString().slice(0, 10),
  description: 'Example entry: one month of hosting',
  amount: $(5),
  receiptUrl: '',
});

// A new proposal that trips the charter check, explained, and waiting for its circle.
clock = Date.now() - 86_400_000;
const nebula = proposeProject(ctx, p('mateo'), {
  title: 'The Nebula Wars: a homemade space opera',
  summary: 'A feature-length science fiction film shot on the moors with cardboard spaceships.',
  story:
    'We are making a ninety-minute space opera over one summer, with cardboard spaceships, a borrowed smoke machine and anyone who wants a part. It will be shown once, on a bedsheet, in a field, with popcorn.',
  plans: 'Cardboard, paint, a smoke machine, costume fabric, a projector for the premiere and a lot of gaffer tape.',
  spirits: ['creativity', 'adventure'],
  hope: $(700),
  groupId: null,
  agreed: true,
  concernNote:
    'The word “Wars” is in the title of our made-up film. It is a silly science fiction adventure with cardboard spaceships and has nothing to do with any real war or the military.',
});
if (nebula.kind === 'created') {
  // One person in its circle has already voted.
  const seat = Object.values(people).find((m) => openSeatsFor(ctx, m.id).some((s) => s.project.id === nebula.project.id));
  if (seat) castVote(ctx, openSeatsFor(ctx, seat.id)[0]!.review.id, seat.id, 'fits', '', 'Cardboard spaceships are fine by me.');
}

const voters = Object.values(people)
  .filter((m) => openSeatsFor(ctx, m.id).some((s) => !s.voted))
  .map((m) => m.handle);
console.log(`Added ${Object.keys(people).length} people and 10 projects to ${path}.`);
console.log('Every example person’s password is "pool together".');
console.log(`People with a charter circle waiting for their vote: ${voters.join(', ')}.`);
console.log('Start the site with: CARETAKERS=demo_caretaker npm run dev');
