CREATE TABLE `ocr_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`encrypted_text` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ocr_cache_user` ON `ocr_cache` (`user_id`);--> statement-breakpoint
CREATE TABLE `ocr_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text NOT NULL,
	`daily_limit` integer DEFAULT 50 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ocr_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`pages` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
