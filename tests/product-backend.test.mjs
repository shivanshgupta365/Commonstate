import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL?.trim();
const skipReason = databaseUrl
  ? false
  : "DATABASE_URL is not configured; multi-company backend integration is skipped.";

test("multi-company backend provisions, isolates, cites, and policy-checks product workspaces", {
  skip: skipReason,
  timeout: 30_000,
}, async () => {
  process.env.PRODUCT_DATABASE_URL ||= databaseUrl;
  process.env.COMMONSTATE_CREDENTIAL_PEPPER ||= "product-backend-test-pepper";
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const database = await import("../db/index.ts");
  const schema = await import("../db/schema.ts");
  const { eq, sql } = await import("drizzle-orm");
  const repository = await import("../lib/product/repository.ts");
  const { productMcp } = await import("../lib/product/mcp.ts");
  const { OWNER_PERMISSIONS } = await import("../lib/product/types.ts");
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const principal = {
    type: "user",
    principalId: `product-owner-${suffix}`,
    actorId: `user:product-owner-${suffix}`,
    email: `owner-${suffix}@example.test`,
    displayName: "Product backend test owner",
  };

  try {
    const first = await repository.provisionWorkspace(
      principal,
      {
        organizationName: `Test Company ${suffix}`,
        workspaceName: `AI Operations ${suffix}`,
        template: "ai-operations",
        publish: true,
      },
      `provision-${suffix}`,
    );
    const second = await repository.provisionWorkspace(
      principal,
      {
        organizationName: `Test Company ${suffix}`,
        workspaceName: `AI Operations ${suffix}`,
        template: "ai-operations",
        publish: true,
      },
      `provision-${suffix}`,
    );
    assert.equal(second.organization.id, first.organization.id);
    assert.equal(second.workspace.id, first.workspace.id);

    const db = database.getDb();
    const scopeRows = await db
      .select({ id: schema.scopes.id })
      .from(schema.scopes)
      .where(eq(schema.scopes.workspaceId, first.workspace.id))
      .orderBy(schema.scopes.createdAt, schema.scopes.id);
    const rootScopeId = scopeRows[0].id;
    const context = {
      principal: {
        type: "user",
        principalId: principal.principalId,
        actorId: `actor:${first.workspace.id}:${principal.principalId}`,
      },
      organizationId: first.organization.id,
      workspaceId: first.workspace.id,
      workspaceSlug: first.workspace.slug,
      allowedScopeIds: [rootScopeId],
      permissions: [...OWNER_PERMISSIONS],
      requestId: `request-${suffix}`,
      clock: { now: () => new Date() },
    };

    const ingested = await repository.executeWorkspaceCommand(
      context,
      "ingest",
      {
        scopeId: rootScopeId,
        source: {
          title: "Production run policy",
          type: "upload",
          classification: "private",
          content: "Operations Agent may use incident.runbook when current approval is present.",
        },
        claims: [
          {
            subjectName: "Operations Agent",
            subjectType: "agent",
            predicate: "agent.allowed_tool",
            value: "incident.runbook",
            sourceSpan: "Operations Agent may use incident.runbook when current approval is present.",
          },
        ],
      },
      `ingest-${suffix}`,
    );
    assert.equal(ingested.proposals.length, 1);
    const claimId = ingested.proposals[0].id;
    const repeated = await repository.executeWorkspaceCommand(
      context,
      "ingest",
      {
        scopeId: rootScopeId,
        source: {
          title: "Production run policy",
          type: "upload",
          classification: "private",
          content: "Operations Agent may use incident.runbook when current approval is present.",
        },
        claims: [
          {
            subjectName: "Operations Agent",
            subjectType: "agent",
            predicate: "agent.allowed_tool",
            value: "incident.runbook",
            sourceSpan: "Operations Agent may use incident.runbook when current approval is present.",
          },
        ],
      },
      `ingest-${suffix}`,
    );
    assert.equal(repeated.proposals[0].id, claimId);

    await repository.executeWorkspaceCommand(
      context,
      "approve",
      { claimIds: [claimId], reason: "Verified against the current runbook." },
      `approve-${suffix}`,
    );
    const answer = await repository.executeWorkspaceCommand(
      context,
      "ask",
      { question: "Which tools may the Operations Agent use?" },
      `ask-${suffix}`,
    );
    assert.equal(answer.contextPack.citations[0].claimId, claimId);
    assert.match(answer.contextPack.versionHash, /^[a-f0-9]{64}$/);

    const state = await repository.getProductState(context);
    assert.equal(state.claims.some((claim) => claim.id === claimId), true);
    assert.equal(state.sources.some((source) => "contentText" in source), false);

    const workflowContext = {
      ...context,
      allowedScopeIds: [scopeRows.at(-1).id],
      requestId: `workflow-scope-${suffix}`,
    };
    const teamOnlyContext = {
      ...context,
      allowedScopeIds: [scopeRows[1].id],
      requestId: `team-scope-${suffix}`,
    };
    const scopedRun = await repository.executeWorkspaceCommand(
      workflowContext,
      "run-agent",
      { task: "Review only the granted workflow scope." },
      `scoped-run-${suffix}`,
    );
    await assert.rejects(
      repository.executeWorkspaceCommand(
        teamOnlyContext,
        "replay",
        { runId: scopedRun.run.id },
        `cross-scope-replay-${suffix}`,
      ),
      (error) => error?.code === "SCOPE_DENIED",
    );
    await assert.rejects(
      repository.executeWorkspaceCommand(
        teamOnlyContext,
        "outcome",
        { runId: scopedRun.run.id, status: "should-not-record" },
        `cross-scope-outcome-${suffix}`,
      ),
      (error) => error?.code === "SCOPE_DENIED",
    );
    const scopedAction = await repository.proposeAction(
      workflowContext,
      {
        actionType: "draft.create",
        contextPackId: scopedRun.contextPack.id,
        payload: { title: "Scoped draft" },
      },
      `scoped-action-${suffix}`,
    );
    await assert.rejects(
      repository.getActionStatus(teamOnlyContext, scopedAction.proposal.id),
      (error) => error?.code === "SCOPE_DENIED",
    );

    await assert.rejects(
      repository.executeWorkspaceCommand(
        context,
        "ingest",
        {
          scopeId: rootScopeId,
          source: {
            title: "Unverifiable note",
            content: "This source does not contain the claimed quotation.",
          },
          claims: [{
            subjectName: "Operations Agent",
            subjectType: "agent",
            predicate: "agent.allowed_tool",
            value: "unverified.tool",
            sourceSpan: "Fabricated source excerpt",
          }],
        },
        `invalid-provenance-${suffix}`,
      ),
      (error) => error?.code === "VALIDATION_ERROR" && /literal excerpt/.test(error.message),
    );
    await assert.rejects(
      repository.executeWorkspaceCommand(
        context,
        "ingest",
        {
          scopeId: rootScopeId,
          source: {
            title: "Invalid structured value",
            content: "Operations Agent configuration is malformed.",
          },
          claims: [{
            subjectName: "Operations Agent",
            subjectType: "agent",
            predicate: "agent.allowed_tool",
            value: { tool: "not-a-string" },
            sourceSpan: "Operations Agent configuration is malformed.",
          }],
        },
        `invalid-schema-${suffix}`,
      ),
      (error) => error?.code === "VALIDATION_ERROR" && /JSON Schema/.test(error.message),
    );

    const changedPolicy = await repository.executeWorkspaceCommand(
      context,
      "ingest",
      {
        scopeId: rootScopeId,
        source: {
          title: "Replacement production run policy",
          content: "Operations Agent may use safe.readonly under the replacement policy.",
        },
        claims: [{
          subjectName: "Operations Agent",
          subjectType: "agent",
          predicate: "agent.allowed_tool",
          value: "safe.readonly",
          sourceSpan: "Operations Agent may use safe.readonly under the replacement policy.",
        }],
      },
      `changed-policy-${suffix}`,
    );
    const replacementClaimId = changedPolicy.proposals[0].id;
    const conflictedState = await repository.getProductState(context);
    const openConflict = conflictedState.conflicts.find(
      (conflict) => conflict.rightClaimId === replacementClaimId && conflict.status === "open",
    );
    assert.ok(openConflict, "overlapping incompatible configured claims create a visible conflict");
    assert.equal(openConflict.risk, "high");
    const blockedAnswer = await repository.executeWorkspaceCommand(
      context,
      "ask",
      { question: "Can the Operations Agent act while the policy conflict is unresolved?" },
      `blocked-ask-${suffix}`,
    );
    assert.equal(blockedAnswer.contextPack.freshnessStatus, "blocked");
    const replacementApproval = await repository.executeWorkspaceCommand(
      context,
      "approve",
      { claimIds: [replacementClaimId], reason: "The replacement policy is authoritative." },
      `replacement-approve-${suffix}`,
    );
    assert.deepEqual(replacementApproval.resolvedConflictIds, [openConflict.id]);
    const resolvedState = await repository.getProductState(context);
    assert.equal(
      resolvedState.claims.find((claim) => claim.id === claimId)?.lifecycle,
      "superseded",
    );
    assert.equal(
      resolvedState.claims.find((claim) => claim.id === replacementClaimId)?.supersedesClaimId,
      claimId,
    );
    assert.equal(
      resolvedState.conflicts.find((conflict) => conflict.id === openConflict.id)?.status,
      "resolved",
    );

    const hiddenPolicy = await repository.executeWorkspaceCommand(
      context,
      "ingest",
      {
        scopeId: rootScopeId,
        source: {
          title: "Restricted proposed policy",
          content: "Operations Agent may use owner-only.tool under a restricted note.",
          acl: [principal.principalId],
        },
        claims: [{
          subjectName: "Operations Agent",
          subjectType: "agent",
          predicate: "agent.allowed_tool",
          value: "owner-only.tool",
          sourceSpan: "Operations Agent may use owner-only.tool under a restricted note.",
        }],
      },
      `hidden-policy-${suffix}`,
    );
    const hiddenClaimId = hiddenPolicy.proposals[0].id;
    const restrictedReader = {
      ...context,
      principal: {
        type: "service_account",
        principalId: `restricted-reader-${suffix}`,
        actorId: `service-account:restricted-reader-${suffix}`,
      },
      permissions: ["workspace:read"],
      requestId: `restricted-reader-${suffix}`,
    };
    const restrictedAnswer = await repository.executeWorkspaceCommand(
      restrictedReader,
      "ask",
      { question: "May the agent act while a restricted conflict exists?" },
      `restricted-ask-${suffix}`,
    );
    assert.equal(restrictedAnswer.contextPack.freshnessStatus, "blocked");
    assert.equal(
      restrictedAnswer.contextPack.blockers.some((blocker) => /restricted conflict/.test(blocker)),
      true,
    );
    assert.equal(
      restrictedAnswer.contextPack.citations.some((citation) => citation.claimId === hiddenClaimId),
      false,
      "the blocker is redacted instead of leaking hidden evidence",
    );
    await repository.executeWorkspaceCommand(
      context,
      "reject",
      { claimIds: [hiddenClaimId], reason: "Restricted proposal was not accepted." },
      `hidden-policy-reject-${suffix}`,
    );

    const rejectedPolicy = await repository.executeWorkspaceCommand(
      context,
      "ingest",
      {
        scopeId: rootScopeId,
        source: {
          title: "Unaccepted experimental policy",
          content: "Operations Agent may use experimental.write under an unaccepted policy.",
        },
        claims: [{
          subjectName: "Operations Agent",
          subjectType: "agent",
          predicate: "agent.allowed_tool",
          value: "experimental.write",
          sourceSpan: "Operations Agent may use experimental.write under an unaccepted policy.",
        }],
      },
      `rejected-policy-${suffix}`,
    );
    const rejectedClaimId = rejectedPolicy.proposals[0].id;
    const rejection = await repository.executeWorkspaceCommand(
      context,
      "reject",
      { claimIds: [rejectedClaimId], reason: "The experimental change was not approved." },
      `reject-policy-${suffix}`,
    );
    assert.equal(rejection.decision, "rejected");
    const postRejectionState = await repository.getProductState(context);
    assert.equal(
      postRejectionState.claims.find((claim) => claim.id === replacementClaimId)?.lifecycle,
      "approved",
    );
    assert.equal(
      postRejectionState.conflicts.some(
        (conflict) => conflict.rightClaimId === rejectedClaimId && conflict.status === "open",
      ),
      false,
    );

    const concurrentPublishes = await Promise.allSettled([
      repository.publishConfiguration(
        { ...context, requestId: `publish-a-${suffix}` },
        { expectedVersion: 1 },
        `publish-a-${suffix}`,
      ),
      repository.publishConfiguration(
        { ...context, requestId: `publish-b-${suffix}` },
        { expectedVersion: 1 },
        `publish-b-${suffix}`,
      ),
    ]);
    assert.equal(
      concurrentPublishes.filter((result) => result.status === "fulfilled").length,
      1,
      "exactly one concurrent configuration publish succeeds",
    );
    const stalePublish = concurrentPublishes.find((result) => result.status === "rejected");
    assert.equal(stalePublish?.reason?.code, "CONCURRENT_UPDATE");
    const versionTwoRows = await db
      .select({ id: schema.workspaceConfigurationVersions.id })
      .from(schema.workspaceConfigurationVersions)
      .where(
        sql`${schema.workspaceConfigurationVersions.workspaceId} = ${first.workspace.id}
          and ${schema.workspaceConfigurationVersions.version} = 2`,
      );
    assert.equal(versionTwoRows.length, 1, "the stale publish leaves no partial configuration version");

    const revoked = await repository.getProductState({ ...context, allowedScopeIds: [] });
    assert.equal(revoked.scopes.length, 0, "an empty scope grant must fail closed");
    assert.equal(revoked.claims.length, 0, "revoked principals cannot read scoped claims");

    const critical = await repository.proposeAction(
      context,
      { actionType: "payment.execute", payload: { amount: 100 } },
      `critical-action-${suffix}`,
    );
    assert.equal(critical.proposal.riskTier, "critical");
    assert.equal(critical.proposal.status, "blocked");

    const readOnlyContext = {
      ...context,
      permissions: ["workspace:read"],
      requestId: `read-only-${suffix}`,
    };
    const readOnlyState = await repository.getProductState(readOnlyContext);
    assert.equal(readOnlyState.actions.length, 0, "read-only principals do not receive action payloads");
    for (const resource of ["members", "connectors", "actions", "audit-events"]) {
      await assert.rejects(
        repository.listProductResource(readOnlyContext, resource, null, 20),
        (error) => error?.code === "FORBIDDEN",
      );
    }

    const otherPrincipal = {
      type: "user",
      principalId: `other-owner-${suffix}`,
      actorId: `user:other-owner-${suffix}`,
      email: `other-${suffix}@example.test`,
      displayName: "Other tenant owner",
    };
    const other = await repository.provisionWorkspace(
      otherPrincipal,
      {
        organizationName: `Other Company ${suffix}`,
        workspaceName: `Other Operations ${suffix}`,
        template: "enterprise-governance",
        publish: true,
      },
      `other-provision-${suffix}`,
    );

    const blank = await repository.provisionWorkspace(
      principal,
      {
        organizationName: `Blank Company ${suffix}`,
        workspaceName: `Blank Operations ${suffix}`,
        template: "blank",
        publish: true,
      },
      `blank-provision-${suffix}`,
    );
    const [blankRootScope] = await db
      .select({ id: schema.scopes.id })
      .from(schema.scopes)
      .where(eq(schema.scopes.workspaceId, blank.workspace.id))
      .orderBy(schema.scopes.createdAt, schema.scopes.id)
      .limit(1);
    assert.ok(blankRootScope?.id);
    const blankContext = {
      ...context,
      principal: {
        ...context.principal,
        actorId: `actor:${blank.workspace.id}:${principal.principalId}`,
      },
      organizationId: blank.organization.id,
      workspaceId: blank.workspace.id,
      workspaceSlug: blank.workspace.slug,
      allowedScopeIds: [blankRootScope.id],
      requestId: `blank-workflow-${suffix}`,
    };
    const blankState = await repository.getProductState(blankContext);
    assert.equal(blankState.agents.length, 1);
    assert.equal(blankState.agents[0].name, "Starter Context Agent");
    assert.equal(blankState.agents[0].writeBudget, 0, "the blank starter has no external action budget");
    assert.equal(blankState.agents[0].permissions.includes("propose_action"), false);
    const blankRun = await repository.executeWorkspaceCommand(
      blankContext,
      "run-agent",
      { task: "Review this new workspace without taking external action." },
      `blank-run-${suffix}`,
    );
    assert.equal(blankRun.run.status, "completed");
    assert.deepEqual(blankRun.run.tools, ["get_context_pack", "get_evidence", "record_outcome"]);
    const blankReplay = await repository.executeWorkspaceCommand(
      blankContext,
      "replay",
      { runId: blankRun.run.id },
      `blank-replay-${suffix}`,
    );
    assert.equal(blankReplay.replay.replayOfRunId, blankRun.run.id);
    const blankOutcome = await repository.executeWorkspaceCommand(
      blankContext,
      "outcome",
      { runId: blankRun.run.id, status: "reviewed", metrics: {}, notes: "Starter run reviewed." },
      `blank-outcome-${suffix}`,
    );
    assert.equal(blankOutcome.outcome.runId, blankRun.run.id);
    assert.equal(blankOutcome.outcome.status, "reviewed");

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("set local role commonstate_runtime"));
      await tx.execute(sql`select set_config('commonstate.organization_id', ${first.organization.id}, true)`);
      await tx.execute(sql`select set_config('commonstate.workspace_id', ${first.workspace.id}, true)`);
      await tx.execute(sql`select set_config('commonstate.principal_id', ${principal.principalId}, true)`);
      const visible = await tx.select({ id: schema.workspaces.id }).from(schema.workspaces);
      assert.deepEqual(visible.map((row) => row.id), [first.workspace.id]);
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("set local role commonstate_runtime"));
      await tx.execute(sql`select set_config('commonstate.organization_id', ${first.organization.id}, true)`);
      await tx.execute(sql`select set_config('commonstate.workspace_id', ${other.workspace.id}, true)`);
      const visible = await tx.select({ id: schema.workspaces.id }).from(schema.workspaces);
      assert.equal(visible.length, 0, "mismatched organization/workspace settings fail closed in RLS");
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("set local role commonstate_runtime"));
      await tx.execute(sql`select set_config('commonstate.organization_id', ${other.organization.id}, true)`);
      await tx.execute(sql`select set_config('commonstate.workspace_id', ${first.workspace.id}, true)`);
      const visibleClaims = await tx.select({ id: schema.claims.id }).from(schema.claims);
      assert.equal(
        visibleClaims.length,
        0,
        "workspace-only legacy tables also require a matching organization GUC",
      );
    });
    let crossTenantWriteRejected = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("set local role commonstate_runtime"));
        await tx.execute(sql`select set_config('commonstate.organization_id', ${first.organization.id}, true)`);
        await tx.execute(sql`select set_config('commonstate.workspace_id', ${first.workspace.id}, true)`);
        await tx.insert(schema.connectors).values({
          id: `cross-tenant-${suffix}`,
          organizationId: other.organization.id,
          workspaceId: other.workspace.id,
          connectorType: "file",
          name: "Cross-tenant write",
          status: "configured",
          configuration: {},
          cursor: {},
          sourceAclMode: "mirror",
          executionEnabled: false,
        });
      });
    } catch {
      crossTenantWriteRejected = true;
    }
    assert.equal(crossTenantWriteRejected, true, "RLS rejects cross-tenant writes through the runtime role");
    const crossTenantRows = await db
      .select({ id: schema.connectors.id })
      .from(schema.connectors)
      .where(eq(schema.connectors.id, `cross-tenant-${suffix}`));
    assert.equal(crossTenantRows.length, 0, "a rejected cross-tenant write leaves no partial row");

    const service = await repository.createServiceAccount(
      context,
      { name: "Evidence reader", permissions: ["workspace:read"] },
      `service-account-${suffix}`,
    );
    const ingestOnlyService = await repository.createServiceAccount(
      context,
      {
        name: "Source-only connector",
        permissions: ["workspace:read", "sources:ingest"],
        writeBudget: 1,
      },
      `source-only-service-${suffix}`,
    );
    const ingestOnlyContext = {
      ...context,
      principal: {
        type: "service_account",
        principalId: ingestOnlyService.serviceAccount.id,
        actorId: `service-account:${ingestOnlyService.serviceAccount.id}`,
      },
      permissions: ["workspace:read", "sources:ingest"],
      requestId: `source-only-${suffix}`,
    };
    await assert.rejects(
      repository.executeWorkspaceCommand(
        ingestOnlyContext,
        "ingest",
        {
          scopeId: rootScopeId,
          source: { title: "Unauthorized proposal", content: "Operations Agent may use denied.tool." },
          claims: [{
            subjectName: "Operations Agent",
            subjectType: "agent",
            predicate: "agent.allowed_tool",
            value: "denied.tool",
            sourceSpan: "Operations Agent may use denied.tool.",
          }],
        },
        `source-only-proposal-${suffix}`,
      ),
      (error) => error?.code === "FORBIDDEN",
    );

    const boundedWriter = await repository.createServiceAccount(
      context,
      {
        name: "Bounded claim proposer",
        permissions: ["workspace:read", "sources:ingest", "claims:propose"],
        writeBudget: 1,
      },
      `bounded-writer-${suffix}`,
    );
    const boundedWriterContext = {
      ...context,
      principal: {
        type: "service_account",
        principalId: boundedWriter.serviceAccount.id,
        actorId: `service-account:${boundedWriter.serviceAccount.id}`,
      },
      permissions: ["workspace:read", "sources:ingest", "claims:propose"],
      requestId: `bounded-writer-${suffix}`,
    };
    const boundedProposal = await repository.executeWorkspaceCommand(
      boundedWriterContext,
      "ingest",
      {
        scopeId: rootScopeId,
        source: { title: "Budgeted proposal", content: "Operations Agent may use budgeted.tool." },
        claims: [{
          subjectName: "Operations Agent",
          subjectType: "agent",
          predicate: "agent.allowed_tool",
          value: "budgeted.tool",
          sourceSpan: "Operations Agent may use budgeted.tool.",
        }],
      },
      `bounded-proposal-${suffix}`,
    );
    await assert.rejects(
      repository.executeWorkspaceCommand(
        boundedWriterContext,
        "ingest",
        {
          scopeId: rootScopeId,
          source: { title: "Over budget", content: "Operations Agent may use over-budget.tool." },
          claims: [{
            subjectName: "Operations Agent",
            subjectType: "agent",
            predicate: "agent.allowed_tool",
            value: "over-budget.tool",
            sourceSpan: "Operations Agent may use over-budget.tool.",
          }],
        },
        `over-budget-proposal-${suffix}`,
      ),
      (error) => error?.code === "ACTION_DISALLOWED" && /write budget/.test(error.message),
    );
    await repository.executeWorkspaceCommand(
      context,
      "reject",
      { claimIds: [boundedProposal.proposals[0].id], reason: "Budget enforcement test cleanup." },
      `bounded-proposal-reject-${suffix}`,
    );
    const mcpList = await productMcp(
      new Request("https://commonstate.test/api/v1/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${service.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    const mcpListBody = await mcpList.json();
    assert.deepEqual(
      mcpListBody.result.tools.map((tool) => tool.name),
      [
        "get_context_pack",
        "get_evidence",
        "propose_claim",
        "request_claim_approval",
        "propose_action",
        "request_action_approval",
        "get_action_status",
        "record_outcome",
      ],
    );
    const mcpEvidence = await productMcp(
      new Request("https://commonstate.test/api/v1/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${service.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_evidence", arguments: { claim_ids: [claimId] } },
        }),
      }),
    );
    const mcpEvidenceBody = await mcpEvidence.json();
    assert.equal(mcpEvidenceBody.error, undefined);
    assert.match(mcpEvidenceBody.result.content[0].text, new RegExp(claimId));

    const policyRows = await db.execute(sql`
      select tablename from pg_policies
      where policyname in ('workspace_tenant_isolation', 'source_chunks_tenant_isolation')
      order by tablename
    `);
    assert.ok(policyRows.some((row) => row.tablename === "workspaces"));
    assert.ok(policyRows.some((row) => row.tablename === "source_chunks"));
  } finally {
    await database.closeDb();
    unregister();
  }
});

