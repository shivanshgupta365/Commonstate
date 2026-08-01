import { createHash, createHmac } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, getProductDb, type CommonstateDb } from "../../db";
import {
  actionApprovals,
  actionProposals,
  actionReceipts,
  actors,
  agentRuns,
  approvals,
  auditEvents,
  claims,
  conflicts,
  connectors,
  contextPackEvidence,
  contextPacks,
  entities,
  evaluationResults,
  idempotencyRecords,
  jobs,
  memberships,
  organizations,
  outcomes,
  profiles,
  providerConfigurations,
  relationships,
  roles,
  runEvents,
  scopeGrants,
  scopes,
  serviceAccounts,
  solutionTemplates,
  sourceChunks,
  sourceEvents,
  sources,
  usageEvents,
  workspaceConfigurationVersions,
  workspaceProfiles,
  workspaces,
} from "../../db/schema";
import {
  SOLUTION_PACKS,
  assertValidWorkspaceConfiguration,
  getSolutionPack,
  type SolutionPackId,
  type WorkspaceConfiguration,
} from "../../packages/configuration/src";
import {
  CustomerSchemaError,
  CustomerSchemaValidator,
} from "../../packages/configuration/src/schema-validator";
import {
  classifyActionRisk,
  decideActionPolicy,
  type ActionApproval as PolicyActionApproval,
  type ActionProposal as PolicyActionProposal,
} from "../../packages/policy/src";
import { ProductError, isDatabaseUnavailable } from "./errors";
import { decodeCursor, encodeCursor, type JsonRecord } from "./http";
import {
  OWNER_PERMISSIONS,
  PRODUCT_PERMISSIONS,
  type AuthenticatedPrincipal,
  type CommandContext,
  type CursorPage,
  type ProductState,
} from "./types";

const customerSchemaValidator = new CustomerSchemaValidator();

type TransactionDb = Parameters<Parameters<CommonstateDb["transaction"]>[0]>[0];
type ProductDb = CommonstateDb | TransactionDb;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function deterministicId(kind: string, value: string): string {
  return `${kind}_${createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 24)}`;
}

