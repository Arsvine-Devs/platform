# AuthZ package scope

- Own only generic JWT verification, principal extraction, and scope/role
  predicates.
- Do not add service-specific permissions, database access, or HTTP responses.
- Preserve issuer, audience, JWKS URL validation, malformed Bearer handling,
  and token error classification.
- Run package typecheck/build and the affected API or Content tests.
