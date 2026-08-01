import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

const { register } = await import("tsx/esm/api");
const unregister = register();
const storage = await import("../lib/product/storage.ts");
const { ProductError } = await import("../lib/product/errors.ts");
const { OWNER_PERMISSIONS } = await import("../lib/product/types.ts");

test.after(async () => {
  const database = await import("../db/index.ts");
  await database.closeDb();
  unregister();
});

test("signed source upload validation rejects unsafe files and accepts supported documents", () => {
  const sha256 = "a".repeat(64);
  assert.deepEqual(storage.validateSourceUploadRequest({
    scopeId: "scope-1",
    filename: "Quarterly policy.pdf",
    contentType: "application/pdf",
    byteSize: 1024,
    sha256,
    classification: "private",
  }), {
    scopeId: "scope-1",
    filename: "Quarterly policy.pdf",
    contentType: "application/pdf",
    byteSize: 1024,
    sha256,
    classification: "private",
  });

  for (const input of [
    { filename: "../secret.pdf", contentType: "application/pdf", byteSize: 1, sha256 },
    { filename: "payload.exe", contentType: "application/octet-stream", byteSize: 1, sha256 },
    { filename: "note.txt", contentType: "application/pdf", byteSize: 1, sha256 },
    { filename: "note.txt", contentType: "text/plain", byteSize: 0, sha256 },
    { filename: "note.txt", contentType: "text/plain", byteSize: 1, sha256: "bad" },
    { filename: "note.txt", contentType: "text/plain", byteSize: 1, sha256, classification: "synthetic" },
  ]) {
    assert.throws(
      () => storage.validateSourceUploadRequest({ scopeId: "scope-1", classification: "private", ...input }),
      (error) => error instanceof ProductError && error.code === "VALIDATION_ERROR",
    );
  }
});

test("signed uploads require a server-only Supabase service-role configuration", async () => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "same-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "same-key";
  const context = {
    principal: { type: "user", principalId: "user-1", actorId: "actor-1" },
    organizationId: "org-1",
    workspaceId: "workspace-1",
    workspaceSlug: "workspace-1",
    allowedScopeIds: ["scope-1"],
    permissions: [...OWNER_PERMISSIONS],
    requestId: "request-1",
    authenticatedAt: null,
    clock: { now: () => new Date("2026-07-15T00:00:00.000Z") },
  };
  try {
    await assert.rejects(
      storage.createSourceUpload(context, {
        scopeId: "scope-1",
        filename: "policy.txt",
        contentType: "text/plain",
        byteSize: 4,
        sha256: "a".repeat(64),
        classification: "private",
      }, "service-role-required"),
      (error) => error instanceof ProductError && error.code === "STORAGE_UNAVAILABLE" && error.status === 503,
    );
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.service;
    if (previous.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.anon;
  }
});

