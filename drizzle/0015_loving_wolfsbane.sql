CREATE TABLE `automation_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automationId` int NOT NULL,
	`contactId` int NOT NULL,
	`currentStep` int NOT NULL DEFAULT 0,
	`nextRunAt` bigint,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automation_enrollments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automationId` int NOT NULL,
	`stepOrder` int NOT NULL,
	`stepType` varchar(32) NOT NULL,
	`waitValue` int,
	`waitUnit` varchar(16),
	`waitMode` varchar(32) DEFAULT 'delay',
	`eventType` varchar(64),
	`smsBody` text,
	`emailSubject` varchar(500),
	`emailBody` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `automation_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`triggerType` varchar(64) NOT NULL DEFAULT 'tag_added',
	`triggerTagId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automations_id` PRIMARY KEY(`id`)
);
