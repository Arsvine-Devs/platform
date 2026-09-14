"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/client";
import * as QRCode from "qrcode";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type SessionUser = { id: string; email: string; role?: string };

export default function SecurityPage() {
  const authClient = useMemo(() => createAuthClient({ plugins: [passkeyClient(), twoFactorClient()] }), []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("Primary security key");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpCode, setTotpCode] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpMessage, setTotpMessage] = useState<string | null>(null);
  const [totpError, setTotpError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/get-session", { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { user?: SessionUser } | null;
        if (response.ok && body?.user) setUser(body.user);
      })
      .finally(() => setLoading(false));
  }, []);

  async function registerKey() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: label.trim() || "Security key",
        authenticatorAttachment: "cross-platform",
        createSession: false,
      });
      if (result.error) throw new Error(result.error.message ?? "Security key registration failed.");
      setMessage("Security key registered. Keep it available as an Owner sign-in method.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Security key registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startTotpSetup() {
    setTotpBusy(true);
    setTotpError(null);
    setTotpMessage(null);
    try {
      const result = await authClient.twoFactor.enable({ method: "totp", password: totpPassword });
      if (result.error || result.data?.method !== "totp") throw new Error(result.error?.message ?? "Authenticator setup failed.");
      const qr = await QRCode.toDataURL(result.data.totpURI, { errorCorrectionLevel: "M", margin: 1, width: 240 });
      setTotpQr(qr);
      setTotpBackupCodes(result.data.backupCodes);
      setTotpPassword("");
    } catch (cause) {
      setTotpError(cause instanceof Error ? cause.message : "Authenticator setup failed.");
    } finally {
      setTotpBusy(false);
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError(null);
    setTotpMessage(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: totpCode, trustDevice: false });
      if (result.error) throw new Error(result.error.message ?? "Authenticator verification failed.");
      setTotpMessage("Authenticator enabled. Keep your backup codes offline.");
      setTotpCode("");
    } catch (cause) {
      setTotpError(cause instanceof Error ? cause.message : "Authenticator verification failed.");
    } finally {
      setTotpBusy(false);
    }
  }

  if (loading) return <main className="auth-shell"><div className="auth-frame"><p className="auth-loading">Loading security settings…</p></div></main>;
  if (!user) {
    return (
      <main className="auth-shell">
      <Card className="auth-frame auth-card auth-empty">
        <p className="auth-kicker">ARSVINE AUTH</p>
        <h1>Sign in to manage security keys</h1>
        <p>Your Auth session is required before a new key can be registered.</p>
        <Button asChild className="auth-button auth-button-primary"><a href="/sign-in">Return to sign in</a></Button>
      </Card>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-frame">
        <header className="auth-header">
          <a className="auth-brand" href="/"><span className="auth-mark">A</span><span>ARSVINE</span><small>AUTH</small></a>
          <a className="auth-text-link" href="/">Account</a>
        </header>
        <section className="auth-intro">
          <p className="auth-kicker">SECURITY / OWNER</p>
          <h1>Register a security key</h1>
          <p>Add a cross-platform passkey for {user.email}. Your browser will ask you to touch the key.</p>
        </section>
        <Card className="auth-card auth-form">
          <CardHeader className="auth-key-panel auth-key-panel-compact">
            <div className="auth-key-icon" aria-hidden="true"><KeyRound size={18} /></div>
            <div><p className="auth-panel-label">WebAuthn passkey</p><CardTitle>Owner access</CardTitle><CardDescription className="auth-panel-copy">The credential is scoped to auth.arsvine.com and stored by your security key.</CardDescription></div>
          </CardHeader>
          <CardContent className="auth-form">
          <Field><FieldLabel htmlFor="key-label">Key label</FieldLabel><Input id="key-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} /></Field>
          <Button className="auth-button auth-button-primary" disabled={busy} size="lg" type="button" onClick={() => void registerKey()}>
            {busy ? "Waiting for your key…" : "Register security key"}
          </Button>
          {message ? <p className="auth-success" role="status">{message}</p> : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          </CardContent>
        </Card>
        <Card className="auth-card auth-form auth-totp-setup-card">
          <CardHeader className="auth-form-heading">
            <p className="auth-panel-label">SECOND FACTOR</p>
            <CardTitle>Authenticator app</CardTitle>
            <CardDescription>Set up a fresh TOTP secret for this account. The old authenticator secret has been reset.</CardDescription>
          </CardHeader>
          <CardContent className="auth-form">
            {!totpQr ? (
              <>
                <Field><FieldLabel htmlFor="totp-password">Current password</FieldLabel><Input id="totp-password" autoComplete="current-password" type="password" value={totpPassword} onChange={(event) => setTotpPassword(event.target.value)} /></Field>
                <Button className="auth-button auth-button-primary" disabled={totpBusy || !totpPassword} size="lg" type="button" onClick={() => void startTotpSetup()}>
                {totpBusy ? "Preparing authenticator…" : "Set up authenticator"}
                </Button>
              </>
            ) : (
              <>
                <div className="auth-totp-setup">
                  <div className="auth-totp-qr">
                    <img src={totpQr} alt="QR code for authenticator setup" />
                    <p>Scan this code with your authenticator app.</p>
                  </div>
                  <form className="auth-form" onSubmit={verifyTotp}>
                    <Field><FieldLabel htmlFor="setup-totp-code">Six-digit code</FieldLabel><Input id="setup-totp-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} required value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
                    <Button className="auth-button auth-button-primary" disabled={totpBusy} size="lg" type="submit">
                      {totpBusy ? "Verifying…" : "Verify and enable"}
                    </Button>
                  </form>
                </div>
                <details className="auth-totp-backup">
                  <summary>Show backup codes</summary>
                  <code>{totpBackupCodes.join("\n")}</code>
                  <p>Store these codes offline. Each code can be used once.</p>
                </details>
              </>
            )}
            {totpMessage ? <p className="auth-success" role="status">{totpMessage}</p> : null}
            {totpError ? <p className="auth-error" role="alert">{totpError}</p> : null}
          </CardContent>
        </Card>
        <footer className="auth-footer">You can add another key later from this page.</footer>
      </div>
    </main>
  );
}
