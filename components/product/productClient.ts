import type { CandidateStatus, DecisionCandidate, TemplateId } from "@/lib/product/templates";

export type ProductApiError = {
  code: string;
  message: string;
  details?: unknown;
  status?: number;
};

export type ProductApiSuccess<T> = {
  ok: true;
  data: T;
  meta: { requestId: string };
};

export type ProductApiFailure = {
  ok: false;
  error: ProductApiError;
  meta?: { requestId: string };
};

export type ProductApiResult<T> = ProductApiSuccess<T> | ProductApiFailure;
export type ProductCommandApiResult<T> = (ProductApiSuccess<T> & { state?: ProductWorkspaceState }) | ProductApiFailure;

export type WorkspaceProfile = {
  organizationName: string;
  workspaceName: string;
  slug: string;
  templateId: TemplateId;
  accent: string;
  locale: string;
  timezone: string;
  currency: string;
  kind: "production" | "demo";
};

export type ProductWorkspaceState = {
  workspace: Record<string, unknown> & { id?: string; slug?: string; name?: string; kind?: string };
  profile?: Partial<WorkspaceProfile> & {
    templateKey?: TemplateId;
    setupStatus?: string;
    accentColor?: string;
    publishedConfigurationVersion?: number | null;
    killSwitchEnabled?: boolean;
  };
  configuration?: Record<string, unknown> & {
    template?: TemplateId;
    templateId?: TemplateId;
    version?: number;
    status?: string;
    branding?: Record<string, unknown>;
    scopeKinds?: Array<Record<string, unknown>>;
    entityKinds?: Array<Record<string, unknown>>;
    authorityRules?: Array<Record<string, unknown>>;
    approvalPolicies?: Array<Record<string, unknown>>;
  };
  metrics?: Array<{ label: string; value: string | number; delta?: string; tone?: string; unit?: string }>;
  scopes?: Array<Record<string, unknown> & { id?: string; name?: string; kind?: string }>;
  sources?: Array<Record<string, unknown> & { id?: string; title?: string }>;
  entities?: Array<Record<string, unknown> & { id?: string; name?: string; type?: string }>;
  relationships?: Array<Record<string, unknown>>;
  claims?: Array<Record<string, unknown> & { id?: string; subject?: string; predicate?: string; lifecycle?: string }>;
  conflicts?: Array<Record<string, unknown> & { id?: string; status?: string; risk?: string }>;
  agents?: Array<Record<string, unknown> & { id?: string; name?: string; status?: string }>;
  runs?: Array<Record<string, unknown> & { id?: string; status?: string; createdAt?: string }>;
  actions?: Array<Record<string, unknown> & { id?: string; status?: string; riskTier?: string }>;
  outcomes?: Array<Record<string, unknown> & { id?: string; status?: string }>;
  evals?: Array<Record<string, unknown>> | { passed?: number; total?: number; results?: Array<Record<string, unknown>> };
};

export type AskCommandResult = {
  answer?: string;
  candidates?: DecisionCandidate[];
  citations?: Array<{ claimId: string; evidenceId?: string; title?: string }>;
  contextPack?: { versionHash?: string; facts?: unknown[]; blockers?: unknown[] };
  asOf?: string;
};

export type ProductCommand =
  | "ask"
  | "ingest"
  | "approve"
  | "reject"
  | "run-agent"
  | "replay"
  | "outcome"
  | "propose-action"
  | "approve-action"
  | "publish-configuration";

function apiFailure(code: string, message: string, status?: number, details?: unknown): ProductApiFailure {
  return { ok: false, error: { code, message, status, details } };
}

