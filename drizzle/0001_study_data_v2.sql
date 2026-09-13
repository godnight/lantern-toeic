CREATE TABLE `question_marks` (
	`user_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`cancelled` integer NOT NULL,
	`mutation_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `entity_id`)
);
--> statement-breakpoint
CREATE TABLE `resource_tasks` (
	`user_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`cancelled` integer NOT NULL,
	`mutation_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `entity_id`)
);
