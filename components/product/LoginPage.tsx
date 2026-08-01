"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ProductBrand } from "./ProductBrand";
import { requestEmailOtp, requestEnterpriseSso, requestGoogleOAuth } from "./productClient";
import styles from "./product.module.css";

export function LoginPage({ callbackError = "" }: { callbackError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [ssoDomain, setSsoDomain] = useState("");
  const [authState, setAuthState] = useState<"idle" | "google" | "sso" | "email">("idle");
  const [authMessage, setAuthMessage] = useState(callbackError ? `Sign-in callback failed: ${callbackError.replaceAll("_", " ")}. No session was created.` : "");

  async function continueWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setAuthState("email"); setAuthMessage("");
    const response = await requestEmailOtp(email.trim());
    setAuthState("idle");
    setAuthMessage(response.ok ? response.data.message : `${response.error.message} (${response.error.code})`);
  }

  async function continueWithGoogle() {
    setAuthState("google"); setAuthMessage("");
    const response = await requestGoogleOAuth();
    if (!response.ok) { setAuthState("idle"); setAuthMessage(`${response.error.message} (${response.error.code})`); return; }
    window.location.assign(response.data.url);
  }

  async function continueWithSso() {
    const domain = ssoDomain.trim().toLowerCase();
    if (!domain) { setAuthMessage("Enter your company domain to start enterprise SSO."); return; }
    setAuthState("sso"); setAuthMessage("");
    const response = await requestEnterpriseSso(domain);
    if (!response.ok) { setAuthState("idle"); setAuthMessage(`${response.error.message} (${response.error.code})`); return; }
    window.location.assign(response.data.url);
  }

  return (
    <main className={styles.authPage}>
      <a className={styles.skipLink} href="#login-form">Skip to sign in</a>
      <section className={styles.authStory} aria-labelledby="auth-title">
        <ProductBrand inverse />
        <div className={styles.authStoryBody}>
          <p className={styles.monoEyebrow}>Your company&apos;s shared operational state</p>
          <h1 id="auth-title">One truth your people and agents can act on.</h1>
          <p>Govern what is current, who can use it, and why every consequential action happened.</p>
          <div className={styles.authProofGrid}>
            <article><strong>Claim-level</strong><span>Evidence for every answer</span></article>
            <article><strong>Fail-closed</strong><span>On rights, policy, and access</span></article>
            <article><strong>Replayable</strong><span>Context, decisions, and outcomes</span></article>
          </div>
        </div>
        <p className={styles.authQuote}>“Every human. Every agent. Same state.”</p>
      </section>

      <section className={styles.authPanel}>
        <div className={styles.authCard}>
          <p className={styles.monoEyebrow}>Private beta</p>
          <h2>Enter your workspace</h2>
          <p>Use your work identity. Membership—not a URL slug—determines which company data you can access.</p>
          <div className={styles.providerStack}>
            <button type="button" onClick={continueWithGoogle} disabled={authState !== "idle"}>
              <span className={styles.providerIcon}>G</span>
              {authState === "google" ? "Opening Google…" : "Continue with Google"}
            </button>
            <div className={styles.ssoRow}><span className={styles.providerIcon}>S</span><input value={ssoDomain} onChange={(event) => setSsoDomain(event.target.value)} placeholder="company.com" aria-label="Company SSO domain" /><button type="button" onClick={continueWithSso} disabled={authState !== "idle"}>{authState === "sso" ? "Opening…" : "Enterprise SSO →"}</button></div>
          </div>
          <div className={styles.authDivider}><span>or</span></div>
          <form id="login-form" onSubmit={continueWithEmail}>
            <label htmlFor="work-email">Work email</label>
            <input
              id="work-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
            <button className={styles.primaryAction} type="submit" disabled={authState !== "idle"}>{authState === "email" ? "Sending secure link…" : <>Continue with email <span aria-hidden="true">→</span></>}</button>
          </form>
          {authMessage ? <div className={styles.authMessage} role="status">{authMessage}</div> : null}
          {process.env.NODE_ENV !== "production" ? <button type="button" className={styles.localBootstrap} onClick={() => router.push("/setup?local-bootstrap=true")}><span>Local only</span> Continue with DB-backed private-beta owner →</button> : null}
          <p className={styles.authTerms}>By continuing, you agree to Commonstate&apos;s private-beta terms and acknowledge its security policy.</p>
        </div>
        <div className={styles.authSecurity}>
          <span aria-hidden="true">◇</span>
          <p><strong>Identity is server-owned.</strong> Workspace and actor IDs are never accepted from model output or request bodies.</p>
        </div>
      </section>
    </main>
  );
}
