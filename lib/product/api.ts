import { resolveCommandContext, resolveProductSession } from "./auth";
import { ProductError } from "./errors";
import {
  pageLimit,
  productFailure,
  productSuccess,
  readJson,
  requestId,
  requireIdempotencyKey,
} from "./http";
import {
  createConnector,
  createServiceAccount,
  executeWorkspaceCommand,
  getProductState,
  listProductResource,
  listSolutionPacks,
  productCapabilities,
  provisionWorkspace,
  publishConfiguration,
  saveConfigurationDraft,
  searchSourceEvidence,
} from "./repository";
import { completeSourceUpload, createSourceUpload } from "./storage";

function normalizedPath(path: string[]): string[] {
  return path.map((segment) => decodeURIComponent(segment)).filter(Boolean);
}

async function productJobStream(
  context: Awaited<ReturnType<typeof resolveCommandContext>>,
  request: Request,
): Promise<Response> {
  const initial = await listProductResource(context, "jobs", null, 100);
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let polling = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: string, data: unknown) => {
        if (!closed) {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (deadline) clearTimeout(deadline);
        controller.close();
      };
      write("snapshot", initial);
      interval = setInterval(() => {
        if (polling || closed) return;
        polling = true;
        void listProductResource(context, "jobs", null, 100)
          .then((page) => write("snapshot", page))
          .catch(() => {
            write("error", { code: "STREAM_UNAVAILABLE", message: "Job progress is temporarily unavailable." });
            close();
          })
          .finally(() => {
            polling = false;
          });
      }, 1_000);
      deadline = setTimeout(close, 25_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
      if (deadline) clearTimeout(deadline);
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store, max-age=0",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}

export async function productGet(request: Request, rawPath: string[]): Promise<Response> {
  const fallbackRequestId = requestId(request);
  try {
    const path = normalizedPath(rawPath);
    if (path.length === 0) {
      return productSuccess(fallbackRequestId, {
        name: "Commonstate API",
        version: "v1",
        documentation: "/api/v1/capabilities",
      });
    }
    if (path[0] === "templates" && path.length === 1) {
      return productSuccess(fallbackRequestId, { items: listSolutionPacks() });
    }
    if (path[0] === "capabilities" && path.length === 1) {
      return productSuccess(fallbackRequestId, await productCapabilities());
    }
    if (path[0] === "session" && path.length === 1) {
      const session = await resolveProductSession(request);
      return productSuccess(fallbackRequestId, session);
    }
    if (path[0] === "organizations" && path.length === 1) {
      const session = await resolveProductSession(request);
      const organizations = Array.from(
        new Map(
          session.memberships.map((membership) => [
            membership.organization.id,
            membership.organization,
          ]),
        ).values(),
      );
      return productSuccess(fallbackRequestId, { items: organizations });
    }
    if (path[0] === "workspaces" && path.length === 1) {
      const session = await resolveProductSession(request);
      return productSuccess(fallbackRequestId, {
        items: session.memberships.map((membership) => ({
          ...membership.workspace,
          organization: membership.organization,
          role: membership.role,
        })),
      });
    }
    if (path[0] === "workspaces" && path.length >= 3) {
      const workspaceSlug = path[1] ?? "";
      const resource = path[2] ?? "";
      const context = await resolveCommandContext(request, workspaceSlug);
      if (resource === "state" && path.length === 3) {
        return productSuccess(context.requestId, await getProductState(context));
      }
      if (resource === "configuration" && path.length === 3) {
        const state = await getProductState(context);
        return productSuccess(context.requestId, {
          profile: state.profile,
          configuration: state.configuration,
        });
      }
      if (resource === "jobs" && path[3] === "stream" && path.length === 4) {
        return productJobStream(context, request);
      }
      if (path.length === 3) {
        const url = new URL(request.url);
        const page = await listProductResource(
          context,
          resource,
          url.searchParams.get("cursor"),
          pageLimit(url),
        );
        return productSuccess(context.requestId, page);
      }
    }
    throw new ProductError("NOT_FOUND", "API resource was not found.", 404);
  } catch (error) {
    return productFailure(error, fallbackRequestId);
  }
}

export async function productPost(request: Request, rawPath: string[]): Promise<Response> {
  const fallbackRequestId = requestId(request);
  try {
    const path = normalizedPath(rawPath);
    const input = await readJson(request);
    if (path[0] === "organizations" && path.length === 1) {
      const session = await resolveProductSession(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const result = await provisionWorkspace(session.principal, input, idempotencyKey);
      return productSuccess(fallbackRequestId, result, 201);
    }
    if (path[0] === "workspaces" && path.length >= 3) {
      const workspaceSlug = path[1] ?? "";
      const resource = path[2] ?? "";
      const context = await resolveCommandContext(request, workspaceSlug);
      if (resource === "commands" && path[3]) {
        const idempotencyKey = requireIdempotencyKey(request);
        const result = await executeWorkspaceCommand(
          context,
          path[3],
          input,
          idempotencyKey,
        );
        return productSuccess(context.requestId, {
          command: path[3],
          result,
          state: await getProductState(context),
        });
      }
      if (resource === "configuration" && path[3] === "publish") {
        const idempotencyKey = requireIdempotencyKey(request);
        const result = await publishConfiguration(context, input, idempotencyKey);
        return productSuccess(context.requestId, {
          result,
          state: await getProductState(context),
        });
      }
      if (resource === "connectors" && path.length === 3) {
        const idempotencyKey = requireIdempotencyKey(request);
        const result = await createConnector(context, input, idempotencyKey);
        return productSuccess(context.requestId, {
          result,
          state: await getProductState(context),
        }, 201);
      }
      if (resource === "service-accounts" && path.length === 3) {
        const idempotencyKey = requireIdempotencyKey(request);
        return productSuccess(
          context.requestId,
          await createServiceAccount(context, input, idempotencyKey),
          201,
        );
      }
      if (resource === "search" && path.length === 3) {
        const query = typeof input.query === "string" ? input.query : "";
        const embedding = Array.isArray(input.embedding)
          ? input.embedding.filter((value): value is number => typeof value === "number")
          : null;
        const limit = typeof input.limit === "number" ? input.limit : 12;
        return productSuccess(
          context.requestId,
          { items: await searchSourceEvidence(context, query, embedding, limit) },
        );
      }
      if (resource === "sources" && path[3] === "upload-url" && path.length === 4) {
        const result = await createSourceUpload(
          context,
          input,
          requireIdempotencyKey(request),
        );
        return productSuccess(context.requestId, { result }, 201);
      }
      if (resource === "sources" && path[3] === "upload-complete" && path.length === 4) {
        const result = await completeSourceUpload(
          context,
          input,
          requireIdempotencyKey(request),
        );
        return productSuccess(context.requestId, { result }, 202);
      }
      if (resource === "ingest" && path[3] === "file") {
        const idempotencyKey = requireIdempotencyKey(request);
        const result = await executeWorkspaceCommand(
          context,
          "ingest",
          {
            scopeId: input.scopeId,
            source: {
              sourceKey: input.sourceKey,
              title: input.filename ?? input.title,
              type: "file",
              classification: input.classification,
              content: input.content,
              uri: input.uri,
              acl: input.acl,
            },
            claims: input.claims,
          },
          idempotencyKey,
        );
        return productSuccess(context.requestId, {
          result,
          state: await getProductState(context),
        }, 201);
      }
      if (resource === "actions" && path.length === 3) {
        const idempotencyKey = requireIdempotencyKey(request);
        const result = await executeWorkspaceCommand(
          context,
          "propose-action",
          input,
          idempotencyKey,
        );
        return productSuccess(context.requestId, { result }, 201);
      }
    }
    throw new ProductError("NOT_FOUND", "API resource was not found.", 404);
  } catch (error) {
    return productFailure(error, fallbackRequestId);
  }
}

export async function productPatch(request: Request, rawPath: string[]): Promise<Response> {
  const fallbackRequestId = requestId(request);
  try {
    const path = normalizedPath(rawPath);
    const input = await readJson(request);
    if (
      path[0] === "workspaces" &&
      path[1] &&
      path[2] === "configuration" &&
      path[3] === "draft"
    ) {
      const context = await resolveCommandContext(request, path[1]);
      const result = await saveConfigurationDraft(
        context,
        input,
        requireIdempotencyKey(request),
      );
      return productSuccess(context.requestId, {
        result,
        state: await getProductState(context),
      });
    }
    throw new ProductError("NOT_FOUND", "API resource was not found.", 404);
  } catch (error) {
    return productFailure(error, fallbackRequestId);
  }
}
