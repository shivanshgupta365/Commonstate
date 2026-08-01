import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Client as MicrosoftGraphClient } from "@microsoft/microsoft-graph-client";
import { WebClient as SlackWebClient } from "@slack/web-api";
import { google } from "googleapis";

export type ConnectorId =
  | "file"
  | "webhook"
  | "slack"
  | "google-drive"
  | "microsoft-teams"
  | "sharepoint-onedrive";
export type ConnectorMaturity = "available" | "credential_gated";
export type ConnectorAuthKind = "none" | "hmac" | "oauth2";

export type ConnectorManifest = Readonly<{
  id: ConnectorId;
  displayName: string;
  maturity: ConnectorMaturity;
  auth: ConnectorAuthKind;
  authorizationScopes: readonly string[];
  capabilities: Readonly<{
    upload: boolean;
    webhook: boolean;
    incrementalSync: boolean;
    aclPropagation: boolean;
    deletionPropagation: boolean;
  }>;
  honestStatus: string;
}>;

export const CONNECTOR_MANIFESTS: Readonly<Record<ConnectorId, ConnectorManifest>> = Object.freeze({
  file: {
    id: "file",
    displayName: "File upload",
    maturity: "available",
    auth: "none",
    authorizationScopes: [],
    capabilities: { upload: true, webhook: false, incrementalSync: false, aclPropagation: true, deletionPropagation: true },
    honestStatus: "Local normalization is available; object storage wiring is deployment-owned.",
  },
  webhook: {
    id: "webhook",
    displayName: "Signed webhook",
    maturity: "available",
    auth: "hmac",
    authorizationScopes: [],
    capabilities: { upload: false, webhook: true, incrementalSync: false, aclPropagation: true, deletionPropagation: true },
    honestStatus: "HMAC verification and replay protection are available.",
  },
  slack: {
    id: "slack",
    displayName: "Slack",
    maturity: "credential_gated",
    auth: "oauth2",
    authorizationScopes: ["channels:history", "channels:read", "groups:history", "groups:read", "users:read"],
    capabilities: { upload: false, webhook: true, incrementalSync: true, aclPropagation: true, deletionPropagation: true },
    honestStatus: "Access-token history sync is available. OAuth installation and Events API callbacks require deployment configuration.",
  },
  "google-drive": {
    id: "google-drive",
    displayName: "Google Drive",
    maturity: "credential_gated",
    auth: "oauth2",
    authorizationScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    capabilities: { upload: false, webhook: true, incrementalSync: true, aclPropagation: true, deletionPropagation: true },
    honestStatus: "Access-token file and changes sync is available. OAuth installation requires deployment configuration.",
  },
  "microsoft-teams": {
    id: "microsoft-teams",
    displayName: "Microsoft Teams",
    maturity: "credential_gated",
    auth: "oauth2",
    authorizationScopes: ["ChannelMessage.Read.All", "Team.ReadBasic.All", "User.Read.All"],
    capabilities: { upload: false, webhook: true, incrementalSync: true, aclPropagation: true, deletionPropagation: true },
    honestStatus: "Access-token channel message sync is available. Microsoft consent and subscriptions require deployment configuration.",
  },
  "sharepoint-onedrive": {
    id: "sharepoint-onedrive",
    displayName: "SharePoint and OneDrive",
    maturity: "credential_gated",
    auth: "oauth2",
    authorizationScopes: ["Files.Read.All", "Sites.Read.All", "User.Read.All"],
    capabilities: { upload: false, webhook: true, incrementalSync: true, aclPropagation: true, deletionPropagation: true },
    honestStatus: "Access-token Graph delta and permission sync is available. Microsoft consent requires deployment configuration.",
  },
});

export type ConnectorErrorCode =
  | "CONNECTOR_NOT_CONFIGURED"
  | "CONNECTOR_NOT_IMPLEMENTED"
  | "INVALID_WEBHOOK_SIGNATURE"
  | "WEBHOOK_EXPIRED"
  | "INVALID_WEBHOOK_PAYLOAD"
  | "CURSOR_REGRESSION"
  | "CONNECTOR_API_FAILURE"
  | "CONNECTOR_ABORTED";

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    status: number,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type ConnectorInstance = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  connector: ConnectorId;
  status: "draft" | "active" | "paused" | "revoked" | "error";
  createdAt: string;
  revokedAt: string | null;
}>;

export type SyncCursor = Readonly<{
  connectorInstanceId: string;
  value: string;
  sequence: number;
  providerRevision: string | null;
  updatedAt: string;
}>;

