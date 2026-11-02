/** Schema migrations embedded as strings so dist needs no extra asset copy. */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "001_initial",
    sql: `
CREATE TABLE IF NOT EXISTS worker_definitions (
  id TEXT PRIMARY KEY,
  spec TEXT NOT NULL CHECK (json_valid(spec)),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_files (
  skill_name TEXT NOT NULL REFERENCES skills(name) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content BLOB NOT NULL,
  mode INTEGER NOT NULL,
  PRIMARY KEY (skill_name, path)
);

CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  thread_id TEXT,
  actor_id TEXT,
  payload_ref TEXT NOT NULL,
  preview TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  definition TEXT NOT NULL CHECK (json_valid(definition)),
  origin_trigger_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  branch TEXT,
  status TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  thread_id TEXT NOT NULL,
  PRIMARY KEY (task_id, thread_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL UNIQUE,
  events_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_run
  ON runs(session_id)
  WHERE status IN ('pending', 'submitted');

CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  trigger_id TEXT NOT NULL REFERENCES triggers(id),
  steer INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (target, trigger_id)
);

CREATE TABLE IF NOT EXISTS tool_actions (
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, tool_call_id)
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  cmd TEXT NOT NULL,
  status TEXT NOT NULL,
  pgid INTEGER,
  proc_start_time TEXT,
  deadline_at TEXT,
  log_path TEXT,
  exit_code INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_command_per_task
  ON operations(task_id)
  WHERE status IN ('pending', 'running', 'unknown');

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  external_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "002_journal",
    sql: `
CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_scope_created
  ON journal(scope, created_at DESC);
`,
  },
  {
    version: 3,
    name: "003_channel_routes",
    sql: `CREATE TABLE IF NOT EXISTS channel_routes (
      channel TEXT NOT NULL, thread_id TEXT NOT NULL,
      target TEXT NOT NULL CHECK (json_valid(target)), updated_at TEXT NOT NULL,
      PRIMARY KEY (channel, thread_id)
    );`,
  },
];
