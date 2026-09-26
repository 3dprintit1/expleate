import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { nestable, type Row, type Sql, type SqlValue } from './sql.js';

/** The Sql interface over Node's built-in SQLite, for local use and self-hosting. */
export function openNodeSql(path: string): Sql & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  const transaction = nestable(<T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });

  return {
    script(sql: string) {
      db.exec(sql);
    },
    run(sql: string, ...params: SqlValue[]) {
      return Number(prepare(sql).run(...params).changes);
    },
    get<T = Row>(sql: string, ...params: SqlValue[]) {
      return prepare(sql).get(...params) as T | undefined;
    },
    all<T = Row>(sql: string, ...params: SqlValue[]) {
      return prepare(sql).all(...params) as T[];
    },
    transaction,
    close() {
      db.close();
    },
  };
}