async function parseResponse<T>(response: Response): Promise<ProductApiResult<T>> {
  const payload = await response.json().catch(() => null) as ProductApiResult<T> | null;
  if (payload && typeof payload === "object" && "ok" in payload) {
    if (!payload.ok) payload.error.status = response.status;
    return payload;
  }
  return apiFailure(
    "INVALID_RESPONSE",
    "Commonstate returned a response the product client could not understand.",
    response.status,
  );
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<ProductApiResult<T>> {
  try {
    const response = await fetch(input, {
      ...init,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    return parseResponse<T>(response);
  } catch (error) {
    return apiFailure(
      "NETWORK_ERROR",
      "The authenticated workspace API could not be reached. No recorded data was substituted.",
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function getProductSession() {
  return request<{ authenticated: boolean; principal?: Record<string, unknown>; workspaces?: Array<Record<string, unknown>> }>(
    "/api/v1/session",
  );
}

export async function getProductTemplates() {
  return request<{ items: Array<{ id: TemplateId; name: string; configuration: Record<string, unknown> }> }>("/api/v1/templates");
}

export async function getWorkspaceState(workspaceSlug: string) {
  return request<ProductWorkspaceState>(`/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/state`);
}

export async function createProductWorkspace(input: Record<string, unknown>) {
  const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `setup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return request<{ organization: { id: string; slug: string; name: string }; workspace: { id: string; slug: string; name: string } }>(
    "/api/v1/organizations",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export async function requestEmailOtp(email: string) {
  return request<{ sent: boolean; message: string }>("/api/v1/auth/otp", {
    method: "POST",
    body: JSON.stringify({ email, next: "/setup" }),
  });
}

export async function requestGoogleOAuth() {
  return request<{ url: string; provider: "google" }>("/api/v1/auth/oauth", {
    method: "POST",
    body: JSON.stringify({ provider: "google", next: "/setup" }),
  });
}

export async function requestEnterpriseSso(domain: string) {
  return request<{ url: string; provider: "enterprise-sso" }>("/api/v1/auth/sso", {
    method: "POST",
    body: JSON.stringify({ domain, next: "/setup" }),
  });
}

export async function signOutProduct() {
  return request<{ signedOut: boolean }>("/api/v1/auth/signout", {
    method: "POST",
  });
}

export async function executeWorkspaceCommand<T>(
  workspaceSlug: string,
  command: ProductCommand,
  input: Record<string, unknown> = {},
): Promise<ProductCommandApiResult<T>> {
  const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await request<{ command: string; result: T; state?: ProductWorkspaceState }>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/commands/${command}`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return response;
  return { ok: true, data: response.data.result, meta: response.meta, ...(response.data.state ? { state: response.data.state } : {}) };
}

export async function saveWorkspaceConfigurationDraft(
  workspaceSlug: string,
  configuration: Record<string, unknown>,
) {
  const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `config-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return request<{ result: Record<string, unknown>; state: ProductWorkspaceState }>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/configuration/draft`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ configuration }),
    },
  );
}

export async function publishWorkspaceConfiguration(workspaceSlug: string, expectedVersion: number) {
  const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `config-publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return request<{ result: Record<string, unknown>; state: ProductWorkspaceState }>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/configuration/publish`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ expectedVersion }),
    },
  );
}

export function normalizeCandidates(value: unknown): DecisionCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DecisionCandidate[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.entityId !== "string" || typeof item.name !== "string") return [];
    const status: CandidateStatus = item.status === "eligible" || item.status === "blocked" || item.status === "review"
      ? item.status
      : "review";
    const facts = Array.isArray(item.facts)
      ? item.facts.flatMap((fact) => {
          if (!fact || typeof fact !== "object") return [];
          const typed = fact as Record<string, unknown>;
          return typeof typed.label === "string" && typeof typed.value === "string"
            ? [{ label: typed.label, value: typed.value }]
            : [];
        })
      : [];
    return [{
      entityId: item.entityId,
      name: item.name,
      ...(typeof item.subtitle === "string" ? { subtitle: item.subtitle } : {}),
      status,
      ...(typeof item.score === "number" ? { score: item.score } : {}),
      facts,
      reason: typeof item.reason === "string" ? item.reason : "Returned by the current workspace policy.",
      evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.filter((id): id is string => typeof id === "string") : [],
    }];
  });
}