export type SourceClassification = "public" | "private" | "synthetic";

export type NormalizedSourceEvent = Readonly<{
  connectorId: ConnectorId;
  connectorInstanceId: string;
  workspaceId: string;
  deliveryId: string;
  externalId: string;
  eventType: "upsert" | "delete" | "acl_changed";
  occurredAt: string;
  sourceHash: string | null;
  title: string;
  mimeType: string | null;
  content: string | null;
  classification: SourceClassification;
  acl: readonly string[];
  providerCursor: string | null;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type ConnectorSourceProjection = Readonly<{
  connectorInstanceId: string;
  externalId: string;
  title: string;
  sourceHash: string | null;
  classification: SourceClassification;
  acl: readonly string[];
  deleted: boolean;
  deletedAt: string | null;
  lastDeliveryId: string;
  updatedAt: string;
}>;

export interface ConnectorAdapter {
  readonly manifest: ConnectorManifest;
  status(): Readonly<{ ready: boolean; reason: string | null }>;
  sync(input: {
    instance: ConnectorInstance;
    cursor: SyncCursor | null;
    signal: AbortSignal;
  }): Promise<Readonly<{ events: readonly NormalizedSourceEvent[]; nextCursor: SyncCursor | null }>>;
}

export class OAuthConnectorScaffold implements ConnectorAdapter {
  readonly manifest: ConnectorManifest;

  constructor(id: Exclude<ConnectorId, "file" | "webhook">) {
    this.manifest = CONNECTOR_MANIFESTS[id];
  }

  status(): Readonly<{ ready: boolean; reason: string | null }> {
    return { ready: false, reason: this.manifest.honestStatus };
  }

  async sync(input: {
    instance: ConnectorInstance;
    cursor: SyncCursor | null;
    signal: AbortSignal;
  }): Promise<Readonly<{ events: readonly NormalizedSourceEvent[]; nextCursor: SyncCursor | null }>> {
    void input;
    throw new ConnectorError(
      "CONNECTOR_NOT_IMPLEMENTED",
      `${this.manifest.displayName} is a declared integration scaffold; live OAuth and sync are not enabled in this build.`,
      501,
      false,
    );
  }
}

export function normalizeFileUpload(input: {
  connectorInstanceId: string;
  workspaceId: string;
  deliveryId: string;
  externalId: string;
  filename: string;
  mimeType: string;
  content: string;
  classification: SourceClassification;
  acl: readonly string[];
  occurredAt: string;
}): NormalizedSourceEvent {
  if (!input.filename.trim() || !input.externalId.trim() || !input.deliveryId.trim()) {
    throw new ConnectorError("INVALID_WEBHOOK_PAYLOAD", "File name, external ID, and delivery ID are required.", 400, false);
  }
  return Object.freeze({
    connectorId: "file",
    connectorInstanceId: input.connectorInstanceId,
    workspaceId: input.workspaceId,
    deliveryId: input.deliveryId,
    externalId: input.externalId,
    eventType: "upsert",
    occurredAt: input.occurredAt,
    sourceHash: createHash("sha256").update(input.content).digest("hex"),
    title: input.filename,
    mimeType: input.mimeType,
    content: input.content,
    classification: input.classification,
    acl: [...new Set(input.acl)].sort(),
    providerCursor: null,
    metadata: { uploaded: true },
  });
}

export function signWebhookPayload(input: {
  rawBody: string | Uint8Array;
  secret: string;
  timestamp: string;
}): string {
  const body = typeof input.rawBody === "string" ? input.rawBody : Buffer.from(input.rawBody).toString("utf8");
  return `v1=${createHmac("sha256", input.secret).update(`${input.timestamp}.${body}`).digest("hex")}`;
}

export function verifyWebhookHmac(input: {
  rawBody: string | Uint8Array;
  signature: string;
  secret: string;
  timestamp: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): void {
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new ConnectorError("INVALID_WEBHOOK_SIGNATURE", "Webhook timestamp is invalid.", 401, false);
  }
  const nowMs = input.nowMs ?? Date.now();
  const toleranceMs = (input.toleranceSeconds ?? 300) * 1000;
  if (Math.abs(nowMs - timestampSeconds * 1000) > toleranceMs) {
    throw new ConnectorError("WEBHOOK_EXPIRED", "Webhook timestamp is outside the accepted replay window.", 401, false);
  }
  const expected = signWebhookPayload(input);
  const supplied = input.signature.trim().toLowerCase();
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    throw new ConnectorError("INVALID_WEBHOOK_SIGNATURE", "Webhook signature does not match the raw request body.", 401, false);
  }
}

