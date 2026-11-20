# API 控制面

[返回仓库地图](../../INDEX.md) · [系统架构](../../docs/ARCHITECTURE.md)

`apps/api` 是 `api.arsvine.com` 的 Fastify 控制面，负责文章和短帖的写入、状态和修订检查。

## 运行与配置

```bash
corepack pnpm --filter @arsvine/api dev
corepack pnpm --filter @arsvine/api typecheck
corepack pnpm --filter @arsvine/api test
```

本地环境从 [`./.env.example`](./.env.example) 配置。API 的 `CORE_DATABASE_URL` 使用 Core 写入角色。 [环境配置](../../docs/CONFIGURATION.md)

## 当前接口

- `/health/live`、`/health/ready`：进程与 Core DB 配置状态。
- `/v1/me`：验证 Bearer token 后返回 principal。
- `/v1/posts/**`、`/v1/tweets/**`：按 scope 保护的内容 CRUD。
- 发布、修改或撤下公开内容需要 `content:publish`。文章及其语言版本在同一事务提交后生效。

具体 schema 由当前 route handler 与 `@arsvine/contracts` 线协议类型共同维护。
