import { describe, expect, it } from 'vitest';
import {
  EMPTY_POOL,
  EMPTY_PORTION,
  type Pool,
  type Portion,
  PoolError,
  contribute,
  portionValue,
  settle,
  takeBack,
  use,
} from '../src/core/pool.js';
import { seeded } from './helpers.js';

interface Person {
  portion: Portion;
  putIn: bigint;
  tookBack: bigint;
}

class Simulation {
  pool: Pool = EMPTY_POOL;
  people: Person[];

  constructor(count: number) {
    this.people = Array.from({ length: count }, () => ({ portion: EMPTY_PORTION, putIn: 0n, tookBack: 0n }));
  }

  value(i: number): bigint {
    return portionValue(this.pool, this.people[i]!.portion);
  }

  put(i: number, amount: bigint): void {
    const person = this.people[i]!;
    const next = contribute(this.pool, person.portion, amount);
    this.pool = next.pool;
    person.portion = next.portion;
    person.putIn += amount;
  }

  take(i: number, amount: bigint): void {
    const person = this.people[i]!;
    const next = takeBack(this.pool, person.portion, amount);
    this.pool = next.pool;
    person.portion = next.portion;
    person.tookBack += amount;
  }

  spend(amount: bigint): void {
    const next = use(this.pool, amount);
    this.pool = next.pool;
    if (next.drained) for (const person of this.people) person.portion = EMPTY_PORTION;
  }

  checkPromises(): void {
    const values = this.people.map((_, i) => this.value(i));
    const total = values.reduce((a, b) => a + b, 0n);
    // The pool can always pay everyone what it says they are owed.
    expect(total <= this.pool.balance).toBe(true);
    // Weights add up.
    expect(this.people.reduce((a, p) => a + p.portion.weight, 0n)).toBe(this.pool.weight);
    for (const person of this.people) {
      // Nobody ever takes back more than they put in.
      expect(person.tookBack <= person.putIn).toBe(true);
      expect(person.portion.cap >= 0n).toBe(true);
      expect(portionValue(this.pool, person.portion) <= person.portion.cap).toBe(true);
    }
  }
}

function randomBigInt(random: () => number, max: bigint): bigint {
  if (max <= 0n) return 0n;
  return BigInt(Math.floor(random() * Number(max))) + 1n;
}

