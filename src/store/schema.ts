import type { Sql } from './sql.js';

/**
 * Database migrations, applied in order. Never edit one that has shipped:
 * add a new one instead.
 *
 * Amounts are INTEGER in the currency's smallest unit. Pool weights are TEXT
 * because they can grow beyond 64 bits; the pooling maths reads them as bigint.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1: the commons */ `
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_member ON sessions(member_id);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, member_id)
);
CREATE INDEX group_members_member ON group_members(member_id);

CREATE TABLE group_invites (
  group_id TEXT NOT NULL REFERENCES groups(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  invited_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, member_id)
);
CREATE INDEX group_invites_member ON group_invites(member_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  story TEXT NOT NULL,
  plans TEXT NOT NULL,
  spirits TEXT NOT NULL,
  hope INTEGER,
  proposer_id TEXT NOT NULL REFERENCES members(id),
  group_id TEXT REFERENCES groups(id),
  status TEXT NOT NULL CHECK (status IN ('awaiting', 'open', 'review', 'completed', 'stopped', 'closed', 'declined')),
  concerns TEXT NOT NULL DEFAULT '[]',
  concern_note TEXT NOT NULL DEFAULT '',
  closing_note TEXT NOT NULL DEFAULT '',
  shuffle_key INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  opened_at TEXT,
  finished_at TEXT,
  pool_balance INTEGER NOT NULL DEFAULT 0 CHECK (pool_balance >= 0),
  pool_weight TEXT NOT NULL DEFAULT '0',
  pool_put_in INTEGER NOT NULL DEFAULT 0,
  pool_taken_back INTEGER NOT NULL DEFAULT 0,
  pool_used INTEGER NOT NULL DEFAULT 0,
  pool_costs INTEGER NOT NULL DEFAULT 0,
  pool_returned INTEGER NOT NULL DEFAULT 0,
  people INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX projects_status ON projects(status, created_at);
CREATE INDEX projects_proposer ON projects(proposer_id);
CREATE INDEX projects_group ON projects(group_id);

CREATE TABLE portions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  weight TEXT NOT NULL DEFAULT '0',
  cap INTEGER NOT NULL DEFAULT 0,
  put_in INTEGER NOT NULL DEFAULT 0,
  taken_back INTEGER NOT NULL DEFAULT 0,
  returned INTEGER NOT NULL DEFAULT 0,
  show_name INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (project_id, member_id)
);
CREATE INDEX portions_member ON portions(member_id);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('add', 'move_out', 'put_in', 'take_back', 'use', 'cost_share', 'return')),
  member_id TEXT,
  project_id TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  pool_after INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ledger_project ON ledger(project_id, id);
CREATE INDEX ledger_member ON ledger(member_id, id);

CREATE TABLE updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  author_id TEXT NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX updates_project ON updates(project_id, created_at);

CREATE TABLE flags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  rule TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  review_id TEXT,
  settled INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX flags_one_open ON flags(project_id, member_id) WHERE settled = 0;

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  reason TEXT NOT NULL CHECK (reason IN ('proposal', 'flags')),
  status TEXT NOT NULL CHECK (status IN ('open', 'decided', 'withdrawn')),
  outcome TEXT CHECK (outcome IN ('fits', 'breaks')),
  created_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX reviews_open ON reviews(status, deadline_at);
CREATE INDEX reviews_project ON reviews(project_id);

CREATE TABLE seats (
  review_id TEXT NOT NULL REFERENCES reviews(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  vote TEXT CHECK (vote IN ('fits', 'breaks')),
  rule TEXT,
  note TEXT NOT NULL DEFAULT '',
  voted_at TEXT,
  PRIMARY KEY (review_id, member_id)
);
CREATE INDEX seats_member ON seats(member_id);

CREATE TABLE costs (
  id TEXT PRIMARY KEY,
  incurred_on TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  receipt_url TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES members(id),
  recorded_at TEXT NOT NULL
);

CREATE TABLE covers (
  id TEXT PRIMARY KEY,
  given_by TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES members(id),
  recorded_at TEXT NOT NULL
);

CREATE TABLE cost_shares (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  pooled INTEGER NOT NULL,
  pools INTEGER NOT NULL
);
`,
];

export function migrate(sql: Sql): void {
  sql.script('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = sql.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    const script = MIGRATIONS[version] as string;
    sql.transaction(() => {
      sql.script(script);
      sql.run(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        String(next),
      );
    });
    version = next;
  }
}