export interface IdempotencyStore {
  /** Atomically returns true once for a workspace + connector + delivery tuple. */
  claim(key: string, expiresAt: string): Promise<boolean>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #keys = new Map<string, number>();

  async claim(key: string, expiresAt: string): Promise<boolean> {
    const now = Date.now();
    for (const [storedKey, expiry] of this.#keys) {
      if (expiry <= now) this.#keys.delete(storedKey);
    }
    if (this.#keys.has(key)) return false;
    this.#keys.set(key, Date.parse(expiresAt));
    return true;
  }
}

function isSourceClassification(value: unknown): value is SourceClassification {
  return value === "public" || value === "private" || value === "synthetic";
}

export async function acceptSignedWebhook(input: {
  connectorInstance: ConnectorInstance;
  rawBody: string;
  signature: string;
  timestamp: string;
  deliveryId: string;
  secret: string;
  idempotency: IdempotencyStore;
  nowMs?: number;
}): Promise<Readonly<{ duplicate: boolean; event: NormalizedSourceEvent | null }>> {
  verifyWebhookHmac(input);
  if (!input.deliveryId.trim()) {
    throw new ConnectorError("INVALID_WEBHOOK_PAYLOAD", "Webhook delivery ID is required.", 400, false);
  }
  const expiresAt = new Date((input.nowMs ?? Date.now()) + 7 * 24 * 60 * 60 * 1000).toISOString();
  const idempotencyKey = `${input.connectorInstance.workspaceId}:${input.connectorInstance.id}:${input.deliveryId}`;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    throw new ConnectorError("INVALID_WEBHOOK_PAYLOAD", "Webhook body must be a JSON object.", 400, false);
  }
  const eventType = payload.eventType;
  const externalId = payload.externalId;
  const classification = payload.classification;
  if (
    (eventType !== "upsert" && eventType !== "delete" && eventType !== "acl_changed") ||
    typeof externalId !== "string" ||
    !isSourceClassification(classification)
  ) {
    throw new ConnectorError("INVALID_WEBHOOK_PAYLOAD", "Webhook eventType, externalId, and classification are invalid.", 400, false);
  }
  const content = typeof payload.content === "string" ? payload.content : null;
  const acl = Array.isArray(payload.acl) && payload.acl.every((item) => typeof item === "string")
    ? [...new Set(payload.acl as string[])].sort()
    : [];
  const event: NormalizedSourceEvent = Object.freeze({
    connectorId: "webhook",
    connectorInstanceId: input.connectorInstance.id,
    workspaceId: input.connectorInstance.workspaceId,
    deliveryId: input.deliveryId,
    externalId,
    eventType,
    occurredAt: typeof payload.occurredAt === "string" ? payload.occurredAt : new Date(input.nowMs ?? Date.now()).toISOString(),
    sourceHash: eventType === "delete" || content === null ? null : createHash("sha256").update(content).digest("hex"),
    title: typeof payload.title === "string" ? payload.title : externalId,
    mimeType: typeof payload.mimeType === "string" ? payload.mimeType : null,
    content: eventType === "delete" ? null : content,
    classification,
    acl,
    providerCursor: typeof payload.cursor === "string" ? payload.cursor : null,
    metadata: typeof payload.metadata === "object" && payload.metadata !== null && !Array.isArray(payload.metadata)
      ? payload.metadata as Record<string, unknown>
      : {},
  });
  if (!(await input.idempotency.claim(idempotencyKey, expiresAt))) {
    return { duplicate: true, event: null };
  }
  return { duplicate: false, event };
}

export function advanceCursor(current: SyncCursor | null, next: SyncCursor): SyncCursor {
  if (current && current.connectorInstanceId !== next.connectorInstanceId) {
    throw new ConnectorError("CURSOR_REGRESSION", "A cursor cannot move between connector instances.", 409, false);
  }
  if (current && next.sequence <= current.sequence) {
    throw new ConnectorError("CURSOR_REGRESSION", "A sync cursor must advance monotonically.", 409, false);
  }
  return Object.freeze(structuredClone(next));
}

/**
 * Applies provider deletion and ACL replacement semantics without retaining the
 * private source body in the collection projection.
 */
