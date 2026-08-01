import { productGet } from "../../../lib/product/api";

export function GET(request: Request): Promise<Response> {
  return productGet(request, []);
}
