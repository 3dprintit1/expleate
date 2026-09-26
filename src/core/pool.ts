/**
 * The pooling rules.
 *
 * Every project has one pool. People put resources in, the project's hosts
 * use resources for the project, and anyone can take back their portion at any
 * time. Two promises hold for everyone in a pool:
 *
 * 1. You can never take back more than you put in. Nobody gains from a pool.
 * 2. When the project uses resources, everyone in the pool carries that use in
 *    proportion to how much of the pool was theirs. Other people joining or
 *    leaving never changes what your portion is worth.
 *
 * So if nothing has been used since you joined, you can take back everything
 * you put in. If the project has used some of the pool, you can take back your
 * fair share of what is left.
 *
 * How it is counted: each person holds a weight in the pool, and the pool's
 * resources are divided between people in proportion to weight. Putting
 * resources in adds weight at the pool's current rate, so newcomers bring their
 * own resources with them and nobody else's portion moves. Taking back removes
 * weight at the same rate. Using resources lowers the pool's balance but leaves
 * its weight alone, which shrinks every portion by the same proportion.
 *
 * All arithmetic is exact integer arithmetic in the currency's smallest unit.
 * Wherever rounding is unavoidable it favours the people who stay in the pool,
 * so the pool can always pay everyone what it says they are owed.
 *
 * See docs/pooling.md for worked examples.
 */

export interface Pool {
  /** Resources in the pool now, in the currency's smallest unit. */
  readonly balance: bigint;
  /** The sum of every portion's weight. */
  readonly weight: bigint;
}

export interface Portion {
  /** This person's weight in the pool. */
  readonly weight: bigint;
  /**
   * The most this person may take back. It starts as what they put in and
   * goes down whenever they take something back.
   */
  readonly cap: bigint;
}

export const EMPTY_POOL: Pool = Object.freeze({ balance: 0n, weight: 0n });
export const EMPTY_PORTION: Portion = Object.freeze({ weight: 0n, cap: 0n });

/**
 * Weight given to each smallest unit put into an empty pool. It is large so
 * that rounding a weight costs far less than one smallest unit of value.
 */
export const WEIGHT_PER_UNIT = 1_000_000_000_000n;

export type PoolErrorCode = 'invalid_amount' | 'more_than_portion' | 'more_than_pool';

export class PoolError extends Error {
  readonly code: PoolErrorCode;

  constructor(code: PoolErrorCode, message: string) {
    super(message);
    this.name = 'PoolError';
    this.code = code;
  }
}

