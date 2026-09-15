# Console application scope

- Console owns the browser UI, host-only opaque session, CSRF, and same-origin
  BFF only. It MUST NOT import Core DB, object-storage, or Auth storage.
- Browser code calls `/api/control/*`; the BFF calls API with the current OIDC
  access token and preserves no-store/private response headers.
- Keep OIDC callback state/nonce, RP-initiated logout, session deletion, and
  CSRF verification intact.
- Content authoring is Core/API based. Do not reintroduce repository panels,
  GitHub paths, X timeline jobs, retired pages, or placeholder worker routes.
- Use Oxlint as the primary linter; ESLint is only the compatibility layer for
  rules not covered by Oxlint.
- Run the focused Console tests/typecheck after UI or BFF changes.
