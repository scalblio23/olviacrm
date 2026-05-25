CREATE TABLE `contact_tags` (
	`contactId` int NOT NULL,
	`tagId` int NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`color` varchar(32) NOT NULL DEFAULT '#6366f1',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `source` varchar(255);--> statement-breakpoint
ALTER TABLE `contacts` ADD `criteria1` varchar(255);--> statement-breakpoint
ALTER TABLE `contacts` ADD `criteria2` varchar(255);--> statement-breakpoint
ALTER TABLE `contacts` ADD `criteria3` varchar(255);--> statement-breakpoint
ALTER TABLE `contacts` ADD `criteria4` varchar(255);--> statement-breakpoint
ALTER TABLE `contacts` ADD `criteria5` varchar(255);--> statement-breakpoint
ALTER TABLE `lead_sessions` ADD `tagId` int;