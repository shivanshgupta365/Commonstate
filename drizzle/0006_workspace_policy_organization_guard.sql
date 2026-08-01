-- Workspace-only legacy tables still need the organization guard. A guessed
-- workspace GUC must never be enough to cross an organization boundary.
CREATE OR REPLACE FUNCTION "commonstate_workspace_visible"("candidate_workspace_id" text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "workspaces" AS "tenant_workspace"
    WHERE "tenant_workspace"."id" = "candidate_workspace_id"
      AND "tenant_workspace"."id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
      AND "tenant_workspace"."organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
  )
$$;
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
		EXECUTE format('DROP POLICY IF EXISTS tenant_workspace_isolation ON %I', table_name);
		EXECUTE format(
			'CREATE POLICY tenant_workspace_isolation ON %I FOR ALL USING (commonstate_workspace_visible(workspace_id)) WITH CHECK (commonstate_workspace_visible(workspace_id))',
			table_name
		);
	END LOOP;
END $$;
--> statement-breakpoint
COMMENT ON FUNCTION "commonstate_workspace_visible"(text) IS
'Requires both the transaction-local organization and workspace to match the candidate workspace.';
