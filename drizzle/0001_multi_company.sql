CREATE TABLE "action_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"action_proposal_id" text NOT NULL,
	"approver_principal_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"reauthenticated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"proposed_by_principal_type" text NOT NULL,
	"proposed_by_principal_id" text NOT NULL,
	"connector_id" text,
	"action_type" text NOT NULL,
	"risk_tier" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"payload" jsonb NOT NULL,
	"context_pack_id" text,
	"ontology_version" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"policy_decision" jsonb NOT NULL,
	"required_approvals" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"action_proposal_id" text NOT NULL,
	"status" text NOT NULL,
	"connector_preflight" jsonb NOT NULL,
	"before_evidence" jsonb NOT NULL,
	"after_evidence" jsonb NOT NULL,
	"compensation_status" text DEFAULT 'not_required' NOT NULL,
	"external_ref" text,
	"receipt_hash" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"policy_decision" text NOT NULL,
	"before_hash" text,
	"after_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"connector_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"external_tenant_ref" text,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_credential_ref" text,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_acl_mode" text DEFAULT 'mirror' NOT NULL,
	"execution_enabled" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"route" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_profile_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"role_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provisioned_by" text DEFAULT 'commonstate' NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"deployment_mode" text DEFAULT 'shared' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_mode" text DEFAULT 'manual_pilot' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"credential_mode" text DEFAULT 'managed' NOT NULL,
	"encrypted_credential_ref" text,
	"model" text NOT NULL,
	"fallback_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text,
	"role_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" jsonb NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"scope_id" text,
	"permissions" jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role_id" text,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"allowed_scope_ids" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"rotated_from_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solution_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"template_key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"definition" jsonb NOT NULL,
	"eval_definition" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"meter" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_configuration_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"ontology" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"branding" jsonb NOT NULL,
	"agents" jsonb NOT NULL,
	"outcomes" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_profiles" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_key" text NOT NULL,
	"setup_status" text DEFAULT 'draft' NOT NULL,
	"logo_url" text,
	"accent_color" text DEFAULT '#7357FF' NOT NULL,
	"locale" text DEFAULT 'en-GB' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"terminology" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled_surfaces" jsonb NOT NULL,
	"draft_configuration" jsonb NOT NULL,
	"published_configuration_version" integer,
	"kill_switch_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "kind" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_action_proposal_id_action_proposals_id_fk" FOREIGN KEY ("action_proposal_id") REFERENCES "public"."action_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_context_pack_id_context_packs_id_fk" FOREIGN KEY ("context_pack_id") REFERENCES "public"."context_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_receipts" ADD CONSTRAINT "action_receipts_action_proposal_id_action_proposals_id_fk" FOREIGN KEY ("action_proposal_id") REFERENCES "public"."action_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_profile_id_profiles_id_fk" FOREIGN KEY ("invited_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_configurations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_grants" ADD CONSTRAINT "scope_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_grants" ADD CONSTRAINT "scope_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_grants" ADD CONSTRAINT "scope_grants_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_configuration_versions" ADD CONSTRAINT "workspace_configuration_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_configuration_versions" ADD CONSTRAINT "workspace_configuration_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_profiles" ADD CONSTRAINT "workspace_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_profiles" ADD CONSTRAINT "workspace_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_approvals_proposal_approver_unique" ON "action_approvals" USING btree ("action_proposal_id","approver_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposals_workspace_idempotency_unique" ON "action_proposals" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "action_proposals_workspace_status_idx" ON "action_proposals" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "action_receipts_proposal_unique" ON "action_receipts" USING btree ("action_proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_receipts_workspace_hash_unique" ON "action_receipts" USING btree ("workspace_id","receipt_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_workspace_request_action_unique" ON "audit_events" USING btree ("workspace_id","request_id","action","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connectors_workspace_type_name_unique" ON "connectors" USING btree ("workspace_id","connector_type","name");--> statement-breakpoint
CREATE INDEX "connectors_workspace_status_idx" ON "connectors" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_principal_route_key_unique" ON "idempotency_records" USING btree ("principal_id","route","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_workspace_email_idx" ON "invitations" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_workspace_idempotency_unique" ON "jobs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_workspace_profile_unique" ON "memberships" USING btree ("workspace_id","profile_id");--> statement-breakpoint
CREATE INDEX "memberships_profile_status_idx" ON "memberships" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "memberships_organization_status_idx" ON "memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_unique" ON "profiles" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_config_workspace_provider_unique" ON "provider_configurations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_workspace_key_unique" ON "roles" USING btree ("organization_id","workspace_id","role_key");--> statement-breakpoint
CREATE INDEX "roles_organization_idx" ON "roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scope_grants_principal_idx" ON "scope_grants" USING btree ("workspace_id","principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_accounts_key_prefix_unique" ON "service_accounts" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "service_accounts_workspace_active_idx" ON "service_accounts" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "solution_templates_key_version_unique" ON "solution_templates" USING btree ("template_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_workspace_idempotency_unique" ON "usage_events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_events_org_meter_occurred_idx" ON "usage_events" USING btree ("organization_id","meter","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_config_workspace_version_unique" ON "workspace_configuration_versions" USING btree ("workspace_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_config_workspace_hash_unique" ON "workspace_configuration_versions" USING btree ("workspace_id","config_hash");--> statement-breakpoint
CREATE INDEX "workspace_profiles_org_idx" ON "workspace_profiles" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_organization_status_idx" ON "workspaces" USING btree ("organization_id","status");
--> statement-breakpoint
INSERT INTO "organizations" (
	"id", "slug", "name", "deployment_mode", "status", "billing_mode", "metadata"
) VALUES (
	'org_legacy_demo', 'commonstate-demo', 'Commonstate public demos', 'shared', 'active', 'manual_pilot', '{"system":true,"purpose":"legacy-demo-backfill"}'::jsonb
) ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
UPDATE "workspaces"
SET "organization_id" = COALESCE("organization_id", 'org_legacy_demo'), "kind" = 'demo'
WHERE "organization_id" IS NULL;
--> statement-breakpoint
DO $$
DECLARE
	table_name text;
BEGIN
	FOREACH table_name IN ARRAY ARRAY[
		'roles', 'memberships', 'invitations', 'scope_grants',
		'service_accounts', 'workspace_profiles', 'workspace_configuration_versions',
		'connectors', 'provider_configurations', 'jobs', 'action_proposals',
		'action_approvals', 'action_receipts', 'audit_events', 'usage_events',
		'idempotency_records'
	]
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
		EXECUTE format(
			'CREATE POLICY tenant_organization_isolation ON %I FOR ALL USING (organization_id = NULLIF(current_setting(''commonstate.organization_id'', true), '''') AND workspace_id = NULLIF(current_setting(''commonstate.workspace_id'', true), '''')) WITH CHECK (organization_id = NULLIF(current_setting(''commonstate.organization_id'', true), '''') AND workspace_id = NULLIF(current_setting(''commonstate.workspace_id'', true), ''''))',
			table_name
		);
	END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "organization_tenant_isolation" ON "organizations" FOR ALL
USING ("id" = NULLIF(current_setting('commonstate.organization_id', true), ''))
WITH CHECK ("id" = NULLIF(current_setting('commonstate.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_tenant_isolation" ON "workspaces" FOR ALL
USING (
	"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	AND "id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
)
WITH CHECK (
	"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	AND "id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
);
--> statement-breakpoint
DO $$
DECLARE
	table_name text;
BEGIN
	FOREACH table_name IN ARRAY ARRAY[
		'scopes', 'actors', 'sources', 'source_events', 'entities', 'relationships',
		'claims', 'memory_events', 'conflicts', 'approvals', 'context_packs',
		'context_pack_evidence', 'agent_runs', 'run_events', 'outcomes',
		'evaluation_results'
	]
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
		EXECUTE format(
			'CREATE POLICY tenant_workspace_isolation ON %I FOR ALL USING (workspace_id = NULLIF(current_setting(''commonstate.workspace_id'', true), '''')) WITH CHECK (workspace_id = NULLIF(current_setting(''commonstate.workspace_id'', true), ''''))',
			table_name
		);
	END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "profile_self_access" ON "profiles" FOR ALL
USING ("id" = NULLIF(current_setting('commonstate.principal_id', true), ''))
WITH CHECK ("id" = NULLIF(current_setting('commonstate.principal_id', true), ''));
--> statement-breakpoint
ALTER TABLE "solution_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "solution_templates_public_read" ON "solution_templates" FOR SELECT USING ("active" = true);
--> statement-breakpoint
COMMENT ON POLICY "workspace_tenant_isolation" ON "workspaces" IS
'The application sets transaction-local organization, workspace, and principal IDs. Use the NOBYPASSRLS runtime role so PostgreSQL remains an independent tenant boundary.';
