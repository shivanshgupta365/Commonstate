ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "organization_tenant_isolation" ON "organizations";
--> statement-breakpoint
CREATE POLICY "organization_tenant_isolation" ON "organizations" FOR ALL
USING ("id" = NULLIF(current_setting('commonstate.organization_id', true), ''))
WITH CHECK ("id" = NULLIF(current_setting('commonstate.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_organization_isolation" ON "workspaces";
--> statement-breakpoint
DROP POLICY IF EXISTS "workspace_tenant_isolation" ON "workspaces";
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
		'roles', 'memberships', 'invitations', 'scope_grants', 'service_accounts',
		'workspace_profiles', 'workspace_configuration_versions', 'connectors',
		'provider_configurations', 'jobs', 'action_proposals', 'action_approvals',
		'action_receipts', 'audit_events', 'usage_events', 'idempotency_records'
	]
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
		EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON %I', table_name);
		EXECUTE format(
			'CREATE POLICY tenant_organization_isolation ON %I FOR ALL USING (organization_id = NULLIF(current_setting(''commonstate.organization_id'', true), '''') AND workspace_id = NULLIF(current_setting(''commonstate.workspace_id'', true), '''')) WITH CHECK (organization_id = NULLIF(current_setting(''commonstate.organization_id'', true), '''') AND workspace_id = NULLIF(current_setting(''commonstate.workspace_id'', true), ''''))',
			table_name
		);
	END LOOP;
END $$;
--> statement-breakpoint
COMMENT ON POLICY "workspace_tenant_isolation" ON "workspaces" IS
'The application sets transaction-local organization, workspace, and principal IDs. Use the NOBYPASSRLS runtime role from drizzle/runtime-role.sql so PostgreSQL remains an independent tenant boundary.';
