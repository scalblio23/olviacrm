ALTER TABLE `appointments` ADD `timezone` varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_enrollments` ADD `eventTimestamp` bigint;--> statement-breakpoint
ALTER TABLE `automations` ADD `timezone` varchar(64) DEFAULT 'UTC' NOT NULL;