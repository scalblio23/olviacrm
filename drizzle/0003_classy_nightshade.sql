ALTER TABLE `call_history` MODIFY COLUMN `leadId` int;--> statement-breakpoint
ALTER TABLE `call_history` MODIFY COLUMN `sessionId` varchar(64);--> statement-breakpoint
ALTER TABLE `call_history` ADD `contactName` varchar(255);--> statement-breakpoint
ALTER TABLE `call_history` ADD `direction` enum('outbound','inbound') DEFAULT 'outbound' NOT NULL;