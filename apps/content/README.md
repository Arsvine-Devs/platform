# Published Content read plane

[返回仓库地图](../../INDEX.md) · [系统架构](../../docs/ARCHITECTURE.md)

`apps/content` 是 `content.arsvine.com` 的已发布内容 read plane。它从 S3-compatible private object storage 读取 current pointer 和 release manifest，对外提供 Blog/Tweet 公共读取，并为 API 提供受 token 保护的发布入口。

## 运行与配置

```bash
corepack pnpm --filter @arsvine/content dev
corepack pnpm --filter @arsvine/content typecheck
corepack pnpm --filter @arsvine/content test
```

环境变量以 [`./.env.example`](./.env.example) 和仓库 [`CONFIGURATION.md`](../../docs/CONFIGURATION.md) 为准。Node 入口通过 `@arsvine/env/dotenv` 加载本地 dotenv；`S3_*`、current pointer、发布 token 和 Auth JWKS/resource 配置均属于服务端输入。

## 当前边界

- 公共 `/v1/posts` 和 variant route 会清理 protected post 的敏感 metadata。
- `/v1/internal/posts/**` 需要 `content:protected:read` JWT。
- `/v1/internal/publications` 需要独立的 publish token，并逐个验证对象后才切换 pointer。
- `/health/ready` 会读取当前 release；storage 或 pointer 不可用时返回 `503`。
