import { acceptSignedWebhook, ConnectorError } from "../../packages/connectors/src";
import { ProductError } from "./errors";
import { productFailure, productSuccess, requestId } from "./http";
import {
  applyConnectorControlEvent,
  executeWorkspaceCommand,
  resolveWebhookConnector,
} from "./repository";
import { PRODUCT_PERMISSIONS, systemClock, type CommandContext } from "./types";
import { deriveWebhookSigningSecret } from "./webhook-secret";

export async function receiveConnectorWebhook(
  request: Request,
  connectorId: string,
): Promise<Response> {
  const id = requestId(request);
  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 64 * 1024) {
      throw new ProductError("PAYLOAD_TOO_LARGE", "Webhook body must be 64KB or smaller.", 413);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
      throw new ProductError("PAYLOAD_TOO_LARGE", "Webhook body must be 64KB or smaller.", 413);
    }
    const binding = await resolveWebhookConnector(connectorId);
    const secretEnv =
      typeof binding.connector.configuration.secretEnv === "string" &&
      /^[A-Z][A-Z0-9_]{2,100}$/.test(binding.connector.configuration.secretEnv)
        ? binding.connector.configuration.secretEnv
        : "COMMONSTATE_WEBHOOK_SECRET";
    const masterSecret = process.env[secretEnv];
    if (!masterSecret) {
      throw new ProductError(
        "CONNECTOR_UNAVAILABLE",
        `Webhook secret ${secretEnv} is not configured for this deployment.`,
        503,
      );
    }
    const secret = deriveWebhookSigningSecret({
      masterSecret,
      organizationId: binding.organizationId,
      workspaceId: binding.workspaceId,
      connectorId: binding.connector.id,
    });
    const signature = request.headers.get("x-commonstate-signature") ?? "";
    const timestamp = request.headers.get("x-commonstate-timestamp") ?? "";
    const deliveryId = request.headers.get("x-commonstate-delivery-id") ?? "";
    const accepted = await acceptSignedWebhook({
      connectorInstance: {
        id: binding.connector.id,
        organizationId: binding.organizationId,
        workspaceId: binding.workspaceId,
        connector: "webhook",
        status: "active",
        createdAt: binding.connector.createdAt,
        revokedAt: null,
      },
      rawBody,
      signature,
      timestamp,
      deliveryId,
      secret,
      idempotency: { claim: async () => true },
    });
    if (!accepted.event) {
      return productSuccess(id, { duplicate: true, event: null });
    }
    const event = accepted.event;
    const context: CommandContext = {
      principal: {
        type: "system",
        principalId: `webhook:${binding.connector.id}`,
        actorId: `actor:webhook:${binding.connector.id}`,
      },
      organizationId: binding.organizationId,
      workspaceId: binding.workspaceId,
      workspaceSlug: binding.workspaceSlug,
      allowedScopeIds: [binding.scopeId],
      permissions: [
        PRODUCT_PERMISSIONS.read,
        PRODUCT_PERMISSIONS.ingest,
        PRODUCT_PERMISSIONS.proposeClaims,
      ],
      requestId: id,
      authenticatedAt: null,
      clock: systemClock,
    };
    const result = event.eventType === "upsert"
      ? await executeWorkspaceCommand(
          context,
          "ingest",
          {
            scopeId: binding.scopeId,
            source: {
              sourceKey: `connector:${binding.connector.id}:${event.externalId}`,
              title: event.title,
              type: "webhook",
              classification: event.classification,
              content: event.content,
              acl: event.acl,
              occurredAt: event.occurredAt,
            },
            claims: [],
          },
          deliveryId,
        )
      : await applyConnectorControlEvent(context, {
          connectorId: binding.connector.id,
          externalId: event.externalId,
          eventType: event.eventType,
          acl: [...event.acl],
          occurredAt: event.occurredAt,
          deliveryId,
        });
    return productSuccess(id, {
      duplicate: false,
      event: { type: event.eventType, externalId: event.externalId, deliveryId },
      result,
    }, 202);
  } catch (error) {
    if (error instanceof ConnectorError) {
      const mapped = new ProductError(
        error.code === "CONNECTOR_API_FAILURE" ? "CONNECTOR_UNAVAILABLE" : "UNAUTHENTICATED",
        error.message,
        error.status,
        { retryable: error.retryable },
      );
      return productFailure(mapped, id);
    }
    return productFailure(error, id);
  }
}
