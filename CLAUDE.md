# Expleate

A platform where anyone can suggest a project of creativity, adventure or joy, and anyone can pool resources into it and take their portion back. Read CHARTER.md and CONTRIBUTING.md before changing anything: every decision starts from the idea that everyone already has an equal share of the world's resources, so there is no profit, no ranking by money, and one person one voice.

## Commands

- `npm test`: all tests (vitest)
- `npm run check`: types for Node and for Cloudflare (regenerates worker-configuration.d.ts)
- `npm run seed && CARETAKERS=demo_caretaker npm run dev`: local site on http://localhost:8787 with example data (password "pool together")
- `npm run docs`: regenerate src/web/docs.generated.ts after editing CHARTER.md, docs/pooling.md, docs/one-person-one-voice.md or public/styles.css
- `npm run cf:dev`: the Cloudflare build locally; `npm run deploy`: deploy (docs/deploying.md)

## Layout

- `src/core`: pure rules (pool.ts pooling maths, charter.ts check, reader.ts the charter reader's instructions and answer checks, circle.ts, costs.ts, money.ts, crypto.ts). No storage or web code.
- `src/ai/claude-reader.ts`: the charter reader on Claude, through the official Anthropic SDK. The only file that talks to a model.
- `src/store`: synchronous `Sql` interface with node:sqlite and Durable Object adapters, and migrations in schema.ts.
- `src/services`: one function per action, each in a transaction. records.ts holds shared reads and writes. reader.ts wraps the actions the charter reader reads first (suggesting, news, uses).
- `src/web`: Hono app with server-rendered JSX, forms protected by a double-submit token and an Origin check, read-only JSON API under /api.
- `src/node.ts` and `src/worker.ts`: the two entry points. The Worker sends every request to one Durable Object, the Commons, and does the slow password work at the edge first, passing results in the headers listed in `src/web/edge.ts`. Nothing that keeps the processor busy may run inside the Commons: it serves everyone. Waiting on the network is fine, as the Commons serves other requests meanwhile, so the charter reader is awaited first and everything it affects is read and written afterwards, in one transaction.
- docs/how-it-runs.md explains the design, how it grows, and what is still missing.

## Rules that must hold

- Nobody takes back more than they put in. Uses and running-cost shares shrink every portion in a pool by the same proportion. Joining or leaving never changes anyone else's portion. The pool can always pay every portion. test/pool.test.ts checks these; extend it for any change to pooling.
- Resources are never created or lost: test/helpers.ts `expectConservation` checks balances, pools, uses, cost shares and moves out against everything added.
- No `await` between a database read and the write that depends on it (Cloudflare would let another request in between).
- Amounts are integers in the smallest currency unit; bigint in core maths, stored as INTEGER, weights stored as TEXT.
- Never show who put in how much. Take-back notes are for hosts only. Circle votes are anonymous.
- The charter reader never decides. Its concerns send a proposal to a circle once the proposer has explained, or count as one flag. It is never drawn for a circle, and it is sent what people wrote, never who wrote it.
- No JavaScript on pages and no third-party requests. The CSP forbids scripts and inline styles.

## Writing

British English, plain and warm, short sentences. No em dashes. Use the words in CONTRIBUTING.md: "put in", "take back", "portion", "people in the pool", "hosts", "uses", "running costs". Avoid invest, donate, backers, withdraw, refund, fees, users, growth, engagement.
