# Core 数据库迁移

[返回仓库地图](../INDEX.md) · [Core DB](../packages/core-db/README.md)

`migrations/core/` 保存 Core PostgreSQL 的顺序迁移。当前 API 通过 `apps/api/scripts/migrate-core.mjs` 执行 `0001_core.sql`；迁移文件是持久化数据结构的可执行来源。

新增或修改 migration 前，先确认 `packages/core-db/src/schema.ts`、现有数据库状态和回滚/恢复边界。迁移不会在普通 `corepack pnpm check` 中自动执行。
