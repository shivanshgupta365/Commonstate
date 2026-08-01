"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createProductWorkspace, getProductTemplates, publishWorkspaceConfiguration, saveWorkspaceConfigurationDraft } from "./productClient";
import { ProductBrand } from "./ProductBrand";
import { solutionTemplates, templatePacks, type TemplateId } from "@/lib/product/templates";
import styles from "./product.module.css";

const setupSteps = [
  { number: "01", label: "Company" },
  { number: "02", label: "Identity" },
  { number: "03", label: "Solution pack" },
  { number: "04", label: "Operating model" },
  { number: "05", label: "Sources" },
  { number: "06", label: "Governance" },
  { number: "07", label: "Publish" },
] as const;

const connectors = [
  { id: "upload", name: "File upload", icon: "↑", description: "PDF, DOCX, CSV, and text" },
  { id: "webhook", name: "Signed webhook", icon: "↯", description: "HMAC-verified source events" },
  { id: "slack", name: "Slack", icon: "S", description: "Channels and thread context" },
  { id: "drive", name: "Google Drive", icon: "D", description: "Files with source permissions" },
  { id: "teams", name: "Microsoft Teams", icon: "T", description: "Teams and channel messages" },
  { id: "sharepoint", name: "SharePoint", icon: "M", description: "Sites, OneDrive, and ACLs" },
] as const;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

function contrastRatio(hex: string, against: string) {
  function luminance(color: string) {
    const normalized = color.replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return 1;
    const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const first = luminance(hex);
  const second = luminance(against);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function bestAccentContrast(hex: string) {
  const onInk = contrastRatio(hex, "#0a0a0a");
  const onWhite = contrastRatio(hex, "#ffffff");
  return onWhite >= onInk ? { ratio: onWhite, foreground: "white" } : { ratio: onInk, foreground: "ink" };
}

function EditableTags({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");

  function add(event: FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (next && !items.some((item) => item.toLowerCase() === next.toLowerCase())) onChange([...items, next]);
    setValue("");
  }

  return (
    <div className={styles.tagBuilder}>
      <div className={styles.fieldLabel}><span>{label}</span><small>{items.length} defined</small></div>
      <div className={styles.tagList}>
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className={styles.editableTag}>
            <i>{String(index + 1).padStart(2, "0")}</i>{item}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((candidate) => candidate !== item))}>×</button>
          </span>
        ))}
      </div>
      <form className={styles.inlineAdd} onSubmit={add}>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} aria-label={`Add ${label.toLowerCase()}`} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