test("auth redirects are same-origin and cloud deployments cannot enable local bootstrap", async () => {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const authHelpers = await import("../lib/product/supabase-auth.ts");
  const productAuth = await import("../lib/product/auth.ts");
  const request = new Request("https://commonstate.example/api/v1/auth/callback");
  try {
    assert.equal(authHelpers.resolveSafeNext(request, "/app/acme/overview"), "/app/acme/overview");
    for (const attack of [
      "//evil.example/path",
      "/\\evil.example/path",
      "/%2f%2fevil.example/path",
      "/%5cevil.example/path",
      "/%252f%252fevil.example/path",
    ]) {
      assert.equal(authHelpers.resolveSafeNext(request, attack), "/setup");
    }

    const previous = {
      vercel: process.env.VERCEL,
      local: process.env.COMMONSTATE_LOCAL_AUTH,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      legacyKey: process.env.SUPABASE_ANON_KEY,
    };
    process.env.VERCEL = "1";
    process.env.COMMONSTATE_LOCAL_AUTH = "true";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    await assert.rejects(
      productAuth.resolveProductSession(new Request("https://commonstate.example/api/v1/session")),
      (error) => error?.code === "AUTH_CONFIG_UNAVAILABLE",
    );
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
    if (previous.local === undefined) delete process.env.COMMONSTATE_LOCAL_AUTH;
    else process.env.COMMONSTATE_LOCAL_AUTH = previous.local;
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previous.key;
    if (previous.legacyKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previous.legacyKey;
  } finally {
    unregister();
  }
});
