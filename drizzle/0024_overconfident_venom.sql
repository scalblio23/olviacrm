ALTER TABLE `contacts` ADD `closer` varchar(255);--> statement-breakpoint
ALTER TABLE `contacts` ADD `priceQuoted` varchar(64);--> statement-breakpoint
ALTER TABLE `contacts` ADD `callRecordingUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `contacts` ADD `objections` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `dealResult` varchar(16);