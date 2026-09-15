# Core DB

[返回仓库地图](../../INDEX.md) · [数据库 migration](../../migrations/README.md)

`@arsvine/core-db` 拥有 Core PostgreSQL 的 Drizzle schema、内容查询、revision 约束和 authoring mutation。它由 API 使用，Console 不能直接访问。

```bash
corepack pnpm --filter @arsvine/core-db typecheck
corepack pnpm --filter @arsvine/core-db build
```

表结构的迁移入口在 [`migrations/core/`](../../migrations/core/)，schema 与 migration 变更必须保持同一持久化契约。
