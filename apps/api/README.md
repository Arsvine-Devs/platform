# API 控制面

[返回仓库地图](../../INDEX.md) · [系统架构](../../docs/ARCHITECTURE.md)

`apps/api` 是 `api.arsvine.com` 的 Fastify 控制面，负责 Core PostgreSQL 中 Blog/Tweet 的 authoring、revision 检查和 Content release 发布编排。

## 运行与配置

```bash
corepack pnpm --filter @arsvine/api dev
corepack pnpm --filter @arsvine/api typecheck
corepack pnpm --filter @arsvine/api test
```

环境变量以 [`./.env.example`](./.env.example) 为准：Core DB、Auth JWKS/resource、Content publish 和 Realm revalidation 都是服务端配置。

## 当前接口

- `/health/live`、`/health/ready`：进程与 Core DB 配置状态。
- `/v1/me`：验证 Bearer token 后返回 principal。
- `/v1/posts/**`、`/v1/tweets/**`：按 scope 保护的内容 CRUD。
- `/v1/publications`：要求 `content:publish`，先写 Content immutable release，再通知 Realm 刷新。

具体 schema 由当前 route handler 与 `@arsvine/contracts` 线协议类型共同维护。
