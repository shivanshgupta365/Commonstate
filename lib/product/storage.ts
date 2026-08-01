import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { getProductDb, type CommonstateDb } from "../../db";
import {
  auditEvents,
  jobs,
  scopes,
  sourceArtifacts,
  sourceEvents,
  sources,
} from "../../db/schema";
import { requirePermission } from "./auth";
import { ProductError, isDatabaseUnavailable } from "./errors";
import { PRODUCT_PERMISSIONS, type CommandContext } from "./types";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DEFAULT_SOURCE_BUCKET = "commonstate-sources";

const CONTENT_TYPES = new Map<string, readonly string[]>([
  [".txt", ["text/plain"]],
  [".md", ["text/markdown", "text/plain"]],
  [".csv", ["text/csv", "text/plain"]],
  [".json", ["application/json", "text/json"]],
  [".pdf", ["application/pdf"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  [".pptx", ["application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
]);

type TransactionDb = Parameters<Parameters<CommonstateDb["transaction"]>[0]>[0];

export type SourceStorageAdapter = {
  createSignedUploadUrl(bucket: string, objectKey: string): Promise<{
    signedUrl: string;
    token: string;
  }>;
  inspectObject(bucket: string, objectKey: string): Promise<{
    byteSize: number | null;
    contentType: string | null;
    metadata: Record<string, unknown>;
  }>;
  downloadObject(bucket: string, objectKey: string): Promise<Uint8Array>;
  removeObject(bucket: string, objectKey: string): Promise<void>;
};

export type SourceUploadRequest = {
  scopeId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  classification: "private" | "public";
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
}

function deterministicId(kind: string, value: string): string {
  return `${kind}_${hash(`${kind}:${value}`).slice(0, 24)}`;
}

function normalizedContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function safeObjectFilename(filename: string): string {
  return filename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function validateSourceUploadRequest(input: Record<string, unknown>): SourceUploadRequest {
  const scopeId = typeof input.scopeId === "string" ? input.scopeId.trim() : "";
  const filename = typeof input.filename === "string" ? input.filename.normalize("NFC").trim() : "";
  const contentType = normalizedContentType(typeof input.contentType === "string" ? input.contentType : "");
  const byteSize = typeof input.byteSize === "number" ? input.byteSize : Number.NaN;
  const sha256 = typeof input.sha256 === "string" ? input.sha256.trim().toLowerCase() : "";
  const classification = input.classification;

  if (!scopeId || scopeId.length > 200) {
    throw new ProductError("VALIDATION_ERROR", "scopeId is required.");
  }
  if (
    !filename ||
    filename.length > 180 ||
    filename.startsWith(".") ||
    /[\u0000-\u001f\u007f/\\]/.test(filename) ||
    filename.includes("..")
  ) {
    throw new ProductError("VALIDATION_ERROR", "filename must be a safe base filename of 180 characters or fewer.");
  }
  const extension = filename.includes(".") ? `.${filename.split(".").at(-1)?.toLowerCase()}` : "";
  const acceptedTypes = CONTENT_TYPES.get(extension);
  if (!acceptedTypes?.includes(contentType)) {
    throw new ProductError(
      "VALIDATION_ERROR",
      "The filename extension and contentType must identify a supported text, PDF, or Office document.",
      400,
      { allowedExtensions: Array.from(CONTENT_TYPES.keys()) },
    );
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_SOURCE_BYTES) {
    throw new ProductError(
      "VALIDATION_ERROR",
      `byteSize must be between 1 and ${MAX_SOURCE_BYTES} bytes.`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new ProductError("VALIDATION_ERROR", "sha256 must be a 64-character lowercase hexadecimal digest.");
  }
  if (classification !== "private" && classification !== "public") {
    throw new ProductError("VALIDATION_ERROR", "classification must be private or public.");
  }
  return { scopeId, filename, contentType, byteSize, sha256, classification };
}

function storageConfiguration(): { url: string; key: string; bucket: string } {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const bucket = process.env.SUPABASE_SOURCE_BUCKET?.trim() || DEFAULT_SOURCE_BUCKET;
  if (!url || !key || key === anonKey || !/^https?:\/\//.test(url) || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket)) {
    throw new ProductError(
      "STORAGE_UNAVAILABLE",
      "Private Supabase Storage is not configured with a valid URL, service-role key, and source bucket.",
      503,
    );
  }
  return { url, key, bucket };
}

function storageFailure(message: string): ProductError {
  return new ProductError("STORAGE_UNAVAILABLE", message, 503);
}

function supabaseStorageAdapter(): { adapter: SourceStorageAdapter; bucket: string } {
  const { url, key, bucket } = storageConfiguration();
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const adapter: SourceStorageAdapter = {
    async createSignedUploadUrl(selectedBucket, objectKey) {
      const { data, error } = await client.storage.from(selectedBucket).createSignedUploadUrl(objectKey, { upsert: false });
      if (error || !data) throw storageFailure("Supabase Storage could not issue an upload URL.");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async inspectObject(selectedBucket, objectKey) {
      const { data, error } = await client.storage.from(selectedBucket).info(objectKey);
      if (error || !data) {
        const status = Number((error as { statusCode?: string | number } | null)?.statusCode);
        if (status === 404) throw new ProductError("CONFLICT", "The uploaded object is not present yet.", 409);
        throw storageFailure("Supabase Storage could not inspect the uploaded object.");
      }
      const metadata: Record<string, unknown> = data.metadata && typeof data.metadata === "object"
        ? data.metadata as Record<string, unknown>
        : {};
      return {
        byteSize: typeof data.size === "number" ? data.size : null,
        contentType: normalizedContentType(
          typeof data.contentType === "string"
            ? data.contentType
            : typeof metadata.mimetype === "string"
              ? metadata.mimetype
              : "",
        ) || null,
        metadata,
      };
    },
    async downloadObject(selectedBucket, objectKey) {
      const { data, error } = await client.storage.from(selectedBucket).download(objectKey);
      if (error || !data) throw storageFailure("Supabase Storage could not verify the uploaded object.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async removeObject(selectedBucket, objectKey) {
      const { error } = await client.storage.from(selectedBucket).remove([objectKey]);
      if (error) throw storageFailure("Supabase Storage could not remove a rejected object.");
    },
  };
  return { adapter, bucket };
}

async function withTenant<T>(context: CommandContext, operation: (tx: TransactionDb) => Promise<T>): Promise<T> {
  try {
    return await getProductDb().transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('commonstate.organization_id', ${context.organizationId}, true), set_config('commonstate.workspace_id', ${context.workspaceId}, true), set_config('commonstate.principal_id', ${context.principal.principalId}, true)`,
      );
      return operation(tx);
    });
  } catch (error) {
    if (error instanceof ProductError) throw error;
    if (isDatabaseUnavailable(error)) {
      throw new ProductError("STORAGE_UNAVAILABLE", "PostgreSQL storage is unavailable.", 503);
    }
    throw error;
  }
}

async function requireVisibleScope(tx: TransactionDb, context: CommandContext, scopeId: string): Promise<void> {
  if (!context.allowedScopeIds.includes(scopeId)) {
    throw new ProductError("SCOPE_DENIED", "The requested source scope is not available to this principal.", 403);
  }
  const [scope] = await tx
    .select({ id: scopes.id })
    .from(scopes)
    .where(and(eq(scopes.id, scopeId), eq(scopes.workspaceId, context.workspaceId)))
    .limit(1);
  if (!scope) throw new ProductError("SCOPE_DENIED", "The requested source scope is invalid.", 403);
}

export async function createSourceUpload(
  context: CommandContext,
  rawInput: Record<string, unknown>,
  idempotencyKey: string,
  dependency?: { adapter: SourceStorageAdapter; bucket: string },
) {
  requirePermission(context, PRODUCT_PERMISSIONS.ingest);
  const input = validateSourceUploadRequest(rawInput);
  const storage = dependency ?? supabaseStorageAdapter();
  const requestHash = hash(input);
  const seed = `${context.workspaceId}:${context.principal.principalId}:${idempotencyKey}`;
  const sourceId = deterministicId("source", seed);
  const artifactId = deterministicId("artifact", seed);
  const jobId = deterministicId("job", `${artifactId}:extract`);
  const safeFilename = safeObjectFilename(input.filename);
  const objectKey = `organizations/${context.organizationId}/workspaces/${context.workspaceId}/scopes/${input.scopeId}/sources/${sourceId}/${input.sha256.slice(0, 16)}-${safeFilename}`;
  const timestamp = context.clock.now().toISOString();
  const acl = input.classification === "public"
    ? ["workspace"]
    : Array.from(new Set([input.scopeId, context.principal.principalId, context.principal.actorId])).sort();

  await withTenant(context, async (tx) => {
    await requireVisibleScope(tx, context, input.scopeId);
    const [existing] = await tx
      .select({ source: sources, artifact: sourceArtifacts })
      .from(sources)
      .innerJoin(sourceArtifacts, eq(sourceArtifacts.sourceId, sources.id))
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, context.workspaceId)))
      .limit(1);
    if (existing) {
      const existingRequestHash = typeof existing.source.metadata.requestHash === "string"
        ? existing.source.metadata.requestHash
        : "";
      if (existingRequestHash !== requestHash || existing.artifact.storageKey !== objectKey) {
        throw new ProductError(
          "IDEMPOTENCY_KEY_REUSED",
          "The Idempotency-Key was already used with a different upload request.",
          409,
        );
      }
      return;
    }
    await tx.insert(sources).values({
      id: sourceId,
      workspaceId: context.workspaceId,
      sourceKey: `storage-upload:${hash(seed)}`,
      sourceType: "file",
      title: input.filename,
      uri: `storage://${storage.bucket}/${objectKey}`,
      classification: input.classification,
      immutable: true,
      sha256: input.sha256,
      capturedAt: timestamp,
      contentText: "",
      metadata: {
        ingestionStatus: "pending_upload",
        requestHash,
        scopeId: input.scopeId,
        artifactId,
        originalFilename: input.filename,
        contentType: input.contentType,
        byteSize: input.byteSize,
        acl,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(sourceArtifacts).values({
      id: artifactId,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      sourceId,
      storageBucket: storage.bucket,
      storageKey: objectKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      classification: input.classification,
      acl,
      status: "pending_upload",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(jobs).values({
      id: jobId,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      jobType: "source.extract",
      status: "waiting_for_upload",
      idempotencyKey: `source-extract:${artifactId}:${input.sha256}`,
      payload: { sourceId, artifactId, scopeId: input.scopeId, storageBucket: storage.bucket, storageKey: objectKey },
      result: null,
      attempts: 0,
      maxAttempts: 5,
      runAfter: timestamp,
      lockedAt: null,
      lockedBy: null,
      completedAt: null,
      cancelledAt: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await tx.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      principalType: context.principal.type,
      principalId: context.principal.principalId,
      action: "source.upload_url_issued",
      resourceType: "source_artifact",
      resourceId: artifactId,
      policyDecision: "allow",
      beforeHash: null,
      afterHash: requestHash,
      metadata: { sourceId, scopeId: input.scopeId, classification: input.classification, byteSize: input.byteSize },
      createdAt: timestamp,
    }).onConflictDoNothing();
  });

  const signed = await storage.adapter.createSignedUploadUrl(storage.bucket, objectKey);
  return {
    sourceId,
    artifactId,
    status: "pending_upload",
    upload: {
      bucket: storage.bucket,
      objectKey,
      signedUrl: signed.signedUrl,
      token: signed.token,
      upsert: false,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
    },
  };
}

export async function completeSourceUpload(
  context: CommandContext,
  rawInput: Record<string, unknown>,
  idempotencyKey: string,
  dependency?: { adapter: SourceStorageAdapter; bucket: string },
) {
  requirePermission(context, PRODUCT_PERMISSIONS.ingest);
  const artifactId = typeof rawInput.artifactId === "string" ? rawInput.artifactId.trim() : "";
  if (!artifactId || artifactId.length > 200) {
    throw new ProductError("VALIDATION_ERROR", "artifactId is required.");
  }
  const storage = dependency ?? supabaseStorageAdapter();
  const jobId = deterministicId("job", `${artifactId}:extract`);
  const pending = await withTenant(context, async (tx) => {
    const [row] = await tx
      .select({ artifact: sourceArtifacts, source: sources, job: jobs })
      .from(sourceArtifacts)
      .innerJoin(sources, eq(sources.id, sourceArtifacts.sourceId))
      .innerJoin(jobs, and(eq(jobs.id, jobId), eq(jobs.workspaceId, sourceArtifacts.workspaceId)))
      .where(and(
        eq(sourceArtifacts.id, artifactId),
        eq(sourceArtifacts.organizationId, context.organizationId),
        eq(sourceArtifacts.workspaceId, context.workspaceId),
      ))
      .limit(1);
    if (!row) throw new ProductError("NOT_FOUND", "Source upload was not found.", 404);
    const scopeId = typeof row.source.metadata.scopeId === "string" ? row.source.metadata.scopeId : "";
    await requireVisibleScope(tx, context, scopeId);
    return { ...row, scopeId };
  });
  if (pending.artifact.status === "ready") {
    return { sourceId: pending.source.id, artifactId, jobId: pending.job.id, status: "extraction_queued" };
  }
  if (pending.artifact.status !== "pending_upload") {
    throw new ProductError("CONFLICT", "Source upload is not awaiting completion.", 409);
  }
  if (pending.artifact.storageBucket !== storage.bucket) {
    throw new ProductError("STORAGE_UNAVAILABLE", "The configured source bucket does not match the pending artifact.", 503);
  }

  const inspected = await storage.adapter.inspectObject(storage.bucket, pending.artifact.storageKey);
  const bytes = await storage.adapter.downloadObject(storage.bucket, pending.artifact.storageKey);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  const actualSize = bytes.byteLength;
  const metadataHash = typeof inspected.metadata.sha256 === "string"
    ? inspected.metadata.sha256.toLowerCase()
    : null;
  const mismatch =
    (inspected.byteSize !== null && inspected.byteSize !== pending.artifact.byteSize) ||
    actualSize !== pending.artifact.byteSize ||
    (inspected.contentType !== null && normalizedContentType(inspected.contentType) !== pending.artifact.contentType) ||
    actualHash !== pending.artifact.sha256 ||
    (metadataHash !== null && metadataHash !== pending.artifact.sha256);
  if (mismatch) {
    await storage.adapter.removeObject(storage.bucket, pending.artifact.storageKey);
    throw new ProductError(
      "CONFLICT",
      "Uploaded object metadata, size, content type, or SHA-256 did not match the signed request.",
      409,
    );
  }

  const timestamp = context.clock.now().toISOString();
  const completed = await withTenant(context, async (tx) => {
    const eventKey = `storage-complete:${idempotencyKey}`;
    const [existingEvent] = await tx
      .select({ sourceId: sourceEvents.sourceId })
      .from(sourceEvents)
      .where(and(eq(sourceEvents.workspaceId, context.workspaceId), eq(sourceEvents.idempotencyKey, eventKey)))
      .limit(1);
    if (existingEvent && existingEvent.sourceId !== pending.source.id) {
      throw new ProductError("IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used for another upload.", 409);
    }
    await tx
      .update(sourceArtifacts)
      .set({ status: "ready", updatedAt: timestamp })
      .where(and(
        eq(sourceArtifacts.id, artifactId),
        eq(sourceArtifacts.organizationId, context.organizationId),
        eq(sourceArtifacts.workspaceId, context.workspaceId),
        eq(sourceArtifacts.status, "pending_upload"),
      ));
    await tx
      .update(sources)
      .set({
        capturedAt: timestamp,
        metadata: { ...pending.source.metadata, ingestionStatus: "extraction_queued", verifiedAt: timestamp },
        updatedAt: timestamp,
      })
      .where(and(eq(sources.id, pending.source.id), eq(sources.workspaceId, context.workspaceId)));
    await tx.insert(sourceEvents).values({
      id: deterministicId("source_event", `${context.workspaceId}:${eventKey}`),
      workspaceId: context.workspaceId,
      sourceId: pending.source.id,
      eventType: "upload_completed",
      idempotencyKey: eventKey,
      sourceHash: pending.artifact.sha256,
      payload: { artifactId, scopeId: pending.scopeId, byteSize: actualSize, contentType: pending.artifact.contentType },
      createdAt: timestamp,
    }).onConflictDoNothing();
    await tx
      .update(jobs)
      .set({ status: "queued", runAfter: timestamp, updatedAt: timestamp })
      .where(and(eq(jobs.id, pending.job.id), eq(jobs.workspaceId, context.workspaceId)));
    await tx.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      principalType: context.principal.type,
      principalId: context.principal.principalId,
      action: "source.upload_completed",
      resourceType: "source_artifact",
      resourceId: artifactId,
      policyDecision: "allow",
      beforeHash: hash({ status: pending.artifact.status }),
      afterHash: hash({ status: "ready", sha256: actualHash, byteSize: actualSize }),
      metadata: { sourceId: pending.source.id, jobId: pending.job.id, scopeId: pending.scopeId },
      createdAt: timestamp,
    }).onConflictDoNothing();
    return { sourceId: pending.source.id, artifactId, jobId: pending.job.id, status: "extraction_queued" };
  });
  return completed;
}
