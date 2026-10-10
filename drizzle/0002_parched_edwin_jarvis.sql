CREATE TABLE `vocabulary_events` (
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`user_id`, `event_id`)
);
