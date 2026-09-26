import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES, screen } from '../src/core/charter.js';
import { decision, decisionAtDeadline, drawCircle } from '../src/core/circle.js';
import { amountToShare, outstanding, splitInProportion } from '../src/core/costs.js';
import { hashPassword, randomInt, verifyPassword } from '../src/core/crypto.js';
import { formatAmount, makeCurrency, parseAmount } from '../src/core/money.js';
import { seeded } from './helpers.js';

const terms = (text: string) => screen({ story: text }).map((c) => `${c.rule}:${c.term.toLowerCase()}`);

describe('the charter check', () => {
  it('notices politics, war, gain and charity', () => {
    expect(terms('A rally for the election campaign')).toContain('politics:election');
    expect(terms('Care packages for soldiers in the war zone')).toEqual(
      expect.arrayContaining(['war:soldiers', 'war:war zone']),
    );
    expect(terms('We will sell prints and split the profits')).toEqual(expect.arrayContaining(['gain:sell', 'gain:profits']));
    expect(terms('Please donate to our fundraiser for flood victims')).toEqual(
      expect.arrayContaining(['charity:donate', 'charity:fundraiser', 'charity:victims']),
    );
    expect(terms('Our investors expect a return on investment')).toEqual(
      expect.arrayContaining(['gain:investors', 'gain:return on investment']),
    );
    expect(terms('Relief for people caught up in the war')).toContain('war:war');
  });

  it('leaves everyday joyful writing alone', () => {
    const innocent = [
      'A birthday party with a glue gun craft table and bath bombs',
      'Tug of war on the beach, then a treasure hunt',
      'We will investigate the rock pools and award a paper crown',
      'Warm soup, a Swiss Army knife and a strict training regime',
      'Costumes from the charity shop, cruelty-free face paint',
      'She returns on Friday with the drums; we will soldier on until then',
      'A non-profit community choir will sing in the park',
      'Put up posters so the whole street knows about the lantern walk',
      'Stewart and Warwick are building the kites',
    ];
    for (const text of innocent) expect(terms(text)).toEqual([]);
  });

  it('reports each wording once, with where it was found', () => {
    const concerns = screen({ title: 'War and war', plans: 'More war' });
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatchObject({ rule: 'war', field: 'title', term: 'War' });
  });

  it('has every rule written into the charter itself', () => {
    const charter = readFileSync(new URL('../CHARTER.md', import.meta.url), 'utf8');
    for (const rule of RULES) expect(charter).toContain(rule.title);
  });
});

describe('charter circles', () => {
  it('draws distinct people, an odd number where possible', () => {
    const random = seeded(7);
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const circle = drawCircle(people, 5, (n) => Math.floor(random() * n));
    expect(new Set(circle).size).toBe(5);
    expect(drawCircle(people.slice(0, 4), 5, () => 0)).toHaveLength(3);
    expect(drawCircle(['a'], 5, () => 0)).toEqual(['a']);
    expect(drawCircle([], 5, () => 0)).toEqual([]);
  });

  it('gives everyone the same chance of being drawn', () => {
    const counts = new Map<string, number>();
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (let i = 0; i < 20_000; i++) {
      for (const person of drawCircle(people, 3, randomInt)) counts.set(person, (counts.get(person) ?? 0) + 1);
    }
    for (const person of people) {
      // Each person is expected 6,000 times; allow for chance.
      expect(counts.get(person)).toBeGreaterThan(5_600);
      expect(counts.get(person)).toBeLessThan(6_400);
    }
  });

  it('decides on a majority of the whole circle, and otherwise gives the benefit of the doubt', () => {
    expect(decision({ seats: 5, fits: 2, breaks: 2 })).toBeNull();
    expect(decision({ seats: 5, fits: 3, breaks: 0 })).toBe('fits');
    expect(decision({ seats: 5, fits: 1, breaks: 3 })).toBe('breaks');
    expect(decisionAtDeadline({ seats: 5, fits: 0, breaks: 0 })).toBe('fits');
    expect(decisionAtDeadline({ seats: 5, fits: 1, breaks: 1 })).toBe('fits');
    expect(decisionAtDeadline({ seats: 5, fits: 1, breaks: 2 })).toBe('breaks');
  });
});

describe('running costs maths', () => {
  it('splits exactly, in proportion', () => {
    expect(splitInProportion(900n, [30_000n, 10_000n])).toEqual([675n, 225n]);
    // Equal remainders: the spare units go to the earliest items.
    expect(splitInProportion(2n, [1n, 1n, 1n])).toEqual([1n, 1n, 0n]);
    expect(splitInProportion(0n, [5n, 5n])).toEqual([0n, 0n]);
  });

  it('never splits more than there is', () => {
    expect(() => splitInProportion(10n, [3n, 3n])).toThrow(RangeError);
    const parts = splitInProportion(10n, [3n, 3n, 4n]);
    expect(parts).toEqual([3n, 3n, 4n]);
  });

  it('works out what is outstanding and how much to share now', () => {
    expect(outstanding({ costs: 500n, covered: 20_000n, shared: 0n })).toBe(0n);
    expect(outstanding({ costs: 20_900n, covered: 20_000n, shared: 300n })).toBe(600n);
    expect(amountToShare(600n, 10_000n, 20_000)).toBe(200n);
    expect(amountToShare(100n, 10_000n, 20_000)).toBe(100n);
    expect(amountToShare(100n, 0n, 20_000)).toBe(0n);
  });
});

describe('money', () => {
  const usd = makeCurrency('USD', 'en-GB');

  it('reads amounts the way people write them', () => {
    const read = (text: string) => {
      const result = parseAmount(text, usd);
      return result.ok ? result.amount : result.reason;
    };
    expect(read('20')).toBe(2_000n);
    expect(read('$20.5')).toBe(2_050n);
    expect(read('1,250.00')).toBe(125_000n);
    expect(read('1.250,00')).toBe(125_000n);
    expect(read('12,50')).toBe(1_250n);
    expect(read('1.234')).toMatch(/thousands separator or a decimal point/);
    expect(read('0.001')).toMatch(/at most 2 digits/);
    expect(read('0')).toMatch(/more than zero/);
    expect(read('-5')).toMatch(/more than zero/);
    expect(read('')).toMatch(/Enter an amount/);
  });

  it('writes amounts plainly', () => {
    expect(formatAmount(2_000n, usd)).toBe('$20');
    expect(formatAmount(2_050, usd)).toBe('$20.50');
    expect(formatAmount(123_456_789n, usd)).toBe('$1,234,567.89');
  });
});

describe('passwords', () => {
  it('hashes and checks', async () => {
    const hash = await hashPassword('pool together', 1_000);
    expect(hash).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect(await verifyPassword('pool together', hash)).toBe(true);
    expect(await verifyPassword('pool apart', hash)).toBe(false);
    expect(await verifyPassword('pool together', 'nonsense')).toBe(false);
  });
});
