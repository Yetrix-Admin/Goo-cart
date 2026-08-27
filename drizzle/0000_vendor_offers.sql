CREATE TABLE IF NOT EXISTS `vendor_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`vendor` text NOT NULL,
	`title` text NOT NULL,
	`code` text NOT NULL,
	`discount_percent` integer NOT NULL,
	`min_order` real NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_vendor_offers_vendor_code` ON `vendor_offers` (`vendor_id`,`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vendor_offers_vendor_active` ON `vendor_offers` (`vendor_id`,`active`);
