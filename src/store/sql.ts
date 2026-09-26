/**
 * A small synchronous SQL interface. Expleate's services are written against
 * this, so the same code runs on Node's built-in SQLite and inside a Cloudflare
 * Durable Object, whose SQLite storage is also synchronous.
 *
 * Synchronous matters: a service reads a pool, works out the new state and
 * writes it back with nothing able to run in between. Together with
 * `transaction`, that is what keeps every pool's books exact.
 */

export type SqlValue = string | number | bigint | null;
export type Row = Record<string, SqlValue>;

export interface Sql {
  /** Runs statements that take no parameters, such as a migration. */
  script(sql: string): void;
  /** Runs one statement and returns how many rows it changed. */
  run(sql: string, ...params: SqlValue[]): number;
  /** Returns the first row, if any. */
  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T = Row>(sql: string, ...params: SqlValue[]): T[];
  /**
   * Runs `fn` in a transaction: all of its writes happen, or none do. `fn`
   * must be synchronous. Nested calls join the outer transaction, so never
   * catch an error inside a transaction and carry on: the writes made before
   * it would still be committed with the outer transaction.
   */
  transaction<T>(fn: () => T): T;
}

/**
 * Adds nesting to an adapter's own begin/commit/rollback, so services can call
 * each other freely inside a transaction.
 */
export function nestable(run: <T>(fn: () => T) => T): <T>(fn: () => T) => T {
  let depth = 0;
  return <T>(fn: () => T): T => {
    if (depth > 0) return fn();
    depth += 1;
    try {
      return run(fn);
    } finally {
      depth -= 1;
    }
  };
}
