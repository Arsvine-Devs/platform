# Auth service scope

- Auth is the sole identity provider. Do not add identity or session stores to
  Console, API, or Content.
- Preserve issuer, audience/resource, JWKS, PKCE, redirect, Passkey RP/origin,
  TOTP, and trusted-origin checks.
- Password verification must match the current Better Auth hash format. Remove
  obsolete formats only after a current Auth DB inventory proves they are gone.
- Never expose password hashes, TOTP secrets, OAuth client secrets, access
  tokens, or ID tokens in pages, logs, tests, or error responses.
- Changes to OAuth, Passkey, TOTP, or password lifecycle require a focused
  runtime/contract check and the root build/typecheck gate.