function normalizedTimestamp(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new ProductError(
      "VALIDATION_ERROR",
      `${field} must be an ISO 8601 timestamp with an explicit UTC offset.`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ProductError("VALIDATION_ERROR", `${field} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

function validityWindowsOverlap(
  left: { validFrom: string; validTo: string | null },
  right: { validFrom: string; validTo: string | null },
): boolean {
  const leftStart = new Date(left.validFrom).getTime();
  const rightStart = new Date(right.validFrom).getTime();
  const leftEnd = left.validTo ? new Date(left.validTo).getTime() : Number.POSITIVE_INFINITY;
  const rightEnd = right.validTo ? new Date(right.validTo).getTime() : Number.POSITIVE_INFINITY;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function now(): string {
  return new Date().toISOString();
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52);
  return slug || fallback;
}

function templateId(value: unknown): SolutionPackId {
  const candidate = typeof value === "string" ? value : "ai-operations";
  if (!(candidate in SOLUTION_PACKS)) {
    throw new ProductError(
      "VALIDATION_ERROR",
      "Template must be ai-operations, enterprise-governance, agency-operations, or blank.",
    );
  }
  return candidate as SolutionPackId;
}

type NormalizedOnboarding = {
  scopeKinds: string[];
  entityTypes: string[];
  connectors: string[];
  requiredApprovers: number;
  lowRiskAutoExecution: boolean;
  managedProvider: "gemini" | "openai" | "anthropic";
};

function configurationKey(value: string, fallback: string): string {
  const key = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return /^[a-z]/.test(key) ? key : fallback;
}

function normalizedOnboarding(
  input: JsonRecord,
  base: WorkspaceConfiguration,
): NormalizedOnboarding {
  const raw = input.onboarding && typeof input.onboarding === "object" && !Array.isArray(input.onboarding)
    ? (input.onboarding as JsonRecord)
    : {};
  const uniqueLabels = (value: unknown, fallback: string[], max: number): string[] => {
    if (!Array.isArray(value)) return fallback;
    const result: string[] = [];
    for (const item of value) {
      if (typeof item !== "string") continue;
      const label = item.trim().slice(0, 60);
      if (label && !result.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
        result.push(label);
      }
      if (result.length >= max) break;
    }
    return result.length ? result : fallback;
  };
  const connectorMap: Record<string, string> = {
    upload: "file",
    file: "file",
    webhook: "webhook",
    slack: "slack",
    drive: "google-drive",
    "google-drive": "google-drive",
    teams: "microsoft-teams",
    "microsoft-teams": "microsoft-teams",
    sharepoint: "sharepoint-onedrive",
    "sharepoint-onedrive": "sharepoint-onedrive",
  };
  const configuredConnectors = Array.isArray(raw.connectors)
    ? Array.from(
        new Set(
          raw.connectors.flatMap((item) =>
            typeof item === "string" && connectorMap[item] ? [connectorMap[item]] : [],
          ),
        ),
      )
    : ["file", "webhook"];
  const requiredApprovers =
    typeof raw.requiredApprovers === "number" && Number.isInteger(raw.requiredApprovers)
      ? Math.max(1, Math.min(3, raw.requiredApprovers))
      : 2;
  const managedProvider = ["gemini", "openai", "anthropic"].includes(String(raw.managedProvider))
    ? (raw.managedProvider as NormalizedOnboarding["managedProvider"])
    : "gemini";
  return {
    scopeKinds: uniqueLabels(
      raw.scopeKinds,
      base.scopeKinds.map((item) => item.label),
      8,
    ),
    entityTypes: uniqueLabels(
      raw.entityTypes,
      base.entityKinds.map((item) => item.label),
      24,
    ),
    connectors: configuredConnectors,
    requiredApprovers,
    lowRiskAutoExecution: raw.lowRiskAutoExecution !== false,
    managedProvider,
  };
}

function customizedConfiguration(
  template: SolutionPackId,
  input: JsonRecord,
): WorkspaceConfiguration {
  const selected = getSolutionPack(template).configuration;
  const onboarding = normalizedOnboarding(input, selected);
  const branding = input.branding && typeof input.branding === "object"
    ? (input.branding as JsonRecord)
    : {};
  const configuredScopes = onboarding.scopeKinds.map((label, index, rows) => {
    const key = configurationKey(label, `scope_${index + 1}`);
    return {
      key,
      label,
      parentKinds: index === 0 ? [] : [configurationKey(rows[index - 1]!, `scope_${index}`)],
      root: index === 0,
    };
  });
  const configuredEntities = onboarding.entityTypes.map((label, index) => ({
    key: configurationKey(label, `entity_${index + 1}`),
    label,
    icon: "record",
    attributesSchema: { type: "object", additionalProperties: true },
  }));
  const configuredEntityKeys = new Set(configuredEntities.map((item) => item.key));
  const configuration: WorkspaceConfiguration = {
    ...selected,
    branding: {
      ...selected.branding,
      companyName:
        typeof branding.companyName === "string" && branding.companyName.trim()
          ? branding.companyName.trim()
          : typeof input.organizationName === "string" && input.organizationName.trim()
            ? input.organizationName.trim()
            : selected.branding.companyName,
      logoUrl: typeof branding.logoUrl === "string" ? branding.logoUrl : null,
      accent:
        typeof branding.accent === "string" ? branding.accent : selected.branding.accent,
      locale:
        typeof branding.locale === "string" ? branding.locale : selected.branding.locale,
      timezone:
        typeof branding.timezone === "string" ? branding.timezone : selected.branding.timezone,
      currency:
        typeof branding.currency === "string" ? branding.currency : selected.branding.currency,
    },
    scopeKinds: configuredScopes,
    entityKinds: configuredEntities,
    predicates: selected.predicates.filter((predicate) =>
      predicate.subjectKinds.every((subjectKind) => configuredEntityKeys.has(subjectKind)),
    ),
    agents: selected.agents.map((agent) => ({
      ...agent,
      allowedScopeKinds: configuredScopes.map((scope) => scope.key),
    })),
    approvalPolicies: selected.approvalPolicies.map((policy) =>
      policy.risk === "high"
        ? { ...policy, requiredApprovals: onboarding.requiredApprovers }
        : policy.risk === "low"
          ? {
              ...policy,
              executable: onboarding.lowRiskAutoExecution,
              requiredApprovals: onboarding.lowRiskAutoExecution ? 0 : 1,
            }
          : policy,
    ),
  };
  assertValidWorkspaceConfiguration(configuration);
  return Object.assign(configuration, { onboarding });
}

async function seedSolutionTemplates(db: ProductDb): Promise<void> {
  const timestamp = now();
  for (const definition of Object.values(SOLUTION_PACKS)) {
    const numericVersion = Number(definition.version.split(".")[0] ?? "1") || 1;
    await db
      .insert(solutionTemplates)
      .values({
        id: deterministicId("template", `${definition.id}:${definition.version}`),
        templateKey: definition.id,
        version: numericVersion,
        name: definition.name,
        category: definition.id,
        description: definition.description,
        definition: definition.configuration as unknown as Record<string, unknown>,
        evalDefinition: definition.configuration.evaluations as unknown as Array<
          Record<string, unknown>
        >,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing();
  }
}

export type ProvisionWorkspaceInput = JsonRecord & {
  organizationName?: string;
  organizationSlug?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  template?: SolutionPackId;
  publish?: boolean;
};

export async function provisionWorkspace(
  principal: AuthenticatedPrincipal,
  input: ProvisionWorkspaceInput,
  idempotencyKey: string,
): Promise<{ organization: typeof organizations.$inferSelect; workspace: typeof workspaces.$inferSelect }> {
  if (principal.type !== "user") {
    throw new ProductError("FORBIDDEN", "Service accounts cannot create organizations.", 403);
  }
  const organizationName =
    typeof input.organizationName === "string" && input.organizationName.trim()
      ? input.organizationName.trim().slice(0, 120)
      : "My company";
  const workspaceName =
    typeof input.workspaceName === "string" && input.workspaceName.trim()
      ? input.workspaceName.trim().slice(0, 120)
      : `${organizationName} Operations`;
  const orgSlugBase = slugify(
    typeof input.organizationSlug === "string" ? input.organizationSlug : organizationName,
    "company",
  );
  const workspaceSlugBase = slugify(
    typeof input.workspaceSlug === "string" ? input.workspaceSlug : workspaceName,
    "workspace",
  );
  const template = templateId(input.template);
  const configuration = customizedConfiguration(template, input);
  const onboarding = (configuration as unknown as { onboarding: NormalizedOnboarding }).onboarding;
  const seed = `${principal.principalId}:${idempotencyKey}`;
  const organizationId = deterministicId("org", seed);
  const workspaceId = deterministicId("ws", seed);
  const ownerRoleId = deterministicId("role", `${workspaceId}:owner`);
  const membershipId = deterministicId("membership", `${workspaceId}:${principal.principalId}`);
  const profileId = principal.principalId;
  const timestamp = now();
  const publish = input.publish === true;
  const rootScope = configuration.scopeKinds.find((item) => item.root);
  if (!rootScope) throw new ProductError("VALIDATION_ERROR", "Template has no root scope.");

  try {
    return await getDb().transaction(async (tx) => {
      await seedSolutionTemplates(tx);
      await tx
        .insert(profiles)
        .values({
          id: profileId,
          email: principal.email ?? `${profileId}@unknown.commonstate`,
          displayName: principal.displayName,
          status: "active",
          lastSeenAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: profiles.id,
          set: { displayName: principal.displayName, lastSeenAt: timestamp, updatedAt: timestamp },
        });

      const existing = await tx
        .select({ organization: organizations, workspace: workspaces })
        .from(workspaces)
        .innerJoin(organizations, eq(workspaces.organizationId, organizations.id))
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (existing[0]) return existing[0];

      let organizationSlug = orgSlugBase;
      let workspaceSlug = workspaceSlugBase;
      const [sameOrgSlug] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, organizationSlug))
        .limit(1);
      if (sameOrgSlug) organizationSlug = `${orgSlugBase}-${organizationId.slice(-6)}`;
      const [sameWorkspaceSlug] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, workspaceSlug))
        .limit(1);
      if (sameWorkspaceSlug) workspaceSlug = `${workspaceSlugBase}-${workspaceId.slice(-6)}`;

      const organizationValue = {
        id: organizationId,
        slug: organizationSlug,
        name: organizationName,
        deploymentMode: "shared",
        status: "active",
        billingMode: "manual_pilot",
        metadata: { provisioningKeyHash: hash(idempotencyKey) },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const workspaceValue = {
        id: workspaceId,
        organizationId,
        slug: workspaceSlug,
        name: workspaceName,
        edition: template,
        kind: "production",
        status: "active",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await tx.insert(organizations).values(organizationValue);
      await tx.insert(workspaces).values(workspaceValue);
      await tx.insert(roles).values({
        id: ownerRoleId,
        organizationId,
        workspaceId,
        roleKey: "owner",
        name: "Workspace owner",
        description: "Full private-beta workspace administration.",
        permissions: [...OWNER_PERMISSIONS],
        system: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await tx.insert(memberships).values({
        id: membershipId,
        organizationId,
        workspaceId,
        profileId,
        roleId: ownerRoleId,
        status: "active",
        provisionedBy: "commonstate",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      let parentScopeId: string | null = null;
      let rootScopeId = "";
      for (const [index, scopeKind] of configuration.scopeKinds.entries()) {
        const scopeId = deterministicId("scope", `${workspaceId}:${scopeKind.key}`);
        if (index === 0) rootScopeId = scopeId;
        await tx.insert(scopes).values({
          id: scopeId,
          workspaceId,
          parentScopeId,
          kind: scopeKind.key,
          name: index === 0 ? organizationName : `${scopeKind.label} workspace`,
          externalRef: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        parentScopeId = scopeId;
      }
      await tx.insert(scopeGrants).values({
        id: deterministicId("grant", `${workspaceId}:${principal.principalId}:root`),
        organizationId,
        workspaceId,
        principalType: "user",
        principalId: principal.principalId,
        scopeId: rootScopeId,
        permissions: [...OWNER_PERMISSIONS],
        constraints: { descendants: true },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await tx.insert(actors).values({
        id: `actor:${workspaceId}:${principal.principalId}`,
        workspaceId,
        actorType: "human",
        displayName: principal.displayName,
        email: principal.email,
        role: "owner",
        permissions: [...OWNER_PERMISSIONS],
        writeBudget: 10_000,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      for (const agent of configuration.agents) {
        await tx.insert(actors).values({
          id: deterministicId("actor", `${workspaceId}:${agent.key}`),
          workspaceId,
          actorType: "agent",
          displayName: agent.name,
          email: null,
          role: agent.key,
          permissions: [...agent.allowedTools],
          writeBudget: agent.writeBudget,
          active: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      await tx.insert(workspaceProfiles).values({
        workspaceId,
        organizationId,
        templateKey: template,
        setupStatus: publish ? "published" : "draft",
        logoUrl: configuration.branding.logoUrl,
        accentColor: configuration.branding.accent,
        locale: configuration.branding.locale,
        timezone: configuration.branding.timezone,
        currency: configuration.branding.currency,
        terminology: configuration.terminology as unknown as Record<string, string>,
        enabledSurfaces: [...configuration.enabledSurfaces],
        draftConfiguration: configuration as unknown as Record<string, unknown>,
        publishedConfigurationVersion: publish ? 1 : null,
        killSwitchEnabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      for (const connectorType of onboarding.connectors) {
        await tx.insert(connectors).values({
          id: deterministicId("connector", `${workspaceId}:${connectorType}`),
          organizationId,
          workspaceId,
          connectorType,
          name: connectorType === "file"
            ? "File upload"
            : connectorType === "webhook"
              ? "Signed webhook"
              : connectorType,
          status: connectorType === "file" || connectorType === "webhook"
            ? "configured"
            : "disconnected",
          externalTenantRef: null,
          configuration: {
            provisionedFromSetup: true,
            oauthRequired: !["file", "webhook"].includes(connectorType),
            scopeId: rootScopeId,
            ...(connectorType === "webhook"
              ? { secretEnv: "COMMONSTATE_WEBHOOK_SECRET" }
              : {}),
          },
          encryptedCredentialRef: null,
          cursor: {},
          sourceAclMode: "mirror",
          executionEnabled: false,
          lastSyncAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      const providerModels: Record<NormalizedOnboarding["managedProvider"], string> = {
        gemini: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
        openai: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
        anthropic: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
      };
      await tx.insert(providerConfigurations).values({
        id: deterministicId("provider", `${workspaceId}:${onboarding.managedProvider}`),
        organizationId,
        workspaceId,
        provider: onboarding.managedProvider,
        credentialMode: "managed",
        encryptedCredentialRef: null,
        model: providerModels[onboarding.managedProvider],
        fallbackOrder: 0,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      if (publish) {
        await tx.insert(workspaceConfigurationVersions).values({
          id: deterministicId("config", `${workspaceId}:1`),
          organizationId,
          workspaceId,
          version: 1,
          status: "published",
          templateKey: template,
          templateVersion: 1,
          ontology: {
            scopeKinds: configuration.scopeKinds,
            entityKinds: configuration.entityKinds,
            predicates: configuration.predicates,
          },
          policy: {
            authorityRules: configuration.authorityRules,
            approvalPolicies: configuration.approvalPolicies,
            evaluations: configuration.evaluations,
            onboarding,
          },
          branding: configuration.branding,
          agents: configuration.agents as unknown as Array<Record<string, unknown>>,
          outcomes: configuration.metrics as unknown as Array<Record<string, unknown>>,
          configHash: hash({ configuration, onboarding }),
          createdByPrincipalId: principal.principalId,
          publishedAt: timestamp,
          createdAt: timestamp,
        });
      }
      await writeAudit(tx, {
        organizationId,
        workspaceId,
        requestId: `provision:${hash(idempotencyKey).slice(0, 16)}`,
        principalType: principal.type,
        principalId: principal.principalId,
        action: "workspace.provisioned",
        resourceType: "workspace",
        resourceId: workspaceId,
        policyDecision: "allow",
        afterHash: hash(workspaceValue),
        metadata: { template, publish, onboarding },
      });
      return { organization: organizationValue, workspace: workspaceValue };
    });
  } catch (error) {
    if (error instanceof ProductError) throw error;
    if (isDatabaseUnavailable(error)) {
      throw new ProductError("STORAGE_UNAVAILABLE", "PostgreSQL storage is unavailable.", 503);
    }
    throw error;
  }
}

export async function ensureLocalBootstrap(principal: AuthenticatedPrincipal): Promise<void> {
  const db = getDb();
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.profileId, principal.principalId), eq(memberships.status, "active")))
    .limit(1);
  if (membership) return;
  await provisionWorkspace(
    principal,
    {
      organizationName: "Northstar Systems",
      workspaceName: "Northstar AI Operations",
      organizationSlug: "northstar-local",
      workspaceSlug: "northstar-ai-operations",
      template: "ai-operations",
      publish: true,
    },
    "commonstate-local-private-beta-v1",
  );
}

async function setTenantContext(tx: TransactionDb, context: CommandContext): Promise<void> {
  await tx.execute(
    sql`select set_config('commonstate.organization_id', ${context.organizationId}, true), set_config('commonstate.workspace_id', ${context.workspaceId}, true), set_config('commonstate.principal_id', ${context.principal.principalId}, true)`,
  );
}

async function withTenant<T>(
  context: CommandContext,
  operation: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  try {
    return await getProductDb().transaction(async (tx) => {
      await setTenantContext(tx, context);
      return operation(tx);
    });
  } catch (error) {
    if (error instanceof ProductError) throw error;
    if (isDatabaseUnavailable(error)) {
      throw new ProductError("STORAGE_UNAVAILABLE", "PostgreSQL storage is unavailable.", 503);
    }
    throw error;
  }
}

type AuditInput = Omit<typeof auditEvents.$inferInsert, "id" | "createdAt">;

async function writeAudit(db: ProductDb, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    ...input,
    createdAt: now(),
  });
}

function assertWorkspace(context: CommandContext, workspaceId: string): void {
  if (workspaceId !== context.workspaceId) {
    throw new ProductError("FORBIDDEN", "Workspace boundary violation.", 403);
  }
}

function scopeVisible(context: CommandContext, scopeId: string | null): boolean {
  return !scopeId || context.allowedScopeIds.includes(scopeId);
}

function claimVisible(
  context: CommandContext,
  claim: { scopeId: string; acl: string[]; classification: string },
): boolean {
  if (!scopeVisible(context, claim.scopeId)) return false;
  if (claim.classification === "public") return true;
  return (
    claim.acl.includes("workspace") ||
    claim.acl.includes(context.principal.principalId) ||
    claim.acl.includes(context.principal.actorId) ||
    claim.acl.some((entry) => context.allowedScopeIds.includes(entry))
  );
}

function contextPackVisible(
  context: CommandContext,
  pack: Pick<typeof contextPacks.$inferSelect, "scopeId" | "constraints" | "citations">,
  visibleClaimIds: ReadonlySet<string>,
): boolean {
  if (!scopeVisible(context, pack.scopeId)) return false;
  const evidenceVisible = pack.citations.every(
    (citation) =>
      typeof citation.claimId === "string" && visibleClaimIds.has(citation.claimId),
  );
  if (!evidenceVisible) return false;
  return (
    pack.constraints.includes(`principal:${context.principal.principalId}`) ||
    context.permissions.includes(PRODUCT_PERMISSIONS.audit)
  );
}

function actionEvidenceVisible(
  context: CommandContext,
  proposal: Pick<typeof actionProposals.$inferSelect, "policyDecision">,
  visibleClaimIds: ReadonlySet<string>,
): boolean {
  const scopeId = typeof proposal.policyDecision.scopeId === "string"
    ? proposal.policyDecision.scopeId
    : null;
  const evidenceClaimIds = Array.isArray(proposal.policyDecision.evidenceClaimIds)
    ? proposal.policyDecision.evidenceClaimIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return Boolean(
    scopeId &&
      scopeVisible(context, scopeId) &&
      evidenceClaimIds.every((claimId) => visibleClaimIds.has(claimId)),
  );
}

async function assertContextPackVisible(
  tx: ProductDb,
  context: CommandContext,
  pack: typeof contextPacks.$inferSelect,
): Promise<void> {
  const claimIds = pack.citations.flatMap((citation) =>
    typeof citation.claimId === "string" ? [citation.claimId] : [],
  );
  const claimRows = claimIds.length
    ? await tx
        .select()
        .from(claims)
        .where(
          and(
            eq(claims.workspaceId, context.workspaceId),
            inArray(claims.id, claimIds),
          ),
        )
    : [];
  const visibleClaimIds = new Set(
    claimRows.filter((claim) => claimVisible(context, claim)).map((claim) => claim.id),
  );
  if (!contextPackVisible(context, pack, visibleClaimIds)) {
    throw new ProductError(
      "SCOPE_DENIED",
      "The context receipt is outside this principal's scope or evidence grants.",
      403,
    );
  }
}

export async function getProductState(context: CommandContext): Promise<ProductState> {
  assertPermission(context, PRODUCT_PERMISSIONS.read);
  return withTenant(context, async (tx) => {
    const [workspace] = await tx
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, context.workspaceId), eq(workspaces.organizationId, context.organizationId)))
      .limit(1);
    const [profile] = await tx
      .select()
      .from(workspaceProfiles)
      .where(eq(workspaceProfiles.workspaceId, context.workspaceId))
      .limit(1);
    if (!workspace || !profile) {
      throw new ProductError("NOT_FOUND", "Workspace product profile was not found.", 404);
    }
    assertWorkspace(context, workspace.id);

    const [
      publishedConfigurationRows,
      scopeRows,
      sourceRows,
      entityRows,
      relationshipRows,
      claimRows,
      conflictRows,
      agentRows,
      runRows,
      actionRows,
      outcomeRows,
      evaluationRows,
    ] = await Promise.all([
      profile.publishedConfigurationVersion
        ? tx
            .select()
            .from(workspaceConfigurationVersions)
            .where(
              and(
                eq(workspaceConfigurationVersions.workspaceId, context.workspaceId),
                eq(
                  workspaceConfigurationVersions.version,
                  profile.publishedConfigurationVersion,
                ),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      tx.select().from(scopes).where(eq(scopes.workspaceId, context.workspaceId)).orderBy(asc(scopes.createdAt), asc(scopes.id)),
      tx
        .select({
          id: sources.id,
          sourceKey: sources.sourceKey,
          sourceType: sources.sourceType,
          title: sources.title,
          uri: sources.uri,
          classification: sources.classification,
          immutable: sources.immutable,
          sha256: sources.sha256,
          capturedAt: sources.capturedAt,
          metadata: sources.metadata,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(sources)
        .where(eq(sources.workspaceId, context.workspaceId))
        .orderBy(asc(sources.createdAt), asc(sources.id)),
      tx.select().from(entities).where(eq(entities.workspaceId, context.workspaceId)).orderBy(asc(entities.createdAt), asc(entities.id)),
      tx.select().from(relationships).where(eq(relationships.workspaceId, context.workspaceId)).orderBy(asc(relationships.createdAt), asc(relationships.id)),
      tx
        .select({ claim: claims, sourceTitle: sources.title, sourceHash: sources.sha256 })
        .from(claims)
        .innerJoin(sources, eq(claims.sourceId, sources.id))
        .where(eq(claims.workspaceId, context.workspaceId))
        .orderBy(asc(claims.createdAt), asc(claims.id)),
      tx.select().from(conflicts).where(eq(conflicts.workspaceId, context.workspaceId)).orderBy(asc(conflicts.createdAt), asc(conflicts.id)),
      tx.select().from(actors).where(and(eq(actors.workspaceId, context.workspaceId), eq(actors.actorType, "agent"))).orderBy(asc(actors.createdAt), asc(actors.id)),
      tx
        .select({ run: agentRuns, pack: contextPacks })
        .from(agentRuns)
        .innerJoin(contextPacks, eq(agentRuns.contextPackId, contextPacks.id))
        .where(eq(agentRuns.workspaceId, context.workspaceId))
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(100),
      tx.select().from(actionProposals).where(eq(actionProposals.workspaceId, context.workspaceId)).orderBy(desc(actionProposals.createdAt), desc(actionProposals.id)).limit(100),
      tx
        .select({ outcome: outcomes, pack: contextPacks })
        .from(outcomes)
        .innerJoin(agentRuns, eq(outcomes.runId, agentRuns.id))
        .innerJoin(contextPacks, eq(agentRuns.contextPackId, contextPacks.id))
        .where(eq(outcomes.workspaceId, context.workspaceId))
        .orderBy(desc(outcomes.createdAt), desc(outcomes.id))
        .limit(100),
      tx.select().from(evaluationResults).where(eq(evaluationResults.workspaceId, context.workspaceId)).orderBy(desc(evaluationResults.runAt), asc(evaluationResults.caseName)).limit(100),
    ]);

    const visibleScopes = scopeRows.filter((row) => scopeVisible(context, row.id));
    const visibleScopeIds = new Set(visibleScopes.map((row) => row.id));
    const visibleEntities = entityRows.filter(
      (row) => !row.scopeId || visibleScopeIds.has(row.scopeId),
    );
    const visibleEntityIds = new Set(visibleEntities.map((row) => row.id));
    const visibleClaims = claimRows
      .filter((row) => claimVisible(context, row.claim))
      .map((row) => ({
        ...row.claim,
        source: {
          title: row.sourceTitle,
          hash: row.sourceHash,
          span: row.claim.sourceSpan,
        },
      }));
    const visibleClaimIds = new Set(visibleClaims.map((claim) => claim.id));
    const visibleSourceIds = new Set(visibleClaims.map((claim) => claim.sourceId));
    const visibleSources = sourceRows.filter((source) => {
      if (visibleSourceIds.has(source.id) || source.classification === "public") return true;
      const scopeId =
        source.metadata && typeof source.metadata.scopeId === "string"
          ? source.metadata.scopeId
          : null;
      const acl = source.metadata && Array.isArray(source.metadata.acl)
        ? source.metadata.acl.filter((item): item is string => typeof item === "string")
        : [];
      return Boolean(
        scopeId &&
          scopeVisible(context, scopeId) &&
          (acl.includes("workspace") || acl.includes(context.principal.principalId)),
      );
    });
    const document = profile.draftConfiguration;
    const publishedConfiguration = publishedConfigurationRows[0] ?? null;
    const configuration = {
      ...document,
      version: profile.publishedConfigurationVersion,
      status: profile.setupStatus,
      templateId: profile.templateKey,
      contentHash: publishedConfiguration?.configHash ?? hash(document),
    };
    const configuredMetrics = Array.isArray(document.metrics)
      ? (document.metrics as Array<Record<string, unknown>>)
      : [];
    const metricValues = new Map<string, number>([
      ["claims", visibleClaims.length],
      ["conflicts", conflictRows.filter((row) => row.status === "open").length],
      ["agents", agentRows.filter((row) => row.active).length],
      ["runs", runRows.filter((row) => contextPackVisible(context, row.pack, visibleClaimIds)).length],
    ]);

    return {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        kind: workspace.kind,
        status: workspace.status,
      },
      profile: {
        templateKey: profile.templateKey,
        setupStatus: profile.setupStatus,
        logoUrl: profile.logoUrl,
        accentColor: profile.accentColor,
        locale: profile.locale,
        timezone: profile.timezone,
        currency: profile.currency,
        terminology: profile.terminology,
        enabledSurfaces: profile.enabledSurfaces,
        publishedConfigurationVersion: profile.publishedConfigurationVersion,
        killSwitchEnabled: profile.killSwitchEnabled,
      },
      configuration,
      metrics: configuredMetrics.map((metric, index) => ({
        key: typeof metric.key === "string" ? metric.key : `metric_${index + 1}`,
        label: typeof metric.label === "string" ? metric.label : "Configured metric",
        value: metricValues.get(String(metric.key)) ?? 0,
        unit: typeof metric.unit === "string" ? metric.unit : "count",
      })),
      scopes: visibleScopes,
      sources: visibleSources,
      entities: visibleEntities,
      relationships: relationshipRows.filter(
        (row) => visibleEntityIds.has(row.fromEntityId) && visibleEntityIds.has(row.toEntityId),
      ),
      claims: visibleClaims,
      conflicts: conflictRows.filter(
        (row) =>
          visibleScopeIds.has(row.scopeId) &&
          visibleEntityIds.has(row.subjectEntityId) &&
          visibleClaimIds.has(row.leftClaimId) &&
          visibleClaimIds.has(row.rightClaimId) &&
          (!row.resolutionClaimId || visibleClaimIds.has(row.resolutionClaimId)),
      ),
      agents: (visibleScopes.length ? agentRows : []).map((row) => ({
        id: row.id,
        name: row.displayName,
        role: row.role,
        permissions: row.permissions,
        writeBudget: row.writeBudget,
        active: row.active,
      })),
      runs: runRows
        .filter((row) => contextPackVisible(context, row.pack, visibleClaimIds))
        .map((row) => row.run),
      actions: context.permissions.some((permission) =>
        ([
          PRODUCT_PERMISSIONS.proposeActions,
          PRODUCT_PERMISSIONS.approveActions,
          PRODUCT_PERMISSIONS.executeActions,
        ] as string[]).includes(permission),
      )
        ? actionRows.filter((row) => actionEvidenceVisible(context, row, visibleClaimIds))
        : [],
      outcomes: outcomeRows
        .filter((row) => contextPackVisible(context, row.pack, visibleClaimIds))
        .map((row) => row.outcome),
      evals: evaluationRows.length
        ? evaluationRows
        : (Array.isArray(document.evaluations)
            ? (document.evaluations as Array<Record<string, unknown>>).map((item) => ({
                ...item,
                passed: null,
                status: "not_run",
              }))
            : []),
    };
  });
}

type Paginatable = Record<string, unknown> & { id: string; createdAt: string };

function paginate<T extends Paginatable>(
  rows: T[],
  cursorValue: string | null,
  limit: number,
): CursorPage<T> {
  const cursor = decodeCursor(cursorValue);
  const sorted = [...rows].sort((left, right) => {
    const time = left.createdAt.localeCompare(right.createdAt);
    return time === 0 ? left.id.localeCompare(right.id) : time;
  });
  const eligible = cursor
    ? sorted.filter(
        (row) =>
          row.createdAt > cursor.createdAt ||
          (row.createdAt === cursor.createdAt && row.id > cursor.id),
      )
    : sorted;
  const items = eligible.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      eligible.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

export async function listProductResource(
  context: CommandContext,
  resource: string,
  cursor: string | null,
  limit: number,
): Promise<CursorPage<Paginatable>> {
  const permissionByResource: Record<string, string[]> = {
    members: [PRODUCT_PERMISSIONS.members],
    roles: [PRODUCT_PERMISSIONS.members],
    connectors: [PRODUCT_PERMISSIONS.configure],
    sources: [PRODUCT_PERMISSIONS.read],
    claims: [PRODUCT_PERMISSIONS.read],
    conflicts: [PRODUCT_PERMISSIONS.read],
    approvals: [PRODUCT_PERMISSIONS.approveClaims],
    "context-packs": [PRODUCT_PERMISSIONS.read],
    agents: [PRODUCT_PERMISSIONS.read],
    actions: [
      PRODUCT_PERMISSIONS.proposeActions,
      PRODUCT_PERMISSIONS.approveActions,
      PRODUCT_PERMISSIONS.executeActions,
    ],
    replays: [PRODUCT_PERMISSIONS.read],
    outcomes: [PRODUCT_PERMISSIONS.read],
    usage: [PRODUCT_PERMISSIONS.audit],
    jobs: [PRODUCT_PERMISSIONS.configure, PRODUCT_PERMISSIONS.audit],
    "audit-events": [PRODUCT_PERMISSIONS.audit],
  };
  const required = permissionByResource[resource];
  if (!required) throw new ProductError("NOT_FOUND", `Unknown API resource: ${resource}.`, 404);
  assertAnyPermission(context, required);
  return withTenant(context, async (tx) => {
    let rows: Paginatable[];
    switch (resource) {
      case "members":
        rows = (await tx
          .select({
            id: memberships.id,
            profileId: memberships.profileId,
            displayName: profiles.displayName,
            email: profiles.email,
            status: memberships.status,
            roleId: roles.id,
            roleKey: roles.roleKey,
            roleName: roles.name,
            createdAt: memberships.createdAt,
          })
          .from(memberships)
          .innerJoin(profiles, eq(memberships.profileId, profiles.id))
          .innerJoin(roles, eq(memberships.roleId, roles.id))
          .where(eq(memberships.workspaceId, context.workspaceId))) as Paginatable[];
        break;
      case "roles":
        rows = (await tx.select().from(roles).where(eq(roles.workspaceId, context.workspaceId))) as Paginatable[];
        break;
      case "connectors":
        rows = (await tx
          .select({
            id: connectors.id,
            connectorType: connectors.connectorType,
            name: connectors.name,
            status: connectors.status,
            externalTenantRef: connectors.externalTenantRef,
            sourceAclMode: connectors.sourceAclMode,
            executionEnabled: connectors.executionEnabled,
            lastSyncAt: connectors.lastSyncAt,
            createdAt: connectors.createdAt,
            updatedAt: connectors.updatedAt,
          })
          .from(connectors)
          .where(eq(connectors.workspaceId, context.workspaceId))) as Paginatable[];
        break;
      case "sources": {
        const sourceRows = await tx
          .select({
            id: sources.id,
            sourceKey: sources.sourceKey,
            sourceType: sources.sourceType,
            title: sources.title,
            uri: sources.uri,
            classification: sources.classification,
            immutable: sources.immutable,
            sha256: sources.sha256,
            capturedAt: sources.capturedAt,
            metadata: sources.metadata,
            createdAt: sources.createdAt,
          })
          .from(sources)
          .where(eq(sources.workspaceId, context.workspaceId));
        const visibleClaimSourceRows = await tx
          .select({ sourceId: claims.sourceId, claim: claims })
          .from(claims)
          .where(eq(claims.workspaceId, context.workspaceId));
        const visibleSourceIds = new Set(
          visibleClaimSourceRows
            .filter((row) => claimVisible(context, row.claim))
            .map((row) => row.sourceId),
        );
        rows = sourceRows.filter((source) => {
          if (source.classification === "public" || visibleSourceIds.has(source.id)) return true;
          const scopeId = typeof source.metadata.scopeId === "string" ? source.metadata.scopeId : null;
          const acl = Array.isArray(source.metadata.acl)
            ? source.metadata.acl.filter((item): item is string => typeof item === "string")
            : [];
          return Boolean(
            scopeId &&
              scopeVisible(context, scopeId) &&
              (acl.includes("workspace") || acl.includes(context.principal.principalId)),
          );
        }) as Paginatable[];
        break;
      }
      case "claims": {
        const claimRows = await tx.select().from(claims).where(eq(claims.workspaceId, context.workspaceId));
        rows = claimRows.filter((row) => claimVisible(context, row)) as Paginatable[];
        break;
      }
      case "conflicts": {
        const [conflictRows, conflictClaimRows] = await Promise.all([
          tx.select().from(conflicts).where(eq(conflicts.workspaceId, context.workspaceId)),
          tx.select().from(claims).where(eq(claims.workspaceId, context.workspaceId)),
        ]);
        const visibleClaimIds = new Set(
          conflictClaimRows.filter((claim) => claimVisible(context, claim)).map((claim) => claim.id),
        );
        rows = conflictRows.filter(
          (row) =>
            scopeVisible(context, row.scopeId) &&
            visibleClaimIds.has(row.leftClaimId) &&
            visibleClaimIds.has(row.rightClaimId) &&
            (!row.resolutionClaimId || visibleClaimIds.has(row.resolutionClaimId)),
        ) as Paginatable[];
        break;
      }
      case "approvals": {
        const approvalRows = await tx
          .select({
            id: approvals.id,
            claimId: approvals.claimId,
            actorId: approvals.actorId,
            decision: approvals.decision,
            reason: approvals.reason,
            previousLifecycle: approvals.previousLifecycle,
            resultingLifecycle: approvals.resultingLifecycle,
            createdAt: approvals.createdAt,
            claim: claims,
          })
          .from(approvals)
          .innerJoin(claims, eq(approvals.claimId, claims.id))
          .where(eq(approvals.workspaceId, context.workspaceId));
        rows = approvalRows
          .filter((row) => claimVisible(context, row.claim))
          .map((row) => ({
            id: row.id,
            claimId: row.claimId,
            actorId: row.actorId,
            decision: row.decision,
            reason: row.reason,
            previousLifecycle: row.previousLifecycle,
            resultingLifecycle: row.resultingLifecycle,
            createdAt: row.createdAt,
          })) as Paginatable[];
        break;
      }
      case "context-packs": {
        const [packRows, claimRows] = await Promise.all([
          tx.select().from(contextPacks).where(eq(contextPacks.workspaceId, context.workspaceId)),
          tx.select().from(claims).where(eq(claims.workspaceId, context.workspaceId)),
        ]);
        const visibleClaimIds = new Set(
          claimRows.filter((claim) => claimVisible(context, claim)).map((claim) => claim.id),
        );
        rows = packRows.filter((pack) => contextPackVisible(context, pack, visibleClaimIds)) as Paginatable[];
        break;
      }
      case "agents":
        rows = (await tx
          .select({
            id: actors.id,
            displayName: actors.displayName,
            role: actors.role,
            permissions: actors.permissions,
            writeBudget: actors.writeBudget,
            active: actors.active,
            createdAt: actors.createdAt,
          })
          .from(actors)
          .where(and(eq(actors.workspaceId, context.workspaceId), eq(actors.actorType, "agent"))))
          .filter(() => context.allowedScopeIds.length > 0) as Paginatable[];
        break;
      case "actions": {
        const [proposalRows, claimRows] = await Promise.all([
          tx.select().from(actionProposals).where(eq(actionProposals.workspaceId, context.workspaceId)),
          tx.select().from(claims).where(eq(claims.workspaceId, context.workspaceId)),
        ]);
        const visibleClaimIds = new Set(
          claimRows.filter((claim) => claimVisible(context, claim)).map((claim) => claim.id),
        );
        rows = proposalRows.filter(
          (proposal) => actionEvidenceVisible(context, proposal, visibleClaimIds),
        ) as Paginatable[];
        break;
      }
      case "replays": {
        const [replayRows, claimRows] = await Promise.all([
          tx
          .select({ run: agentRuns, pack: contextPacks })
          .from(agentRuns)
          .innerJoin(contextPacks, eq(agentRuns.contextPackId, contextPacks.id))
          .where(and(eq(agentRuns.workspaceId, context.workspaceId), sql`${agentRuns.replayOfRunId} is not null`)),
          tx.select().from(claims).where(eq(claims.workspaceId, context.workspaceId)),
        ]);
        const visibleClaimIds = new Set(
          claimRows.filter((claim) => claimVisible(context, claim)).map((claim) => claim.id),
        );
        rows = replayRows
          .filter((row) => contextPackVisible(context, row.pack, visibleClaimIds))
          .map((row) => row.run) as Paginatable[];
        break;
      }
      case "outcomes": {
        const [outcomeRows, claimRows] = await Promise.all([
          tx
          .select({ outcome: outcomes, pack: contextPacks })
          .from(outcomes)
          .innerJoin(agentRuns, eq(outcomes.runId, agentRuns.id))
          .innerJoin(contextPacks, eq(agentRuns.contextPackId, contextPacks.id))
          .where(eq(outcomes.workspaceId, context.workspaceId)),
          tx.select().from(claims).where(eq(claims.workspaceId, context.workspaceId)),
        ]);
        const visibleClaimIds = new Set(
          claimRows.filter((claim) => claimVisible(context, claim)).map((claim) => claim.id),
        );
        rows = outcomeRows
          .filter((row) => contextPackVisible(context, row.pack, visibleClaimIds))
          .map((row) => row.outcome) as Paginatable[];
        break;
      }
      case "usage":
        rows = (await tx
          .select({
            id: usageEvents.id,
            principalId: usageEvents.principalId,
            meter: usageEvents.meter,
            quantity: usageEvents.quantity,
            unit: usageEvents.unit,
            occurredAt: usageEvents.occurredAt,
            createdAt: usageEvents.createdAt,
          })
          .from(usageEvents)
          .where(eq(usageEvents.workspaceId, context.workspaceId))) as Paginatable[];
        break;
      case "jobs":
        rows = (await tx
          .select({
            id: jobs.id,
            jobType: jobs.jobType,
            status: jobs.status,
            attempts: jobs.attempts,
            maxAttempts: jobs.maxAttempts,
            runAfter: jobs.runAfter,
            completedAt: jobs.completedAt,
            cancelledAt: jobs.cancelledAt,
            lastError: jobs.lastError,
            createdAt: jobs.createdAt,
            updatedAt: jobs.updatedAt,
          })
          .from(jobs)
          .where(eq(jobs.workspaceId, context.workspaceId))) as Paginatable[];
        break;
      case "audit-events":
        rows = (await tx
          .select({
            id: auditEvents.id,
            requestId: auditEvents.requestId,
            principalType: auditEvents.principalType,
            principalId: auditEvents.principalId,
            action: auditEvents.action,
            resourceType: auditEvents.resourceType,
            resourceId: auditEvents.resourceId,
            policyDecision: auditEvents.policyDecision,
            beforeHash: auditEvents.beforeHash,
            afterHash: auditEvents.afterHash,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .where(eq(auditEvents.workspaceId, context.workspaceId))) as Paginatable[];
        break;
      default:
        throw new ProductError("NOT_FOUND", `Unknown API resource: ${resource}.`, 404);
    }
    return paginate(rows, cursor, limit);
  });
}

function assertPermission(context: CommandContext, permission: string): void {
  if (!context.permissions.includes(permission)) {
    throw new ProductError("FORBIDDEN", `Missing required permission: ${permission}.`, 403);
  }
}

function assertAnyPermission(context: CommandContext, permissions: string[]): void {
  if (!permissions.some((permission) => context.permissions.includes(permission))) {
    throw new ProductError(
      "FORBIDDEN",
      `One of these permissions is required: ${permissions.join(", ")}.`,
      403,
    );
  }
}

async function idempotentMutation<T extends Record<string, unknown>>(
  context: CommandContext,
  route: string,
  idempotencyKey: string,
  input: unknown,
  operation: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  return withTenant(context, async (tx) => {
    const requestHash = hash(input);
    const [existing] = await tx
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.principalId, context.principal.principalId),
          eq(idempotencyRecords.route, route),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ProductError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency-Key was already used with a different request body.",
          409,
        );
      }
      if (existing.responseBody) return existing.responseBody as T;
      throw new ProductError(
        "CONFLICT",
        "An identical request is already in progress.",
        409,
      );
    }
    const timestamp = context.clock.now().toISOString();
    const recordId = crypto.randomUUID();
    await tx.insert(idempotencyRecords).values({
      id: recordId,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      principalId: context.principal.principalId,
      route,
      idempotencyKey,
      requestHash,
      responseStatus: null,
      responseBody: null,
      expiresAt: new Date(context.clock.now().getTime() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const result = await operation(tx);
    await tx.insert(usageEvents).values({
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      principalId: context.principal.principalId,
      meter: "product.write",
      quantity: 1,
      unit: "operation",
      idempotencyKey: hash({ route, idempotencyKey }),
      occurredAt: context.clock.now().toISOString(),
      metadata: { route },
      createdAt: context.clock.now().toISOString(),
    });
    await tx
      .update(idempotencyRecords)
      .set({ responseStatus: 200, responseBody: result, updatedAt: context.clock.now().toISOString() })
      .where(eq(idempotencyRecords.id, recordId));
    return result;
  });
}

export function listSolutionPacks(): Array<Record<string, unknown>> {
  return Object.values(SOLUTION_PACKS).map((pack) => ({
    id: pack.id,
    version: pack.version,
    name: pack.name,
    audience: pack.audience,
    description: pack.description,
    recordedDemoAvailable: pack.recordedDemoAvailable,
    sampleWorkspaceName: pack.sampleWorkspaceName,
    configuration: pack.configuration,
  }));
}

export async function saveConfigurationDraft(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.configure);
  const candidate = input.configuration;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ProductError("VALIDATION_ERROR", "Configuration must be a JSON object.");
  }
  const configuration = candidate as unknown as WorkspaceConfiguration;
  try {
    assertValidWorkspaceConfiguration(configuration);
  } catch (error) {
    const details =
      error && typeof error === "object" && "issues" in error
        ? { issues: (error as { issues: unknown }).issues }
        : undefined;
    throw new ProductError(
      "VALIDATION_ERROR",
      "Workspace configuration is invalid.",
      400,
      details,
    );
  }
  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/configuration/draft`,
    idempotencyKey,
    input,
    async (tx) => {
      const timestamp = context.clock.now().toISOString();
      await tx
        .update(workspaceProfiles)
        .set({
          setupStatus: "draft",
          draftConfiguration: configuration as unknown as Record<string, unknown>,
          updatedAt: timestamp,
        })
        .where(eq(workspaceProfiles.workspaceId, context.workspaceId));
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: "configuration.draft_saved",
        resourceType: "workspace_configuration",
        resourceId: context.workspaceId,
        policyDecision: "allow",
        afterHash: hash(configuration),
        metadata: { template: configuration.template },
      });
      return {
        status: "draft",
        configuration,
        configurationHash: hash(configuration),
      };
    },
  );
}

