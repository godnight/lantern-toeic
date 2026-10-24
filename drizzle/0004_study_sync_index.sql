-- Latest revision per entity, not a retained server operation history.
-- Schema-only: explicit bounded initialization is outside migration execution.
-- Trigger fallback permits writes before the ready=0 clock is initialized.
CREATE TABLE IF NOT EXISTS study_sync_clock (id INTEGER PRIMARY KEY NOT NULL, epoch TEXT NOT NULL, revision INTEGER NOT NULL, ready INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_sync_index (user_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, PRIMARY KEY(user_id,kind,entity_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS study_sync_owner_revision ON study_sync_index(user_id,revision,kind,entity_id);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_profiles_insert AFTER INSERT ON profiles BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'profile',NEW.user_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_profiles_update AFTER UPDATE ON profiles WHEN OLD.user_id IS NOT NEW.user_id OR OLD.body IS NOT NEW.body BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'profile',OLD.user_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'profile',NEW.user_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_profiles_delete AFTER DELETE ON profiles BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'profile',OLD.user_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_attempts_insert AFTER INSERT ON attempts BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'attempt',NEW.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_attempts_update AFTER UPDATE ON attempts WHEN OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id OR OLD.qid IS NOT NEW.qid OR OLD.choice IS NOT NEW.choice OR OLD.correct IS NOT NEW.correct OR OLD.created_at IS NOT NEW.created_at OR OLD.seconds IS NOT NEW.seconds OR OLD.mode IS NOT NEW.mode BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'attempt',OLD.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'attempt',NEW.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_attempts_delete AFTER DELETE ON attempts BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'attempt',OLD.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_checkins_insert AFTER INSERT ON checkins BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'checkin',NEW.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_checkins_update AFTER UPDATE ON checkins WHEN OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id OR OLD.body IS NOT NEW.body OR OLD.created_at IS NOT NEW.created_at BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'checkin',OLD.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'checkin',NEW.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_checkins_delete AFTER DELETE ON checkins BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'checkin',OLD.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_recordings_insert AFTER INSERT ON recordings BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'recording',NEW.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_recordings_update AFTER UPDATE ON recordings WHEN OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id OR OLD.object_key IS NOT NEW.object_key OR OLD.body IS NOT NEW.body OR OLD.created_at IS NOT NEW.created_at BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'recording',OLD.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'recording',NEW.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_recordings_delete AFTER DELETE ON recordings BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'recording',OLD.id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_question_marks_insert AFTER INSERT ON question_marks BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'questionMark',NEW.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_question_marks_update AFTER UPDATE ON question_marks WHEN OLD.user_id IS NOT NEW.user_id OR OLD.entity_id IS NOT NEW.entity_id OR OLD.body IS NOT NEW.body OR OLD.revision IS NOT NEW.revision OR OLD.cancelled IS NOT NEW.cancelled OR OLD.mutation_id IS NOT NEW.mutation_id BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'questionMark',OLD.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'questionMark',NEW.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_question_marks_delete AFTER DELETE ON question_marks BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'questionMark',OLD.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_resource_tasks_insert AFTER INSERT ON resource_tasks BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'resourceTask',NEW.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_resource_tasks_update AFTER UPDATE ON resource_tasks WHEN OLD.user_id IS NOT NEW.user_id OR OLD.entity_id IS NOT NEW.entity_id OR OLD.body IS NOT NEW.body OR OLD.revision IS NOT NEW.revision OR OLD.cancelled IS NOT NEW.cancelled OR OLD.mutation_id IS NOT NEW.mutation_id BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'resourceTask',OLD.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(NEW.user_id,'resourceTask',NEW.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),0) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS study_sync_resource_tasks_delete AFTER DELETE ON resource_tasks BEGIN
UPDATE study_sync_clock SET revision=revision+1 WHERE id=1;
INSERT INTO study_sync_index(user_id,kind,entity_id,revision,deleted) VALUES(OLD.user_id,'resourceTask',OLD.entity_id,COALESCE((SELECT revision FROM study_sync_clock WHERE id=1),1),1) ON CONFLICT(user_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
