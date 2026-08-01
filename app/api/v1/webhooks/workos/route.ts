import { workosDirectoryWebhook } from "../../../../../lib/product/workos-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return workosDirectoryWebhook(request);
}
