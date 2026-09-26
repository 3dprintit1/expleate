# How pooling works

Every project on Expleate has one pool. People put resources in, the project's hosts use resources for the project, and anyone can take their portion back at any time.

Two promises hold for everyone in every pool:

1. **You never take back more than you put in.** Nobody gains from a pool.
2. **Only the project using resources can shrink your portion, and it shrinks everyone's by the same proportion.** Other people joining or leaving never changes what your portion is worth.

## Some examples

### Nothing has been used yet

Amara puts in $100 and Kenji puts in $100. The pool holds $200. Nothing has been used, so each of them can take back their $100 whenever they like, in either order.

### The pool has been used

Amara and Kenji have $100 each in the pool. The hosts use $150 on rope and a tent, which leaves $50. Three quarters of the pool has been used, so three quarters of each portion has gone with it: Amara and Kenji can each take back $25.

### Someone joins after a use

Amara puts in $100. The hosts use $50 of it. Then Kenji puts in $100. Amara's portion is now $50, and Kenji's is $100. None of Kenji's $100 went on something that happened before it arrived.

### Taking back part of a portion

Amara's portion is worth $80. Amara takes back $30 and leaves $50 in. From then on, that $50 carries later uses in proportion, like everyone else's.

### The project finishes

The project is done and $300 is left. Amara's portion is worth $100 and Kenji's is worth $200. The pool hands back $100 to Amara and $200 to Kenji, and closes.

## Why the rule is counted this way

The idea Expleate started from was this: you can take back up to what you put in, and if there is less in the pot than when you joined, you get the same percentage of what is left as your contribution was of the pot when you put it in.

For one person on their own that works exactly. Put in $100, the pot halves, and you get $50 back.

With more than one person, reading it word for word goes wrong:

- Amara and Kenji each put in $100, and nothing is used. Amara takes $100 back. The pot now holds $100, which is less than the $200 it held when Kenji put money in. Kenji's $100 was 50% of the pot then, so Kenji would get 50% of $100: only $50, although nothing was ever used. The other $50 would be stranded.
- Amara puts $100 into an empty pot, so Amara's share is 100%. Kenji puts in $100, which is 50%. The project uses $150. If Amara asks first, Amara gets 100% of the $50 left, and Kenji gets nothing. Whoever asks first does best, which is the kind of race Expleate exists to avoid.

So Expleate keeps the idea and fixes the counting. Your part of the pool is set when you put something in. People joining or leaving change the size of your part but not what it is worth, because they bring or take their own resources with them. Only uses shrink what it is worth. For someone alone in a pool, this gives exactly the original rule. With other people it stays fair, and it no longer matters who takes back first.

## How it is counted

Each person in a pool holds a *weight*, and the pool's resources belong to people in proportion to their weight.

- **Putting in** adds weight at the pool's current rate: the amount times the pool's total weight, divided by what the pool holds. The newcomer's weight is worth exactly what they brought, and nobody else's changes.
- **Taking back** removes weight at the same rate.
- **Using** lowers what the pool holds but leaves the weights alone, so every portion is worth less by the same proportion.
- A portion is worth its weight times what the pool holds, divided by the total weight, and never more than what its holder put in, less what they have already taken back.

Everything is counted exactly, in whole cents, using whole-number arithmetic with no rounding errors building up. Where rounding cannot be avoided, it is arranged so that the pool can always pay everyone what it says they are owed, and so that putting something in never costs you a cent. After a use you may see a cent of difference now and then, never more than a cent or two.

If a use empties the pool completely, every portion in it is worth nothing and the pool starts afresh for anyone who puts something in afterwards.

When a project finishes, what is left is shared out by the same weights. Each person gets their share rounded down, and the few cents left over by rounding go one at a time to the people whose shares were rounded down the most.

## Running costs

Keeping Expleate online costs money. Once gifts have covered what they can, running costs are shared across all live pools at exactly what they cost, once a month. Each pool gives up the same percentage of what it holds, and inside each pool that works just like a use: everyone's portion shrinks by that same small percentage. The [running costs page](/costs) lists every cost and every share.

## How we know it holds

The pooling rules live in [`src/core/pool.ts`](../src/core/pool.ts). The tests in [`test/pool.test.ts`](../test/pool.test.ts) run thousands of random sequences of putting in, taking back and using, and check after every step that:

- the pool can always pay everyone what their portion is worth
- nobody has ever taken back more than they put in
- when nothing has been used, everyone can take back exactly what they put in, to the cent
- a use shrinks every portion by the same proportion, to within a cent
- the order in which people take back makes no difference beyond a cent or two
- when a project finishes, every cent is handed back
