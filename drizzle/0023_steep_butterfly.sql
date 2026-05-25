CREATE TABLE `update_dismissals` (
	`userId` int NOT NULL,
	`updateId` int NOT NULL,
	`dismissedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `update_dismissals_userId_updateId_pk` PRIMARY KEY(`userId`,`updateId`)
);
--> statement-breakpoint
CREATE TABLE `updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `updates_id` PRIMARY KEY(`id`)
);
