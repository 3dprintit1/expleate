# One person, one voice

On Expleate every person has the same say, whatever they put in. That only holds if each person has one account. This page explains why duplicate accounts matter less here than on most sites, what stops them today, the ways to go further, and the order we would take them in.

## Why there is little to gain from cheating

Most fake accounts exist to collect something: money, rewards, votes that can be sold, attention. Expleate has none of those.

- Nobody profits from a pool, and there are no rewards, prizes or rankings.
- Putting in more never buys more say, so splitting money across several accounts gains nothing.
- Hosts cannot take a pool for themselves. Every use is public and pays for the project. Once real money flows, uses will be paid to suppliers directly, against receipts.
- Anyone can take their portion back at any time. A project that loses people's trust empties.

What someone with many accounts could still try:

1. Flag a project enough times to pause its pool.
2. Fill a charter circle, to keep open a project that breaks the charter, or to close one that does not.
3. Fill the site with projects.
4. Make a pool look more popular than it is.

## What is in place today

**Standing.** People can flag a project, or be drawn for a charter circle, only once they have been members for a week. Fake accounts have to be made in advance and then wait, and a sudden wave of new accounts has no voice at all.

**Circles drawn at random.** A circle is drawn from everyone with standing, leaving out the project's hosts, anyone who has put into its pool and anyone who flagged it. To control a circle, someone needs a large share of every eligible account on the site. The chance that accounts held by one person win a circle's majority:

| Their share of eligible accounts | Circle of 5 | Circle of 9 |
| --- | --- | --- |
| 5% | 0.1% | under 0.01% |
| 10% | 0.9% | 0.1% |
| 20% | 5.8% | 2.0% |
| 30% | 16.3% | 9.9% |

Five is the right size for a young site. As Expleate grows, `CIRCLE_SIZE` should grow with it: nine people make a stacked circle far less likely, and it gets harder still as the number of eligible accounts grows.

**Flags only pause.** Three flags pause a pool while a circle decides. Flags never close anything. Someone who flagged a project that a circle then found fits waits 30 days before flagging it again, and so does the charter reader.

**A few live projects each.** One person can have three live projects at a time. Finishing one makes room for the next.

**The charter reader** reads every proposal, piece of news and use. It does not count accounts, so it cannot be outvoted by them.

**Limits on joining and signing in**, for each place and each handle.

**Popularity buys little.** The list of projects is shuffled every day, so a pool with inflated numbers does not rise to the top. Once money is real, each account in a pool also means real money put in.

## Ways to go further

Every option trades strength against cost, privacy and who it leaves out. None of them is right as the only door.

**Email or phone codes.** Cheap, familiar and weak. A text message code costs a few cents and stops casual duplicates, but virtual numbers get around it, and many people in the world share a phone. Useful as a speed bump.

**Bot challenges.** Cloudflare can challenge suspicious sign-ups on `/join` with a rule in its dashboard, without adding any script to Expleate's own pages. This stops scripted sign-ups, not a patient person.

**Vouching.** Members with standing vouch for people they know. Each member can vouch for a few people a month, and if a circle finds that an account was a duplicate, everyone who vouched for it loses the right to vouch for a while. It is free and private, it suits a community built on trust, and it gets stronger as that community grows. It is weakest at the very start, when few people know each other. BrightID works in a similar way.

**Meeting in person.** People gather at the same time in many places, and each person present receives one token. Nobody can be in two places at once. The computer scientist Bryan Ford called these pseudonym parties. Expleate's projects are gatherings anyway: a first picnic held at the same hour in many towns could seed the community with members nobody doubts.

**Identity checks by the payment partner.** Once real money flows, the law requires the payment partner to check who people are before money moves. That check can double as proof of one person, one voice: the partner tells Expleate only that someone is verified, and gives a token that is the same for the same person. Expleate never sees a document. It leaves out people without a bank account or official papers, so it should never be the only way to gain standing.

**ID documents and selfies.** Services such as Stripe Identity, Persona and Veriff compare an ID document with a live photo. Strong, at about a dollar or two per check, but they hold sensitive images and leave out people without ID.

**National digital identity wallets.** The EU requires every member state to offer one by the end of 2026. They are designed to prove a single fact, such as age, without handing over a name. Promising where they exist, and far from global.

**Proof-of-personhood networks.** World ID scans people's irises at its own devices, which gives strong uniqueness at a serious cost to privacy, and regulators in several countries have challenged it. Idena asks everyone to solve puzzles at the same moment. Proof of Humanity uses video, vouching and a deposit. Each either collects biometrics, needs cryptocurrency or reaches few people. Expleate could accept them as optional evidence, never require them.

## What we recommend

Keep the door wide open and make influence slow to fake.

1. **Anyone can join, suggest, put in and take back**, with no checks at all. That is how joy spreads, and none of it gives anyone power over anyone else.
2. **A voice needs standing.** Today that means a week of membership. Next, standing should also need one of: two vouches from members with standing, a place at an in-person gathering, or a check by the payment partner. Any one will do, so nobody is shut out for lacking a phone, a bank or a passport.
3. **Circles grow with the site**, from five people to nine and more.
4. **Duplicates found are dealt with by a circle**, never by one person: the accounts lose their standing, and so do the vouches that let them in.

## Only projects that do good?

Expleate does not try to decide which projects are worth doing. That would hand a few people, or an AI, the power to judge what everyone else may find joyful.

The charter draws the edges instead. A project must be creativity, adventure or joy, and it must stay clear of politics, war, profit, charity and harm. The word check, the charter reader, flags and circles guard those edges. Inside them, people decide with their own resources: a project nobody wants gathers nothing, and a project that loses people's trust empties as they take their portions back.

## Settings

| Setting | What it does | Default |
| --- | --- | --- |
| `STANDING_DAYS` | Days of membership before someone can flag or sit in a circle | `7` |
| `MAX_LIVE_PROJECTS` | Live projects one person can have at a time | `3` |
| `CIRCLE_SIZE` | People drawn for a circle | `5` |
| `FLAG_THRESHOLD` | Flags that pause a pool and draw a circle | `3` |
