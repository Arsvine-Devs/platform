# API service scope

- Keep Fastify route handlers as the HTTP and authorization adapter; Core
  persistence belongs to `@arsvine/core-db`.
- Authenticate with `@arsvine/authz` and enforce the narrowest required scope.
- Preserve `If-Match` revision checks for updates and deletes.
- Publication MUST write and verify Content objects before the current pointer
  changes, then send timestamped HMAC revalidation to Realm.
- Never log bearer tokens, publication tokens, database URLs, or request bodies
  containing credentials.
- Run the API unit tests and typecheck after service changes; run the root gate
  before handoff.
