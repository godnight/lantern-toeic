-- Additive provider identity mapping. Case-sensitive OpenID; never merges names.
CREATE TABLE auth_provider_bindings (
 provider TEXT NOT NULL,
 audience TEXT NOT NULL,
 subject TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES auth_users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(provider,audience,subject)
);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_provider_bindings_owner ON auth_provider_bindings(provider,audience,user_id);
--> statement-breakpoint
CREATE TABLE auth_huawei_codes (
 code_hash TEXT PRIMARY KEY NOT NULL,
 ticket TEXT NOT NULL UNIQUE,
 purpose TEXT NOT NULL,
 reserved_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 committed_user_id TEXT REFERENCES auth_users(id),
 completed_at INTEGER,
 CONSTRAINT auth_huawei_codes_hash CHECK(length(code_hash)=64),
 CONSTRAINT auth_huawei_codes_purpose CHECK(purpose IN ('login','bind')),
 CONSTRAINT auth_huawei_codes_completion CHECK((completed_at IS NULL AND committed_user_id IS NULL) OR (completed_at IS NOT NULL AND committed_user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX auth_huawei_codes_expiry ON auth_huawei_codes(reserved_at);