export async function publishConfiguration(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.configure);
  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/configuration/publish`,
    idempotencyKey,
    input,
    async (tx) => {
      const [profile] = await tx
        .select()
        .from(workspaceProfiles)
        .where(eq(workspaceProfiles.workspaceId, context.workspaceId))
        .limit(1);
      if (!profile) throw new ProductError("NOT_FOUND", "Workspace profile was not found.", 404);
      const expectedVersion =
        typeof input.expectedVersion === "number"
          ? input.expectedVersion
          : profile.publishedConfigurationVersion ?? 0;
      const currentVersion = profile.publishedConfigurationVersion ?? 0;
      if (expectedVersion !== currentVersion) {
        throw new ProductError(
          "CONCURRENT_UPDATE",
          "Configuration changed since this draft was loaded.",
          409,
          { expectedVersion, currentVersion },
        );
      }
      const configuration = profile.draftConfiguration as unknown as WorkspaceConfiguration;
      try {
        assertValidWorkspaceConfiguration(configuration);
      } catch (error) {
        throw new ProductError("VALIDATION_ERROR", "Draft configuration is invalid.", 400, {
          issues:
            error && typeof error === "object" && "issues" in error
              ? (error as { issues: unknown }).issues
              : [],
        });
      }
      const version = currentVersion + 1;
      const timestamp = context.clock.now().toISOString();
      const configHash = hash(configuration);
      const updatedProfiles = await tx
        .update(workspaceProfiles)
        .set({
          templateKey: configuration.template,
          setupStatus: "published",
          logoUrl: configuration.branding.logoUrl,
          accentColor: configuration.branding.accent,
          locale: configuration.branding.locale,
          timezone: configuration.branding.timezone,
          currency: configuration.branding.currency,
          terminology: configuration.terminology as unknown as Record<string, string>,
          enabledSurfaces: [...configuration.enabledSurfaces],
          publishedConfigurationVersion: version,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(workspaceProfiles.workspaceId, context.workspaceId),
            currentVersion === 0
              ? isNull(workspaceProfiles.publishedConfigurationVersion)
              : eq(workspaceProfiles.publishedConfigurationVersion, currentVersion),
          ),
        )
        .returning({ workspaceId: workspaceProfiles.workspaceId });
      if (updatedProfiles.length !== 1) {
        throw new ProductError(
          "CONCURRENT_UPDATE",
          "Workspace configuration changed while this publish was running. Refresh and retry.",
          409,
          { expectedVersion: currentVersion },
        );
      }
      await tx.insert(workspaceConfigurationVersions).values({
        id: deterministicId("config", `${context.workspaceId}:${version}`),
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        version,
        status: "published",
        templateKey: configuration.template,
        templateVersion: 1,
        ontology: {
          scopeKinds: configuration.scopeKinds,
          entityKinds: configuration.entityKinds,
          predicates: configuration.predicates,
        },
        policy: {
          authorityRules: configuration.authorityRules,
          approvalPolicies: configuration.approvalPolicies,
          evaluations: configuration.evaluations,
        },
        branding: configuration.branding,
        agents: configuration.agents as unknown as Array<Record<string, unknown>>,
        outcomes: configuration.metrics as unknown as Array<Record<string, unknown>>,
        configHash,
        createdByPrincipalId: context.principal.principalId,
        publishedAt: timestamp,
        createdAt: timestamp,
      });
      const configuredAgentIds = new Set<string>();
      for (const agent of configuration.agents) {
        const agentId = deterministicId("actor", `${context.workspaceId}:${agent.key}`);
        configuredAgentIds.add(agentId);
        await tx
          .insert(actors)
          .values({
            id: agentId,
            workspaceId: context.workspaceId,
            actorType: "agent",
            displayName: agent.name,
            email: null,
            role: agent.key,
            permissions: [...agent.allowedTools],
            writeBudget: agent.writeBudget,
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: actors.id,
            set: {
              displayName: agent.name,
              role: agent.key,
              permissions: [...agent.allowedTools],
              writeBudget: agent.writeBudget,
              active: true,
              updatedAt: timestamp,
            },
          });
      }
      const existingAgents = await tx
        .select({ id: actors.id, role: actors.role })
        .from(actors)
        .where(
          and(
            eq(actors.workspaceId, context.workspaceId),
            eq(actors.actorType, "agent"),
          ),
        );
      for (const agent of existingAgents) {
        if (agent.role === "service_account" || configuredAgentIds.has(agent.id)) continue;
        await tx
          .update(actors)
          .set({ active: false, updatedAt: timestamp })
          .where(and(eq(actors.id, agent.id), eq(actors.workspaceId, context.workspaceId)));
      }
      await tx
        .update(contextPacks)
        .set({ invalidatedAt: timestamp })
        .where(
          and(
            eq(contextPacks.workspaceId, context.workspaceId),
            sql`${contextPacks.invalidatedAt} is null`,
          ),
        );
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: "configuration.published",
        resourceType: "workspace_configuration",
        resourceId: deterministicId("config", `${context.workspaceId}:${version}`),
        policyDecision: "allow",
        afterHash: configHash,
        metadata: { version },
      });
      return { status: "published", version, configurationHash: configHash, configuration };
    },
  );
}

const CONNECTOR_TYPES = new Set([
  "file",
  "webhook",
  "slack",
  "google-drive",
  "microsoft-teams",
  "sharepoint-onedrive",
]);

export async function createConnector(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.configure);
  const connectorType = typeof input.type === "string" ? input.type : "";
  if (!CONNECTOR_TYPES.has(connectorType)) {
    throw new ProductError("VALIDATION_ERROR", "Connector type is not supported.");
  }
  if (["secret", "token", "accessToken", "clientSecret"].some((key) => key in input)) {
    throw new ProductError(
      "VALIDATION_ERROR",
      "Raw credentials are not accepted. Store encrypted credentials through the deployment secret broker.",
    );
  }
  const name = typeof input.name === "string" && input.name.trim()
    ? input.name.trim().slice(0, 100)
    : connectorType;
  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/connectors`,
    idempotencyKey,
    input,
    async (tx) => {
      const timestamp = context.clock.now().toISOString();
      const connector = {
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        connectorType,
        name,
        status: connectorType === "file" || connectorType === "webhook" ? "configured" : "disconnected",
        externalTenantRef: null,
        configuration:
          input.configuration && typeof input.configuration === "object"
            ? (input.configuration as Record<string, unknown>)
            : {},
        encryptedCredentialRef:
          typeof input.encryptedCredentialRef === "string" ? input.encryptedCredentialRef : null,
        cursor: {},
        sourceAclMode: "mirror",
        executionEnabled: false,
        lastSyncAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await tx.insert(connectors).values(connector);
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: "connector.created",
        resourceType: "connector",
        resourceId: connector.id,
        policyDecision: "allow",
        afterHash: hash(connector),
        metadata: { connectorType },
      });
      return { connector };
    },
  );
}