export function applySourceEvent(
  current: ConnectorSourceProjection | null,
  event: NormalizedSourceEvent,
): ConnectorSourceProjection {
  if (current && (
    current.connectorInstanceId !== event.connectorInstanceId ||
    current.externalId !== event.externalId
  )) {
    throw new ConnectorError("INVALID_WEBHOOK_PAYLOAD", "Source projection identity does not match the incoming event.", 409, false);
  }
  if (event.eventType === "delete") {
    return Object.freeze({
      connectorInstanceId: event.connectorInstanceId,
      externalId: event.externalId,
      title: current?.title ?? event.title,
      sourceHash: null,
      classification: current?.classification ?? event.classification,
      acl: [],
      deleted: true,
      deletedAt: event.occurredAt,
      lastDeliveryId: event.deliveryId,
      updatedAt: event.occurredAt,
    });
  }
  return Object.freeze({
    connectorInstanceId: event.connectorInstanceId,
    externalId: event.externalId,
    title: event.eventType === "acl_changed" && current ? current.title : event.title,
    sourceHash: event.eventType === "acl_changed" && current ? current.sourceHash : event.sourceHash,
    classification: event.classification,
    acl: [...new Set(event.acl)].sort(),
    deleted: false,
    deletedAt: null,
    lastDeliveryId: event.deliveryId,
    updatedAt: event.occurredAt,
  });
}

type CursorEnvelope = Readonly<{
  mode: string;
  token: string | null;
  index?: number;
}>;

function decodeCursor(cursor: SyncCursor | null, expectedMode: readonly string[]): CursorEnvelope | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(cursor.value) as CursorEnvelope;
    if (!value || typeof value.mode !== "string" || !expectedMode.includes(value.mode)) throw new Error("mode");
    if (value.token !== null && typeof value.token !== "string") throw new Error("token");
    if (value.index !== undefined && (!Number.isInteger(value.index) || value.index < 0)) throw new Error("index");
    return value;
  } catch {
    throw new ConnectorError("CURSOR_REGRESSION", "Connector cursor is malformed or belongs to a different sync adapter.", 409, false);
  }
}

function encodeCursor(input: {
  connectorInstanceId: string;
  previous: SyncCursor | null;
  envelope: CursorEnvelope;
  providerRevision: string | null;
  now: string;
}): SyncCursor {
  return Object.freeze({
    connectorInstanceId: input.connectorInstanceId,
    value: JSON.stringify(input.envelope),
    sequence: (input.previous?.sequence ?? 0) + 1,
    providerRevision: input.providerRevision,
    updatedAt: input.now,
  });
}

function assertSyncable(instance: ConnectorInstance, expected: ConnectorId): void {
  if (instance.connector !== expected) {
    throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", `Connector instance ${instance.id} is not a ${expected} instance.`, 409, false);
  }
  if (instance.status !== "active") {
    throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", `Connector instance ${instance.id} is ${instance.status}, not active.`, 409, false);
  }
}

function connectorFailure(name: string, error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const candidate = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  const aborted = candidate?.name === "AbortError" || candidate?.code === "ABORT_ERR";
  const status = typeof candidate?.status === "number" ? candidate.status : 502;
  return new ConnectorError(
    aborted ? "CONNECTOR_ABORTED" : "CONNECTOR_API_FAILURE",
    `${name} sync failed: ${error instanceof Error ? error.message : "unknown provider error"}`,
    aborted ? 499 : status,
    aborted || status === 408 || status === 429 || status >= 500,
  );
}

function requireCredential(name: string, value: string | null): string {
  if (!value) {
    throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", `${name} access token is not configured.`, 503, false);
  }
  return value;
}

function slackTimestampToIso(timestamp: string | undefined, fallback: string): string {
  if (!timestamp) return fallback;
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : fallback;
}

export class SlackConnectorAdapter implements ConnectorAdapter {
  readonly manifest = CONNECTOR_MANIFESTS.slack;
  readonly #token: string | null;
  readonly #channelIds: readonly string[];
  readonly #client: SlackWebClient | null;

