# Taking part in building Expleate

Thank you for wanting to help. Please read this before you write any code.

## The one idea

Build as if everyone already had an equal share of the world's resources.

In that world nobody needs to sell to anybody, nobody competes for attention, and nobody's voice counts for more because they have more. Every decision about Expleate starts there: what a page shows, what a feature rewards, how a number is worded. When a choice is unclear, ask which option would make sense in that world, and pick it.

## What that means in practice

- **No fees, no margin, no profit.** Running costs are shared at exactly what they cost and published at `/costs`. Nothing is ever added on top.
- **No ads, no tracking, no selling data.** No third-party scripts at all.
- **No ranking by money.** Never sort, highlight or reward projects or people by how much they have pooled. The default order is a daily shuffle.
- **One person, one voice.** Charter circles give each person one vote. Nothing anywhere is weighted by resources.
- **Amounts stay private.** Nobody sees how much anyone else put in. Pools show their total and how many people are in them.
- **Leaving is always possible.** Taking back a portion must never be blocked or made harder, including while a circle is deciding.
- **Everything done with pooled resources is public.** Uses and running costs are listed for anyone to check.
- **No tricks to hold attention.** No streaks, countdowns, "trending" badges, or notifications meant to pull people back.
- **Everyone, everywhere.** Pages are server-rendered HTML that works without JavaScript, on slow connections and small screens. Accessibility is part of done.
- **The money rules are sacred.** Any change to how pools are counted needs tests that show the promises in [How pooling works](docs/pooling.md) still hold.

## Words

The words on the site shape how people think about what they are doing.

| Say | Avoid |
| --- | --- |
| put in, contribution | invest, donate, back, fund |
| take back, your portion | withdraw, refund, cash out, return |
| people in the pool | investors, backers, donors, customers |
| stewards, the people looking after it | owners, founders, creators |
| uses | expenses, spending |
| running costs | fees, platform charge |
| members, people | users, customers, audience |

Leave out market language altogether: growth, engagement, conversion, monetise, market, ROI.

Write plainly, in British English (colour, organise, programme). Keep sentences short and warm. Avoid em dashes and hype words such as exciting, powerful or revolutionary.

## Working on the code

```sh
npm install
npm run seed && CARETAKERS=demo_caretaker npm run dev
npm test
npm run check
```

- Keep `src/core` free of storage and web code, so the rules can be tested on their own.
- Services must stay synchronous between reading and writing the database. On Cloudflare, an `await` between a read and the write that depends on it would let another request slip in between.
- Put every change that moves resources inside `ctx.sql.transaction`, and write it to the ledger with `record`.
- Add a migration to `src/store/schema.ts` for any schema change. Never edit one that has shipped.
- After editing `CHARTER.md` or `docs/pooling.md`, run `npm run docs`, since the site shows them. A test fails if you forget.

## Changing the charter

The charter belongs to everyone who uses Expleate. Propose a change by opening an issue that explains what you would change and why, so anyone can read it and join in. Changes to the charter check's word lists are welcome too, especially in other languages.
