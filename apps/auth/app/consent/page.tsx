"use client";

import { useMemo, useState } from "react";

export default function ConsentPage() {
  const oauthQuery = useMemo(
    () =>
      typeof window === "undefined" ? "" : window.location.search.slice(1),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const body = (await response.json().catch(() => null)) as {
        redirect_uri?: string;
        message?: string;
      } | null;
      if (!response.ok || !body?.redirect_uri) {
        throw new Error(body?.message ?? "Consent request failed.");
      }
      window.location.assign(body.redirect_uri);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Consent request failed.",
      );
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Authorize application</h1>
      <p>This application is requesting access to your account.</p>
      <div>
        <button
          disabled={busy}
          type="button"
          onClick={() => void respond(true)}
        >
          Allow
        </button>
        <button
          disabled={busy}
          type="button"
          onClick={() => void respond(false)}
        >
          Deny
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
