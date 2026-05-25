CREATE TABLE `automation_execution_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automationId` int NOT NULL,
	`enrollmentId` int NOT NULL,
	`contactId` int NOT NULL,
	`stepIndex` int NOT NULL,
	`stepType` varchar(32) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'executed',
	`detail` varchar(500),
	`executedAt` bigint NOT NULL,
	CONSTRAINT `automation_execution_logs_id` PRIMARY KEY(`id`)
);
