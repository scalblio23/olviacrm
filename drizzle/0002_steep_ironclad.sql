CREATE TABLE `call_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`phone` varchar(64) NOT NULL,
	`durationSeconds` int NOT NULL DEFAULT 0,
	`disposition` enum('none','answered','no_answer','callback','appointment_set') NOT NULL DEFAULT 'none',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `call_history_id` PRIMARY KEY(`id`)
);
