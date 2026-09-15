# Auth 身份服务

[返回仓库地图](../../INDEX.md) · [安全边界](../../docs/SECURITY.md)

`apps/auth` 是 `auth.arsvine.com` 的 Better Auth 身份服务，拥有 OAuth/OIDC provider、JWKS、Passkey、TOTP 和 Auth PostgreSQL。Console 通过 OIDC 使用它，其他服务只验证其签发的 JWT。

## 运行与配置

```bash
corepack pnpm --filter @arsvine/auth dev
corepack pnpm --filter @arsvine/auth typecheck
corepack pnpm --filter @arsvine/auth build
```

环境变量以 [`./.env.example`](./.env.example) 为准。`AUTH_DATABASE_URL`、`BETTER_AUTH_SECRET`、issuer/audience、trusted origins 和 Passkey origin 必须按部署环境配置。

## 页面与接口

- `/sign-in`：账户密码或 Passkey 登录。
- `/security`：已登录账户的 Passkey、Authenticator/TOTP 和密码管理。
- `/oauth2/*`、`/.well-known/*`、`/jwks`：OIDC/OAuth provider discovery 与验证接口。
- `/health/live`、`/health/ready`：进程和 Auth 数据库/secret readiness。

Auth 数据库当前使用 Better Auth 密码 hash 格式；格式变更必须同步考虑现有持久化数据和迁移方案。