export function SetupWizard({ initialTemplate = "ai-operations" }: { initialTemplate?: TemplateId }) {
  const router = useRouter();
  const initialPack = templatePacks[initialTemplate];
  const [step, setStep] = useState(0);
  const [organizationName, setOrganizationName] = useState("Northstar Labs");
  const [workspaceName, setWorkspaceName] = useState(initialPack.name);
  const [slug, setSlug] = useState(`northstar-${initialTemplate.replace("-operations", "")}`);
  const [accent, setAccent] = useState(initialPack.accent);
  const [locale, setLocale] = useState("en-GB");
  const [timezone, setTimezone] = useState("Europe/London");
  const [currency, setCurrency] = useState("GBP");
  const [templateId, setTemplateId] = useState<TemplateId>(initialTemplate);
  const [scopeKinds, setScopeKinds] = useState([...initialPack.scopeKinds]);
  const [entityTypes, setEntityTypes] = useState([...initialPack.entityTypes]);
  const [enabledConnectors, setEnabledConnectors] = useState<string[]>(["upload", "webhook"]);
  const [approvers, setApprovers] = useState(2);
  const [lowRiskAuto, setLowRiskAuto] = useState(true);
  const [managedProvider, setManagedProvider] = useState<"gemini" | "openai" | "anthropic">("gemini");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedTemplate = templatePacks[templateId];
  const contrast = useMemo(() => bestAccentContrast(accent), [accent]);

  function chooseTemplate(id: TemplateId) {
    const pack = templatePacks[id];
    setTemplateId(id);
    setScopeKinds([...pack.scopeKinds]);
    setEntityTypes([...pack.entityTypes]);
    setAccent(pack.accent);
    if (id !== "blank") setWorkspaceName(pack.name);
  }

  function nextStep() {
    setError("");
    if (step === 0 && (!organizationName.trim() || !workspaceName.trim() || !slug.trim())) {
      setError("Company, workspace, and workspace URL are required.");
      return;
    }
    if (step === 3 && (!scopeKinds.length || !entityTypes.length)) {
      setError("Define at least one scope kind and one entity type.");
      return;
    }
    setStep((current) => Math.min(setupSteps.length - 1, current + 1));
  }

  async function publishWorkspace() {
    setSubmitting(true);
    setError("");
    const templatesResponse = await getProductTemplates();
    if (!templatesResponse.ok) {
      setSubmitting(false);
      setError(`${templatesResponse.error.message} (${templatesResponse.error.code}). The authenticated template registry is required; no recorded configuration was substituted.`);
      return;
    }
    const template = templatesResponse.data.items.find((item) => item.id === templateId);
    if (!template) {
      setSubmitting(false);
      setError("The selected template is not available in the authenticated template registry.");
      return;
    }
    const base = structuredClone(template.configuration);
    const baseScopes = Array.isArray(base.scopeKinds) ? base.scopeKinds as Array<Record<string, unknown>> : [];
    const baseEntities = Array.isArray(base.entityKinds) ? base.entityKinds as Array<Record<string, unknown>> : [];
    const scopeDefinitions = scopeKinds.map((label, index) => baseScopes[index] ? { ...baseScopes[index], label } : { key: `scope_${index + 1}`, label, parentKinds: index ? [`scope_${index}`] : [], root: index === 0 });
    const entityDefinitions = entityTypes.map((label, index) => baseEntities[index] ? { ...baseEntities[index], label } : { key: `entity_${index + 1}`, label, icon: "record", attributesSchema: { type: "object", properties: {}, additionalProperties: false } });
    const approvalPolicies = Array.isArray(base.approvalPolicies) ? (base.approvalPolicies as Array<Record<string, unknown>>).map((policy) => policy.risk === "high" ? { ...policy, requiredApprovals: approvers } : policy.risk === "low" ? { ...policy, requiredApprovals: lowRiskAuto ? 0 : 1 } : policy) : [];
    const configuration = { ...base, template: templateId, branding: { ...((base.branding as Record<string, unknown> | undefined) ?? {}), companyName: organizationName.trim(), accent, locale, timezone, currency }, scopeKinds: scopeDefinitions, entityKinds: entityDefinitions, approvalPolicies };
    const response = await createProductWorkspace({
      organizationName: organizationName.trim(),
      organizationSlug: slugify(organizationName),
      workspaceName: workspaceName.trim(),
      workspaceSlug: slugify(slug),
      template: templateId,
      branding: { accent, locale, timezone, currency },
      publish: false,
      onboarding: {
        scopeKinds,
        entityTypes,
        connectors: enabledConnectors,
        requiredApprovers: approvers,
        lowRiskAutoExecution: lowRiskAuto,
        managedProvider,
      },
    });
    if (!response.ok) {
      setSubmitting(false);
      setError(`${response.error.message} (${response.error.code}). The production setup was not replaced with a demo workspace.`);
      return;
    }
    const createdSlug = response.data.workspace.slug;
    const saved = await saveWorkspaceConfigurationDraft(createdSlug, configuration);
    if (!saved.ok) {
      setSubmitting(false);
      setError(`The workspace was created, but its tailored draft was not saved: ${saved.error.message} (${saved.error.code}). Open /app/${createdSlug}/settings to retry safely.`);
      return;
    }
    const published = await publishWorkspaceConfiguration(createdSlug, 0);
    setSubmitting(false);
    if (!published.ok) {
      setError(`The tailored draft was saved but not published: ${published.error.message} (${published.error.code}). Open /app/${createdSlug}/settings to review it.`);
      return;
    }
    router.push(`/app/${encodeURIComponent(createdSlug)}/overview`);
  }

  return (
    <main className={styles.setupPage} style={{ "--workspace-accent": accent } as React.CSSProperties}>
      <a className={styles.skipLink} href="#setup-content">Skip to setup</a>
      <aside className={styles.setupRail}>
        <ProductBrand inverse href="/" />
        <div className={styles.setupRailIntro}>
          <p className={styles.monoEyebrow}>Workspace setup</p>
          <h1>Shape Commonstate around how your company works.</h1>
          <p>Every choice becomes a versioned configuration—not custom application code.</p>
        </div>
        <ol className={styles.setupSteps} aria-label="Setup progress">
          {setupSteps.map((item, index) => (
            <li key={item.number} className={index === step ? styles.setupStepActive : index < step ? styles.setupStepDone : ""}>
              <button type="button" onClick={() => index <= step && setStep(index)} disabled={index > step} aria-current={index === step ? "step" : undefined}>
                <span>{index < step ? "✓" : item.number}</span>
                <strong>{item.label}</strong>
              </button>
            </li>
          ))}
        </ol>
        <div className={styles.setupRailFooter}><span>Private beta</span><p>Configuration is draft-only until the final publish step.</p></div>
      </aside>

      <section className={styles.setupWorkspace}>
        <header className={styles.setupTopbar}>
          <span>Step {step + 1} of {setupSteps.length}</span>
          <div className={styles.setupProgress} role="progressbar" aria-label="Setup completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((step + 1) / setupSteps.length) * 100)}><i style={{ width: `${((step + 1) / setupSteps.length) * 100}%` }} /></div>
          <button type="button" onClick={() => router.push("/login")}>Save and exit</button>
        </header>

        <div id="setup-content" className={styles.setupContent} tabIndex={-1}>
          {step === 0 ? (
            <div className={styles.setupPanel}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>01 · Company and workspace</p><h2>Give this operational state a home.</h2><p>An organization can hold multiple workspaces. Membership determines access; the workspace URL never does.</p></div>
              <div className={styles.formGrid}>
                <label className={styles.spanTwo}>Organization name<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} autoFocus /></label>
                <label>Workspace name<input value={workspaceName} onChange={(event) => { setWorkspaceName(event.target.value); setSlug(slugify(event.target.value)); }} /></label>
                <label>Workspace URL<span className={styles.slugInput}><small>commonstate.app/</small><input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} /></span></label>
              </div>
              <aside className={styles.securityNote}><span>◇</span><div><strong>Tenant boundary</strong><p>Commonstate derives the organization and workspace from the authenticated membership on every request.</p></div></aside>
            </div>
          ) : null}

          {step === 1 ? (
            <div className={styles.setupPanel}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>02 · Identity and locale</p><h2>Make it unmistakably yours.</h2><p>Commonstate keeps its high-information interface while adopting a safe company accent and local conventions.</p></div>
              <div className={styles.identityLayout}>
                <div className={styles.logoDrop}><span style={{ background: accent }}>{organizationName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>Company logo</strong><p>Upload is available after workspace creation.</p><button type="button" disabled>Available after setup</button></div></div>
                <div className={styles.brandPreview}>
                  <div className={styles.brandPreviewTop}><span style={{ background: accent }} /><strong>{workspaceName || "Your workspace"}</strong><small>Preview</small></div>
                  <div className={styles.brandPreviewBody}><i /><i /><i /></div>
                </div>
              </div>
              <div className={styles.formGrid}>
                <label>Accent color<span className={styles.colorInput}><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /><input value={accent} onChange={(event) => setAccent(event.target.value)} /></span><small className={contrast.ratio >= 4.5 ? styles.fieldGood : styles.fieldWarn}>{contrast.ratio >= 4.5 ? `AA contrast · ${contrast.ratio.toFixed(1)}:1 on ${contrast.foreground}` : `Low contrast · ${contrast.ratio.toFixed(1)}:1`}</small></label>
                <label>Locale<select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option><option value="de-DE">German</option><option value="fr-FR">French</option></select></label>
                <label>Timezone<select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Europe/London">Europe / London</option><option value="America/New_York">America / New York</option><option value="Asia/Kolkata">Asia / Kolkata</option><option value="UTC">UTC</option></select></label>
                <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="GBP">GBP · £</option><option value="USD">USD · $</option><option value="EUR">EUR · €</option><option value="INR">INR · ₹</option></select></label>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className={styles.setupPanelWide}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>03 · Solution pack</p><h2>Start from a proven operating model.</h2><p>Templates configure vocabulary, policies, metrics, agents, and evaluations. Everything remains editable.</p></div>
              <div className={styles.templateGrid}>
                {solutionTemplates.map((template, index) => (
                  <button key={template.id} type="button" className={templateId === template.id ? styles.templateCardActive : styles.templateCard} onClick={() => chooseTemplate(template.id)} aria-pressed={templateId === template.id}>
                    <span className={styles.templateIndex}>0{index + 1}</span>
                    <i style={{ background: template.accent }} />
                    <p>{template.eyebrow}</p>
                    <h3>{template.name}</h3>
                    <span>{template.description}</span>
                    <dl><div><dt>Scopes</dt><dd>{template.scopeKinds.join(" → ")}</dd></div><div><dt>Entities</dt><dd>{template.entityTypes.length || "Custom"}</dd></div></dl>
                    <strong>{templateId === template.id ? "Selected ✓" : "Use this pack →"}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className={styles.setupPanelWide}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>04 · Operating model</p><h2>Use the language your teams already use.</h2><p>Scopes define inheritance and access. Entities define the things your company makes decisions about.</p></div>
              <div className={styles.modelBuilder}>
                <EditableTags label="Scope hierarchy" items={scopeKinds} onChange={setScopeKinds} placeholder="Add scope kind" />
                <EditableTags label="Entity vocabulary" items={entityTypes} onChange={setEntityTypes} placeholder="Add entity type" />
              </div>
              <div className={styles.precedencePreview}>
                <div><p className={styles.monoEyebrow}>Deterministic precedence</p><h3>Specific approved truth wins.</h3><span>{scopeKinds.join(" overrides ")}</span></div>
                <ol>{scopeKinds.map((scope, index) => <li key={scope}><span>{index + 1}</span><strong>{scope}</strong><small>{index === scopeKinds.length - 1 ? "Most specific" : "Inherited defaults"}</small></li>)}</ol>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className={styles.setupPanelWide}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>05 · Sources</p><h2>Connect the systems where truth changes.</h2><p>Start with files or a signed webhook. Add managed connectors now or from Workspace Settings later.</p></div>
              <div className={styles.connectorGrid}>
                {connectors.map((connector) => {
                  const active = enabledConnectors.includes(connector.id);
                  return <button key={connector.id} type="button" className={active ? styles.connectorActive : styles.connectorCard} aria-pressed={active} onClick={() => setEnabledConnectors((current) => active ? current.filter((id) => id !== connector.id) : [...current, connector.id])}><span>{connector.icon}</span><div><strong>{connector.name}</strong><small>{connector.description}</small></div><i>{active ? "✓" : "+"}</i></button>;
                })}
              </div>
              <aside className={styles.securityNote}><span>↯</span><div><strong>Permissions stay attached</strong><p>Connector ACL changes and deletions propagate into search, context packs, evidence, and replay.</p></div></aside>
            </div>
          ) : null}

          {step === 5 ? (
            <div className={styles.setupPanelWide}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>06 · Agents and governance</p><h2>Define what automation may do.</h2><p>Models propose. Deterministic policy sets the effective risk tier, approvals, and execution boundary.</p></div>
              <div className={styles.governanceGrid}>
                <article className={styles.governanceCard}>
                  <div className={styles.governanceCardHeader}><span>01</span><div><h3>Approval policy</h3><p>For high-risk proposed actions</p></div></div>
                  <label>Required approvers<select value={approvers} onChange={(event) => setApprovers(Number(event.target.value))}><option value={1}>1 authorized approver</option><option value={2}>2 authorized approvers</option><option value={3}>3 authorized approvers</option></select></label>
                  <label className={styles.toggleRow}><span><strong>Low-risk auto execution</strong><small>Only reversible operations with compensation</small></span><input type="checkbox" checked={lowRiskAuto} onChange={(event) => setLowRiskAuto(event.target.checked)} /></label>
                </article>
                <article className={styles.governanceCard}>
                  <div className={styles.governanceCardHeader}><span>02</span><div><h3>Managed AI provider</h3><p>Can be overridden per workspace later</p></div></div>
                  <div className={styles.radioStack}>{(["gemini", "openai", "anthropic"] as const).map((provider) => <label key={provider}><input type="radio" name="provider" value={provider} checked={managedProvider === provider} onChange={() => setManagedProvider(provider)} /><span><strong>{provider === "gemini" ? "Gemini" : provider === "openai" ? "OpenAI" : "Anthropic"}</strong><small>{provider === "gemini" ? "Managed default" : "Managed adapter"}</small></span></label>)}</div>
                </article>
              </div>
              <div className={styles.riskStrip}>{["Low · reversible", "Medium · 1 approval", "High · 2 approvals", "Critical · blocked"].map((tier, index) => <span key={tier} className={index === 3 ? styles.riskBlocked : ""}><i>{index + 1}</i>{tier}</span>)}</div>
            </div>
          ) : null}

          {step === 6 ? (
            <div className={styles.setupPanelWide}>
              <div className={styles.setupHeading}><p className={styles.monoEyebrow}>07 · Review and publish</p><h2>Your first governed workspace is ready.</h2><p>Publishing creates immutable ontology and policy version 1. Future changes remain drafts until published.</p></div>
              <div className={styles.reviewLayout}>
                <article className={styles.reviewHero} style={{ background: selectedTemplate.accentSoft }}>
                  <div><span style={{ background: accent }}>{organizationName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><p className={styles.monoEyebrow}>{selectedTemplate.name}</p><h3>{workspaceName}</h3><p>{selectedTemplate.description}</p></div>
                  <strong>Configuration v1 · ready to publish</strong>
                </article>
                <dl className={styles.reviewFacts}>
                  <div><dt>Organization</dt><dd>{organizationName}</dd></div>
                  <div><dt>Workspace URL</dt><dd>/{slug}</dd></div>
                  <div><dt>Scope hierarchy</dt><dd>{scopeKinds.join(" → ")}</dd></div>
                  <div><dt>Entity types</dt><dd>{entityTypes.length} configured</dd></div>
                  <div><dt>Sources</dt><dd>{enabledConnectors.length} selected for authorization</dd></div>
                  <div><dt>Action policy</dt><dd>{approvers} approvers · critical blocked</dd></div>
                  <div><dt>AI provider</dt><dd>{managedProvider}</dd></div>
                  <div><dt>Locale</dt><dd>{locale} · {timezone} · {currency}</dd></div>
                </dl>
              </div>
              <div className={styles.publishChecks}><span>✓ Tenant policies ready</span><span>✓ Audit ledger enabled</span><span>✓ Critical actions blocked</span><span>✓ Configuration validated</span></div>
            </div>
          ) : null}

          {error ? <div className={styles.setupError} role="alert"><span>!</span><p>{error}</p></div> : null}
        </div>

        <footer className={styles.setupFooter}>
          <button type="button" className={styles.secondaryAction} onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>← Back</button>
          <p>{step === setupSteps.length - 1 ? "Publishing creates an immutable configuration receipt." : "You can edit every choice later in Workspace Settings."}</p>
          {step === setupSteps.length - 1
            ? <button type="button" className={styles.primaryAction} onClick={publishWorkspace} disabled={submitting}>{submitting ? "Publishing safely…" : "Publish workspace →"}</button>
            : <button type="button" className={styles.primaryAction} onClick={nextStep}>Continue →</button>}
        </footer>
      </section>
    </main>
  );
}
