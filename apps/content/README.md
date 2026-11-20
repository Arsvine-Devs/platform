# Published Content read plane

[返回仓库地图](../../INDEX.md) · [系统架构](../../docs/ARCHITECTURE.md)

`apps/content` 提供文章和短帖读取。每次请求从当前环境的 Core PostgreSQL 发布视图读取已提交的数据。

## 运行与配置

```bash
corepack pnpm --filter @arsvine/content dev
corepack pnpm --filter @arsvine/content typecheck
corepack pnpm --filter @arsvine/content test
```

本地环境从 [`./.env.example`](./.env.example) 配置。给 Content 使用独立的 `CORE_DATABASE_URL`，数据库角色只有发布视图的读权限。 [环境配置](../../docs/CONFIGURATION.md)

## 当前边界

- 匿名请求读取公开文章和短帖。受保护文章只提供访问门禁所需的元数据。
- `/v1/internal/posts/**` 使用 Auth 验证带 `content:protected:read` 权限的服务令牌。
- `/health/ready` 检查三个发布视图是否可读。数据库不可用时返回 `503`。
