import { receiveConnectorWebhook } from "../../../../../lib/product/webhook";

type RouteContext = { params: Promise<{ connectorId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return receiveConnectorWebhook(request, (await context.params).connectorId);
}
