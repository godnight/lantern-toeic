-- Additive SMS challenge admission. No users, passwords, old proofs or Study tables rewritten.
CREATE TABLE auth_phone_challenges (
 challenge_id TEXT PRIMARY KEY NOT NULL,
 provider_id TEXT NOT NULL,
 audience TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('bind','login')),
 phone TEXT NOT NULL,
 binding_user_id TEXT REFERENCES auth_users(id),
 reservation_ticket TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('pending','sent','verifying','consumed','failed','unknown')),
 provider_reference TEXT,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 resend_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 verification_ticket TEXT UNIQUE,
 consumption_ticket TEXT UNIQUE,
 CHECK((purpose='bind' AND binding_user_id IS NOT NULL) OR (purpose='login' AND binding_user_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX auth_phone_challenges_expiry ON auth_phone_challenges(expires_at);
--> statement-breakpoint
CREATE TABLE auth_phone_flow_buckets (
 scope TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 count INTEGER NOT NULL CHECK(count>0),
 admission_ticket TEXT NOT NULL,
 PRIMARY KEY(scope,window_start)
);
--> statement-breakpoint
CREATE TABLE auth_phone_flow_cooldowns (
 scope TEXT PRIMARY KEY NOT NULL,
 resend_at INTEGER NOT NULL,
 admission_ticket TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE auth_phone_flow_operations (
 ticket TEXT PRIMARY KEY NOT NULL,
 challenge_id TEXT NOT NULL REFERENCES auth_phone_challenges(challenge_id),
 kind TEXT NOT NULL CHECK(kind IN ('verify')),
 created_at INTEGER NOT NULL
);
