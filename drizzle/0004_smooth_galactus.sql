CREATE TABLE `sms_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(64) NOT NULL,
	`direction` enum('outbound','inbound') NOT NULL,
	`body` text NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'sent',
	`externalId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_messages_id` PRIMARY KEY(`id`)
);
