# ARSVINE PLATFORM

The `Arsvine-Devs/platform` repository is the platform workspace for the Arsvine management system. The current Phase 1 workspace contains the behavior-preserving Console move; Auth, API, Content, Worker, and shared packages are introduced in later migration phases.

## Workspace layout

```text
apps/
└── console/    # current Admin application; console.arsvine.com target
packages/       # reserved for phase-owned shared/server packages
```

The Console application keeps its existing routes, server code, database migrations, tests, and operational scripts under `apps/console`. The workspace root owns dependency installation and delegates application commands through the `arsvine-admin` package.

## Development

Prerequisites: Node.js 24 and the repository-pinned pnpm version.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Run the application-scoped checks from the workspace root:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

The current Console still uses its existing provider and authentication boundaries. The Phase 1 move does not introduce Auth/API extraction or change production credentials.

Detailed Console behavior, environment variables, and current operational procedures are documented in [`apps/console/README.md`](./apps/console/README.md).

## Reference runtime

The Phase 2 reference stack uses Docker Compose with PostgreSQL, Valkey, MinIO, Console, and Caddy. It is a local/provider-portability baseline; the current Console still retains its existing Neon, Upstash, and GitHub provider contracts until the later portability phases.

With Docker Desktop running:

```bash
pnpm compose:config
pnpm compose:up
```

The Console is exposed through Caddy at `http://localhost:18080`. The liveness endpoint is `http://localhost:18080/health/live`. Stop the stack and remove its local volumes with:

```bash
pnpm compose:down
```
