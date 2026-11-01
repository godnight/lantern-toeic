-- Additive only. No user creation, phone transfer or legacy data claim.
CREATE TABLE auth_phone_bindings (
 phone TEXT PRIMARY KEY NOT NULL CONSTRAINT auth_phone_bindings_phone_format CHECK(length(phone)=14 AND substr(phone,1,4)='+861' AND substr(phone,5) NOT GLOB '*[^0-9]*'),
 user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id),
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE auth_phone_proofs (
 provider_id TEXT NOT NULL,
 proof_hash TEXT NOT NULL CONSTRAINT auth_phone_proofs_hash_format CHECK(length(proof_hash)=64),
 consumption_ticket TEXT NOT NULL UNIQUE,
 purpose TEXT NOT NULL CONSTRAINT auth_phone_proofs_purpose CHECK(purpose IN ('bind','login')),
 audience TEXT NOT NULL,
 phone TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES auth_users(id),
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER NOT NULL,
 PRIMARY KEY(provider_id,proof_hash)
);
--> statement-breakpoint
CREATE INDEX auth_phone_proofs_expiry ON auth_phone_proofs(expires_at);
