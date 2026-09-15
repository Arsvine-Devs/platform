# ARSVINE PLATFORM — AI entrypoint

ARSVINE PLATFORM is a pnpm workspace for the Console BFF, Auth/OIDC provider,
Control API, published Content read plane, and small shared runtime packages.

## Scope and authority

- Read `INDEX.md` and `docs/INDEX.md` before changing a service boundary.
- Read the nearest scoped `AGENTS.md` before editing an app, package, migration,
  or operational area.
- Treat current source, package manifests, schemas, migrations, tests, and
  `.env.example` files as the primary current contract.
- Keep the standalone deprecated `C:\dev\arsvine-content` repository outside
  this workspace and do not modify it.
- Register user-configurable environment keys in `config/env-contracts.json`
  and the owning `.env.example`; use `corepack pnpm envctl query` instead of
  printing values while investigating configuration.
- Default to branch-local work. Do not push, merge, deploy, or mutate remote
  infrastructure unless the current task explicitly authorizes it.

## Runtime boundaries

1. `apps/console` owns the browser UI, the host-only Console session, and the
   same-origin BFF. It MUST call the Control API rather than Core DB,
   object-storage, or Auth storage directly.
2. `apps/auth` owns Better Auth, OAuth/OIDC, JWKS, passkeys, TOTP, and Auth DB.
3. `apps/api` owns Core authoring and publication orchestration.
4. `apps/content` owns the published release read plane and its object-storage
   publication endpoint.
5. `packages/*` own only their named shared boundary; do not reintroduce
   service-specific behavior into a generic package.
6. `@arsvine/env` owns dotenv loading and primitive environment normalization;
   service policy stays in the consuming service.
7. The current hosted path is Console → Auth/API, API → Content, and Realm →
   Content. Do not add compatibility paths for retired repository workflows.
8. `infra/compose` and Docker files are a separate reference environment. Do
   not modify or run them unless the task explicitly reopens that scope.

## Verification

```bash
corepack pnpm format:check
corepack pnpm docs:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm quality
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

Use the narrowest affected check during iteration, then run `corepack pnpm
check` before handoff. Never present local checks as production, cross-platform,
or independent-review evidence.
