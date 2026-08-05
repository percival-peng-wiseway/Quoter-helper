CREATE TABLE `system_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_system_notifications_created` ON `system_notifications` (`created_at`);