export async function createServiceAccount(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.serviceAccounts);
  const name = typeof input.name === "string" && input.name.trim()
    ? input.name.trim().slice(0, 100)
    : "Commonstate agent";
  const requestedPermissions = Array.isArray(input.permissions)
    ? input.permissions.filter((value): value is string => typeof value === "string")
    : [PRODUCT_PERMISSIONS.read];
  if (requestedPermissions.some((permission) => !context.permissions.includes(permission))) {
    throw new ProductError(
      "FORBIDDEN",
      "A service account cannot receive permissions its creator does not hold.",
      403,
    );
  }
  const allowedScopeIds = Array.isArray(input.allowedScopeIds)
    ? input.allowedScopeIds.filter((value): value is string => typeof value === "string")
    : [...context.allowedScopeIds];
  if (allowedScopeIds.some((scopeId) => !context.allowedScopeIds.includes(scopeId))) {
    throw new ProductError("SCOPE_DENIED", "A requested service-account scope is not allowed.", 403);
  }
  const writeBudget = typeof input.writeBudget === "number" && Number.isFinite(input.writeBudget)
    ? Math.max(0, Math.min(10_000, Math.floor(input.writeBudget)))
    : 100;
  const pepper = process.env.COMMONSTATE_CREDENTIAL_PEPPER ??
    (!process.env.VERCEL && !process.env.CI ? "commonstate-local-credentials-only" : "");
  if (!pepper) {
    throw new ProductError(
      "AUTH_CONFIG_UNAVAILABLE",
      "COMMONSTATE_CREDENTIAL_PEPPER is required to issue service-account credentials.",
      503,
    );
  }
  const keyMaterial = `${context.organizationId}:${context.workspaceId}:${context.principal.principalId}:${idempotencyKey}`;
  const prefix = `cs_sa_${createHmac("sha256", pepper).update(`prefix:${keyMaterial}`).digest("hex").slice(0, 12)}`;
  const secret = createHmac("sha256", pepper).update(`secret:${keyMaterial}`).digest("base64url");
  const timestamp = context.clock.now().toISOString();
  const account = await withTenant(context, async (tx) => {
    const value = {
      id: deterministicId("service_account", keyMaterial),
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      roleId: null,
      name,
      keyPrefix: prefix,
      secretHash: createHash("sha256").update(secret).digest("hex"),
      permissions: Array.from(new Set(requestedPermissions)).sort(),
      allowedScopeIds: Array.from(new Set(allowedScopeIds)).sort(),
      active: true,
      expiresAt: typeof input.expiresAt === "string" ? input.expiresAt : null,
      lastUsedAt: null,
      rotatedFromId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const [existing] = await tx
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, value.id))
      .limit(1);
    if (existing) {
      const [existingActor] = await tx
        .select({ writeBudget: actors.writeBudget })
        .from(actors)
        .where(
          and(
            eq(actors.id, `service-account:${value.id}`),
            eq(actors.workspaceId, context.workspaceId),
          ),
        )
        .limit(1);
      if (
        existing.name !== value.name ||
        hash(existing.permissions) !== hash(value.permissions) ||
        hash(existing.allowedScopeIds) !== hash(value.allowedScopeIds) ||
        (existingActor && existingActor.writeBudget !== writeBudget)
      ) {
        throw new ProductError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency-Key was already used with different service-account settings.",
          409,
        );
      }
      if (!existingActor) {
        await tx.insert(actors).values({
          id: `service-account:${value.id}`,
          workspaceId: context.workspaceId,
          actorType: "agent",
          displayName: value.name,
          email: null,
          role: "service_account",
          permissions: value.permissions,
          writeBudget,
          active: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return existing;
    }
    await tx.insert(serviceAccounts).values(value);
    await tx.insert(actors).values({
      id: `service-account:${value.id}`,
      workspaceId: context.workspaceId,
      actorType: "agent",
      displayName: value.name,
      email: null,
      role: "service_account",
      permissions: value.permissions,
      writeBudget,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await writeAudit(tx, {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      principalType: context.principal.type,
      principalId: context.principal.principalId,
      action: "service_account.created",
      resourceType: "service_account",
      resourceId: value.id,
      policyDecision: "allow",
      afterHash: hash({ ...value, secretHash: "redacted" }),
      metadata: { keyPrefix: prefix },
    });
    return value;
  });
  return {
    serviceAccount: {
      id: account.id,
      name: account.name,
      keyPrefix: prefix,
      permissions: account.permissions,
      allowedScopeIds: account.allowedScopeIds,
      writeBudget,
      createdAt: account.createdAt,
    },
    credential: `${prefix}.${secret}`,
    warning: "This credential is shown once. Store it in a secret manager.",
  };
}

const REVERSIBLE_INTERNAL_ACTIONS = new Set([
  "draft.create",
  "metadata.update",
  "label.apply",
  "claim.tag",
]);

function requestedRisk(value: unknown): "low" | "medium" | "high" | "critical" {
  return value === "medium" || value === "high" || value === "critical" ? value : "low";
}

function actionScope(
  context: CommandContext,
  proposal: { policyDecision: Record<string, unknown> },
): string {
  const scopeId = typeof proposal.policyDecision.scopeId === "string"
    ? proposal.policyDecision.scopeId
    : "";
  if (!scopeId || !scopeVisible(context, scopeId)) {
    throw new ProductError(
      "SCOPE_DENIED",
      "The action is not available in this principal's granted scopes.",
      403,
    );
  }
  return scopeId;
}

async function authorizeActionEvidence(
  tx: ProductDb,
  context: CommandContext,
  proposal: {
    contextPackId: string | null;
    policyDecision: Record<string, unknown>;
  },
): Promise<string> {
  const scopeId = actionScope(context, proposal);
  const evidenceClaimIds = Array.isArray(proposal.policyDecision.evidenceClaimIds)
    ? proposal.policyDecision.evidenceClaimIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const evidenceRows = evidenceClaimIds.length
    ? await tx
        .select()
        .from(claims)
        .where(
          and(
            eq(claims.workspaceId, context.workspaceId),
            inArray(claims.id, evidenceClaimIds),
          ),
        )
    : [];
  if (
    evidenceRows.length !== evidenceClaimIds.length ||
    evidenceRows.some((claim) => !claimVisible(context, claim))
  ) {
    throw new ProductError(
      "SCOPE_DENIED",
      "The action references evidence outside this principal's grants.",
      403,
    );
  }
  if (proposal.contextPackId) {
    const [pack] = await tx
      .select()
      .from(contextPacks)
      .where(
        and(
          eq(contextPacks.id, proposal.contextPackId),
          eq(contextPacks.workspaceId, context.workspaceId),
        ),
      )
      .limit(1);
    if (!pack || pack.scopeId !== scopeId || !scopeVisible(context, pack.scopeId)) {
      throw new ProductError("SCOPE_DENIED", "The action context pack is not authorized.", 403);
    }
    await assertContextPackVisible(tx, context, pack);
  }
  return scopeId;
}

async function assertCurrentActionVersions(
  tx: ProductDb,
  context: CommandContext,
  proposal: {
    contextPackId: string | null;
    ontologyVersion: number;
    policyVersion: number;
  },
): Promise<void> {
  const [profile] = await tx
    .select({ version: workspaceProfiles.publishedConfigurationVersion })
    .from(workspaceProfiles)
    .where(eq(workspaceProfiles.workspaceId, context.workspaceId))
    .limit(1);
  if (
    !profile?.version ||
    proposal.ontologyVersion !== profile.version ||
    proposal.policyVersion !== profile.version
  ) {
    throw new ProductError(
      "CONFIG_VERSION_MISMATCH",
      "The action was proposed under an older ontology or policy version.",
      409,
      {
        actionOntologyVersion: proposal.ontologyVersion,
        actionPolicyVersion: proposal.policyVersion,
        currentVersion: profile?.version ?? null,
      },
    );
  }
  if (!proposal.contextPackId) {
    throw new ProductError(
      "ACTION_DISALLOWED",
      "A current evidence-backed context pack is required before approval or execution.",
      409,
    );
  }
  const [pack] = await tx
    .select({ invalidatedAt: contextPacks.invalidatedAt })
    .from(contextPacks)
    .where(
      and(
        eq(contextPacks.id, proposal.contextPackId),
        eq(contextPacks.workspaceId, context.workspaceId),
      ),
    )
    .limit(1);
  if (!pack || pack.invalidatedAt) {
    throw new ProductError(
      "ACTION_DISALLOWED",
      "The action context pack is missing or invalidated. Compile fresh context and propose again.",
      409,
    );
  }
}

export async function proposeAction(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.proposeActions);
  const actionType = typeof input.actionType === "string" ? input.actionType.trim() : "";
  if (!actionType) throw new ProductError("VALIDATION_ERROR", "actionType is required.");
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? (input.payload as Record<string, unknown>)
    : {};
  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/actions/propose`,
    idempotencyKey,
    input,
    async (tx) => {
      const commandActorId = await ensureCommandActor(tx, context);
      await consumeActorWriteBudget(tx, context, commandActorId, 1);
      const [profile] = await tx
        .select()
        .from(workspaceProfiles)
        .where(eq(workspaceProfiles.workspaceId, context.workspaceId))
        .limit(1);
      if (!profile || !profile.publishedConfigurationVersion) {
        throw new ProductError(
          "ACTION_DISALLOWED",
          "Publish workspace policy before proposing actions.",
          409,
        );
      }
      const [publishedPolicyVersion] = await tx
        .select({ policy: workspaceConfigurationVersions.policy })
        .from(workspaceConfigurationVersions)
        .where(
          and(
            eq(workspaceConfigurationVersions.workspaceId, context.workspaceId),
            eq(
              workspaceConfigurationVersions.version,
              profile.publishedConfigurationVersion,
            ),
          ),
        )
        .limit(1);
      if (!publishedPolicyVersion) {
        throw new ProductError(
          "CONFIG_VERSION_MISMATCH",
          "The published action-policy version is unavailable.",
          409,
        );
      }
      const contextPackId =
        typeof input.contextPackId === "string" && input.contextPackId.trim()
          ? input.contextPackId.trim()
          : null;
      const [boundContextPack] = contextPackId
        ? await tx
            .select()
            .from(contextPacks)
            .where(
              and(
                eq(contextPacks.id, contextPackId),
                eq(contextPacks.workspaceId, context.workspaceId),
              ),
            )
            .limit(1)
        : [undefined];
      if (
        contextPackId &&
        (!boundContextPack ||
          boundContextPack.invalidatedAt ||
          !scopeVisible(context, boundContextPack.scopeId) ||
          !boundContextPack.constraints.includes(
            `principal:${context.principal.principalId}`,
          ))
      ) {
        throw new ProductError(
          "ACTION_DISALLOWED",
          "The supplied context pack is missing, invalidated, or not authorized for this principal.",
          409,
        );
      }
      const evidenceClaimIds = Array.isArray(input.evidenceClaimIds)
        ? [...new Set(input.evidenceClaimIds.filter((value): value is string => typeof value === "string"))]
        : [];
      const evidenceRows = evidenceClaimIds.length
        ? await tx
            .select()
            .from(claims)
            .where(
              and(
                eq(claims.workspaceId, context.workspaceId),
                inArray(claims.id, evidenceClaimIds),
              ),
            )
        : [];
      if (
        evidenceRows.length !== evidenceClaimIds.length ||
        evidenceRows.some((claim) => !claimVisible(context, claim))
      ) {
        throw new ProductError(
          "SCOPE_DENIED",
          "Action evidence contains a missing or unauthorized claim.",
          403,
        );
      }
      if (boundContextPack && evidenceClaimIds.length) {
        const packedClaimIds = new Set(
          boundContextPack.citations.flatMap((citation) =>
            typeof citation.claimId === "string" ? [citation.claimId] : [],
          ),
        );
        if (evidenceClaimIds.some((claimId) => !packedClaimIds.has(claimId))) {
          throw new ProductError(
            "ACTION_DISALLOWED",
            "Action evidence must be present in the bound context pack.",
            409,
          );
        }
      }
      const connectorId = typeof input.connectorId === "string" ? input.connectorId : null;
      const [proposalConnector] = connectorId
        ? await tx
            .select({ id: connectors.id })
            .from(connectors)
            .where(
              and(
                eq(connectors.id, connectorId),
                eq(connectors.workspaceId, context.workspaceId),
              ),
            )
            .limit(1)
        : [undefined];
      if (connectorId && !proposalConnector) {
        throw new ProductError(
          "CONNECTOR_UNAVAILABLE",
          "The requested connector is not configured in this workspace.",
          503,
        );
      }
      const reversible = !connectorId && REVERSIBLE_INTERNAL_ACTIONS.has(actionType);
      const externalSideEffect = Boolean(connectorId) || /(external|send|publish|deploy)/i.test(actionType);
      const policyProposal: PolicyActionProposal = {
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        scopeId: boundContextPack?.scopeId ?? context.allowedScopeIds[0] ?? "",
        actionKind: actionType,
        connectorId,
        requestedRisk: requestedRisk(input.requestedRisk),
        reversible,
        externalSideEffect,
        proposedByActorId: context.principal.actorId,
        proposedAt: context.clock.now().toISOString(),
        idempotencyKey,
        input: payload,
        evidenceClaimIds,
      };
      const configuredRisk = classifyActionRisk(policyProposal);
      const policies = Array.isArray(publishedPolicyVersion.policy.approvalPolicies)
        ? (publishedPolicyVersion.policy.approvalPolicies as Array<Record<string, unknown>>)
        : [];
      const policy = policies.find((item) => item.risk === configuredRisk);
      const executable = policy?.executable === true;
      const requiredApprovals =
        typeof policy?.requiredApprovals === "number"
          ? policy.requiredApprovals
          : configuredRisk === "high"
            ? 2
            : configuredRisk === "medium"
              ? 1
              : 0;
      const blocked =
        profile.killSwitchEnabled || configuredRisk === "critical" || !boundContextPack;
      const sharedDecision = decideActionPolicy({
        action: policyProposal,
        policy: {
          killSwitchEnabled: profile.killSwitchEnabled,
          disabledConnectorIds: [],
          allowedActionKinds: [actionType],
          privateBeta: true,
          reauthenticationMaxAgeSeconds: 600,
        },
        approvals: [],
        executor: {
          actorId: context.principal.actorId,
          permissions: [
            ...context.permissions,
            ...(context.permissions.includes(PRODUCT_PERMISSIONS.executeActions)
              ? ["actions.execute"]
              : []),
          ],
          authenticatedAt: context.clock.now().toISOString(),
        },
        now: context.clock.now().toISOString(),
        explicitExecutionConfirmed: false,
      });
      const timestamp = context.clock.now().toISOString();
      const proposal = {
        id: policyProposal.id,
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        proposedByPrincipalType: context.principal.type,
        proposedByPrincipalId: context.principal.principalId,
        connectorId,
        actionType,
        riskTier: configuredRisk,
        status: blocked
          ? "blocked"
          : requiredApprovals === 0
            ? "approved"
            : "awaiting_approval",
        payload,
        contextPackId,
        ontologyVersion: profile.publishedConfigurationVersion,
        policyVersion: profile.publishedConfigurationVersion,
        policyDecision: {
          decision: blocked ? "deny" : requiredApprovals === 0 ? "allow" : "require_approval",
          reason: profile.killSwitchEnabled
            ? "Workspace kill switch is enabled."
            : configuredRisk === "critical"
              ? "Critical actions are disabled in private beta."
              : !boundContextPack
                ? "A current evidence-backed context pack is required before an action can proceed."
              : `Configured ${configuredRisk}-risk policy applied.`,
          deterministicRisk: configuredRisk,
          scopeId: policyProposal.scopeId,
          requestedRisk: policyProposal.requestedRisk,
          reversible,
          externalSideEffect,
          evidenceClaimIds: policyProposal.evidenceClaimIds,
          configuredExecutable: executable,
          sharedDecision,
        },
        requiredApprovals,
        idempotencyKey,
        expiresAt: new Date(context.clock.now().getTime() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await tx.insert(actionProposals).values(proposal);
      let receipt: typeof actionReceipts.$inferSelect | null = null;
      if (
        !blocked &&
        configuredRisk === "low" &&
        requiredApprovals === 0 &&
        reversible &&
        !externalSideEffect &&
        !connectorId &&
        executable &&
        sharedDecision.allowed
      ) {
        const receiptValue = {
          id: crypto.randomUUID(),
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actionProposalId: proposal.id,
          status: "executed",
          connectorPreflight: { required: false, passed: true, decision: sharedDecision },
          beforeEvidence: [] as string[],
          afterEvidence: [] as string[],
          compensationStatus: "available",
          externalRef: null,
          receiptHash: hash({ proposalId: proposal.id, actionType, payload, timestamp }),
          executedAt: timestamp,
          createdAt: timestamp,
        };
        await tx.insert(actionReceipts).values(receiptValue);
        await tx
          .update(actionProposals)
          .set({ status: "executed", updatedAt: timestamp })
          .where(eq(actionProposals.id, proposal.id));
        receipt = receiptValue;
      }
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: "action.proposed",
        resourceType: "action_proposal",
        resourceId: proposal.id,
        policyDecision: blocked ? "deny" : "allow",
        afterHash: hash(proposal),
        metadata: { riskTier: configuredRisk, requiredApprovals },
      });
      return { proposal: { ...proposal, status: receipt ? "executed" : proposal.status }, receipt };
    },
  );
}

export async function approveAction(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.approveActions);
  if (context.principal.type !== "user") {
    throw new ProductError("FORBIDDEN", "Only a human principal may approve actions.", 403);
  }
  const proposalId = typeof input.proposalId === "string" ? input.proposalId : "";
  const decision = input.decision === "reject" ? "rejected" : "approved";
  if (!proposalId) throw new ProductError("VALIDATION_ERROR", "proposalId is required.");
  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/actions/${proposalId}/approve`,
    idempotencyKey,
    input,
    async (tx) => {
      const [proposal] = await tx
        .select()
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.id, proposalId),
            eq(actionProposals.workspaceId, context.workspaceId),
          ),
        )
        .limit(1);
      if (!proposal) throw new ProductError("NOT_FOUND", "Action proposal was not found.", 404);
      await authorizeActionEvidence(tx, context, proposal);
      if (proposal.status !== "awaiting_approval") {
        throw new ProductError("CONFLICT", `Action is already ${proposal.status}.`, 409);
      }
      if (proposal.proposedByPrincipalId === context.principal.principalId) {
        throw new ProductError("FORBIDDEN", "Action proposers cannot approve their own action.", 403);
      }
      const authenticationAge = context.authenticatedAt
        ? context.clock.now().getTime() - new Date(context.authenticatedAt).getTime()
        : Number.POSITIVE_INFINITY;
      if (
        proposal.riskTier === "high" &&
        (!Number.isFinite(authenticationAge) || authenticationAge < 0 || authenticationAge > 10 * 60 * 1000)
      ) {
        throw new ProductError(
          "ACTION_DISALLOWED",
          "High-risk approval requires a server-verified recent reauthentication.",
          409,
        );
      }
      await assertCurrentActionVersions(tx, context, proposal);
      const timestamp = context.clock.now().toISOString();
      await tx.insert(actionApprovals).values({
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actionProposalId: proposal.id,
        approverPrincipalId: context.principal.principalId,
        decision,
        reason: typeof input.reason === "string" ? input.reason.slice(0, 500) : "Reviewed in Commonstate.",
        reauthenticatedAt: proposal.riskTier === "high" ? timestamp : null,
        createdAt: timestamp,
      });
      let resultingStatus = proposal.status;
      if (decision === "rejected") {
        resultingStatus = "rejected";
      } else {
        const approved = await tx
          .select({ id: actionApprovals.id })
          .from(actionApprovals)
          .where(
            and(
              eq(actionApprovals.actionProposalId, proposal.id),
              eq(actionApprovals.decision, "approved"),
            ),
          );
        if (approved.length >= proposal.requiredApprovals) resultingStatus = "approved";
      }
      await tx
        .update(actionProposals)
        .set({ status: resultingStatus, updatedAt: timestamp })
        .where(eq(actionProposals.id, proposal.id));
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: `action.${decision}`,
        resourceType: "action_proposal",
        resourceId: proposal.id,
        policyDecision: "allow",
        beforeHash: hash(proposal),
        afterHash: hash({ ...proposal, status: resultingStatus }),
        metadata: { riskTier: proposal.riskTier },
      });
      return { proposal: { ...proposal, status: resultingStatus }, decision };
    },
  );
}

