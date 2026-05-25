CREATE TABLE `email_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`direction` enum('outbound','inbound') NOT NULL,
	`subject` varchar(500) NOT NULL,
	`body` text NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'sent',
	`externalId` varchar(255),
	`messageType` varchar(32) NOT NULL DEFAULT 'manual',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `inviteSequenceStep` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `inviteCronTaskUid` varchar(65);