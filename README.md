# Expleate

Pool resources with anyone in the world, for projects of creativity, adventure and joy.

Someone, or a group, suggests a project. Anyone who loves the idea can put in whatever they like. If you stop liking where it is heading, you can take your portion back at any time: never more than you put in, and if the project has used some of the pool, your fair share of what is left.

Expleate is built as though everyone already had an equal share of the world's resources. Nobody profits, putting in more never buys more say, and running costs are shared at exactly what they cost, in the open. Projects have nothing to do with politics, war, financial gain or charity. [The charter](CHARTER.md) sets all of this out.

Its home is [expleat.ing](https://expleat.ing). For now it is a prototype: resources are pretend until real money is connected.

## Try it on your own machine

You need Node 22.13 or newer.

```sh
npm install
npm run seed                          # example people, groups and projects
CARETAKERS=demo_caretaker npm run dev # http://localhost:8787
```

Every example person's password is `pool together`. Sign in as `kenji` to find a charter circle waiting for your vote, or as `demo_caretaker` to record running costs. Data lives in `data/expleate.db`; delete it to start afresh.

## How it works

- **[The charter](CHARTER.md)**: what projects are for, how pooling works, and how charter circles decide.
- **[How pooling works](docs/pooling.md)**: the rule for taking back, with examples, and why it is counted the way it is.
- **The charter reader**: an AI that reads every proposal, piece of news and use against the charter. It can only ask people to take a second look. Its instructions are public at `/reader`, and it is switched off until you give it an Anthropic API key.
- **[One person, one voice](docs/one-person-one-voice.md)**: how Expleate keeps each person to one voice, what is in place and what comes next.
- **[Running costs](CHARTER.md#running-costs)**: the founder covers the first $200, then costs are shared across all live pools at exactly what they cost, once a month, and every bill is listed publicly at `/costs`.

## How it is built

TypeScript throughout, with very few dependencies. Pages are rendered on the server as plain HTML with no JavaScript, so they load fast on slow connections and old phones.

```
src/core/       The rules, with no storage or web code: pooling maths, the charter check,
                the charter reader's instructions, charter circles, running-cost shares,
                money, passwords
src/ai/         The charter reader on Claude, through Anthropic's official SDK
src/store/      A small synchronous SQL interface, with adapters for Node's built-in SQLite
                and for Cloudflare Durable Object storage, plus the schema
src/services/   Everything people can do, each in one transaction: pools, projects,
                circles, groups, members, running costs
src/web/        The site (Hono, server-rendered JSX) and a read-only JSON API under /api
src/node.ts     Runs it on Node, for development and self-hosting
src/worker.ts   Runs it on Cloudflare: a Worker in front of one Durable Object, the Commons
test/           Unit, property, service and HTTP tests
```

Money is counted exactly, in whole cents, with bigint arithmetic. The tests run thousands of random sequences of putting in, taking back and using, and check the promises in the charter after every step.

## Checks

```sh
npm test        # all tests
npm run check   # types, for both Node and Cloudflare
npm run docs    # after editing CHARTER.md, docs/pooling.md, docs/one-person-one-voice.md
                # or public/styles.css, which the site uses
```

To run the same checks on every push, copy [docs/ci.yml](docs/ci.yml) to `.github/workflows/ci.yml`.

## Deploying

[docs/deploying.md](docs/deploying.md) covers putting it online at expleat.ing on Cloudflare, pointing the domain at Cloudflare from VentraIP, becoming the first caretaker and recording the founder's $200. [docs/how-it-runs.md](docs/how-it-runs.md) explains how the system runs, how it grows, and what it still needs before real money.

## Taking part

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. It explains the one idea every part of Expleate is built around, and the words we use and avoid. [The roadmap](docs/roadmap.md) lists what comes next, starting with connecting real money.

## Licence

[AGPL-3.0-or-later](LICENSE). Anyone can use, change and run Expleate, and anyone who runs a changed version for others must share their changes too. That keeps it a commons.