function assertPositive(amount: bigint): void {
  if (amount <= 0n) {
    throw new PoolError('invalid_amount', 'The amount must be more than zero.');
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Rounding a weight costs at most about a trillionth of a smallest unit.
 * Portions are read with an allowance of a billionth, so that rounding never
 * shows up as a lost cent, for instance for someone who joins after a use.
 * The allowances cannot add up to a whole unit while a pool has fewer than a
 * billion portions, so the pool can still pay everyone.
 */
const ALLOWANCE = 1_000_000_000n;

/**
 * What a portion is worth right now: the most its holder could take back.
 * It is their share of the pool by weight, never more than their cap.
 */
export function portionValue(pool: Pool, portion: Portion): bigint {
  if (portion.weight === 0n || pool.weight === 0n) return 0n;
  const fair = (portion.weight * pool.balance * ALLOWANCE + pool.weight) / (pool.weight * ALLOWANCE);
  return fair < portion.cap ? fair : portion.cap;
}

/** The fraction of the pool that belongs to a portion, from 0 to 1. For display only. */
export function portionFraction(pool: Pool, portion: Portion): number {
  if (pool.weight === 0n) return 0;
  // Scale before dividing so the result keeps useful precision as a float.
  const scaled = (portion.weight * 1_000_000n) / pool.weight;
  return Number(scaled) / 1_000_000;
}

export interface Contribution {
  readonly pool: Pool;
  readonly portion: Portion;
}

/**
 * Someone puts `amount` into the pool. Their weight grows at the pool's
 * current rate, so everyone else's portion keeps exactly the value it had.
 */
export function contribute(pool: Pool, portion: Portion, amount: bigint): Contribution {
  assertPositive(amount);

  let weightAdded: bigint;
  if (pool.weight === 0n) {
    weightAdded = amount * WEIGHT_PER_UNIT;
  } else if (pool.balance === 0n) {
    // A pool that has been used up is reset by `use`, so this cannot happen
    // unless a caller skipped that reset.
    throw new Error('A used-up pool must be reset before new resources are put in.');
  } else {
    // Rounded down, so the newcomer's weight never claims more than they brought.
    weightAdded = (amount * pool.weight) / pool.balance;
  }

  if (weightAdded === 0n) {
    throw new PoolError('invalid_amount', 'The amount is too small to put into this pool.');
  }

  return {
    pool: { balance: pool.balance + amount, weight: pool.weight + weightAdded },
    portion: { weight: portion.weight + weightAdded, cap: portion.cap + amount },
  };
}

export interface TakeBack {
  readonly pool: Pool;
  readonly portion: Portion;
}

/**
 * Someone takes `amount` back out of the pool. They may take any amount up to
 * the current value of their portion.
 */
export function takeBack(pool: Pool, portion: Portion, amount: bigint): TakeBack {
  assertPositive(amount);
  const value = portionValue(pool, portion);
  if (amount > value) {
    throw new PoolError('more_than_portion', 'That is more than your portion of this pool.');
  }

  let weightRemoved: bigint;
  let capRemaining: bigint;
  if (amount === value) {
    // Taking back everything they can. Their whole weight leaves with it, and
    // any rounding left behind stays with the people still in the pool.
    weightRemoved = portion.weight;
    capRemaining = 0n;
  } else {
    // Rounded up, so the person leaving carries any rounding, not the pool.
    weightRemoved = ceilDiv(amount * pool.weight, pool.balance);
    if (weightRemoved > portion.weight) weightRemoved = portion.weight;
    const weightRemaining = portion.weight - weightRemoved;
    // The cap shrinks in step with the weight, and always by at least the
    // amount taken, so a lifetime of taking back can never exceed what was put in.
    const proportional = (portion.cap * weightRemaining) / portion.weight;
    const reduced = portion.cap - amount;
    capRemaining = proportional < reduced ? proportional : reduced;
  }

  return {
    pool: { balance: pool.balance - amount, weight: pool.weight - weightRemoved },
    portion: { weight: portion.weight - weightRemoved, cap: capRemaining },
  };
}

export interface Use {
  readonly pool: Pool;
  /**
   * True when the use emptied the pool. Every portion in it is then worth
   * nothing and must be reset to EMPTY_PORTION by the caller, so that people
   * who put resources in later start afresh.
   */
  readonly drained: boolean;
}

/**
 * The project's hosts use `amount` from the pool. The balance goes down and
 * the weights stay put, so every portion shrinks by the same proportion.
 */
export function use(pool: Pool, amount: bigint): Use {
  assertPositive(amount);
  if (amount > pool.balance) {
    throw new PoolError('more_than_pool', 'That is more than there is in the pool.');
  }
  const balance = pool.balance - amount;
  if (balance === 0n) return { pool: EMPTY_POOL, drained: true };
  return { pool: { balance, weight: pool.weight }, drained: false };
}

export interface Settlement {
  /** What each portion receives, in the same order as the portions given. */
  readonly amounts: readonly bigint[];
  /**
   * Anything that could not be returned without breaking someone's cap. It is
   * only ever rounding dust, and it stays in the pool.
   */
  readonly unreturned: bigint;
}

/**
 * Hands everything in the pool back to the people in it, as happens when a
 * project finishes or is closed. Each person gets their fair share, rounded
 * down, and the units left over by rounding go one at a time to the people
 * whose shares were rounded down the most. The result does not depend on the
 * order the portions are listed in, apart from breaking exact ties.
 */
export function settle(pool: Pool, portions: readonly Portion[]): Settlement {
  if (pool.weight === 0n || pool.balance === 0n) {
    return { amounts: portions.map(() => 0n), unreturned: pool.balance };
  }

  const rows = portions.map((portion, index) => {
    const numerator = portion.weight * pool.balance;
    const floor = numerator / pool.weight;
    const amount = floor < portion.cap ? floor : portion.cap;
    return { index, amount, remainder: numerator % pool.weight, cap: portion.cap };
  });

  const floorsTotal = portions.reduce((sum, p) => sum + (p.weight * pool.balance) / pool.weight, 0n);
  let spare = pool.balance - floorsTotal;

  const byRemainder = rows
    .filter((row) => row.remainder > 0n)
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const row of byRemainder) {
    if (spare === 0n) break;
    if (row.amount < row.cap) {
      row.amount += 1n;
      spare -= 1n;
    }
  }

  const amounts = rows.map((row) => row.amount);
  const handedBack = amounts.reduce((sum, a) => sum + a, 0n);
  return { amounts, unreturned: pool.balance - handedBack };
}
