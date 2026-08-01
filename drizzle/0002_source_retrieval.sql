CREATE TABLE "source_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"classification" text NOT NULL,
	"acl" jsonb NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"artifact_id" text,
	"ordinal" integer NOT NULL,
	"content_text" text NOT NULL,
	"search_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"classification" text NOT NULL,
	"acl" jsonb NOT NULL,
	"configuration_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifacts_workspace_storage_key_unique" ON "source_artifacts" USING btree ("workspace_id","storage_bucket","storage_key");--> statement-breakpoint
CREATE INDEX "source_artifacts_workspace_source_idx" ON "source_artifacts" USING btree ("workspace_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_chunks_source_ordinal_hash_unique" ON "source_chunks" USING btree ("source_id","ordinal","content_hash");--> statement-breakpoint
CREATE INDEX "source_chunks_workspace_source_idx" ON "source_chunks" USING btree ("workspace_id","source_id");
--> statement-breakpoint
CREATE INDEX "source_chunks_search_fts_idx" ON "source_chunks"
USING gin (to_tsvector('english', "search_text"));
--> statement-breakpoint
ALTER TABLE "source_artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "source_artifacts_tenant_isolation" ON "source_artifacts" FOR ALL
USING (
	"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	AND "workspace_id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
)
WITH CHECK (
	"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	AND "workspace_id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
);
--> statement-breakpoint
ALTER TABLE "source_chunks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "source_chunks_tenant_isolation" ON "source_chunks" FOR ALL
USING (
	"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	AND "workspace_id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
)
WITH CHECK (
	"organization_id" = NULLIF(current_setting('commonstate.organization_id', true), '')
	AND "workspace_id" = NULLIF(current_setting('commonstate.workspace_id', true), '')
);
--> statement-breakpoint
DO $$
BEGIN
	BEGIN
		CREATE EXTENSION IF NOT EXISTS vector;
	EXCEPTION WHEN OTHERS THEN
		RAISE NOTICE 'pgvector is unavailable; Commonstate will expose keyword-only retrieval until the vector extension is installed: %', SQLERRM;
	END;

	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
		ALTER TABLE "source_chunks" ADD COLUMN IF NOT EXISTS "embedding_vector" vector(768);
		BEGIN
			CREATE INDEX "source_chunks_embedding_hnsw_idx" ON "source_chunks"
			USING hnsw ("embedding_vector" vector_cosine_ops);
		EXCEPTION WHEN duplicate_table THEN
			NULL;
		WHEN OTHERS THEN
			RAISE NOTICE 'pgvector exists but HNSW indexing is unavailable: %', SQLERRM;
		END;
	END IF;
END $$;
--> statement-breakpoint
COMMENT ON TABLE "source_chunks" IS
'Keyword retrieval is always available. The optional embedding_vector vector(768) column and HNSW index are created when pgvector is installed; GET /api/v1/capabilities reports the active mode.';
