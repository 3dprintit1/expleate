# What comes next

Expleate works end to end today with pretend resources. These are the larger pieces still to build, roughly in the order they matter. [How Expleate runs](how-it-runs.md) has the fuller picture, including how it grows and a checklist for real money.

## Real money

This is the big one. Holding other people's money in a pool, and letting them take it back later, is regulated almost everywhere. Before `DEMO_RESOURCES` can be switched off, Expleate needs:

- a legal home, such as a cooperative or an association, with legal advice for the countries it will serve
- a payment partner able to hold pooled funds, accept contributions from many countries and pay back take-backs, including the identity checks that come with that
- a way to pay for a project's uses directly, for example paying suppliers against receipts, so pooled money does not pass through hosts' own accounts

`addResources` and `moveOut` in `src/services/members.ts` are where payments would arrive and leave.

## One person, one voice

Standing and circles drawn at random are in place. Next come vouching between members, then identity checks through the payment partner once money is real, and gatherings in person. [One person, one voice](one-person-one-voice.md) sets out every option and the order to take them in.

## Changing the charter together

Right now changes to the charter are proposed in the open on the code repository. Members should be able to propose and agree changes on Expleate itself. Charter circles could do this, or a vote of everyone, one person one vote.

## Every language

The interface and the charter are in English, and so are the charter check's word lists. Translations of both are needed for a site meant for the whole world. The check in `src/core/charter.ts` already treats text as Unicode, so new word lists can be added language by language.

## More than one currency

A pool currently holds one currency, set for the whole site. Pools in different currencies, or a fair way to convert, would come with real money.

## Growing past one Durable Object

All requests go through a single Durable Object, which keeps the books exact and is simple to reason about. It will comfortably serve a young site. Well beyond that, each pool could live in its own Durable Object, with a careful protocol for moving resources between a person and a pool, and busy pages could be served from read replicas.

## Smaller things

- Let people know, gently, when they have been drawn for a charter circle (email or a notification they opt into).
- Passkeys, so nobody needs a password.
- A regular export of the public ledger, as a backup anyone can check.
- Pledges of time, skills, tools and space alongside resources.
- A way to report harmful words in updates, not only projects that break the charter.
- An accessibility review with people who use screen readers and other assistive technology.
