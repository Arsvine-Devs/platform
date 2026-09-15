# Environment provider

`@arsvine/env` is the Platform-owned boundary for reading configuration. It
normalizes empty values, provides required/list readers, and owns the only
dotenv loader used by the Node API and Content entrypoints.

The package is source-backed at runtime, so a clean checkout does not depend on
an untracked `dist/` directory. The `./dotenv` entrypoint is Node-only and must
not be imported by browser, Proxy, or Edge code.

Use `corepack pnpm envctl stats`, `corepack pnpm envctl query --key NAME`, and
`corepack pnpm envctl register ...` from the repository root. The machine-readable
registry is [`../../config/env-contracts.json`](../../config/env-contracts.json);
the human instructions are [`../../docs/OPERATIONS.md`](../../docs/OPERATIONS.md).
