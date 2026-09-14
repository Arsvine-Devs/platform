"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { FormEvent, useMemo, useState } from "react";

const authClient = createAuthClient({
  plugins: [passkeyClient()],
});

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
      const result = await authClient.signIn.passkey();
      if (result.error) throw new Error(result.error.message ?? "Passkey sign-in failed.");
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
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message ?? "Sign-in failed.");
      window.location.assign(oauthQuery ? `/consent?${oauthQuery}` : "/");
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