  constructor(options: { botToken?: string | null; channelIds: readonly string[]; timeoutMs?: number; baseUrl?: string }) {
    this.#token = options.botToken?.trim() || null;
    this.#channelIds = [...new Set(options.channelIds.map((id) => id.trim()).filter(Boolean))].sort();
    this.#client = this.#token
      ? new SlackWebClient(this.#token, {
        timeout: options.timeoutMs ?? 10_000,
        slackApiUrl: options.baseUrl,
        rejectRateLimitedCalls: true,
      })
      : null;
  }

  status(): Readonly<{ ready: boolean; reason: string | null }> {
    if (!this.#token) return { ready: false, reason: "Slack bot access token is not configured." };
    if (this.#channelIds.length === 0) return { ready: false, reason: "No Slack channel IDs are configured." };
    return { ready: true, reason: null };
  }

  async sync(input: {
    instance: ConnectorInstance;
    cursor: SyncCursor | null;
    signal: AbortSignal;
  }): Promise<Readonly<{ events: readonly NormalizedSourceEvent[]; nextCursor: SyncCursor | null }>> {
    assertSyncable(input.instance, "slack");
    requireCredential("Slack bot", this.#token);
    const client = this.#client;
    if (!client || this.#channelIds.length === 0) {
      throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", "Slack channel sync is not configured.", 503, false);
    }
    const cursor = decodeCursor(input.cursor, ["slack_history"]);
    const index = Math.min(cursor?.index ?? 0, this.#channelIds.length - 1);
    const channel = this.#channelIds[index];
    try {
      if (input.signal.aborted) throw new DOMException("Slack sync aborted", "AbortError");
      const response = await client.conversations.history({
        channel,
        cursor: cursor?.token ?? undefined,
        include_all_metadata: true,
        limit: 100,
      });
      if (input.signal.aborted) throw new DOMException("Slack sync aborted", "AbortError");
      const now = new Date().toISOString();
      const events = (response.messages ?? []).flatMap((message): NormalizedSourceEvent[] => {
        const record = message as typeof message & { deleted_ts?: string };
        const timestamp = record.deleted_ts ?? message.ts;
        if (!timestamp) return [];
        const deleted = message.subtype === "message_deleted" || message.subtype === "tombstone";
        const content = deleted ? null : message.text ?? "";
        return [Object.freeze({
          connectorId: "slack",
          connectorInstanceId: input.instance.id,
          workspaceId: input.instance.workspaceId,
          deliveryId: `slack:${channel}:${timestamp}:${message.edited?.ts ?? "original"}`,
          externalId: `slack:${channel}:${timestamp}`,
          eventType: deleted ? "delete" : "upsert",
          occurredAt: slackTimestampToIso(message.edited?.ts ?? timestamp, now),
          sourceHash: content === null ? null : createHash("sha256").update(content).digest("hex"),
          title: `#${channel} · ${timestamp}`,
          mimeType: "text/slack-message",
          content,
          classification: "private",
          acl: [`slack:channel:${channel}`],
          providerCursor: response.response_metadata?.next_cursor || null,
          metadata: { channelId: channel, userId: message.user ?? null, threadTs: message.thread_ts ?? null },
        })];
      });
      const nextToken = response.response_metadata?.next_cursor || null;
      const nextIndex = nextToken ? index : (index + 1) % this.#channelIds.length;
      return {
        events,
        nextCursor: encodeCursor({
          connectorInstanceId: input.instance.id,
          previous: input.cursor,
          envelope: { mode: "slack_history", token: nextToken, index: nextIndex },
          providerRevision: events.at(-1)?.occurredAt ?? null,
          now,
        }),
      };
    } catch (error) {
      throw connectorFailure("Slack", error);
    }
  }
}

export class GoogleDriveConnectorAdapter implements ConnectorAdapter {
  readonly manifest = CONNECTOR_MANIFESTS["google-drive"];
  readonly #accessToken: string | null;
  readonly #drive: ReturnType<typeof google.drive> | null;

  constructor(options: { accessToken?: string | null }) {
    this.#accessToken = options.accessToken?.trim() || null;
    if (this.#accessToken) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: this.#accessToken });
      this.#drive = google.drive({ version: "v3", auth });
    } else {
      this.#drive = null;
    }
  }

  status(): Readonly<{ ready: boolean; reason: string | null }> {
    return this.#accessToken
      ? { ready: true, reason: null }
      : { ready: false, reason: "Google Drive access token is not configured." };
  }

  async sync(input: {
    instance: ConnectorInstance;
    cursor: SyncCursor | null;
    signal: AbortSignal;
  }): Promise<Readonly<{ events: readonly NormalizedSourceEvent[]; nextCursor: SyncCursor | null }>> {
    assertSyncable(input.instance, "google-drive");
    requireCredential("Google Drive", this.#accessToken);
    const drive = this.#drive;
    if (!drive) throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", "Google Drive client is not configured.", 503, false);
    const cursor = decodeCursor(input.cursor, ["drive_files", "drive_changes"]);
    const now = new Date().toISOString();
    try {
      if (!cursor || cursor.mode === "drive_files") {
        const response = await drive.files.list({
          pageToken: cursor?.token ?? undefined,
          pageSize: 100,
          spaces: "drive",
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,trashed,permissionIds,driveId,parents,webViewLink,version,sha256Checksum)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }, { signal: input.signal });
        const events = (response.data.files ?? []).flatMap((file): NormalizedSourceEvent[] => {
          if (!file.id) return [];
          const modifiedAt = file.modifiedTime ?? now;
          return [Object.freeze({
            connectorId: "google-drive",
            connectorInstanceId: input.instance.id,
            workspaceId: input.instance.workspaceId,
            deliveryId: `drive:${file.id}:${file.version ?? modifiedAt}`,
            externalId: `drive:${file.id}`,
            eventType: file.trashed ? "delete" : "upsert",
            occurredAt: modifiedAt,
            sourceHash: file.trashed ? null : file.sha256Checksum ?? null,
            title: file.name ?? file.id,
            mimeType: file.mimeType ?? null,
            content: null,
            classification: "private",
            acl: (file.permissionIds ?? []).map((id) => `google-drive:permission:${id}`).sort(),
            providerCursor: response.data.nextPageToken ?? null,
            metadata: { driveId: file.driveId ?? null, parentIds: file.parents ?? [], webViewLink: file.webViewLink ?? null, bodyPending: !file.trashed },
          })];
        });
        if (response.data.nextPageToken) {
          return {
            events,
            nextCursor: encodeCursor({ connectorInstanceId: input.instance.id, previous: input.cursor, envelope: { mode: "drive_files", token: response.data.nextPageToken }, providerRevision: events.at(-1)?.occurredAt ?? null, now }),
          };
        }
        const start = await drive.changes.getStartPageToken({ supportsAllDrives: true }, { signal: input.signal });
        return {
          events,
          nextCursor: encodeCursor({ connectorInstanceId: input.instance.id, previous: input.cursor, envelope: { mode: "drive_changes", token: start.data.startPageToken ?? null }, providerRevision: events.at(-1)?.occurredAt ?? null, now }),
        };
      }

      if (!cursor.token) throw new ConnectorError("CURSOR_REGRESSION", "Google Drive changes cursor is missing its page token.", 409, false);
      const response = await drive.changes.list({
        pageToken: cursor.token,
        pageSize: 100,
        includeRemoved: true,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: "nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,modifiedTime,trashed,permissionIds,driveId,parents,webViewLink,version,sha256Checksum))",
      }, { signal: input.signal });
      const events = (response.data.changes ?? []).flatMap((change): NormalizedSourceEvent[] => {
        const fileId = change.fileId ?? change.file?.id;
        if (!fileId) return [];
        const deleted = Boolean(change.removed || change.file?.trashed);
        const occurredAt = change.time ?? change.file?.modifiedTime ?? now;
        return [Object.freeze({
          connectorId: "google-drive",
          connectorInstanceId: input.instance.id,
          workspaceId: input.instance.workspaceId,
          deliveryId: `drive-change:${fileId}:${change.file?.version ?? occurredAt}:${deleted ? "deleted" : "upsert"}`,
          externalId: `drive:${fileId}`,
          eventType: deleted ? "delete" : "upsert",
          occurredAt,
          sourceHash: deleted ? null : change.file?.sha256Checksum ?? null,
          title: change.file?.name ?? fileId,
          mimeType: change.file?.mimeType ?? null,
          content: null,
          classification: "private",
          acl: (change.file?.permissionIds ?? []).map((id) => `google-drive:permission:${id}`).sort(),
          providerCursor: response.data.nextPageToken ?? response.data.newStartPageToken ?? cursor.token,
          metadata: { driveId: change.file?.driveId ?? null, parentIds: change.file?.parents ?? [], bodyPending: !deleted },
        })];
      });
      return {
        events,
        nextCursor: encodeCursor({
          connectorInstanceId: input.instance.id,
          previous: input.cursor,
          envelope: { mode: "drive_changes", token: response.data.nextPageToken ?? response.data.newStartPageToken ?? cursor.token },
          providerRevision: events.at(-1)?.occurredAt ?? input.cursor?.providerRevision ?? null,
          now,
        }),
      };
    } catch (error) {
      throw connectorFailure("Google Drive", error);
    }
  }
}

type GraphPage = Readonly<{
  value?: readonly Record<string, unknown>[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}>;

function graphClient(accessToken: string | null): MicrosoftGraphClient | null {
  if (!accessToken) return null;
  return MicrosoftGraphClient.initWithMiddleware({
    authProvider: { getAccessToken: async () => accessToken },
  });
}

function graphAcl(permissionPage: unknown): readonly string[] {
  const value = (permissionPage as { value?: readonly Record<string, unknown>[] })?.value ?? [];
  const acl = new Set<string>();
  for (const permission of value) {
    const granted = permission.grantedToV2 as Record<string, unknown> | undefined;
    const identities = permission.grantedToIdentitiesV2 as readonly Record<string, unknown>[] | undefined;
    for (const identity of [granted, ...(identities ?? [])]) {
      if (!identity) continue;
      for (const kind of ["user", "group", "site"]) {
        const principal = identity[kind] as Record<string, unknown> | undefined;
        if (typeof principal?.id === "string") acl.add(`microsoft:${kind}:${principal.id}`);
      }
    }
    if (typeof permission.id === "string" && acl.size === 0) acl.add(`microsoft:permission:${permission.id}`);
  }
  return [...acl].sort();
}

export class MicrosoftGraphDriveConnectorAdapter implements ConnectorAdapter {
  readonly manifest = CONNECTOR_MANIFESTS["sharepoint-onedrive"];
  readonly #accessToken: string | null;
  readonly #driveId: string;
  readonly #client: MicrosoftGraphClient | null;

  constructor(options: { accessToken?: string | null; driveId: string }) {
    this.#accessToken = options.accessToken?.trim() || null;
    this.#driveId = options.driveId.trim();
    this.#client = graphClient(this.#accessToken);
  }

  status(): Readonly<{ ready: boolean; reason: string | null }> {
    if (!this.#accessToken) return { ready: false, reason: "Microsoft Graph access token is not configured." };
    if (!this.#driveId) return { ready: false, reason: "Microsoft drive ID is not configured." };
    return { ready: true, reason: null };
  }

  async sync(input: {
    instance: ConnectorInstance;
    cursor: SyncCursor | null;
    signal: AbortSignal;
  }): Promise<Readonly<{ events: readonly NormalizedSourceEvent[]; nextCursor: SyncCursor | null }>> {
    assertSyncable(input.instance, "sharepoint-onedrive");
    requireCredential("Microsoft Graph", this.#accessToken);
    if (!this.#client || !this.#driveId) throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", "Microsoft drive sync is not configured.", 503, false);
    const cursor = decodeCursor(input.cursor, ["graph_drive_delta"]);
    const endpoint = cursor?.token ?? `/drives/${encodeURIComponent(this.#driveId)}/root/delta`;
    const now = new Date().toISOString();
    try {
      const page = await this.#client.api(endpoint).options({ signal: input.signal }).get() as GraphPage;
      const events: NormalizedSourceEvent[] = [];
      for (const item of page.value ?? []) {
        const id = typeof item.id === "string" ? item.id : null;
        if (!id) continue;
        const deleted = Boolean(item.deleted);
        const permissions = deleted
          ? null
          : await this.#client.api(`/drives/${encodeURIComponent(this.#driveId)}/items/${encodeURIComponent(id)}/permissions`)
            .select("id,grantedToV2,grantedToIdentitiesV2,roles")
            .options({ signal: input.signal })
            .get();
        const file = item.file as Record<string, unknown> | undefined;
        const occurredAt = typeof item.lastModifiedDateTime === "string" ? item.lastModifiedDateTime : now;
        events.push(Object.freeze({
          connectorId: "sharepoint-onedrive",
          connectorInstanceId: input.instance.id,
          workspaceId: input.instance.workspaceId,
          deliveryId: `graph-drive:${id}:${String(item.eTag ?? occurredAt)}:${deleted ? "deleted" : "upsert"}`,
          externalId: `graph-drive:${this.#driveId}:${id}`,
          eventType: deleted ? "delete" : "upsert",
          occurredAt,
          sourceHash: null,
          title: typeof item.name === "string" ? item.name : id,
          mimeType: typeof file?.mimeType === "string" ? file.mimeType : null,
          content: null,
          classification: "private",
          acl: deleted ? [] : graphAcl(permissions),
          providerCursor: page["@odata.nextLink"] ?? page["@odata.deltaLink"] ?? null,
          metadata: { driveId: this.#driveId, webUrl: item.webUrl ?? null, eTag: item.eTag ?? null, bodyPending: !deleted },
        }));
      }
      const token = page["@odata.nextLink"] ?? page["@odata.deltaLink"] ?? endpoint;
      return {
        events,
        nextCursor: encodeCursor({ connectorInstanceId: input.instance.id, previous: input.cursor, envelope: { mode: "graph_drive_delta", token }, providerRevision: events.at(-1)?.occurredAt ?? null, now }),
      };
    } catch (error) {
      throw connectorFailure("Microsoft Graph drive", error);
    }
  }
}

export class MicrosoftTeamsConnectorAdapter implements ConnectorAdapter {
  readonly manifest = CONNECTOR_MANIFESTS["microsoft-teams"];
  readonly #accessToken: string | null;
  readonly #teamId: string;
  readonly #channelIds: readonly string[];
  readonly #client: MicrosoftGraphClient | null;

  constructor(options: { accessToken?: string | null; teamId: string; channelIds: readonly string[] }) {
    this.#accessToken = options.accessToken?.trim() || null;
    this.#teamId = options.teamId.trim();
    this.#channelIds = [...new Set(options.channelIds.map((id) => id.trim()).filter(Boolean))].sort();
    this.#client = graphClient(this.#accessToken);
  }

  status(): Readonly<{ ready: boolean; reason: string | null }> {
    if (!this.#accessToken) return { ready: false, reason: "Microsoft Graph access token is not configured." };
    if (!this.#teamId || this.#channelIds.length === 0) return { ready: false, reason: "Microsoft team and channel IDs are required." };
    return { ready: true, reason: null };
  }

  async sync(input: {
    instance: ConnectorInstance;
    cursor: SyncCursor | null;
    signal: AbortSignal;
  }): Promise<Readonly<{ events: readonly NormalizedSourceEvent[]; nextCursor: SyncCursor | null }>> {
    assertSyncable(input.instance, "microsoft-teams");
    requireCredential("Microsoft Graph", this.#accessToken);
    if (!this.#client || !this.#teamId || this.#channelIds.length === 0) {
      throw new ConnectorError("CONNECTOR_NOT_CONFIGURED", "Microsoft Teams sync is not configured.", 503, false);
    }
    const cursor = decodeCursor(input.cursor, ["graph_teams_messages"]);
    const index = Math.min(cursor?.index ?? 0, this.#channelIds.length - 1);
    const channelId = this.#channelIds[index];
    const endpoint = cursor?.token ?? `/teams/${encodeURIComponent(this.#teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=50`;
    const now = new Date().toISOString();
    try {
      const page = await this.#client.api(endpoint).options({ signal: input.signal }).get() as GraphPage;
      const events = (page.value ?? []).flatMap((message): NormalizedSourceEvent[] => {
        const id = typeof message.id === "string" ? message.id : null;
        if (!id) return [];
        const body = message.body as Record<string, unknown> | undefined;
        const deleted = typeof message.deletedDateTime === "string";
        const content = deleted || typeof body?.content !== "string" ? null : body.content;
        const occurredAt = typeof message.lastModifiedDateTime === "string"
          ? message.lastModifiedDateTime
          : typeof message.createdDateTime === "string" ? message.createdDateTime : now;
        return [Object.freeze({
          connectorId: "microsoft-teams",
          connectorInstanceId: input.instance.id,
          workspaceId: input.instance.workspaceId,
          deliveryId: `graph-teams:${this.#teamId}:${channelId}:${id}:${occurredAt}`,
          externalId: `graph-teams:${this.#teamId}:${channelId}:${id}`,
          eventType: deleted ? "delete" : "upsert",
          occurredAt,
          sourceHash: content === null ? null : createHash("sha256").update(content).digest("hex"),
          title: `Teams · ${channelId} · ${id}`,
          mimeType: typeof body?.contentType === "string" ? `text/${body.contentType}` : "text/html",
          content,
          classification: "private",
          acl: [`microsoft:team:${this.#teamId}`, `microsoft:channel:${channelId}`],
          providerCursor: page["@odata.nextLink"] ?? null,
          metadata: { teamId: this.#teamId, channelId, sender: message.from ?? null },
        })];
      });
      const nextLink = page["@odata.nextLink"] ?? null;
      const nextIndex = nextLink ? index : (index + 1) % this.#channelIds.length;
      return {
        events,
        nextCursor: encodeCursor({ connectorInstanceId: input.instance.id, previous: input.cursor, envelope: { mode: "graph_teams_messages", token: nextLink, index: nextIndex }, providerRevision: events.at(-1)?.occurredAt ?? null, now }),
      };
    } catch (error) {
      throw connectorFailure("Microsoft Teams", error);
    }
  }
}
