CREATE TABLE `exam_library` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`manifest` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_library_owner_sha` ON `exam_library` (`user_id`,`sha256`);