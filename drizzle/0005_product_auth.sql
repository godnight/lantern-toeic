-- Additive only: legacy study, guest and Sites-owned data are never claimed.
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE auth_password_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES auth_users(id),
  password_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
--> statement-breakpoint
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE auth_rate_limits (
  scope TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(scope, window_start)
);
--> statement-breakpoint
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(window_start);
