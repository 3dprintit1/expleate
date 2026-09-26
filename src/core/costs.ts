/**
 * Running costs. Keeping Expleate online costs money (hosting, a domain name),
 * and those costs are shared across every pool at exactly what they cost.
 *
 * Whatever has not been covered by a gift or already shared is "outstanding".
 * When costs are shared, the outstanding amount is split between all the live
 * pools in proportion to what each holds, so every pool gives up the same
 * percentage. Inside each pool it works like any other use: everyone's portion
 * shrinks by that same percentage. A limit on the percentage taken in one go
 * protects projects from a sudden large bill; anything above the limit waits
 * for the next share.
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

/** How much to share now: everything outstanding, up to the limit. */
export function amountToShare(outstandingAmount: bigint, pooled: bigint, maxPpm: number): bigint {
  if (outstandingAmount <= 0n || pooled <= 0n) return 0n;
  const limit = (pooled * BigInt(Math.max(0, Math.floor(maxPpm)))) / 1_000_000n;
  return outstandingAmount < limit ? outstandingAmount : limit;
}

/**
 * Splits `total` between items in proportion to `sizes`, exactly. Each item
 * gets its share rounded down, then the units left over go one at a time to
 * the items that lost the most to rounding. No item gets more than its size
 * as long as `total` is no more than the sum of sizes.
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
