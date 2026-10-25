CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`scout_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`scout_id` text NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_scout_item_type_idx` ON `alerts` (`scout_id`,`item_id`,`type`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`scout_id` text NOT NULL,
	`stage` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`available_at` integer NOT NULL,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`scout_id` text NOT NULL,
	`item_id` text NOT NULL,
	`data` text NOT NULL,
	`user_state` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_scout_item_idx` ON `matches` (`scout_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `scouts` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`next_run_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scouts_due_idx` ON `scouts` (`status`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