test("signed upload reserves tenant rows, verifies exact bytes, and queues extraction", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is required for storage integration.",
  timeout: 30_000,
}, async () => {
  process.env.PRODUCT_DATABASE_URL ||= process.env.DATABASE_URL;
  const database = await import("../db/index.ts");
  const schema = await import("../db/schema.ts");
  const repository = await import("../lib/product/repository.ts");
  const { and, eq } = await import("drizzle-orm");
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const principal = {
    type: "user",
    principalId: `storage-owner-${suffix}`,
    actorId: `user:storage-owner-${suffix}`,
    email: `storage-${suffix}@example.test`,
    displayName: "Storage test owner",
  };
  const provisioned = await repository.provisionWorkspace(principal, {
    organizationName: `Storage test ${suffix}`,
    workspaceName: `Evidence ${suffix}`,
    template: "ai-operations",
    publish: true,
  }, `storage-provision-${suffix}`);
  const db = database.getDb();
  const [scope] = await db.select({ id: schema.scopes.id }).from(schema.scopes)
    .where(eq(schema.scopes.workspaceId, provisioned.workspace.id))
    .orderBy(schema.scopes.createdAt, schema.scopes.id).limit(1);
  const context = {
    principal: {
      type: "user",
      principalId: principal.principalId,
      actorId: `actor:${provisioned.workspace.id}:${principal.principalId}`,
    },
    organizationId: provisioned.organization.id,
    workspaceId: provisioned.workspace.id,
    workspaceSlug: provisioned.workspace.slug,
    allowedScopeIds: [scope.id],
    permissions: [...OWNER_PERMISSIONS],
    requestId: `storage-request-${suffix}`,
    authenticatedAt: null,
    clock: { now: () => new Date("2026-07-15T00:00:00.000Z") },
  };
  const bytes = new TextEncoder().encode("A current, permissioned operating rule.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let removed = false;
  const adapter = {
    async createSignedUploadUrl(bucket, objectKey) {
      assert.equal(bucket, "private-sources");
      assert.match(objectKey, new RegExp(`^organizations/${context.organizationId}/workspaces/${context.workspaceId}/scopes/${scope.id}/sources/`));
      return { signedUrl: `https://storage.example/${objectKey}?token=signed`, token: "signed" };
    },
    async inspectObject() {
      return { byteSize: bytes.byteLength, contentType: "text/plain", metadata: { sha256 } };
    },
    async downloadObject() { return bytes; },
    async removeObject() { removed = true; },
  };
  const dependency = { adapter, bucket: "private-sources" };
  const input = {
    scopeId: scope.id,
    filename: "operating-rule.txt",
    contentType: "text/plain",
    byteSize: bytes.byteLength,
    sha256,
    classification: "private",
  };

  const created = await storage.createSourceUpload(context, input, `upload-${suffix}`, dependency);
  const repeated = await storage.createSourceUpload(context, input, `upload-${suffix}`, dependency);
  assert.equal(repeated.sourceId, created.sourceId);
  assert.equal(repeated.artifactId, created.artifactId);
  assert.equal(created.status, "pending_upload");
  assert.equal(created.upload.upsert, false);
  assert.equal(created.upload.objectKey.includes(principal.principalId), false);

  const [pending] = await db.select({ source: schema.sources, artifact: schema.sourceArtifacts, job: schema.jobs })
    .from(schema.sourceArtifacts)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceArtifacts.sourceId))
    .innerJoin(schema.jobs, and(eq(schema.jobs.workspaceId, schema.sourceArtifacts.workspaceId), eq(schema.jobs.jobType, "source.extract")))
    .where(eq(schema.sourceArtifacts.id, created.artifactId)).limit(1);
  assert.equal(pending.source.contentText, "");
  assert.equal(pending.artifact.status, "pending_upload");
  assert.equal(pending.job.status, "waiting_for_upload");
  assert.deepEqual(pending.artifact.acl.sort(), [context.principal.actorId, context.principal.principalId, scope.id].sort());

  const completed = await storage.completeSourceUpload(
    { ...context, requestId: `storage-complete-${suffix}` },
    { artifactId: created.artifactId },
    `complete-${suffix}`,
    dependency,
  );
  assert.equal(completed.status, "extraction_queued");
  assert.equal(removed, false);

  const [ready] = await db.select({ artifact: schema.sourceArtifacts, job: schema.jobs })
    .from(schema.sourceArtifacts)
    .innerJoin(schema.jobs, and(eq(schema.jobs.workspaceId, schema.sourceArtifacts.workspaceId), eq(schema.jobs.jobType, "source.extract")))
    .where(eq(schema.sourceArtifacts.id, created.artifactId)).limit(1);
  assert.equal(ready.artifact.status, "ready");
  assert.equal(ready.job.status, "queued");
  const events = await db.select().from(schema.sourceEvents)
    .where(and(eq(schema.sourceEvents.workspaceId, context.workspaceId), eq(schema.sourceEvents.sourceId, created.sourceId)));
  assert.equal(events.some((event) => event.eventType === "upload_completed"), true);
});
