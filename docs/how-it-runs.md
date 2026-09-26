# How Expleate runs, and what it still needs

This is the whole picture: what exists today, how it grows, and the problems that are not solved yet. The open problems are written as plainly as the solved ones.

## What runs today

A request to expleat.ing takes this path:

1. **Cloudflare's edge** serves the stylesheet, fonts and icon directly. They cost nothing and never touch the code.
2. **The Worker** receives everything else. It strips any header a visitor could use to fake an internal message. For joining and signing in, it limits how often each place and each handle can try, and does the slow password work itself.
3. **The Commons**, a single Durable Object, holds the whole ledger in its own SQLite database: people, pools, portions, projects, circles, costs. It renders the page and sends it back.
4. **The charter reader**, when someone suggests a project, shares news or records a use. The Commons sends the text to Anthropic's API and waits a few seconds for the answer before saving anything. It carries on serving everyone else while it waits.

Once a day a scheduled job settles circles whose time is up, lets the charter reader catch up on any project it could not read, and on the first of the month shares running costs across the pools.

The same code also runs on an ordinary server with Node and a SQLite file, for development and for anyone who wants to host their own Expleate.

## Why one Durable Object

The Commons handles one request at a time. When someone puts $20 into a pool, it reads the pool, works out the new weights and writes them back with nothing able to run in between. That is what makes the books exact: no race can create or lose a cent, and the tests check this after every step of thousands of random sequences.

The price of that simplicity is a ceiling. Cloudflare suggests about 1,000 requests a second for one Durable Object, and each page takes the Commons a few milliseconds. In practice that means a few hundred page views a second, which is enough for tens of thousands of people using Expleate every day. A single Durable Object can store 10 GB, which is room for millions of pool movements.

Anything that keeps the processor busy must happen before a request reaches the Commons, or everyone waits. The only deliberately slow thing on the site, checking a password (about 45 ms of work), already happens at the edge. Waiting on the network is different: while the Commons waits for the charter reader, it serves other requests. So the code always asks the reader first, and only then reads and writes the books, in one go.

## How it grows

Each step below is only needed when the one before runs out, and none of them changes the rules.

1. **Cache the public pages.** Most visits are people reading. The project list, project pages and running costs can be served from Cloudflare's cache for a few seconds, so the Commons only sees people who are signed in or changing something.
2. **Render at the edge.** Move page rendering into the Worker and let the Commons answer only data questions. That frees most of its time.
3. **One Durable Object per pool.** Each pool becomes its own Durable Object, and each person's balance lives in another. Moving resources between two places that cannot share a transaction needs a two-step handshake with a receipt for every transfer, so a failure halfway can always be finished or undone, and a regular check that every receipt matches both sides. This is the step that lets Expleate serve the whole world. It is also the one that needs the most care.
4. **Closer to everyone.** The Commons lives in one place, so someone on the far side of the world waits a moment longer for each action. Read-only copies near each region, and pools that live near the people who use them, shorten that.

## Real money

Everything in pools today is pretend. Connecting real money is the largest piece of work left, and most of it is legal, not technical.

- **A legal home.** Holding other people's money, and paying it back on request, is regulated almost everywhere. Expleate needs a legal body, such as a cooperative or an association, and legal advice in each country it serves.
- **A payment partner** that can accept contributions from many countries and hold pooled money apart from any company's own money. It must also pay back take-backs, and pay a project's suppliers directly against receipts, so pooled money never passes through hosts' own accounts.
- **Identity checks.** A payment partner will check who people are before money moves, as the law requires.
- **Reconciliation.** Every day, the ledger in the Commons must match the balances the payment partner reports, to the cent, with any difference raised straight away.
- **Currencies.** A pool holds one currency today. Real money brings the question of pools in different currencies, and of converting fairly between them.

The places in the code where money would arrive and leave are `addResources` and `moveOut` in `src/services/members.ts`.

## One person, one voice

Charter circles and flags only work if each person has one voice. [One person, one voice](one-person-one-voice.md) sets out what stops someone from opening several accounts, what is in place today, and the layers still to come.

## Safety

The word check, the charter reader and charter circles cover what projects are for. The reader reads news and uses as well as proposals, so a project that drifts away from what it promised can be flagged even if nobody is watching it. Still missing:

- a way to report harmful words in updates and notes
- a way to suspend an account that is abusing others, decided by a circle rather than by one person
- a contact address and a process for legal requests, such as removing unlawful content

## Privacy

Expleate uses three cookies, all its own: the session, a token that protects forms, and a one-line message after a form is sent. Two more remember display settings, light or dark colours and still motion, only for people who choose them. There are no trackers, adverts or third-party requests, and no scripts on any page.

Nobody can see what anyone else has put in. Names appear in pools only if people choose, and alphabetically, so they cannot be matched to the pool's record. That record is dated by day, not to the second, for the same reason.

Still missing: letting people download their data and close their account, which data protection law requires in many countries and which is right anyway.

## Governance

- **The charter** changes in the open. Today that means on the code repository. Next is a way for members to propose and agree changes on Expleate itself, one person one vote.
- **Caretakers** pay the bills and record them. They have no say over projects or circles. Today they are named in the site's settings; later a circle could confirm them.
- **The founder** covers the first $200 of running costs and holds the Cloudflare account. As Expleate grows, that account should belong to its legal home, with more than one person able to act.

## Keeping it running

- **Backups.** Cloudflare can restore the Commons to any moment in the last 30 days. A nightly export of the public ledger, which anyone could check, would add a copy outside Cloudflare.
- **Watching.** Cloudflare's logs are on. Alerts for errors, and for the daily job failing, are next.
- **Changes.** Every change runs the checks and tests before it goes live (see `docs/ci.yml`).
- **Costs.** Every bill goes on the running costs page, with its receipt.

## Before real money: a checklist

- [ ] A legal home, and legal advice for the first countries
- [ ] A payment partner that holds pooled money separately and pays suppliers directly
- [ ] Identity checks, and circles limited to verified people (see [one person, one voice](one-person-one-voice.md))
- [ ] Daily reconciliation between the ledger and the payment partner
- [ ] Account download and deletion
- [ ] Reports of harmful content, and a contact for legal requests
- [ ] Alerts for errors and for the daily job
- [ ] The Cloudflare account held by the legal home, with two people able to act
