# Putting Expleate online at expleat.ing

Expleate runs on Cloudflare: one Worker that receives every request, and one Durable Object (the Commons) that holds the whole ledger in its own SQLite database. The Commons handles one request at a time, so a pool's balance can never be read and written by two requests at once. The stylesheet and icon are served straight from Cloudflare's edge.

## What it costs

Use the **Workers Paid plan, at $5 a month**. Signing up and signing in run a deliberately slow password check (about 45 ms of processing), and the free plan allows only 10 ms per request, so the free plan would turn people away at the door.

The paid plan includes 10 million Worker requests and 1 million Durable Object requests a month. Every page view uses one of each, so that is roughly a million page views a month before anything extra is charged, and past that it is cents per million. Add the yearly renewal of the domain. At early traffic, $200 covers about three years.

Check Cloudflare's current prices before relying on these numbers: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Before the first deploy

1. **A Cloudflare account on the Workers Paid plan.** In the dashboard: Workers & Pages, then Plans.
2. **expleat.ing added to the same Cloudflare account.** The domain is registered with VentraIP, so Cloudflare needs to answer for it:
   1. In the Cloudflare dashboard, choose **Add a domain**, enter `expleat.ing`, and pick the **Free** plan for the domain. (The Workers Paid plan is separate and covers the site itself.) Cloudflare then shows you two nameservers, such as `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`. Yours will have different names.
   2. In [VentraIP's VIPcontrol](https://vip.ventraip.com.au), go to **My Services**, then **Domains**, and click the **DNS** button next to `expleat.ing`.
   3. If **DNSSEC** is switched on for the domain, switch it off first. Cloudflare can switch it back on later, with its own keys.
   4. Open the **Custom Nameservers** tab, enter the two Cloudflare nameservers, and click **Set Custom Nameservers**.
   5. Wait for Cloudflare to say the domain is active. VentraIP suggests allowing 2 to 6 hours, and it can take up to a day.

   You never need to give anyone your VentraIP password for this. Nothing else changes at VentraIP: the domain stays registered there, and you renew it there.
3. **Node 22.13 or newer**, then in this repository run `npm install`.

## Deploy

```sh
npx wrangler login
npm run deploy
```

The deploy creates the Worker and the Commons, sets up the daily job, and attaches `expleat.ing` with a certificate. If the domain is not active on Cloudflare yet, the deploy stops with an error about the zone. You can wait, or delete the `routes` line in `wrangler.jsonc` to deploy to a `workers.dev` address in the meantime.

## Become the first caretaker

Caretakers pay the bills and record them on the public running-costs page. They have no say over projects or circles.

1. Go to <https://expleat.ing/join> and join with the handle you want, before telling anyone the site exists.
2. Put that handle in `wrangler.jsonc`, for example `"CARETAKERS": "alan"`, and run `npm run deploy` again.

Joining first matters: whoever holds a handle listed in `CARETAKERS` is a caretaker, so claim yours before listing it.

## Record the founder's $200

On <https://expleat.ing/costs>, use "Record a gift that covers costs": who is covering it ("The founder", or your name), `200`, and a note such as "Covers the first $200 of running costs." From then on, each bill you record is covered by that gift until it runs out, and only then shared across the pools.

## Record every bill

When Cloudflare or the registrar charges you, record it on the costs page with the date, what it was for, the amount, and a link to the receipt if you can share one. Cloudflare's invoices are under Manage Account, then Billing. Everyone can see every entry, and the public API serves them at `/api/costs`.

On the first of each month the daily job shares whatever is still owed across all live pools, never more than 2% of everything pooled in one go. Caretakers can also share sooner with the button on the costs page.

## While Expleate is a prototype

`DEMO_RESOURCES` is `"true"`, so people add pretend resources with a button and a banner says so on every page. The cost shares are pretend too, and the real bills are paid by the founder's gift. Set it to `"false"` only once real money is connected: see [the roadmap](roadmap.md).

## Settings

All in the `vars` section of `wrangler.jsonc`:

| Setting | What it does | Default |
| --- | --- | --- |
| `SITE_URL` | The public address | `https://expleat.ing` |
| `CURRENCY`, `LOCALE` | Currency and how numbers and dates are written | `USD`, `en-GB` |
| `DEMO_RESOURCES` | Pretend resources while there is no real money | `true` |
| `CARETAKERS` | Handles of the people who record running costs | none |
| `CIRCLE_SIZE` | People drawn for a charter circle (kept odd) | `5` |
| `FLAG_THRESHOLD` | Different people who must flag a project before a circle is drawn | `3` |
| `REVIEW_DAYS` | How long a circle has to decide | `7` |
| `MAX_COST_SHARE_PPM` | Most one running-cost share may take, in parts per million | `20000` (2%) |

## Looking after it

- `npx wrangler tail` shows live logs, and the Cloudflare dashboard keeps recent ones (observability is on).
- `npm run cf:dev` runs the Cloudflare version on your own machine, with its own local data.
- Durable Object storage keeps 30 days of point-in-time recovery on Cloudflare's side. A regular export of the ledger is on the roadmap.
- Rate limiting rules in the Cloudflare dashboard (Security, then WAF) are worth adding for `/join` and `/sign-in`.
