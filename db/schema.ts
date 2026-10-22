import {integer, sqliteTable, text, primaryKey, uniqueIndex, index, check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const profiles=sqliteTable('profiles',{userId:text('user_id').primaryKey(),body:text('body').notNull(),updatedAt:text('updated_at').notNull()});
export const attempts=sqliteTable('attempts',{id:text('id').primaryKey(),userId:text('user_id').notNull(),qid:text('qid').notNull(),choice:integer('choice').notNull(),correct:integer('correct',{mode:'boolean'}).notNull(),createdAt:text('created_at').notNull(),seconds:integer('seconds').notNull(),mode:text('mode').notNull()});
export const checkins=sqliteTable('checkins',{id:text('id').primaryKey(),userId:text('user_id').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()});
export const recordings=sqliteTable('recordings',{id:text('id').primaryKey(),userId:text('user_id').notNull(),objectKey:text('object_key').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()});
const mutableColumns=()=>({userId:text('user_id').notNull(),entityId:text('entity_id').notNull(),body:text('body').notNull(),revision:integer('revision').notNull(),cancelled:integer('cancelled').notNull(),mutationId:text('mutation_id').notNull()});
export const questionMarks=sqliteTable('question_marks',mutableColumns(),table=>[primaryKey({columns:[table.userId,table.entityId]})]);
export const resourceTasks=sqliteTable('resource_tasks',mutableColumns(),table=>[primaryKey({columns:[table.userId,table.entityId]})]);
export const vocabularyEvents=sqliteTable('vocabulary_events',{userId:text('user_id').notNull(),eventId:text('event_id').notNull(),body:text('body').notNull()},table=>[primaryKey({columns:[table.userId,table.eventId]})]);
export const examLibrary=sqliteTable('exam_library',{id:text('id').primaryKey(),userId:text('user_id').notNull(),objectKey:text('object_key').notNull(),manifest:text('manifest').notNull(),bytes:integer('bytes').notNull(),sha256:text('sha256').notNull(),state:text('state').notNull(),createdAt:text('created_at').notNull()},table=>[uniqueIndex('exam_library_owner_sha').on(table.userId,table.sha256)]);

// The clock is advanced by transaction triggers, never by client timestamps.
export const studySyncClock=sqliteTable('study_sync_clock',{id:integer('id').primaryKey(),epoch:text('epoch').notNull(),revision:integer('revision').notNull(),ready:integer('ready').notNull()});
export const studySyncIndex=sqliteTable('study_sync_index',{userId:text('user_id').notNull(),kind:text('kind').notNull(),entityId:text('entity_id').notNull(),revision:integer('revision').notNull(),deleted:integer('deleted').notNull()},table=>[primaryKey({columns:[table.userId,table.kind,table.entityId]}),index('study_sync_owner_revision').on(table.userId,table.revision,table.kind,table.entityId)]);


// Stable product identities; Study sync tables above remain unchanged.
export const authUsers=sqliteTable('auth_users',{id:text('id').primaryKey(),username:text('username').notNull().unique(),createdAt:integer('created_at').notNull()});
export const authPasswordCredentials=sqliteTable('auth_password_credentials',{userId:text('user_id').primaryKey().references(()=>authUsers.id),passwordHash:text('password_hash').notNull()});
export const authSessions=sqliteTable('auth_sessions',{tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>authUsers.id),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull()},table=>[index('auth_sessions_user').on(table.userId),index('auth_sessions_expiry').on(table.expiresAt)]);
export const authRateLimits=sqliteTable('auth_rate_limits',{scope:text('scope').notNull(),windowStart:integer('window_start').notNull(),count:integer('count').notNull(),admissionId:text('admission_id').notNull().default('')},table=>[primaryKey({columns:[table.scope,table.windowStart]}),index('auth_rate_limits_expiry').on(table.windowStart)]);

