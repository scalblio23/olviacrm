ALTER TABLE `smartlists` ADD `isPublic` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `smartlists` ADD `sharedWith` text;