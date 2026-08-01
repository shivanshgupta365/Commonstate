import { healthResponse } from "../../../lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return healthResponse();
}
