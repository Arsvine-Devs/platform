# Content service scope

- Keep published releases immutable; the current pointer is the only mutable
  publication selector.
- Public endpoints MUST NOT return protected title, excerpt, tags, variants, or
  body content.
- Protected variants require Auth JWT verification and the exact
  `content:protected:read` scope.
- Validate object keys before storage access and verify every written object
  before changing the pointer.
- Do not add a GitHub/repository read path or a compatibility fallback for the
  retired content repository.
- Run Content tests and typecheck after changes, then the root gate.