// Phone ownership attaches to existing product users only; no account migration.
export const authPhoneBindings=sqliteTable('auth_phone_bindings',{
 phone:text('phone').primaryKey(),userId:text('user_id').notNull().unique().references(()=>authUsers.id),createdAt:integer('created_at').notNull(),
},table=>[check('auth_phone_bindings_phone_format',sql`length(${table.phone})=14 AND substr(${table.phone},1,4)='+861' AND substr(${table.phone},5) NOT GLOB '*[^0-9]*'`)]);
export const authPhoneProofs=sqliteTable('auth_phone_proofs',{
 providerId:text('provider_id').notNull(),proofHash:text('proof_hash').notNull(),consumptionTicket:text('consumption_ticket').notNull().unique(),
 purpose:text('purpose').notNull(),audience:text('audience').notNull(),phone:text('phone').notNull(),userId:text('user_id').notNull().references(()=>authUsers.id),
 issuedAt:integer('issued_at').notNull(),expiresAt:integer('expires_at').notNull(),consumedAt:integer('consumed_at').notNull(),
},table=>[primaryKey({columns:[table.providerId,table.proofHash]}),check('auth_phone_proofs_hash_format',sql`length(${table.proofHash})=64`),check('auth_phone_proofs_purpose',sql`${table.purpose} IN ('bind','login')`),index('auth_phone_proofs_expiry').on(table.expiresAt)]);


// Additive 20055 SMS challenge/cooldown/atomic admission state; never stores codes.
export const authPhoneChallenges=sqliteTable('auth_phone_challenges',{
 challengeId:text('challenge_id').primaryKey(),providerId:text('provider_id').notNull(),audience:text('audience').notNull(),purpose:text('purpose').notNull(),phone:text('phone').notNull(),
 bindingUserId:text('binding_user_id').references(()=>authUsers.id),reservationTicket:text('reservation_ticket').notNull().unique(),state:text('state').notNull(),providerReference:text('provider_reference'),
 issuedAt:integer('issued_at').notNull(),expiresAt:integer('expires_at').notNull(),resendAt:integer('resend_at').notNull(),attempts:integer('attempts').notNull().default(0),verificationTicket:text('verification_ticket').unique(),consumptionTicket:text('consumption_ticket').unique(),
},table=>[index('auth_phone_challenges_expiry').on(table.expiresAt),check('auth_phone_challenges_purpose',sql`${table.purpose} IN ('bind','login')`),check('auth_phone_challenges_state',sql`${table.state} IN ('pending','sent','verifying','consumed','failed','unknown')`),check('auth_phone_challenges_attempts',sql`${table.attempts} BETWEEN 0 AND 5`),check('auth_phone_challenges_binding',sql`(${table.purpose}='bind' AND ${table.bindingUserId} IS NOT NULL) OR (${table.purpose}='login' AND ${table.bindingUserId} IS NULL)`)]);
export const authPhoneFlowBuckets=sqliteTable('auth_phone_flow_buckets',{scope:text('scope').notNull(),windowStart:integer('window_start').notNull(),count:integer('count').notNull(),admissionTicket:text('admission_ticket').notNull()},table=>[primaryKey({columns:[table.scope,table.windowStart]}),check('auth_phone_flow_buckets_count',sql`${table.count}>0`)]);
export const authPhoneFlowCooldowns=sqliteTable('auth_phone_flow_cooldowns',{scope:text('scope').primaryKey(),resendAt:integer('resend_at').notNull(),admissionTicket:text('admission_ticket').notNull()});
export const authPhoneFlowOperations=sqliteTable('auth_phone_flow_operations',{ticket:text('ticket').primaryKey(),challengeId:text('challenge_id').notNull().references(()=>authPhoneChallenges.challengeId),kind:text('kind').notNull(),createdAt:integer('created_at').notNull()},table=>[check('auth_phone_flow_operations_kind',sql`${table.kind}='verify'`)]);
