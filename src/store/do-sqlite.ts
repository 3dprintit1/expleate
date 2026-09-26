import { nestable, type Row, type Sql, type SqlValue } from './sql.js';

/**
 * The parts of a Durable Object's storage this adapter needs. Written out
 * here so shared code does not depend on the Workers type definitions.
 */
export interface DurableSqlStorage {
  sql: {
    exec(query: string, ...bindings: unknown[]): {
      toArray(): Record<string, unknown>[];
    };
  };
  transactionSync<T>(closure: () => T): T;
}

/** The Sql interface over a Cloudflare Durable Object's SQLite storage. */
export function durableObjectSql(storage: DurableSqlStorage): Sql {
  const exec = (query: string, params: SqlValue[]) => storage.sql.exec(query, ...params).toArray();

  return {
    script(sql: string) {
      exec(sql, []);
    },
    run(sql: string, ...params: SqlValue[]) {
      exec(sql, params);
      const [row] = exec('SELECT changes() AS n', []);
      return Number(row?.n ?? 0);
    },
    get<T = Row>(sql: string, ...params: SqlValue[]) {
      return exec(sql, params)[0] as T | undefined;
    },
    all<T = Row>(sql: string, ...params: SqlValue[]) {
      return exec(sql, params) as T[];
    },
    transaction: nestable(<T>(fn: () => T): T => storage.transactionSync(fn)),
  };
}
