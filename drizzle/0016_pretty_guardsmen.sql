CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`calendarId` int NOT NULL,
	`contactId` int,
	`title` varchar(255) NOT NULL,
	`startAt` bigint NOT NULL,
	`endAt` bigint NOT NULL,
	`notes` text,
	`status` varchar(32) NOT NULL DEFAULT 'scheduled',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`type` varchar(32) NOT NULL DEFAULT 'custom',
	`ownerId` int,
	`color` varchar(32) NOT NULL DEFAULT '#6366f1',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `calendars_id` PRIMARY KEY(`id`)
);
