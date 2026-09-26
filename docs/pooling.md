# How pooling works

Every project on Expleate has one pool. People put resources in, the project's hosts use them for the project, and anyone can take their portion back at any time.

Your portion is your share of what is in the pool now, counting only the spending that happened while your money was in it. Two promises follow from that, for everyone in every pool:

1. **You never take back more than you put in.** Nobody gains from a pool.
2. **You share in the spending that happens while your money is in the pool, and only that.** Everyone in the pool at that moment carries it by the same percentage. People joining or leaving never changes what your portion is worth.

## Some examples

### A hundred people join, then $100 is spent

Two people put in $50 each to start the pool. Then 100 more people put in $50 each, so the pool holds $5,100. The hosts spend $100 on paint. That is 1.96% of the pool, so every portion shrinks by 1.96%, and all 102 people can take back $49.01 or $49.02 each, however early they joined. The exact share is $49.0196, and every cent of the $5,000 is paid out.

### Spending before someone joins

Ten people put in $1,000 each, and the hosts spend $9,000 building a boat. Then Siobhán puts in $1,000 for the last part of the trip. The boat was paid for before Siobhán joined, so it is carried by the ten whose money paid for it: their portions are worth $100 each, and Siobhán's is worth $1,000.

If the hosts then spend $1,000 of the $2,000 left, that is half the pool, and everyone in it shares it: the ten are left with $50 each, and Siobhán with $500.

### Nothing has been used yet

Amara puts in $100 and Kenji puts in $100. The pool holds $200. Nothing has been used, so each of them can take back their $100 whenever they like, in either order.

### Taking back part of a portion

Amara's portion is worth $80. Amara takes back $30 and leaves $50 in. From then on, that $50 carries later spending in proportion, like everyone else's.

### The project finishes

The project is done and $300 is left. Amara's portion is worth $100 and Kenji's is worth $200. The pool hands back $100 to Amara and $200 to Kenji, and closes.

## Why not share out by what everyone has put in?

It is tempting to share the pool out by what people have put in: your share of the pool is what you put in, divided by everything everyone has put in. When all the spending happens after everyone has joined, that gives exactly the same answers as Expleate, as in the first example above.

It goes wrong when some of the spending came first. In the boat example, Siobhán's $1,000 would be worth $181.82 the moment it went in, because it would be paying for a boat bought before Siobhán arrived, and each of the ten would gain $81.82 from Siobhán joining. Nobody should lose anything by joining a pool, or gain anything because someone else did.

## Why not a percentage fixed when you joined?

The idea Expleate started from was that you can take back up to what you put in, and if the pot holds less than when you joined, you get the same percentage of what is left as your contribution was of the pot back then.

For one person on their own, that works exactly. With more people, each person's percentage is measured against a different pot, so the percentages do not add up to the whole pot, and the answer depends on who asks first. Take the first example, read word for word:

- If people take back in the order they joined, the first ones get their full $50, the 100th person gets only $12.13, and $1,225 is left in the pot that nobody is owed.
- If they take back in the opposite order, everyone gets $49.02.

Someone taking their own money back would also count as a loss for everyone who stayed, even when nothing had been spent.

Expleate keeps the two promises from that idea and counts it so the numbers always add up.

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
