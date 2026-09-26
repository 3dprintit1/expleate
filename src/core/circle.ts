/**
 * Charter circles. When a project might break the charter, a small circle of
 * members is drawn at random to decide. Drawing by lot means nobody holds the
 * job of judging others, and every member has the same chance to serve.
 * Each person in a circle has one vote, whatever they have pooled.
 */

export type Verdict = 'fits' | 'breaks';

export function isVerdict(value: string): value is Verdict {
  return value === 'fits' || value === 'breaks';
}

/**
 * Draws up to `size` distinct people uniformly at random. The circle is kept
 * to an odd number of people where possible, so that a complete vote always
 * has a majority.
 */
export function drawCircle<T>(
  eligible: readonly T[],
  size: number,
  randomInt: (maxExclusive: number) => number,
): T[] {
  let count = Math.min(Math.max(1, Math.floor(size)), eligible.length);
  if (count > 1 && count % 2 === 0) count -= 1;

  // A partial Fisher-Yates shuffle: every subset of `count` people is equally likely.
  const pool = [...eligible];
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(pool.length - i);
    const picked = pool[j] as T;
    pool[j] = pool[i] as T;
    pool[i] = picked;
  }
  return pool.slice(0, count);
}

export interface Tally {
  readonly fits: number;
  readonly breaks: number;
  /** How many people sit in the circle, whether or not they have voted. */
  readonly seats: number;
}

/** The decision once a majority of the whole circle agrees, or null while it is still open. */
export function decision(tally: Tally): Verdict | null {
  const majority = Math.floor(tally.seats / 2) + 1;
  if (tally.breaks >= majority) return 'breaks';
  if (tally.fits >= majority) return 'fits';
  return null;
}

/**
 * The decision when the circle's time runs out. A project is only stopped if
 * more people said it breaks the charter than said it fits. A tie, or no votes
 * at all, gives the project the benefit of the doubt.
 */
export function decisionAtDeadline(tally: Tally): Verdict {
  return tally.breaks > tally.fits ? 'breaks' : 'fits';
}
