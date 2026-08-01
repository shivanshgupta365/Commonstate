import { productGet, productPatch, productPost } from "../../../../lib/product/api";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return productGet(request, (await context.params).path);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return productPost(request, (await context.params).path);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return productPatch(request, (await context.params).path);
}
