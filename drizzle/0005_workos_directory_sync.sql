CREATE TABLE IF NOT EXISTS "directory_sync_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"workos_organization_id" text,
	"organization_id" text,
	"event_type" text NOT NULL,
	"directory_id" text,
	"external_subject_id" text,
	"subject_type" text NOT NULL,
	"subject_state" text,
	"payload_hash" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"processing_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_sync_events_organization_id_organizations_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
		ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_sync_events_status_received_idx"
	ON "directory_sync_events" USING btree ("status", "received_at", "event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_sync_events_organization_status_idx"
	ON "directory_sync_events" USING btree ("organization_id", "status", "received_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_workos_organization_unique"
	ON "organizations" (("metadata" ->> 'workosOrganizationId'))
	WHERE ("metadata" ->> 'workosOrganizationId') IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_principal_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"directory_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_principal_links_organization_id_organizations_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
		ON DELETE CASCADE,
	CONSTRAINT "directory_principal_links_workspace_id_workspaces_id_fk"
		FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
		ON DELETE CASCADE,
	CONSTRAINT "directory_principal_links_workspace_organization_fk"
		FOREIGN KEY ("workspace_id", "organization_id")
		REFERENCES "public"."workspaces"("id", "organization_id")
		ON DELETE CASCADE,
	CONSTRAINT "directory_principal_links_type_check"
		CHECK ("principal_type" IN ('user', 'service_account'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "directory_principal_links_subject_principal_unique"
	ON "directory_principal_links" USING btree (
		"organization_id", "directory_id", "external_user_id", "principal_type", "principal_id"
	);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "directory_principal_links_subject_active_idx"
	ON "directory_principal_links" USING btree (
		"organization_id", "directory_id", "external_user_id", "active"
	);
--> statement-breakpoint
ALTER TABLE "directory_sync_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "directory_sync_events_organization_isolation" ON "directory_sync_events";
--> statement-breakpoint
CREATE POLICY "directory_sync_events_organization_isolation"
	ON "directory_sync_events" FOR ALL
	USING (
		"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	)
	WITH CHECK (
		"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	);
--> statement-breakpoint
ALTER TABLE "directory_principal_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "directory_principal_links_tenant_isolation" ON "directory_principal_links";
--> statement-breakpoint
CREATE POLICY "directory_principal_links_tenant_isolation"
	ON "directory_principal_links" FOR ALL
	USING (
		"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
		AND "workspace_id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
	)
	WITH CHECK (
		"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
		AND "workspace_id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
	);
--> statement-breakpoint
COMMENT ON TABLE "directory_sync_events" IS
'Verified WorkOS Directory Sync events. Unmapped events remain durable without accepting tenant identity from an HTTP caller.';
--> statement-breakpoint
COMMENT ON TABLE "directory_principal_links" IS
'Explicit, tenant-scoped WorkOS directory-user links used for immediate access revocation.';
