/**
 * Running costs. Keeping Expleate online costs money (hosting, a domain name),
 * and those costs are shared across every pool at exactly what they cost.
 *
 * Whatever has not been covered by a gift or already shared is "outstanding".
 * When costs are shared, the outstanding amount is split between all the live
 * pools in proportion to what each holds, so every pool gives up the same
 * percentage. Inside each pool it works like any other use: everyone's portion
 * shrinks by that same percentage.
 *
 * A limit protects projects from a sudden large bill: in any one calendar
 * month, no pool gives more than a set share of what it holds, however many
 * times costs are shared. Anything above the limit waits for next month.
 */

/** Parts per million: 20,000 is 2%. */
export const DEFAULT_MAX_SHARE_PPM = 20_000;

export interface CostTotals {
  readonly costs: bigint;
  readonly covered: bigint;
  readonly shared: bigint;
}

export function outstanding(totals: CostTotals): bigint {
  const left = totals.costs - totals.covered - totals.shared;
  return left > 0n ? left : 0n;
}

/**
 * The most each pool may still give this month: its share of what it holds,
 * less anything it has already given this month.
 */
export function monthlyCaps(balances: readonly bigint[], givenThisMonth: readonly bigint[], maxPpm: number): bigint[] {
  const ppm = BigInt(Math.max(0, Math.floor(maxPpm)));
  return balances.map((balance, index) => {
    const cap = (balance * ppm) / 1_000_000n - (givenThisMonth[index] ?? 0n);
    return cap > 0n ? cap : 0n;
  });
}

/**
 * What each pool gives now: everything outstanding, up to the pools' caps,
 * split in proportion to those caps. No pool gives more than its cap.
 */
export function planShare(owed: bigint, caps: readonly bigint[]): bigint[] {
  const room = caps.reduce((sum, cap) => sum + cap, 0n);
  const amount = owed < room ? owed : room;
  return splitInProportion(amount > 0n ? amount : 0n, caps);
}

/**
 * Splits `total` between items in proportion to `sizes`, exactly. Each item
 * gets its share rounded down, then the units left over go one at a time to
 * the items that lost the most to rounding. No item gets more than its size.
 */
export function splitInProportion(total: bigint, sizes: readonly bigint[]): bigint[] {
  const sum = sizes.reduce((acc, size) => acc + size, 0n);
  if (total <= 0n || sum <= 0n) return sizes.map(() => 0n);
  if (total > sum) throw new RangeError('Cannot split more than the sizes add up to.');

  const rows = sizes.map((size, index) => ({
    index,
    share: (total * size) / sum,
    remainder: (total * size) % sum,
  }));
  let spare = total - rows.reduce((acc, row) => acc + row.share, 0n);
  const byRemainder = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const row of byRemainder) {
    if (spare === 0n) break;
    row.share += 1n;
    spare -= 1n;
  }
  return rows.map((row) => row.share);
}
