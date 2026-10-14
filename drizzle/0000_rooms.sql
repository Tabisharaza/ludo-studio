CREATE TABLE `rooms` (
  `code` text PRIMARY KEY NOT NULL,
  `data` text NOT NULL,
  `version` integer NOT NULL DEFAULT 0,
  `expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_expires_idx` ON `rooms` (`expires`);
