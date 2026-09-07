import {integer, sqliteTable, text} from 'drizzle-orm/sqlite-core';
export const profiles=sqliteTable('profiles',{userId:text('user_id').primaryKey(),body:text('body').notNull(),updatedAt:text('updated_at').notNull()});
export const attempts=sqliteTable('attempts',{id:text('id').primaryKey(),userId:text('user_id').notNull(),qid:text('qid').notNull(),choice:integer('choice').notNull(),correct:integer('correct',{mode:'boolean'}).notNull(),createdAt:text('created_at').notNull(),seconds:integer('seconds').notNull(),mode:text('mode').notNull()});
export const checkins=sqliteTable('checkins',{id:text('id').primaryKey(),userId:text('user_id').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()});
export const recordings=sqliteTable('recordings',{id:text('id').primaryKey(),userId:text('user_id').notNull(),objectKey:text('object_key').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()});
