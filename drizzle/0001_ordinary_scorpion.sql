CREATE TABLE `lead_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`fileName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_sessions_sessionId_unique` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`name` varchar(255),
	`phone` varchar(64) NOT NULL,
	`company` varchar(255),
	`extraData` json,
	`disposition` enum('none','answered','no_answer','callback','appointment_set') NOT NULL DEFAULT 'none',
	`notes` text DEFAULT (''),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
