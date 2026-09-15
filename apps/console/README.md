# ARSVINE Console

[返回仓库地图](../../INDEX.md) · [安全边界](../../docs/SECURITY.md)

`console.arsvine.com` 是 ARSVINE Platform 的管理界面。它使用 Auth OIDC 建立身份，再把加密的 Host-only opaque session 保存在服务端；浏览器代码不会接触 OAuth token、数据库连接或 Content storage 凭据。

## 当前流程

```text
Console UI
  → same-origin Console BFF (/api/control/*)
  → https://api.arsvine.com/v1/*
  → Core PostgreSQL
  → Content release publication
  → Realm revalidation
```

Blog 和 Tweet authoring 属于 Core/API。Realm 的公开读取属于 Content read plane。

## 路由

- `/login`：跳转到 Auth OIDC 登录。
- `/library`：列出 Core 中的 Blog 与 Tweet。
- `/blog`：编辑 Blog variant 并发布 release。
- `/tweets`：编辑 Core Tweet 记录。
- `/control`：查看当前 OIDC session 和 Control API principal。
- `/auth/signed-out`：Console 与 Auth session 关闭后的落点。
- `/health/live`、`/health/ready`：进程与 BFF 配置探针。

账户安全、Passkey、TOTP、密码和账户生命周期属于 `auth.arsvine.com/security`。退出登录会删除 Console session、清除浏览器 cookie，再完成 Auth RP-Initiated Logout；已注册的安全密钥不会因退出登录而删除。

`prompts/` 保存供维护者手动使用的 Blog/Tweet 翻译模板，不会被 Console runtime 加载，也不代表已部署 translation worker。

## 配置

环境变量以 [`./.env.example`](./.env.example) 为准：

- `SESSION_SECRET`：服务端 session 加密密钥；
- `AUTH_OIDC_*`：Auth issuer、client、回调、JWKS、resource 和 logout 配置；
- `API_BASE_URL`：服务端 Control API origin；
- `UPSTASH_REDIS_REST_*`：session 与分布式限流；
- `TRUST_PROXY`：只有可信代理覆盖 client header 时才开启；
- `NEXT_PUBLIC_ANALYTICS_*`：可选 Vercel telemetry。

Console 不再需要 Core DB、object storage、GitHub、独立内容仓库、X cron 或翻译 provider 的配置。

## 本地检查

```bash
corepack pnpm --filter arsvine-admin format:check
corepack pnpm --filter arsvine-admin lint
corepack pnpm --filter arsvine-admin typecheck
corepack pnpm --filter arsvine-admin test
corepack pnpm --filter arsvine-admin build
```
