# API service scope

- Keep Fastify route handlers as the HTTP and authorization adapter; Core
  persistence belongs to `@arsvine/core-db`.
- Authenticate with `@arsvine/authz` and enforce the narrowest required scope.
- Preserve `If-Match` revision checks for updates and deletes.
- Commit post metadata and locale variants together. Require content:publish
  for changes that publish, edit, or withdraw public content.
- Never log bearer tokens, database URLs, or request bodies
  containing credentials.
- Run the API unit tests and typecheck after service changes; run the root gate
  before handoff.
