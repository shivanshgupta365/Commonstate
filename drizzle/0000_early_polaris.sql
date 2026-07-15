CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`permissions` text NOT NULL,
	`write_budget` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actors_workspace_type_idx` ON `actors` (`workspace_id`,`actor_type`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_actor_id` text NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`context_pack_id` text NOT NULL,
	`context_version_hash` text NOT NULL,
	`model` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`tools` text NOT NULL,
	`decision` text NOT NULL,
	`approval_ids` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`token_usage` integer NOT NULL,
	`cost_micros` integer NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`replay_of_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_pack_id`) REFERENCES `context_packs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_workspace_receipt_unique` ON `agent_runs` (`workspace_id`,`receipt_hash`);--> statement-breakpoint
CREATE INDEX `agent_runs_workspace_created_idx` ON `agent_runs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`previous_lifecycle` text NOT NULL,
	`resulting_lifecycle` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `approvals_workspace_claim_idx` ON `approvals` (`workspace_id`,`claim_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`subject_entity_id` text NOT NULL,
	`predicate` text NOT NULL,
	`value` text NOT NULL,
	`value_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_event_id` text,
	`source_span` text NOT NULL,
	`author_actor_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`confidence` integer NOT NULL,
	`authority` text NOT NULL,
	`lifecycle` text NOT NULL,
	`supersedes_claim_id` text,
	`classification` text NOT NULL,
	`freshness_seconds` integer NOT NULL,
	`acl` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `scopes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_event_id`) REFERENCES `source_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `claims_workspace_lifecycle_idx` ON `claims` (`workspace_id`,`lifecycle`);--> statement-breakpoint
CREATE INDEX `claims_workspace_subject_predicate_idx` ON `claims` (`workspace_id`,`subject_entity_id`,`predicate`);--> statement-breakpoint
CREATE INDEX `claims_workspace_scope_validity_idx` ON `claims` (`workspace_id`,`scope_id`,`valid_from`,`valid_to`);--> statement-breakpoint
CREATE TABLE `conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`subject_entity_id` text NOT NULL,
	`predicate` text NOT NULL,
	`left_claim_id` text NOT NULL,
	`right_claim_id` text NOT NULL,
	`risk` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`detected_at` text NOT NULL,
	`resolved_at` text,
	`resolution_claim_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `scopes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conflicts_workspace_status_risk_idx` ON `conflicts` (`workspace_id`,`status`,`risk`);--> statement-breakpoint
CREATE TABLE `context_pack_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`context_pack_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_span` text NOT NULL,
	`ordinal` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_pack_id`) REFERENCES `context_packs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_pack_evidence_unique` ON `context_pack_evidence` (`context_pack_id`,`claim_id`);--> statement-breakpoint
CREATE TABLE `context_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`task` text NOT NULL,
	`entity_refs` text NOT NULL,
	`as_of` text NOT NULL,
	`version_hash` text NOT NULL,
	`facts` text NOT NULL,
	`constraints` text NOT NULL,
	`blockers` text NOT NULL,
	`citations` text NOT NULL,
	`freshness_status` text NOT NULL,
	`created_at` text NOT NULL,
	`invalidated_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `scopes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_packs_workspace_version_unique` ON `context_packs` (`workspace_id`,`version_hash`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope_id` text,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`external_ref` text,
	`attributes` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scope_id`) REFERENCES `scopes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entities_workspace_type_idx` ON `entities` (`workspace_id`,`entity_type`);--> statement-breakpoint
CREATE TABLE `evaluation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`suite` text NOT NULL,
	`category` text NOT NULL,
	`case_name` text NOT NULL,
	`passed` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`details` text NOT NULL,
	`run_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluation_results_workspace_suite_idx` ON `evaluation_results` (`workspace_id`,`suite`);--> statement-breakpoint
CREATE TABLE `memory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_events_workspace_sequence_unique` ON `memory_events` (`workspace_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`metrics` text NOT NULL,
	`notes` text NOT NULL,
	`learning_claim_id` text,
	`recorded_by_actor_id` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outcomes_workspace_receipt_unique` ON `outcomes` (`workspace_id`,`receipt_hash`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`from_entity_id` text NOT NULL,
	`to_entity_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`attributes` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `relationships_workspace_from_idx` ON `relationships` (`workspace_id`,`from_entity_id`);--> statement-breakpoint
CREATE INDEX `relationships_workspace_to_idx` ON `relationships` (`workspace_id`,`to_entity_id`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_sequence_unique` ON `run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_scope_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`external_ref` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scopes_workspace_kind_idx` ON `scopes` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `source_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_id` text NOT NULL,
	`event_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_events_workspace_idempotency_unique` ON `source_events` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `source_events_workspace_source_idx` ON `source_events` (`workspace_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_key` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`uri` text,
	`classification` text NOT NULL,
	`immutable` integer DEFAULT true NOT NULL,
	`sha256` text NOT NULL,
	`captured_at` text NOT NULL,
	`content_text` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_workspace_key_unique` ON `sources` (`workspace_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `sources_workspace_class_idx` ON `sources` (`workspace_id`,`classification`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`edition` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);