export async function executeAction(
  context: CommandContext,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.executeActions);
  const proposalId = typeof input.proposalId === "string" ? input.proposalId : "";
  if (!proposalId) throw new ProductError("VALIDATION_ERROR", "proposalId is required.");
  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/actions/${proposalId}/execute`,
    idempotencyKey,
    input,
    async (tx) => {
      const [proposal] = await tx
        .select()
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.id, proposalId),
            eq(actionProposals.workspaceId, context.workspaceId),
          ),
        )
        .limit(1);
      if (!proposal) throw new ProductError("NOT_FOUND", "Action proposal was not found.", 404);
      const proposalScopeId = await authorizeActionEvidence(tx, context, proposal);
      const [existingReceipt] = await tx
        .select()
        .from(actionReceipts)
        .where(eq(actionReceipts.actionProposalId, proposal.id))
        .limit(1);
      if (existingReceipt) return { proposal, receipt: existingReceipt };
      if (proposal.status === "blocked" || proposal.status === "rejected") {
        throw new ProductError(
          "ACTION_DISALLOWED",
          `Action is ${proposal.status} and cannot execute.`,
          409,
        );
      }
      await assertCurrentActionVersions(tx, context, proposal);
      const approvalRows = await tx
        .select()
        .from(actionApprovals)
        .where(eq(actionApprovals.actionProposalId, proposal.id))
        .orderBy(asc(actionApprovals.createdAt), asc(actionApprovals.id));
      const accepted = approvalRows.filter((approval) => approval.decision === "approved");
      if (accepted.length < proposal.requiredApprovals) {
        throw new ProductError(
          "ACTION_DISALLOWED",
          `${proposal.requiredApprovals - accepted.length} additional approval${proposal.requiredApprovals - accepted.length === 1 ? " is" : "s are"} required.`,
          409,
        );
      }
      const [profile] = await tx
        .select()
        .from(workspaceProfiles)
        .where(eq(workspaceProfiles.workspaceId, context.workspaceId))
        .limit(1);
      if (!profile) throw new ProductError("NOT_FOUND", "Workspace profile was not found.", 404);
      const [connector] = proposal.connectorId
        ? await tx
            .select()
            .from(connectors)
            .where(
              and(
                eq(connectors.id, proposal.connectorId),
                eq(connectors.workspaceId, context.workspaceId),
              ),
            )
            .limit(1)
        : [undefined];
      const storedDecision = proposal.policyDecision as Record<string, unknown>;
      const action: PolicyActionProposal = {
        id: proposal.id,
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        scopeId: proposalScopeId,
        actionKind: proposal.actionType,
        connectorId: proposal.connectorId,
        requestedRisk: requestedRisk(storedDecision.requestedRisk),
        reversible: storedDecision.reversible === true,
        externalSideEffect: storedDecision.externalSideEffect === true,
        proposedByActorId: proposal.proposedByPrincipalId,
        proposedAt: proposal.createdAt,
        idempotencyKey: proposal.idempotencyKey,
        input: proposal.payload,
        evidenceClaimIds: Array.isArray(storedDecision.evidenceClaimIds)
          ? storedDecision.evidenceClaimIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      };
      const policyApprovals: PolicyActionApproval[] = accepted.map((approval) => ({
        id: approval.id,
        actionId: proposal.id,
        actorId: approval.approverPrincipalId,
        decision: "approved",
        authorized: true,
        reason: approval.reason,
        createdAt: approval.createdAt,
      }));
      const timestamp = context.clock.now().toISOString();
      const decision = decideActionPolicy({
        action,
        policy: {
          killSwitchEnabled: profile.killSwitchEnabled,
          disabledConnectorIds:
            connector && !connector.executionEnabled ? [connector.id] : [],
          allowedActionKinds: [proposal.actionType],
          privateBeta: true,
          reauthenticationMaxAgeSeconds: 600,
        },
        approvals: policyApprovals,
        executor: {
          actorId: context.principal.actorId,
          permissions: [
            ...context.permissions,
            ...(context.permissions.includes(PRODUCT_PERMISSIONS.executeActions)
              ? ["actions.execute"]
              : []),
          ],
          authenticatedAt:
            context.authenticatedAt ?? "1970-01-01T00:00:00.000Z",
        },
        now: timestamp,
        explicitExecutionConfirmed: input.confirm === true,
      });
      if (!decision.allowed) {
        throw new ProductError(
          "ACTION_DISALLOWED",
          decision.reasons.join(" ") || "Action policy denied execution.",
          409,
          { decision },
        );
      }
      if (proposal.connectorId) {
        throw new ProductError(
          "CONNECTOR_UNAVAILABLE",
          "Connector execution requires a ready adapter, successful preflight, and compensation contract. This connector is not execution-enabled.",
          503,
        );
      }
      if (!REVERSIBLE_INTERNAL_ACTIONS.has(proposal.actionType) || !action.reversible) {
        throw new ProductError(
          "ACTION_DISALLOWED",
          "Private beta executes only allowlisted reversible Commonstate operations.",
          409,
        );
      }
      const receiptValue = {
        id: crypto.randomUUID(),
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actionProposalId: proposal.id,
        status: "executed",
        connectorPreflight: {
          required: decision.requirements.preflight,
          passed: true,
          adapter: "commonstate-internal",
          decision,
        },
        beforeEvidence: action.evidenceClaimIds as string[],
        afterEvidence: [] as string[],
        compensationStatus: "available",
        externalRef: null,
        receiptHash: hash({ proposalId: proposal.id, action, decision, timestamp }),
        executedAt: timestamp,
        createdAt: timestamp,
      };
      await tx.insert(actionReceipts).values(receiptValue);
      await tx
        .update(actionProposals)
        .set({ status: "executed", updatedAt: timestamp })
        .where(eq(actionProposals.id, proposal.id));
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: "action.executed",
        resourceType: "action_proposal",
        resourceId: proposal.id,
        policyDecision: "allow",
        beforeHash: hash(proposal),
        afterHash: receiptValue.receiptHash,
        metadata: { riskTier: decision.risk, adapter: "commonstate-internal" },
      });
      return { proposal: { ...proposal, status: "executed" }, receipt: receiptValue };
    },
  );
}

async function ensureCommandActor(tx: TransactionDb, context: CommandContext): Promise<string> {
  const actorId = context.principal.actorId;
  const timestamp = context.clock.now().toISOString();
  await tx
    .insert(actors)
    .values({
      id: actorId,
      workspaceId: context.workspaceId,
      actorType: context.principal.type === "user" ? "human" : "agent",
      displayName:
        context.principal.type === "user" ? "Workspace operator" : "Service account",
      email: null,
      role: context.principal.type,
      permissions: context.permissions,
      writeBudget: context.principal.type === "user" ? 10_000 : 100,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing();
  return actorId;
}

async function consumeActorWriteBudget(
  tx: TransactionDb,
  context: CommandContext,
  actorId: string,
  amount: number,
): Promise<void> {
  if (context.principal.type !== "service_account" || amount <= 0) return;
  const consumed = await tx
    .update(actors)
    .set({
      writeBudget: sql`${actors.writeBudget} - ${amount}`,
      updatedAt: context.clock.now().toISOString(),
    })
    .where(
      and(
        eq(actors.id, actorId),
        eq(actors.workspaceId, context.workspaceId),
        eq(actors.active, true),
        sql`${actors.writeBudget} >= ${amount}`,
      ),
    )
    .returning({ id: actors.id });
  if (consumed.length !== 1) {
    throw new ProductError(
      "ACTION_DISALLOWED",
      "The service account write budget is exhausted or inactive.",
      409,
    );
  }
}

type CompiledPack = {
  pack: typeof contextPacks.$inferSelect;
  claims: Array<typeof claims.$inferSelect>;
};

async function compileContextPack(
  tx: TransactionDb,
  context: CommandContext,
  task: string,
  entityRefs: string[] = [],
  requestedAsOf?: string,
  requestedScopeId?: string,
): Promise<CompiledPack> {
  const currentTime = context.clock.now();
  const asOfTime = requestedAsOf ? new Date(requestedAsOf) : currentTime;
  if (
    Number.isNaN(asOfTime.getTime()) ||
    asOfTime.getTime() > currentTime.getTime()
  ) {
    throw new ProductError(
      "VALIDATION_ERROR",
      "asOf must be a valid UTC timestamp at or before the current time.",
      400,
    );
  }
  const timestamp = asOfTime.toISOString();
  const createdAt = currentTime.toISOString();
  const [configurationVersion] = await tx
    .select()
    .from(workspaceConfigurationVersions)
    .where(
      and(
        eq(workspaceConfigurationVersions.workspaceId, context.workspaceId),
        lte(workspaceConfigurationVersions.publishedAt, timestamp),
      ),
    )
    .orderBy(desc(workspaceConfigurationVersions.version))
    .limit(1);
  if (!configurationVersion) {
    throw new ProductError(
      "CONFIG_VERSION_MISMATCH",
      "No published workspace configuration existed at the requested time.",
      409,
    );
  }
  const scopeRows = await tx
    .select()
    .from(scopes)
    .where(eq(scopes.workspaceId, context.workspaceId))
    .orderBy(asc(scopes.createdAt), asc(scopes.id));
  const selectedScope = requestedScopeId
    ? scopeRows.find(
        (scope) => scope.id === requestedScopeId && scopeVisible(context, scope.id),
      )
    : scopeRows.find((scope) => scopeVisible(context, scope.id));
  if (!selectedScope) throw new ProductError("SCOPE_DENIED", "No readable scope is available.", 403);
  const includedScopeIds = new Set<string>();
  if (requestedScopeId) {
    let cursor: typeof scopes.$inferSelect | undefined = selectedScope;
    while (cursor) {
      if (scopeVisible(context, cursor.id)) includedScopeIds.add(cursor.id);
      cursor = cursor.parentScopeId
        ? scopeRows.find((scope) => scope.id === cursor?.parentScopeId)
        : undefined;
    }
  } else {
    for (const scope of scopeRows) {
      if (scopeVisible(context, scope.id)) includedScopeIds.add(scope.id);
    }
  }
  const allClaims = await tx
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.workspaceId, context.workspaceId),
        inArray(claims.lifecycle, ["approved", "superseded", "expired"]),
      ),
    )
    .orderBy(asc(claims.createdAt), asc(claims.id));
  const approvalRows = allClaims.length
    ? await tx
        .select({ claimId: approvals.claimId, decision: approvals.decision, createdAt: approvals.createdAt })
        .from(approvals)
        .where(
          and(
            eq(approvals.workspaceId, context.workspaceId),
            inArray(approvals.claimId, allClaims.map((claim) => claim.id)),
            lte(approvals.createdAt, timestamp),
          ),
        )
        .orderBy(asc(approvals.createdAt), asc(approvals.id))
    : [];
  const approvedByAsOf = new Set(
    approvalRows
      .filter((approval) => approval.decision === "approved")
      .map((approval) => approval.claimId),
  );
  const currentClaims = allClaims.filter((claim) => {
    if (!claimVisible(context, claim)) return false;
    if (!includedScopeIds.has(claim.scopeId)) return false;
    if (!approvedByAsOf.has(claim.id)) return false;
    if (entityRefs.length && !entityRefs.includes(claim.subjectEntityId)) return false;
    if (new Date(claim.validFrom).getTime() > new Date(timestamp).getTime()) return false;
    if (claim.validTo && new Date(claim.validTo).getTime() <= new Date(timestamp).getTime()) return false;
    if (claim.freshnessSeconds > 0) {
      const age = new Date(timestamp).getTime() - new Date(claim.observedAt).getTime();
      if (age > claim.freshnessSeconds * 1000) return false;
    }
    return true;
  });
  const activeConflicts = await tx
    .select()
    .from(conflicts)
    .where(eq(conflicts.workspaceId, context.workspaceId))
    .orderBy(asc(conflicts.detectedAt), asc(conflicts.id))
    .then((rows) => rows.filter((conflict) =>
      new Date(conflict.detectedAt).getTime() <= asOfTime.getTime() &&
      (!conflict.resolvedAt || new Date(conflict.resolvedAt).getTime() > asOfTime.getTime())
    ));
  const conflictClaimIds = Array.from(new Set(activeConflicts.flatMap((item) => [
    item.leftClaimId,
    item.rightClaimId,
  ])));
  const conflictClaims = conflictClaimIds.length
    ? await tx
        .select()
        .from(claims)
        .where(
          and(
            eq(claims.workspaceId, context.workspaceId),
            inArray(claims.id, conflictClaimIds),
          ),
        )
    : [];
  const conflictClaimMap = new Map(conflictClaims.map((claim) => [claim.id, claim]));
  const visibleConflictIds = new Set(activeConflicts.flatMap((item) => {
    const left = conflictClaimMap.get(item.leftClaimId);
    const right = conflictClaimMap.get(item.rightClaimId);
    return left && right && claimVisible(context, left) && claimVisible(context, right)
      ? [item.id]
      : [];
  }));
  const blocking = activeConflicts.filter(
    (item) =>
      ["high", "critical"].includes(item.risk) && includedScopeIds.has(item.scopeId),
  );
  const sourceRows = currentClaims.length
    ? await tx
        .select({ id: sources.id, title: sources.title, sha256: sources.sha256 })
        .from(sources)
        .where(inArray(sources.id, Array.from(new Set(currentClaims.map((claim) => claim.sourceId)))))
    : [];
  const sourceMap = new Map(sourceRows.map((source) => [source.id, source]));
  const facts = currentClaims.map((claim) => ({
    claimId: claim.id,
    subjectEntityId: claim.subjectEntityId,
    predicate: claim.predicate,
    value: claim.value,
    validFrom: claim.validFrom,
    validTo: claim.validTo,
    authority: claim.authority,
    configurationVersion: configurationVersion.version,
  }));
  const citations = currentClaims.map((claim) => ({
    claimId: claim.id,
    sourceId: claim.sourceId,
    sourceTitle: sourceMap.get(claim.sourceId)?.title ?? "Unavailable source",
    sourceHash: sourceMap.get(claim.sourceId)?.sha256 ?? null,
    sourceSpan: claim.sourceSpan,
    classification: claim.classification,
  }));
  const versionHash = hash({
    workspaceId: context.workspaceId,
    principalId: context.principal.principalId,
    scopeId: selectedScope.id,
    task,
    entityRefs: [...entityRefs].sort(),
    configurationVersion: configurationVersion.version,
    claims: currentClaims.map((claim) => ({ id: claim.id, version: claim.version })),
    blockers: blocking.map((item) => item.id),
  });
  const packId = deterministicId("pack", `${context.workspaceId}:${versionHash}:${timestamp}`);
  const packValue = {
    id: packId,
    workspaceId: context.workspaceId,
    scopeId: selectedScope.id,
    task,
    entityRefs,
    asOf: timestamp,
    versionHash,
    facts,
    constraints: [
      `ontology_version:${configurationVersion.version}`,
      `policy_version:${configurationVersion.version}`,
      `principal:${context.principal.principalId}`,
    ],
    blockers: blocking.map((item) =>
      visibleConflictIds.has(item.id)
        ? `${item.risk}:${item.reason}`
        : `${item.risk}:A restricted conflict in this scope blocks action.`,
    ),
    citations,
    freshnessStatus: blocking.length ? "blocked" : "current",
    createdAt,
    invalidatedAt: null,
  };
  await tx.insert(contextPacks).values(packValue).onConflictDoNothing();
  const [storedPack] = await tx
    .select()
    .from(contextPacks)
    .where(
      and(
        eq(contextPacks.workspaceId, context.workspaceId),
        eq(contextPacks.versionHash, versionHash),
      ),
    )
    .limit(1);
  if (!storedPack) {
    throw new ProductError(
      "CONFLICT",
      "The context pack could not be persisted reproducibly.",
      409,
    );
  }
  for (const [ordinal, claim] of currentClaims.entries()) {
    await tx
      .insert(contextPackEvidence)
      .values({
        id: deterministicId("pack_evidence", `${storedPack.id}:${claim.id}`),
        workspaceId: context.workspaceId,
        contextPackId: storedPack.id,
        claimId: claim.id,
        sourceId: claim.sourceId,
        sourceSpan: claim.sourceSpan,
        ordinal,
        createdAt,
      })
      .onConflictDoNothing();
  }
  return { pack: storedPack, claims: currentClaims };
}

function commandName(value: string): string {
  const aliases: Record<string, string> = {
    "run_agent": "run-agent",
    "record-outcome": "outcome",
    "propose_action": "propose-action",
    "approve_action": "approve-action",
  };
  return aliases[value] ?? value;
}

export async function executeWorkspaceCommand(
  context: CommandContext,
  rawCommand: string,
  input: JsonRecord,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const command = commandName(rawCommand);
  if (command === "propose-action") return proposeAction(context, input, idempotencyKey);
  if (command === "approve-action") return approveAction(context, input, idempotencyKey);
  if (command === "execute-action") return executeAction(context, input, idempotencyKey);
  if (command === "publish-configuration") {
    return publishConfiguration(context, input, idempotencyKey);
  }

  return idempotentMutation(
    context,
    `/workspaces/${context.workspaceSlug}/commands/${command}`,
    idempotencyKey,
    input,
    async (tx) => {
      const timestamp = context.clock.now().toISOString();
      const actorId = await ensureCommandActor(tx, context);

      if (command === "ask") {
        assertPermission(context, PRODUCT_PERMISSIONS.read);
        const task = typeof input.question === "string" && input.question.trim()
          ? input.question.trim().slice(0, 2_000)
          : "Summarize the current operational state.";
        const entityRefs = Array.isArray(input.entityRefs)
          ? input.entityRefs.filter((value): value is string => typeof value === "string")
          : [];
        const compiled = await compileContextPack(
          tx,
          context,
          task,
          entityRefs,
          typeof input.asOf === "string" ? input.asOf : undefined,
          typeof input.scopeId === "string" ? input.scopeId : undefined,
        );
        const entityRows = compiled.claims.length
          ? await tx
              .select()
              .from(entities)
              .where(inArray(entities.id, Array.from(new Set(compiled.claims.map((claim) => claim.subjectEntityId)))))
          : [];
        const candidates = entityRows.map((entity) => {
          const entityClaims = compiled.claims.filter((claim) => claim.subjectEntityId === entity.id);
          return {
            entityId: entity.id,
            name: entity.name,
            subtitle: entity.entityType,
            status: compiled.pack.blockers.length ? "blocked" : "eligible",
            facts: entityClaims.slice(0, 6).map((claim) => ({
              label: claim.predicate,
              value: typeof claim.value === "string" ? claim.value : JSON.stringify(claim.value),
            })),
            reason: compiled.pack.blockers.length
              ? "An unresolved high-risk conflict blocks action."
              : "Current approved evidence is available.",
            evidenceIds: entityClaims.map((claim) => claim.id),
          };
        });
        return {
          answer:
            compiled.claims.length > 0
              ? `${compiled.claims.length} current, permission-scoped claim${compiled.claims.length === 1 ? "" : "s"} support this answer.`
              : "No current approved evidence is available for this question.",
          candidates,
          contextPack: compiled.pack,
        };
      }

      if (command === "ingest") {
        assertPermission(context, PRODUCT_PERMISSIONS.ingest);
        const sourceInput = input.source && typeof input.source === "object" && !Array.isArray(input.source)
          ? (input.source as JsonRecord)
          : input;
        const content = typeof sourceInput.content === "string" ? sourceInput.content : "";
        if (!content.trim()) {
          throw new ProductError("VALIDATION_ERROR", "Source content is required.");
        }
        const scopeId = typeof input.scopeId === "string"
          ? input.scopeId
          : context.allowedScopeIds[0];
        if (!scopeId || !scopeVisible(context, scopeId)) {
          throw new ProductError("SCOPE_DENIED", "A readable target scope is required.", 403);
        }
        const aclWasSupplied = Array.isArray(sourceInput.acl);
        const suppliedAcl = aclWasSupplied
          ? (sourceInput.acl as unknown[]).filter(
              (value): value is string => typeof value === "string" && value.length <= 200,
            )
          : [];
        const sourceAcl: string[] = aclWasSupplied
          ? Array.from(new Set(suppliedAcl)).sort()
          : ["workspace", scopeId];
        const sourceHash = hash(content);
        const logicalSourceKey = typeof sourceInput.sourceKey === "string"
          ? sourceInput.sourceKey
          : `ingest:${sourceHash}`;
        const sourceId = deterministicId(
          "source",
          `${context.workspaceId}:${logicalSourceKey}:${sourceHash}`,
        );
        const existingSourceVersions = await tx
          .select()
          .from(sources)
          .where(
            and(
              eq(sources.workspaceId, context.workspaceId),
              or(
                eq(sources.sourceKey, logicalSourceKey),
                sql`${sources.metadata}->>'logicalSourceKey' = ${logicalSourceKey}`,
              ),
            ),
          )
          .orderBy(asc(sources.capturedAt), asc(sources.id));
        const matchingSource = existingSourceVersions.find((source) => source.sha256 === sourceHash);
        const sourceKey = matchingSource?.sourceKey ?? (
          existingSourceVersions.length
            ? `${logicalSourceKey}@${sourceHash.slice(0, 16)}`
            : logicalSourceKey
        );
        const connectorOccurredAt = typeof sourceInput.occurredAt === "string" &&
          Number.isFinite(Date.parse(sourceInput.occurredAt))
          ? new Date(sourceInput.occurredAt).toISOString()
          : null;
        await tx
          .insert(sources)
          .values({
            id: sourceId,
            workspaceId: context.workspaceId,
            sourceKey,
            sourceType: typeof sourceInput.type === "string" ? sourceInput.type : "upload",
            title: typeof sourceInput.title === "string" ? sourceInput.title.slice(0, 200) : "Uploaded source",
            uri: typeof sourceInput.uri === "string" ? sourceInput.uri : null,
            classification:
              sourceInput.classification === "public" || sourceInput.classification === "synthetic"
                ? sourceInput.classification
                : "private",
            immutable: true,
            sha256: sourceHash,
            capturedAt: timestamp,
            contentText: content,
            metadata: {
              untrustedInput: true,
              scopeId,
              acl: sourceAcl,
              logicalSourceKey,
              supersedesSourceId: existingSourceVersions.at(-1)?.id ?? null,
              ...(connectorOccurredAt ? { connectorOccurredAt } : {}),
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoNothing();
        const eventId = deterministicId("source_event", `${context.workspaceId}:${idempotencyKey}`);
        await tx
          .insert(sourceEvents)
          .values({
            id: eventId,
            workspaceId: context.workspaceId,
            sourceId,
            eventType: "source.ingested",
            idempotencyKey,
            sourceHash,
            payload: { title: sourceInput.title ?? "Uploaded source", untrustedInput: true },
            createdAt: timestamp,
          })
          .onConflictDoNothing();
        const [workspaceProfile] = await tx
          .select({
            version: workspaceProfiles.publishedConfigurationVersion,
          })
          .from(workspaceProfiles)
          .where(eq(workspaceProfiles.workspaceId, context.workspaceId))
          .limit(1);
        if (!workspaceProfile?.version) {
          throw new ProductError(
            "CONFIG_VERSION_MISMATCH",
            "A published workspace configuration is required before evidence can be ingested.",
            409,
          );
        }
        const [publishedConfiguration] = await tx
          .select({ ontology: workspaceConfigurationVersions.ontology })
          .from(workspaceConfigurationVersions)
          .where(
            and(
              eq(workspaceConfigurationVersions.workspaceId, context.workspaceId),
              eq(workspaceConfigurationVersions.version, workspaceProfile.version),
            ),
          )
          .limit(1);
        const ontology = publishedConfiguration?.ontology as {
          predicates?: WorkspaceConfiguration["predicates"];
          entityKinds?: WorkspaceConfiguration["entityKinds"];
        } | undefined;
        if (!ontology?.predicates || !ontology.entityKinds) {
          throw new ProductError(
            "CONFIG_VERSION_MISMATCH",
            "The published ontology version is unavailable.",
            409,
          );
        }
        const configuredPredicates = new Map(
          ontology.predicates.map((predicate) => [predicate.key, predicate]),
        );
        const configuredEntityKinds = new Set(
          ontology.entityKinds.map((entityKind) => entityKind.key),
        );
        await tx
          .insert(sourceChunks)
          .values({
            id: deterministicId("chunk", `${sourceId}:0:${sourceHash}`),
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            sourceId,
            artifactId: null,
            ordinal: 0,
            contentText: content,
            searchText: content,
            contentHash: sourceHash,
            tokenCount: Math.max(1, Math.ceil(content.length / 4)),
            classification:
              sourceInput.classification === "public" || sourceInput.classification === "synthetic"
                ? sourceInput.classification
                : "private",
            acl: sourceAcl,
            configurationVersion: workspaceProfile.version,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoNothing();
        const proposedInputs = Array.isArray(input.claims)
          ? input.claims.filter(
              (value): value is JsonRecord => Boolean(value && typeof value === "object" && !Array.isArray(value)),
            )
          : [];
        if (proposedInputs.length > 0) {
          assertPermission(context, PRODUCT_PERMISSIONS.proposeClaims);
          await consumeActorWriteBudget(tx, context, actorId, proposedInputs.length);
        }
        const proposed: Array<typeof claims.$inferSelect> = [];
        for (const [index, candidate] of proposedInputs.entries()) {
          const predicateKey = typeof candidate.predicate === "string"
            ? candidate.predicate.trim()
            : "";
          const predicateDefinition = configuredPredicates.get(predicateKey);
          if (!predicateDefinition) {
            throw new ProductError(
              "VALIDATION_ERROR",
              `Predicate ${predicateKey || "(missing)"} is not defined in the published workspace configuration.`,
              400,
              { predicate: predicateKey || null, configurationVersion: workspaceProfile.version },
            );
          }

          let subjectId = typeof candidate.subjectId === "string" ? candidate.subjectId : "";
          let subjectType = typeof candidate.subjectType === "string"
            ? candidate.subjectType.trim()
            : "";
          if (subjectId) {
            const [subject] = await tx
              .select()
              .from(entities)
              .where(and(eq(entities.id, subjectId), eq(entities.workspaceId, context.workspaceId)))
              .limit(1);
            if (
              !subject ||
              !scopeVisible(context, subject.scopeId) ||
              (subject.scopeId !== null && subject.scopeId !== scopeId)
            ) {
              throw new ProductError(
                "SCOPE_DENIED",
                "The claim subject is not available in the selected workspace scope.",
                403,
              );
            }
            subjectType = subject.entityType;
          } else if (typeof candidate.subjectName === "string" && candidate.subjectName.trim()) {
            if (!subjectType || !configuredEntityKinds.has(subjectType)) {
              throw new ProductError(
                "VALIDATION_ERROR",
                `Entity kind ${subjectType || "(missing)"} is not defined in the published workspace configuration.`,
              );
            }
            const subjectName = candidate.subjectName.trim().slice(0, 200);
            subjectId = deterministicId(
              "entity",
              `${context.workspaceId}:${scopeId}:${subjectType}:${subjectName}`,
            );
            await tx
              .insert(entities)
              .values({
                id: subjectId,
                workspaceId: context.workspaceId,
                scopeId,
                entityType: subjectType,
                name: subjectName,
                externalRef: null,
                attributes: {},
                createdAt: timestamp,
                updatedAt: timestamp,
              })
              .onConflictDoNothing();
          }
          if (!subjectId) {
            throw new ProductError(
              "VALIDATION_ERROR",
              "Each proposed claim requires a subjectId or a subjectName and configured subjectType.",
            );
          }
          if (!predicateDefinition.subjectKinds.includes(subjectType)) {
            throw new ProductError(
              "VALIDATION_ERROR",
              `Predicate ${predicateKey} cannot be applied to entity kind ${subjectType}.`,
              400,
              { predicate: predicateKey, subjectType },
            );
          }
          try {
            customerSchemaValidator.assert(predicateDefinition.valueSchema, candidate.value);
          } catch (error) {
            if (error instanceof CustomerSchemaError) {
              throw new ProductError(
                "VALIDATION_ERROR",
                `Value for ${predicateKey} does not match its published JSON Schema.`,
                400,
                { predicate: predicateKey, issues: error.issues },
              );
            }
            throw error;
          }
          const sourceSpan = typeof candidate.sourceSpan === "string"
            ? candidate.sourceSpan
            : content.slice(0, 500);
          if (!sourceSpan.trim() || sourceSpan.length > 2_000 || !content.includes(sourceSpan)) {
            throw new ProductError(
              "VALIDATION_ERROR",
              "Every claim sourceSpan must be a non-empty literal excerpt of the ingested source.",
              400,
              { predicate: predicateKey, provenance: "literal_source_span_required" },
            );
          }
          const validFrom = normalizedTimestamp(candidate.validFrom, timestamp, "validFrom");
          const validTo = candidate.validTo === undefined || candidate.validTo === null || candidate.validTo === ""
            ? null
            : normalizedTimestamp(candidate.validTo, timestamp, "validTo");
          if (validTo && new Date(validTo).getTime() <= new Date(validFrom).getTime()) {
            throw new ProductError("VALIDATION_ERROR", "validTo must be later than validFrom.");
          }
          const sourceClassification =
            sourceInput.classification === "public" || sourceInput.classification === "synthetic"
              ? sourceInput.classification
              : "private";
          const claimClassification = sourceClassification === "synthetic"
            ? "synthetic"
            : predicateDefinition.classification === "private" || sourceClassification === "private"
              ? "private"
              : predicateDefinition.classification === "synthetic"
                ? "synthetic"
                : "public";
          const proposedClaim = {
            id: deterministicId("claim", `${eventId}:${index}:${predicateKey}`),
            workspaceId: context.workspaceId,
            scopeId,
            subjectEntityId: subjectId,
            predicate: predicateKey,
            value: candidate.value,
            valueType: typeof candidate.valueType === "string" ? candidate.valueType : typeof candidate.value,
            sourceId,
            sourceEventId: eventId,
            sourceSpan,
            authorActorId: actorId,
            observedAt: timestamp,
            validFrom,
            validTo,
            confidence:
              typeof candidate.confidence === "number"
                ? Math.max(0, Math.min(100, Math.round(candidate.confidence)))
                : 80,
            authority: "operator_note",
            lifecycle: "proposed",
            supersedesClaimId: null,
            classification: claimClassification,
            freshnessSeconds: predicateDefinition.freshnessSeconds ?? 0,
            acl: sourceAcl,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await tx.insert(claims).values(proposedClaim).onConflictDoNothing();
          const approvedClaims = await tx
            .select()
            .from(claims)
            .where(
              and(
                eq(claims.workspaceId, context.workspaceId),
                eq(claims.subjectEntityId, subjectId),
                eq(claims.predicate, predicateKey),
                eq(claims.lifecycle, "approved"),
              ),
            )
            .orderBy(asc(claims.createdAt), asc(claims.id));
          for (const existingClaim of approvedClaims) {
            if (
              stable(existingClaim.value) === stable(proposedClaim.value) ||
              !validityWindowsOverlap(existingClaim, proposedClaim)
            ) {
              continue;
            }
            const conflictId = deterministicId(
              "conflict",
              [context.workspaceId, existingClaim.id, proposedClaim.id].sort().join(":"),
            );
            await tx
              .insert(conflicts)
              .values({
                id: conflictId,
                workspaceId: context.workspaceId,
                scopeId,
                subjectEntityId: subjectId,
                predicate: predicateKey,
                leftClaimId: existingClaim.id,
                rightClaimId: proposedClaim.id,
                risk: predicateDefinition.conflictRisk,
                status: "open",
                reason: `Overlapping ${predicateDefinition.conflictRisk}-risk values require a human decision.`,
                detectedAt: timestamp,
                resolvedAt: null,
                resolutionClaimId: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              })
              .onConflictDoNothing();
          }
          proposed.push(proposedClaim);
        }
        await tx
          .insert(jobs)
          .values({
            id: deterministicId("job", `${context.workspaceId}:${idempotencyKey}`),
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            jobType: "source.ingest",
            status: "completed",
            idempotencyKey: `ingest:${idempotencyKey}`,
            payload: { sourceId, sourceEventId: eventId },
            result: { proposalIds: proposed.map((claim) => claim.id) },
            attempts: 1,
            maxAttempts: 5,
            runAfter: timestamp,
            lockedAt: timestamp,
            lockedBy: "inline-private-beta",
            completedAt: timestamp,
            cancelledAt: null,
            lastError: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoNothing();
        return {
          source: {
            id: sourceId,
            title: sourceInput.title ?? "Uploaded source",
            hash: sourceHash,
            classification: sourceInput.classification ?? "private",
          },
          proposals: proposed,
          message:
            proposed.length > 0
              ? `${proposed.length} claim proposal${proposed.length === 1 ? "" : "s"} entered human review.`
              : "Source stored and indexed. No structured claims were supplied for deterministic extraction.",
        };
      }

      if (command === "approve" || command === "reject") {
        assertPermission(context, PRODUCT_PERMISSIONS.approveClaims);
        if (context.principal.type !== "user") {
          throw new ProductError("FORBIDDEN", "Only humans may decide claim proposals.", 403);
        }
        const claimIds = Array.isArray(input.claimIds)
          ? input.claimIds.filter((value): value is string => typeof value === "string")
          : typeof input.claimId === "string"
            ? [input.claimId]
            : [];
        if (!claimIds.length) throw new ProductError("VALIDATION_ERROR", "claimIds is required.");
        const rows = await tx
          .select()
          .from(claims)
          .where(and(eq(claims.workspaceId, context.workspaceId), inArray(claims.id, claimIds)));
        const eligible = rows.filter(
          (claim) => claim.lifecycle === "proposed" && claimVisible(context, claim),
        );
        if (eligible.length !== claimIds.length) {
          throw new ProductError(
            "CONFLICT",
            "One or more claim proposals are missing, unauthorized, or already decided.",
            409,
          );
        }
        const relatedConflicts = await tx
          .select()
          .from(conflicts)
          .where(
            and(
              eq(conflicts.workspaceId, context.workspaceId),
              eq(conflicts.status, "open"),
              or(
                inArray(conflicts.leftClaimId, claimIds),
                inArray(conflicts.rightClaimId, claimIds),
              ),
            ),
          )
          .orderBy(asc(conflicts.createdAt), asc(conflicts.id));
        const relatedClaimIds = Array.from(new Set(relatedConflicts.flatMap((item) => [
          item.leftClaimId,
          item.rightClaimId,
        ])));
        const relatedClaims = relatedClaimIds.length
          ? await tx
              .select()
              .from(claims)
              .where(
                and(
                  eq(claims.workspaceId, context.workspaceId),
                  inArray(claims.id, relatedClaimIds),
                ),
              )
          : [];
        const relatedClaimMap = new Map(relatedClaims.map((claim) => [claim.id, claim]));
        const resultingLifecycle = command === "approve" ? "approved" : "rejected";
        for (const claim of eligible) {
          const claimConflicts = relatedConflicts.filter(
            (item) => item.leftClaimId === claim.id || item.rightClaimId === claim.id,
          );
          const supersededClaims: Array<typeof claims.$inferSelect> = [];
          if (command === "approve") {
            for (const conflict of claimConflicts) {
              const otherId = conflict.leftClaimId === claim.id
                ? conflict.rightClaimId
                : conflict.leftClaimId;
              const otherClaim = relatedClaimMap.get(otherId);
              if (!otherClaim || otherClaim.lifecycle !== "approved") continue;
              const replacementStartsAt = new Date(claim.validFrom).getTime() > new Date(timestamp).getTime()
                ? claim.validFrom
                : timestamp;
              const shortenedValidTo = !otherClaim.validTo ||
                new Date(otherClaim.validTo).getTime() > new Date(replacementStartsAt).getTime()
                ? replacementStartsAt
                : otherClaim.validTo;
              await tx
                .update(claims)
                .set({
                  lifecycle: "superseded",
                  validTo: shortenedValidTo,
                  version: otherClaim.version + 1,
                  updatedAt: timestamp,
                })
                .where(
                  and(
                    eq(claims.id, otherClaim.id),
                    eq(claims.workspaceId, context.workspaceId),
                    eq(claims.version, otherClaim.version),
                  ),
                );
              supersededClaims.push(otherClaim);
            }
          }
          const supersedesClaimId = supersededClaims[0]?.id ?? null;
          await tx
            .update(claims)
            .set({
              lifecycle: resultingLifecycle,
              supersedesClaimId,
              version: claim.version + 1,
              updatedAt: timestamp,
            })
            .where(
              and(
                eq(claims.id, claim.id),
                eq(claims.workspaceId, context.workspaceId),
                eq(claims.version, claim.version),
              ),
            );
          await tx.insert(approvals).values({
            id: crypto.randomUUID(),
            workspaceId: context.workspaceId,
            claimId: claim.id,
            actorId,
            decision: resultingLifecycle,
            reason: typeof input.reason === "string" ? input.reason.slice(0, 500) : "Human review completed.",
            previousLifecycle: claim.lifecycle,
            resultingLifecycle,
            createdAt: timestamp,
          });
          for (const conflict of claimConflicts) {
            const otherId = conflict.leftClaimId === claim.id
              ? conflict.rightClaimId
              : conflict.leftClaimId;
            const resolutionClaimId = command === "approve"
              ? claim.id
              : relatedClaimMap.get(otherId)?.lifecycle === "approved"
                ? otherId
                : null;
            await tx
              .update(conflicts)
              .set({
                status: "resolved",
                resolvedAt: timestamp,
                resolutionClaimId,
                updatedAt: timestamp,
              })
              .where(
                and(
                  eq(conflicts.id, conflict.id),
                  eq(conflicts.workspaceId, context.workspaceId),
                  eq(conflicts.status, "open"),
                ),
              );
          }
          await writeAudit(tx, {
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            requestId: context.requestId,
            principalType: context.principal.type,
            principalId: context.principal.principalId,
            action: `claim.${resultingLifecycle}`,
            resourceType: "claim",
            resourceId: claim.id,
            policyDecision: "human_decision",
            beforeHash: hash(claim),
            afterHash: hash({
              ...claim,
              lifecycle: resultingLifecycle,
              supersedesClaimId,
              version: claim.version + 1,
            }),
            metadata: {
              resolvedConflictIds: claimConflicts.map((item) => item.id),
              supersededClaimIds: supersededClaims.map((item) => item.id),
            },
          });
        }
        await tx
          .update(contextPacks)
          .set({ invalidatedAt: timestamp })
          .where(
            and(
              eq(contextPacks.workspaceId, context.workspaceId),
              isNull(contextPacks.invalidatedAt),
            ),
          );
        return {
          claimIds,
          decision: resultingLifecycle,
          resolvedConflictIds: relatedConflicts.map((item) => item.id),
        };
      }

      if (command === "run-agent") {
        assertPermission(context, PRODUCT_PERMISSIONS.runAgents);
        const task = typeof input.task === "string" ? input.task.slice(0, 2_000) : "Review current operational state.";
        const compiled = await compileContextPack(
          tx,
          context,
          task,
          [],
          undefined,
          typeof input.scopeId === "string" ? input.scopeId : undefined,
        );
        const [agent] = await tx
          .select()
          .from(actors)
          .where(and(eq(actors.workspaceId, context.workspaceId), eq(actors.actorType, "agent"), eq(actors.active, true)))
          .orderBy(asc(actors.createdAt), asc(actors.id))
          .limit(1);
        if (!agent) throw new ProductError("NOT_FOUND", "No active agent is configured.", 404);
        const runId = crypto.randomUUID();
        const blocked = compiled.pack.blockers.length > 0;
        const decision = {
          status: blocked ? "blocked" : "dry_run_complete",
          proposedActions: blocked ? [] : [{ type: "draft.create", reversible: true }],
          reason: blocked
            ? "High-risk unresolved context blocks the run."
            : "Current scoped context passed deterministic preflight.",
        };
        const receiptHash = hash({ runId, context: compiled.pack.versionHash, decision, timestamp });
        const run = {
          id: runId,
          workspaceId: context.workspaceId,
          agentActorId: agent.id,
          task,
          status: blocked ? "blocked" : "completed",
          mode: "deterministic-private-beta",
          contextPackId: compiled.pack.id,
          contextVersionHash: compiled.pack.versionHash,
          model: "deterministic",
          modelVersion: "product-v1",
          promptVersion: "workspace-policy-v1",
          tools: agent.permissions,
          decision,
          approvalIds: [] as string[],
          latencyMs: 0,
          tokenUsage: 0,
          costMicros: 0,
          startedAt: timestamp,
          completedAt: timestamp,
          receiptHash,
          replayOfRunId: null,
          createdAt: timestamp,
        };
        await tx.insert(agentRuns).values(run);
        await tx.insert(runEvents).values({
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          runId,
          sequence: 1,
          eventType: "agent.completed",
          payload: { contextVersionHash: compiled.pack.versionHash, decision },
          createdAt: timestamp,
        });
        return { run, contextPack: compiled.pack };
      }

      if (command === "replay") {
        assertPermission(context, PRODUCT_PERMISSIONS.read);
        const runId = typeof input.runId === "string" ? input.runId : "";
        const [original] = await tx
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, context.workspaceId)))
          .limit(1);
        if (!original) throw new ProductError("NOT_FOUND", "Agent run was not found.", 404);
        const [originalPack] = await tx
          .select()
          .from(contextPacks)
          .where(
            and(
              eq(contextPacks.id, original.contextPackId),
              eq(contextPacks.workspaceId, context.workspaceId),
            ),
          )
          .limit(1);
        if (!originalPack) throw new ProductError("NOT_FOUND", "Agent context pack was not found.", 404);
        await assertContextPackVisible(tx, context, originalPack);
        const compiled = await compileContextPack(
          tx,
          context,
          original.task,
          [],
          undefined,
          originalPack.scopeId,
        );
        const changed = compiled.pack.versionHash !== original.contextVersionHash;
        const replayRun = {
          ...original,
          id: crypto.randomUUID(),
          contextPackId: compiled.pack.id,
          contextVersionHash: compiled.pack.versionHash,
          decision: {
            ...original.decision,
            replayBlocked: compiled.pack.blockers.length > 0,
            contextChanged: changed,
          },
          startedAt: timestamp,
          completedAt: timestamp,
          receiptHash: hash({ original: original.id, current: compiled.pack.versionHash, timestamp }),
          replayOfRunId: original.id,
          createdAt: timestamp,
        };
        await tx.insert(agentRuns).values(replayRun);
        return {
          replay: replayRun,
          comparison: {
            previousContextHash: original.contextVersionHash,
            currentContextHash: compiled.pack.versionHash,
            changed,
            nowBlocked: compiled.pack.blockers.length > 0,
          },
        };
      }

      if (command === "outcome") {
        assertPermission(context, PRODUCT_PERMISSIONS.runAgents);
        const runId = typeof input.runId === "string" ? input.runId : "";
        const [run] = await tx
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, context.workspaceId)))
          .limit(1);
        if (!run) throw new ProductError("NOT_FOUND", "Agent run was not found.", 404);
        const [runPack] = await tx
          .select()
          .from(contextPacks)
          .where(
            and(
              eq(contextPacks.id, run.contextPackId),
              eq(contextPacks.workspaceId, context.workspaceId),
            ),
          )
          .limit(1);
        if (!runPack) throw new ProductError("NOT_FOUND", "Agent context pack was not found.", 404);
        await assertContextPackVisible(tx, context, runPack);
        const metrics = input.metrics && typeof input.metrics === "object" && !Array.isArray(input.metrics)
          ? Object.fromEntries(
              Object.entries(input.metrics as Record<string, unknown>).filter(
                (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
              ),
            )
          : {};
        const outcome = {
          id: crypto.randomUUID(),
          workspaceId: context.workspaceId,
          runId,
          status: typeof input.status === "string" ? input.status : "recorded",
          metrics,
          notes: typeof input.notes === "string" ? input.notes.slice(0, 2_000) : "",
          learningClaimId: null,
          recordedByActorId: actorId,
          receiptHash: hash({ runId, metrics, status: input.status, timestamp }),
          createdAt: timestamp,
        };
        await tx.insert(outcomes).values(outcome);
        return { outcome };
      }

      throw new ProductError("NOT_FOUND", `Unknown workspace command: ${command}.`, 404);
    },
  );
}

export async function productCapabilities(): Promise<Record<string, unknown>> {
  try {
    const result = await getDb().execute(sql`
      select
        exists(select 1 from pg_extension where extname = 'vector') as vector_enabled,
        exists(
          select 1 from information_schema.columns
          where table_name = 'source_chunks' and column_name = 'embedding_vector'
        ) as vector_column
    `);
    const row = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const vector = row.vector_enabled === true && row.vector_column === true;
    return {
      retrieval: {
        fullText: true,
        vector,
        mode: vector ? "hybrid" : "keyword-only",
        vectorDimensions: vector ? 768 : null,
      },
      auth: {
        supabase: Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
            (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY),
        ),
        workos: Boolean(process.env.WORKOS_API_KEY),
        localBootstrap: !process.env.VERCEL && !process.env.CI,
      },
      deployment: {
        dedicated: process.env.COMMONSTATE_DEPLOYMENT_MODE === "dedicated",
        runtimeRls: Boolean(process.env.PRODUCT_DATABASE_URL),
      },
    };
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      throw new ProductError("STORAGE_UNAVAILABLE", "PostgreSQL storage is unavailable.", 503);
    }
    throw error;
  }
}

export async function searchSourceEvidence(
  context: CommandContext,
  query: string,
  embedding: number[] | null,
  limit = 12,
): Promise<Array<Record<string, unknown>>> {
  assertPermission(context, PRODUCT_PERMISSIONS.read);
  const normalizedQuery = query.trim().slice(0, 2_000);
  if (!normalizedQuery) throw new ProductError("VALIDATION_ERROR", "Search query is required.");
  if (embedding && (embedding.length !== 768 || embedding.some((value) => !Number.isFinite(value)))) {
    throw new ProductError("VALIDATION_ERROR", "Embedding must contain 768 finite numbers.");
  }
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  return withTenant(context, async (tx) => {
    const aclConditions = [
      sql`${sourceChunks.classification} = 'public'`,
      sql`${sourceChunks.acl} @> ${JSON.stringify(["workspace"])}::jsonb`,
      sql`${sourceChunks.acl} @> ${JSON.stringify([context.principal.principalId])}::jsonb`,
      ...context.allowedScopeIds.map(
        (scopeId) => sql`${sourceChunks.acl} @> ${JSON.stringify([scopeId])}::jsonb`,
      ),
    ];
    const aclFilter = sql`(${sql.join(aclConditions, sql` or `)})`;
    const rank = sql<number>`ts_rank_cd(to_tsvector('english', ${sourceChunks.searchText}), plainto_tsquery('english', ${normalizedQuery}))`;
    const keywordRows = await tx
      .select({
        id: sourceChunks.id,
        sourceId: sourceChunks.sourceId,
        ordinal: sourceChunks.ordinal,
        contentText: sourceChunks.contentText,
        contentHash: sourceChunks.contentHash,
        classification: sourceChunks.classification,
        configurationVersion: sourceChunks.configurationVersion,
        rank,
      })
      .from(sourceChunks)
      .where(
        and(
          eq(sourceChunks.workspaceId, context.workspaceId),
          aclFilter,
          sql`to_tsvector('english', ${sourceChunks.searchText}) @@ plainto_tsquery('english', ${normalizedQuery})`,
        ),
      )
      .orderBy(desc(rank), asc(sourceChunks.id))
      .limit(Math.min(200, boundedLimit * 4));

    const vectorScores = new Map<string, number>();
    if (embedding) {
      const capability = await tx.execute(sql`
        select exists(
          select 1 from information_schema.columns
          where table_name = 'source_chunks' and column_name = 'embedding_vector'
        ) as enabled
      `);
      const vectorEnabled =
        ((capability as unknown as Array<Record<string, unknown>>)[0]?.enabled ?? false) === true;
      if (vectorEnabled) {
        const literal = `[${embedding.join(",")}]`;
        const rows = await tx.execute(sql`
          select id, 1 - (embedding_vector <=> ${literal}::vector) as vector_score
          from source_chunks
          where workspace_id = ${context.workspaceId}
            and ${aclFilter}
            and embedding_vector is not null
          order by embedding_vector <=> ${literal}::vector, id
          limit ${Math.min(200, boundedLimit * 4)}
        `);
        for (const row of rows as unknown as Array<Record<string, unknown>>) {
          if (typeof row.id === "string") vectorScores.set(row.id, Number(row.vector_score) || 0);
        }
      }
    }

    const vectorOnlyIds = Array.from(vectorScores.keys()).filter(
      (id) => !keywordRows.some((row) => row.id === id),
    );
    const vectorOnlyRows = vectorOnlyIds.length
      ? await tx
          .select({
            id: sourceChunks.id,
            sourceId: sourceChunks.sourceId,
            ordinal: sourceChunks.ordinal,
            contentText: sourceChunks.contentText,
            contentHash: sourceChunks.contentHash,
            classification: sourceChunks.classification,
            configurationVersion: sourceChunks.configurationVersion,
          })
          .from(sourceChunks)
          .where(
            and(
              eq(sourceChunks.workspaceId, context.workspaceId),
              aclFilter,
              inArray(sourceChunks.id, vectorOnlyIds),
            ),
          )
      : [];
    const combined = [
      ...keywordRows.map((row) => ({ ...row, keywordScore: Number(row.rank) || 0 })),
      ...vectorOnlyRows.map((row) => ({ ...row, keywordScore: 0 })),
    ];
    const sourceIds = Array.from(new Set(combined.map((row) => row.sourceId)));
    const sourceRows = sourceIds.length
      ? await tx
          .select({ id: sources.id, title: sources.title, sha256: sources.sha256 })
          .from(sources)
          .where(and(eq(sources.workspaceId, context.workspaceId), inArray(sources.id, sourceIds)))
      : [];
    const sourceMap = new Map(sourceRows.map((source) => [source.id, source]));
    return combined
      .map((row) => ({
        id: row.id,
        excerpt: row.contentText.slice(0, 800),
        contentHash: row.contentHash,
        classification: row.classification,
        configurationVersion: row.configurationVersion,
        source: sourceMap.get(row.sourceId) ?? null,
        keywordScore: row.keywordScore,
        vectorScore: vectorScores.get(row.id) ?? null,
        score:
          (embedding ? 0.55 : 1) * row.keywordScore +
          (embedding ? 0.45 : 0) * (vectorScores.get(row.id) ?? 0),
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, boundedLimit);
  });
}

export async function getClaimEvidence(
  context: CommandContext,
  claimIds: string[],
): Promise<Array<Record<string, unknown>>> {
  assertPermission(context, PRODUCT_PERMISSIONS.read);
  if (!claimIds.length) return [];
  return withTenant(context, async (tx) => {
    const rows = await tx
      .select({ claim: claims, sourceTitle: sources.title, sourceHash: sources.sha256 })
      .from(claims)
      .innerJoin(sources, eq(claims.sourceId, sources.id))
      .where(
        and(
          eq(claims.workspaceId, context.workspaceId),
          inArray(claims.id, claimIds.slice(0, 100)),
        ),
      );
    return rows
      .filter((row) => claimVisible(context, row.claim))
      .map((row) => ({
        claimId: row.claim.id,
        subjectEntityId: row.claim.subjectEntityId,
        predicate: row.claim.predicate,
        value: row.claim.value,
        lifecycle: row.claim.lifecycle,
        validFrom: row.claim.validFrom,
        validTo: row.claim.validTo,
        sourceTitle: row.sourceTitle,
        sourceSpan: row.claim.sourceSpan,
        sourceHash: row.sourceHash,
        classification: row.claim.classification,
      }));
  });
}

export async function getPendingClaimApprovals(
  context: CommandContext,
  claimIds: string[],
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.read);
  return withTenant(context, async (tx) => {
    const rows = claimIds.length
      ? await tx
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.workspaceId, context.workspaceId),
              eq(claims.lifecycle, "proposed"),
              inArray(claims.id, claimIds.slice(0, 100)),
            ),
          )
      : [];
    return {
      status: "human_approval_required",
      proposalIds: rows.filter((row) => claimVisible(context, row)).map((row) => row.id),
    };
  });
}

export async function getActionStatus(
  context: CommandContext,
  proposalId: string,
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.read);
  return withTenant(context, async (tx) => {
    const [proposal] = await tx
      .select()
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.workspaceId, context.workspaceId),
          eq(actionProposals.id, proposalId),
        ),
      )
      .limit(1);
    if (!proposal) throw new ProductError("NOT_FOUND", "Action proposal was not found.", 404);
    await authorizeActionEvidence(tx, context, proposal);
    const approvalRows = await tx
      .select()
      .from(actionApprovals)
      .where(eq(actionApprovals.actionProposalId, proposal.id))
      .orderBy(asc(actionApprovals.createdAt), asc(actionApprovals.id));
    const [receipt] = await tx
      .select()
      .from(actionReceipts)
      .where(eq(actionReceipts.actionProposalId, proposal.id))
      .limit(1);
    return {
      proposal,
      approvals: approvalRows,
      receipt: receipt ?? null,
      remainingApprovals: Math.max(
        0,
        proposal.requiredApprovals -
          approvalRows.filter((approval) => approval.decision === "approved").length,
      ),
    };
  });
}

export async function resolveWebhookConnector(connectorId: string): Promise<{
  connector: typeof connectors.$inferSelect;
  organizationId: string;
  workspaceId: string;
  workspaceSlug: string;
  scopeId: string;
}> {
  const db = getDb();
  const [row] = await db
    .select({ connector: connectors, workspace: workspaces })
    .from(connectors)
    .innerJoin(workspaces, eq(connectors.workspaceId, workspaces.id))
    .where(eq(connectors.id, connectorId))
    .limit(1);
  if (!row || row.connector.connectorType !== "webhook" || row.connector.status !== "configured") {
    throw new ProductError("NOT_FOUND", "Configured webhook connector was not found.", 404);
  }
  const configuredScope =
    typeof row.connector.configuration.scopeId === "string"
      ? row.connector.configuration.scopeId
      : null;
  const [scope] = configuredScope
    ? await db
        .select({ id: scopes.id })
        .from(scopes)
        .where(
          and(eq(scopes.id, configuredScope), eq(scopes.workspaceId, row.workspace.id)),
        )
        .limit(1)
    : await db
        .select({ id: scopes.id })
        .from(scopes)
        .where(eq(scopes.workspaceId, row.workspace.id))
        .orderBy(asc(scopes.createdAt), asc(scopes.id))
        .limit(1);
  if (!scope) throw new ProductError("SCOPE_DENIED", "Webhook connector has no valid scope.", 409);
  return {
    connector: row.connector,
    organizationId: row.connector.organizationId,
    workspaceId: row.connector.workspaceId,
    workspaceSlug: row.workspace.slug,
    scopeId: scope.id,
  };
}

export async function applyConnectorControlEvent(
  context: CommandContext,
  input: {
    connectorId: string;
    externalId: string;
    eventType: "delete" | "acl_changed";
    acl: string[];
    occurredAt: string;
    deliveryId: string;
  },
): Promise<Record<string, unknown>> {
  assertPermission(context, PRODUCT_PERMISSIONS.ingest);
  return idempotentMutation(
    context,
    `/connectors/${input.connectorId}/events/${input.eventType}`,
    input.deliveryId,
    input,
    async (tx) => {
      const sourceKey = `connector:${input.connectorId}:${input.externalId}`;
      const sourceVersions = await tx
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.workspaceId, context.workspaceId),
            or(
              eq(sources.sourceKey, sourceKey),
              sql`${sources.metadata}->>'logicalSourceKey' = ${sourceKey}`,
            ),
          ),
        )
        .orderBy(asc(sources.capturedAt), asc(sources.id));
      const source = sourceVersions.at(-1);
      if (!source) throw new ProductError("NOT_FOUND", "Connector source was not found.", 404);
      const sourceIds = sourceVersions.map((version) => version.id);
      const previousOccurredAt = Math.max(
        ...sourceVersions.map((version) =>
          typeof version.metadata.connectorOccurredAt === "string" &&
          Number.isFinite(Date.parse(version.metadata.connectorOccurredAt))
            ? Date.parse(version.metadata.connectorOccurredAt)
            : Number.NEGATIVE_INFINITY,
        ),
      );
      const incomingOccurredAt = Date.parse(input.occurredAt);
      if (!Number.isFinite(incomingOccurredAt)) {
        throw new ProductError("VALIDATION_ERROR", "Connector occurredAt must be a valid timestamp.");
      }
      if (incomingOccurredAt <= previousOccurredAt) {
        return {
          sourceId: source.id,
          eventType: input.eventType,
          applied: false,
          ignored: "stale_or_out_of_order",
        };
      }
      const timestamp = context.clock.now().toISOString();
      const acl = Array.from(new Set(input.acl)).sort();
      const metadata = sourceVersions.map((version) => ({
        sourceId: version.id,
        value: {
          ...version.metadata,
          acl,
          connectorEvent: input.eventType,
          connectorOccurredAt: input.occurredAt,
          ...(input.eventType === "delete" ? { deletedAt: input.occurredAt } : {}),
        },
      }));
      for (const version of metadata) {
        await tx
          .update(sources)
          .set({ metadata: version.value, updatedAt: timestamp })
          .where(
            and(eq(sources.id, version.sourceId), eq(sources.workspaceId, context.workspaceId)),
          );
      }
      if (input.eventType === "delete") {
        await tx
          .update(claims)
          .set({ lifecycle: "expired", validTo: input.occurredAt, updatedAt: timestamp })
          .where(and(eq(claims.workspaceId, context.workspaceId), inArray(claims.sourceId, sourceIds)));
        await tx
          .update(sourceChunks)
          .set({ acl: [], updatedAt: timestamp })
          .where(
            and(
              eq(sourceChunks.workspaceId, context.workspaceId),
              inArray(sourceChunks.sourceId, sourceIds),
            ),
          );
      } else {
        await tx
          .update(claims)
          .set({ acl, updatedAt: timestamp })
          .where(and(eq(claims.workspaceId, context.workspaceId), inArray(claims.sourceId, sourceIds)));
        await tx
          .update(sourceChunks)
          .set({ acl, updatedAt: timestamp })
          .where(
            and(
              eq(sourceChunks.workspaceId, context.workspaceId),
              inArray(sourceChunks.sourceId, sourceIds),
            ),
          );
      }
      const affectedPackRows = await tx
        .select({ contextPackId: contextPackEvidence.contextPackId })
        .from(contextPackEvidence)
        .where(
          and(
            eq(contextPackEvidence.workspaceId, context.workspaceId),
            inArray(contextPackEvidence.sourceId, sourceIds),
          ),
        );
      const affectedPackIds = Array.from(
        new Set(affectedPackRows.map((row) => row.contextPackId)),
      );
      if (affectedPackIds.length) {
        await tx
          .update(contextPacks)
          .set({ invalidatedAt: timestamp })
          .where(
            and(
              eq(contextPacks.workspaceId, context.workspaceId),
              inArray(contextPacks.id, affectedPackIds),
              isNull(contextPacks.invalidatedAt),
            ),
          );
      }
      await tx.insert(sourceEvents).values({
        id: deterministicId("source_event", `${context.workspaceId}:${input.deliveryId}`),
        workspaceId: context.workspaceId,
        sourceId: source.id,
        eventType: input.eventType,
        idempotencyKey: input.deliveryId,
        sourceHash: source.sha256,
        payload: { connectorId: input.connectorId, externalId: input.externalId, acl, sourceIds },
        createdAt: timestamp,
      });
      await tx
        .insert(jobs)
        .values({
          id: deterministicId("job", `${context.workspaceId}:${input.deliveryId}`),
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          jobType: `source.${input.eventType}`,
          status: "completed",
          idempotencyKey: `connector:${input.deliveryId}`,
          payload: { sourceId: source.id, sourceIds, connectorId: input.connectorId },
          result: { applied: true },
          attempts: 1,
          maxAttempts: 5,
          runAfter: timestamp,
          lockedAt: timestamp,
          lockedBy: "inline-private-beta",
          completedAt: timestamp,
          cancelledAt: null,
          lastError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoNothing();
      await writeAudit(tx, {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        requestId: context.requestId,
        principalType: context.principal.type,
        principalId: context.principal.principalId,
        action: `connector.${input.eventType}`,
        resourceType: "source",
        resourceId: source.id,
        policyDecision: "allow",
        beforeHash: hash(sourceVersions.map((version) => ({ id: version.id, metadata: version.metadata }))),
        afterHash: hash(metadata),
        metadata: { connectorId: input.connectorId, deliveryId: input.deliveryId },
      });
      return {
        sourceId: source.id,
        sourceIds,
        eventType: input.eventType,
        applied: true,
        invalidatedContextPackIds: affectedPackIds,
      };
    },
  );
}
