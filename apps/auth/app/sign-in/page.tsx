"use client";

import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { FormEvent, useMemo, useState } from "react";

export default function SignInPage() {
  const oauthQuery = useMemo(
    () =>
      typeof window === "undefined" ? "" : window.location.search.slice(1),
    [],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);

  async function signInWithPasskey() {
    setKeyBusy(true);
    setError(null);
    try {
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");
      const optionsResponse = await fetch("/api/auth/passkey/generate-authenticate-options");
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options?.message ?? "Passkey sign-in failed.");
      const authentication = await startAuthentication({ optionsJSON: options });
      const { clientExtensionResults: _clientExtensionResults, ...response } = authentication;
      const verifyResponse = await fetch("/api/auth/passkey/verify-authentication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const body = (await verifyResponse.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!verifyResponse.ok) throw new Error(body?.message ?? "Passkey sign-in failed.");
      window.location.assign(oauthQuery ? `/consent?${oauthQuery}` : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passkey sign-in failed.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        message?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? body?.message ?? "Sign-in failed.",
        );
      }
      window.location.assign(
        body?.url ?? (oauthQuery ? `/consent?${oauthQuery}` : "/"),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <main>
      <p>ARSVINE AUTH</p>
      <h1>Sign in to your workspace</h1>
      <p>Use a registered security key for Owner access, or continue with your account credentials.</p>
      <section>
        <h2>Owner security key</h2>
        <p>Passkeys stay bound to the Auth origin and never enter browser storage.</p>
        <button disabled={keyBusy} type="button" onClick={() => void signInWithPasskey()}>
          {keyBusy ? "Verifying…" : "Sign in with security key"}
        </button>
      </section>
      <hr />
      <h2>Editor sign in</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input
            autoComplete="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
