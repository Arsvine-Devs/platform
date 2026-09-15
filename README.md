# ARSVINE PLATFORM

The `Arsvine-Devs/platform` repository is the platform workspace for the Arsvine management system. It currently contains the Console, Auth, API, Content read plane, and shared runtime packages used by the subdomain migration.

## Workspace layout

```text
apps/
├── console/    # console.arsvine.com BFF and management UI
├── auth/       # auth.arsvine.com identity and OAuth/OIDC provider
├── api/        # api.arsvine.com control plane
└── content/    # content.arsvine.com published read plane
packages/       # authz, Core DB, object storage, contracts, observability
```

The workspace root owns dependency installation, cross-service quality gates, and the current service build/typecheck traversal. Console-specific UI and BFF code remains under `apps/console`; service ownership stays with each app/package.

## Development

Prerequisites: Node.js 24 and the repository-pinned pnpm version.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Run the workspace checks from the root:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

The current connection direction is Console BFF → `API_BASE_URL`/`api.arsvine.com`, Console identity → Auth OIDC, and Realm → `CONTENT_BASE_URL`/`content.arsvine.com`. Production environment values and authenticated mutation acceptance remain deployment concerns.

Detailed Console behavior, environment variables, and current operational procedures are documented in [`apps/console/README.md`](./apps/console/README.md).

## Reference runtime

The optional reference stack is a later provider-portability target. The current deployed connection is Console → Auth/API and API → Content; its runtime service contracts are configured per application environment.

With Docker Desktop running:

```bash
pnpm compose:config
pnpm compose:up
```

The Console is exposed through Caddy at `http://localhost:18080`. The liveness endpoint is `http://localhost:18080/health/live`. Stop the stack and remove its local volumes with:

```bash
pnpm compose:down
```
