CREATE TABLE "actors" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"write_budget" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_actor_id" text NOT NULL,
	"task" text NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"context_pack_id" text NOT NULL,
	"context_version_hash" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tools" jsonb NOT NULL,
	"decision" jsonb NOT NULL,
	"approval_ids" jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"token_usage" integer NOT NULL,
	"cost_micros" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"receipt_hash" text NOT NULL,
	"replay_of_run_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"previous_lifecycle" text NOT NULL,
	"resulting_lifecycle" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"subject_entity_id" text NOT NULL,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_event_id" text,
	"source_span" text NOT NULL,
	"author_actor_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"confidence" integer NOT NULL,
	"authority" text NOT NULL,
	"lifecycle" text NOT NULL,
	"supersedes_claim_id" text,
	"classification" text NOT NULL,
	"freshness_seconds" integer NOT NULL,
	"acl" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"subject_entity_id" text NOT NULL,
	"predicate" text NOT NULL,
	"left_claim_id" text NOT NULL,
	"right_claim_id" text NOT NULL,
	"risk" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_claim_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_pack_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"context_pack_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_span" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"task" text NOT NULL,
	"entity_refs" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"version_hash" text NOT NULL,
	"facts" jsonb NOT NULL,
	"constraints" jsonb NOT NULL,
	"blockers" jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"freshness_status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope_id" text,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"external_ref" text,
	"attributes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"suite" text NOT NULL,
	"category" text NOT NULL,
	"case_name" text NOT NULL,
	"passed" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"details" jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"notes" text NOT NULL,
	"learning_claim_id" text,
	"recorded_by_actor_id" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"from_entity_id" text NOT NULL,
	"to_entity_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"attributes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_scope_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_key" text NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"uri" text,
	"classification" text NOT NULL,
	"immutable" boolean DEFAULT true NOT NULL,
	"sha256" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"content_text" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"edition" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_actor_id_actors_id_fk" FOREIGN KEY ("agent_actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_context_pack_id_context_packs_id_fk" FOREIGN KEY ("context_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_event_id_source_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."source_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_author_actor_id_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_evidence" ADD CONSTRAINT "context_pack_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_evidence" ADD CONSTRAINT "context_pack_evidence_context_pack_id_context_packs_id_fk" FOREIGN KEY ("context_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_evidence" ADD CONSTRAINT "context_pack_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_pack_evidence" ADD CONSTRAINT "context_pack_evidence_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_packs" ADD CONSTRAINT "context_packs_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_recorded_by_actor_id_actors_id_fk" FOREIGN KEY ("recorded_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_entity_id_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scopes" ADD CONSTRAINT "scopes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actors_workspace_type_idx" ON "actors" USING btree ("workspace_id","actor_type");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_workspace_receipt_unique" ON "agent_runs" USING btree ("workspace_id","receipt_hash");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_created_idx" ON "agent_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_workspace_claim_idx" ON "approvals" USING btree ("workspace_id","claim_id");--> statement-breakpoint
CREATE INDEX "claims_workspace_lifecycle_idx" ON "claims" USING btree ("workspace_id","lifecycle");--> statement-breakpoint
CREATE INDEX "claims_workspace_subject_predicate_idx" ON "claims" USING btree ("workspace_id","subject_entity_id","predicate");--> statement-breakpoint
CREATE INDEX "claims_workspace_scope_validity_idx" ON "claims" USING btree ("workspace_id","scope_id","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "conflicts_workspace_status_risk_idx" ON "conflicts" USING btree ("workspace_id","status","risk");--> statement-breakpoint
CREATE UNIQUE INDEX "context_pack_evidence_unique" ON "context_pack_evidence" USING btree ("context_pack_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_packs_workspace_version_unique" ON "context_packs" USING btree ("workspace_id","version_hash");--> statement-breakpoint
CREATE INDEX "entities_workspace_type_idx" ON "entities" USING btree ("workspace_id","entity_type");--> statement-breakpoint
CREATE INDEX "evaluation_results_workspace_suite_idx" ON "evaluation_results" USING btree ("workspace_id","suite");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_events_workspace_sequence_unique" ON "memory_events" USING btree ("workspace_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_workspace_receipt_unique" ON "outcomes" USING btree ("workspace_id","receipt_hash");--> statement-breakpoint
CREATE INDEX "relationships_workspace_from_idx" ON "relationships" USING btree ("workspace_id","from_entity_id");--> statement-breakpoint
CREATE INDEX "relationships_workspace_to_idx" ON "relationships" USING btree ("workspace_id","to_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_sequence_unique" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "scopes_workspace_kind_idx" ON "scopes" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "source_events_workspace_idempotency_unique" ON "source_events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "source_events_workspace_source_idx" ON "source_events" USING btree ("workspace_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_workspace_key_unique" ON "sources" USING btree ("workspace_id","source_key");--> statement-breakpoint
CREATE INDEX "sources_workspace_class_idx" ON "sources" USING btree ("workspace_id","classification");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" USING btree ("slug");
