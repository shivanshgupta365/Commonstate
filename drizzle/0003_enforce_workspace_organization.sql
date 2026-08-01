ALTER TABLE "workspaces" ALTER COLUMN "organization_id" SET DEFAULT 'org_legacy_demo';--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_id_organization_unique" UNIQUE ("id", "organization_id");
--> statement-breakpoint
DO $$
DECLARE
	table_name text;
BEGIN
	FOREACH table_name IN ARRAY ARRAY[
		'roles', 'memberships', 'invitations', 'scope_grants', 'service_accounts',
		'workspace_profiles', 'workspace_configuration_versions', 'connectors',
		'provider_configurations', 'jobs', 'action_proposals', 'action_approvals',
		'action_receipts', 'audit_events', 'usage_events', 'idempotency_records',
		'source_artifacts', 'source_chunks'
	]
	LOOP
		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id) ON DELETE CASCADE',
			table_name,
			left(table_name || '_workspace_organization_fk', 63)
		);
	END LOOP;
END $$;
