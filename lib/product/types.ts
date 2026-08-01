export type PrincipalType = "user" | "service_account" | "system";

export type Clock = {
  now(): Date;
};

export const systemClock: Clock = Object.freeze({
  now: () => new Date(),
});

export type CommandContext = {
  principal: {
    type: PrincipalType;
    principalId: string;
    actorId: string;
  };
  organizationId: string;
  workspaceId: string;
  workspaceSlug: string;
  allowedScopeIds: string[];
  permissions: string[];
  requestId: string;
  authenticatedAt: string | null;
  clock: Clock;
};

export type AuthenticatedPrincipal = {
  type: "user" | "service_account";
  principalId: string;
  actorId: string;
  email: string | null;
  displayName: string;
  permissions?: string[];
  allowedScopeIds?: string[];
  workspaceId?: string;
  organizationId?: string;
  authenticatedAt?: string | null;
};

export type DecisionCandidate = {
  entityId: string;
  name: string;
  subtitle?: string;
  status: "eligible" | "blocked" | "review";
  score?: number;
  facts: Array<{ label: string; value: string; tone?: string }>;
  reason: string;
  evidenceIds: string[];
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export const PRODUCT_PERMISSIONS = Object.freeze({
  read: "workspace:read",
  configure: "workspace:configure",
  members: "workspace:members",
  ingest: "sources:ingest",
  proposeClaims: "claims:propose",
  approveClaims: "claims:approve",
  runAgents: "agents:run",
  proposeActions: "actions:propose",
  approveActions: "actions:approve",
  executeActions: "actions:execute",
  audit: "audit:read",
  serviceAccounts: "service_accounts:manage",
} as const);

export const OWNER_PERMISSIONS = Object.freeze(Object.values(PRODUCT_PERMISSIONS));

export type ProductState = {
  workspace: {
    id: string;
    slug: string;
    name: string;
    kind: string;
    status: string;
  };
  profile: {
    templateKey: string;
    setupStatus: string;
    logoUrl: string | null;
    accentColor: string;
    locale: string;
    timezone: string;
    currency: string;
    terminology: Record<string, string>;
    enabledSurfaces: string[];
    publishedConfigurationVersion: number | null;
    killSwitchEnabled: boolean;
  };
  configuration: Record<string, unknown>;
  metrics: Array<{ key: string; label: string; value: number; unit: string }>;
  scopes: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  entities: Array<Record<string, unknown>>;
  relationships: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  outcomes: Array<Record<string, unknown>>;
  evals: Array<Record<string, unknown>>;
};
