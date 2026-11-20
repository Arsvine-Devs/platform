# ARSVINE Console

[返回仓库地图](../../INDEX.md) · [安全边界](../../docs/SECURITY.md)

`console.arsvine.com` 使用 Auth OIDC 登录。访问令牌和数据库凭据保存在服务端，浏览器通过当前站点的会话访问 BFF。

## 当前流程

```text
Console UI
  → same-origin Console BFF (/api/control/*)
  → https://api.arsvine.com/v1/*
  → Core PostgreSQL
```

Core 提交文章或短帖后，Realm 的下一次请求通过 Content 读取已提交数据。

## 路由

- `/login`：跳转到 Auth OIDC 登录。
- `/library`：列出 Core 中的 Blog 与 Tweet。
- `/blog`：编辑 Blog variant 并发布 release。
- `/tweets`：编辑 Core Tweet 记录。
- `/control`：查看当前 OIDC session 和 Control API principal。
- `/auth/signed-out`：Console 与 Auth session 关闭后的落点。
- `/health/live`、`/health/ready`：进程与 BFF 配置探针。

账户安全、Passkey、TOTP、密码和账户生命周期属于 `auth.arsvine.com/security`。退出登录会删除 Console session、清除浏览器 cookie，再完成 Auth RP-Initiated Logout；已注册的安全密钥不会因退出登录而删除。

`prompts/` 保存供维护者手动使用的 Blog/Tweet 翻译模板；它们由维护者显式提供输入，Console runtime 只处理当前 Core/API 流程。

## 配置

动态环境变量以 [`./.env.example`](./.env.example) 和仓库 [`CONFIGURATION.md`](../../docs/CONFIGURATION.md) 为准：

- `SESSION_SECRET`：服务端 session 加密密钥；
- `AUTH_OIDC_CLIENT_ID`、`AUTH_OIDC_CLIENT_SECRET`：Auth 签发的 Console client credentials；
- `REDIS_URL`、`REDIS_KEY_PREFIX`：Valkey 会话与限流；
- `TRUST_PROXY`：只有可信代理覆盖 client header 时才开启；

Console 的固定 OIDC/API 拓扑由 `@arsvine/site-config` 提供，动态服务端配置读取统一经过 `@arsvine/env`。`next.config.ts` 和浏览器 Analytics 组件保留直接读取 `NEXT_PUBLIC_*`，以便 Next.js 在构建时注入公开值。

Console 配置包含浏览器会话、Auth OIDC、Control API、Valkey 和 Web Ops 套接字。Core DB 和 Content storage 的配置由对应服务管理。

## 本地检查

```bash
corepack pnpm --filter arsvine-admin format:check
corepack pnpm --filter arsvine-admin lint
corepack pnpm --filter arsvine-admin typecheck
corepack pnpm --filter arsvine-admin test
corepack pnpm --filter arsvine-admin build
```
