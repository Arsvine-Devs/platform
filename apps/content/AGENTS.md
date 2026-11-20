# Content service scope

- Read only the published-content PostgreSQL views with a dedicated role.
- Public endpoints MUST NOT return protected title, excerpt, tags, variants, or
  body content.
- Protected variants require Auth JWT verification and the exact
  `content:protected:read` scope.
- Keep public requests independent of Auth. Apply no-store to Content responses.
- Do not add a GitHub/repository read path or a compatibility fallback for the
  retired content repository.
- Run Content tests and typecheck after changes, then the root gate.
