import { createHmac } from "node:crypto";

/**
 * Derive an isolated connector signing secret from a deployment master secret.
 * The master value is never accepted from a request or stored on the connector.
 */
export function deriveWebhookSigningSecret(input: {
  masterSecret: string;
  organizationId: string;
  workspaceId: string;
  connectorId: string;
}): string {
  if (!input.masterSecret.trim()) throw new Error("Webhook master secret is required.");
  return createHmac("sha256", input.masterSecret)
    .update(
      `commonstate-webhook:v1:${input.organizationId}:${input.workspaceId}:${input.connectorId}`,
    )
    .digest("base64url");
}