describe('pooling maths', () => {
  it('matches the simple case: the pool halves, so does your portion', () => {
    const sim = new Simulation(1);
    sim.put(0, 10_000n);
    sim.spend(5_000n);
    expect(sim.value(0)).toBe(5_000n);
  });

  it('fixes the flaw in reading the rule word for word', () => {
    // Two people each put in 100 and nothing is used. Read literally, the rule
    // would give the second person only 50 after the first leaves. Here, both
    // get back exactly what they put in.
    const sim = new Simulation(2);
    sim.put(0, 10_000n);
    sim.put(1, 10_000n);
    sim.take(0, 10_000n);
    expect(sim.value(1)).toBe(10_000n);
    sim.take(1, 10_000n);
    expect(sim.pool).toEqual(EMPTY_POOL);
  });

  it('keeps its promises through thousands of random steps', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = seeded(seed);
      const sim = new Simulation(2 + Math.floor(random() * 6));
      for (let step = 0; step < 150; step++) {
        const roll = random();
        const i = Math.floor(random() * sim.people.length);
        if (roll < 0.45) {
          sim.put(i, randomBigInt(random, random() < 0.1 ? 1_000_000_000n : 100_000n));
        } else if (roll < 0.8) {
          const value = sim.value(i);
          if (value > 0n) sim.take(i, random() < 0.4 ? value : randomBigInt(random, value));
        } else if (sim.pool.balance > 0n) {
          sim.spend(random() < 0.05 ? sim.pool.balance : randomBigInt(random, sim.pool.balance));
        }
        sim.checkPromises();
      }
    }
  });

  it('gives back exactly what was put in, to the unit, when nothing is used', () => {
    for (let seed = 100; seed < 130; seed++) {
      const random = seeded(seed);
      const sim = new Simulation(5);
      for (let step = 0; step < 80; step++) {
        const i = Math.floor(random() * 5);
        if (random() < 0.6) sim.put(i, randomBigInt(random, 50_000n));
        else {
          const value = sim.value(i);
          if (value > 0n) sim.take(i, randomBigInt(random, value));
        }
      }
      sim.people.forEach((person, i) => {
        expect(sim.value(i)).toBe(person.putIn - person.tookBack);
      });
    }
  });

  it('shrinks every portion by the same proportion when resources are used', () => {
    for (let seed = 200; seed < 240; seed++) {
      const random = seeded(seed);
      const sim = new Simulation(6);
      for (let i = 0; i < 6; i++) sim.put(i, randomBigInt(random, 1_000_000n));
      sim.spend(randomBigInt(random, sim.pool.balance / 2n));
      const before = sim.people.map((_, i) => sim.value(i));
      const balanceBefore = sim.pool.balance;
      const spent = randomBigInt(random, balanceBefore - 1n);
      sim.spend(spent);
      sim.people.forEach((_, i) => {
        const expected = (before[i]! * (balanceBefore - spent)) / balanceBefore;
        const difference = sim.value(i) - expected;
        expect(difference >= -1n && difference <= 1n).toBe(true);
      });
    }
  });

  it('gives the same result whatever order people take back in, to within rounding', () => {
    for (let seed = 300; seed < 340; seed++) {
      const random = seeded(seed);
      const build = () => {
        const sim = new Simulation(7);
        const r = seeded(seed * 7);
        for (let step = 0; step < 40; step++) {
          const i = Math.floor(r() * 7);
          if (r() < 0.75) sim.put(i, randomBigInt(r, 500_000n));
          else if (sim.pool.balance > 1n) sim.spend(randomBigInt(r, sim.pool.balance - 1n));
        }
        return sim;
      };
      const forwards = build();
      const backwards = build();
      const order = [0, 1, 2, 3, 4, 5, 6].sort(() => random() - 0.5);
      const received = (sim: Simulation, sequence: number[]) => {
        const got = new Map<number, bigint>();
        for (const i of sequence) {
          const value = sim.value(i);
          if (value > 0n) sim.take(i, value);
          got.set(i, value);
        }
        return got;
      };
      const a = received(forwards, order);
      const b = received(backwards, [...order].reverse());
      for (let i = 0; i < 7; i++) {
        const difference = a.get(i)! - b.get(i)!;
        expect(difference >= -7n && difference <= 7n).toBe(true);
      }
    }
  });

  it('settles a pool exactly, with every unit accounted for', () => {
    for (let seed = 400; seed < 440; seed++) {
      const random = seeded(seed);
      const sim = new Simulation(9);
      for (let i = 0; i < 9; i++) sim.put(i, randomBigInt(random, 777_777n));
      sim.spend(randomBigInt(random, sim.pool.balance - 1n));
      const { amounts, unreturned } = settle(sim.pool, sim.people.map((p) => p.portion));
      expect(amounts.reduce((a, b) => a + b, 0n) + unreturned).toBe(sim.pool.balance);
      expect(unreturned).toBe(0n);
      amounts.forEach((amount, i) => expect(amount <= sim.people[i]!.portion.cap).toBe(true));
    }
  });

  it('rejects amounts it should not accept', () => {
    const sim = new Simulation(1);
    expect(() => sim.put(0, 0n)).toThrow(PoolError);
    sim.put(0, 100n);
    expect(() => sim.take(0, 101n)).toThrow(PoolError);
    expect(() => sim.spend(101n)).toThrow(PoolError);
    expect(() => sim.take(0, -1n)).toThrow(PoolError);
  });
});
