# 环境变量配置

[返回文档目录](./INDEX.md) · [返回仓库地图](../INDEX.md)

Platform 把配置分为两类：源代码拥有的固定站点拓扑，以及部署时注入的运行时输入。固定拓扑集中在 [`@arsvine/site-config`](../packages/site-config/src/index.mjs)；运行时输入集中由 [`@arsvine/env`](../packages/env/README.md) 读取。这样 `API_PUBLIC_URL` 这类不会再通过 dotenv 在仓库内传播，数据库连接、凭据和明确的本地运行开关仍保持可部署性。

机器契约是 [`config/env-contracts.json`](../config/env-contracts.json)，四个服务的 `.env.example` 是安全模板，由 `corepack pnpm env:check` 校验。真实值只放在对应服务目录的未跟踪 `.env.local` 或部署平台环境中，不进入 Git、浏览器 bundle、日志或测试 fixture。

五个 Vercel production deployment 使用当前主分支版本，production environment 只保留动态运行时契约键；固定拓扑键由 `@arsvine/site-config` 提供，不应重新加入 Vercel 或 `.env`。

## 源代码固定拓扑

以下值是当前服务协议和域名拓扑的一部分，直接由 `@arsvine/site-config` 提供：

| 配置位置                  | 当前内容                                                                                                                          | 使用方                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `siteConfig.api`          | API origin、`Arsvine Control API` display name、API resource/audience                                                             | API OpenAPI、API JWT 校验                                  |
| `siteConfig.auth`         | Auth origin/issuer、JWKS URL、JWT audience、OAuth resources、Passkey RP/origin、`Arsvine Auth` display name                       | Auth、API、Content                                         |
| `siteConfig.content`      | Content origin、`Arsvine Published Content` display name、Content resource、`realm-content/current.json` pointer、publication URL | Content、API publication                                   |
| `siteConfig.console.oidc` | Auth OIDC endpoints、API resource、Console callback/logout URL、OAuth scope                                                       | Console OIDC BFF                                           |
| `siteConfig.realm`        | Realm origin 和 `/api/internal/revalidate` URL                                                                                    | API publication                                            |
| `siteConfig.cdn`          | `https://cdn.arsvine.com`                                                                                                         | 由 Realm 自己的 `siteConfig` 继续拥有，Platform 只记录拓扑 |

这些值的改变属于拓扑或协议变更：修改 `packages/site-config/src/index.mjs`，同步 OIDC client registration、DNS/Vercel domain 和相关文档，然后运行完整门禁。不要为固定值新增 `.env` fallback。

## dotenv provider

Platform 不使用根目录聚合环境文件作为服务配置。每个服务从自己的目录加载：

```powershell
Copy-Item apps/api/.env.example apps/api/.env.local
Copy-Item apps/auth/.env.example apps/auth/.env.local
Copy-Item apps/content/.env.example apps/content/.env.local
Copy-Item apps/console/.env.example apps/console/.env.local
corepack pnpm envctl stats
corepack pnpm envctl query --key CORE_DATABASE_URL
corepack pnpm env:check
```

`@arsvine/env` 的 `readEnv()` 会去除首尾空白并把空字符串视为未配置；`readEnvList()` 使用逗号分隔并逐项去空白。API 和 Content 的 Node 入口通过 `@arsvine/env/dotenv` 按 `.env.<mode>.local`、`.env.local`、`.env.<mode>`、`.env` 的优先级加载，进程环境优先。Auth 和 Console 的 Next.js 运行时由 Next.js 加载 dotenv，服务端读取仍使用同一 provider 的规范化函数。

Next 配置和浏览器公开 `NEXT_PUBLIC_*` 值保留直接读取，以便 Next.js 在构建期注入公开值；它们不能被改成动态 `readEnv(name)`，否则生产 bundle 无法得到预期的公开配置。

生成随机 secret 的示例：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## API：`apps/api/.env.local`

| 变量                        | 填入内容与格式                                  | 作用和读取方                          | 作用域 / secret              | 缺失或错误行为                         |
| --------------------------- | ----------------------------------------------- | ------------------------------------- | ---------------------------- | -------------------------------------- |
| `PORT`                      | 十进制端口 `1`–`65535`；本地示例 `3001`         | API Node 入口监听端口                 | local/self-hosted；否        | 默认 `3001`；Vercel 自己提供运行时端口 |
| `HOST`                      | 绑定主机名或 IP；本地通常为 `0.0.0.0`           | API Node 入口绑定地址                 | local/self-hosted；否        | 默认 `0.0.0.0`                         |
| `CORE_DATABASE_URL`         | PostgreSQL URL；托管数据库带 `?sslmode=require` | `@arsvine/core-db` 和 Core migration  | local/preview/production；是 | Core route 和 migration fail closed    |
| `CONTENT_PUBLISH_TOKEN`     | API 与 Content 使用相同的高熵不透明 token       | API 请求头和 Content publication auth | local/preview/production；是 | Content 返回 `401`，发布失败           |
| `REVALIDATE_WEBHOOK_SECRET` | API 与 Realm 共享的长随机 HMAC secret           | API 对 Realm revalidation 事件签名    | local/preview/production；是 | Realm 拒绝事件，发布链路失败           |

API origin、OpenAPI display name、Auth issuer/JWKS/resource、Content publication URL、Realm revalidation URL 和 pointer 由 `siteConfig` 提供。

## Auth：`apps/auth/.env.local`

| 变量                   | 填入内容与格式                                                                                                                   | 作用和读取方                                | 作用域 / secret              | 缺失或错误行为                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------- | ---------------------------------------- |
| `AUTH_DATABASE_URL`    | PostgreSQL URL；托管数据库带 TLS 参数                                                                                            | Better Auth account/session/security 数据库 | local/preview/production；是 | readiness 失败，数据库请求不可用         |
| `BETTER_AUTH_SECRET`   | Auth 专用长随机 secret                                                                                                           | Better Auth 签名和加密                      | local/preview/production；是 | readiness 失败；开发 fallback 不用于生产 |
| `AUTH_TRUSTED_ORIGINS` | 逗号分隔 exact origins，包含 scheme 且不带 path；例 `http://localhost:3003,https://auth.arsvine.com,https://console.arsvine.com` | Better Auth 浏览器请求信任列表              | local/preview/production；否 | readiness 失败，未列 origin 被拒绝       |

Auth origin、issuer、audience、trusted origins、OAuth resources、display name、Passkey RP ID 和 origin 由 `siteConfig.auth` 提供。

## Content：`apps/content/.env.local`

| 变量                    | 填入内容与格式                                                     | 作用和读取方                       | 作用域 / secret                    | 缺失或错误行为                         |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------- | ---------------------------------- | -------------------------------------- |
| `PORT`                  | 十进制端口 `1`–`65535`；本地示例 `3002`                            | Content Node 入口监听端口          | local/self-hosted；否              | 默认 `3002`；Vercel 自己提供运行时端口 |
| `HOST`                  | 绑定主机名或 IP；本地通常为 `0.0.0.0`                              | Content Node 入口绑定地址          | local/self-hosted；否              | 默认 `0.0.0.0`                         |
| `S3_ENDPOINT`           | 绝对 HTTPS S3-compatible endpoint；例 `https://s3.example.invalid` | `@arsvine/object-storage` endpoint | local/preview/production；否       | storage 不创建，readiness 为 `503`     |
| `S3_REGION`             | provider region identifier；例 `ap-beijing`                        | S3 client region                   | local/preview/production；否       | storage 不创建                         |
| `S3_FORCE_PATH_STYLE`   | `true`/`false`；`false` 选择 virtual-hosted style                  | S3 addressing mode                 | local/preview/production；否       | 默认 path-style                        |
| `S3_ACCESS_KEY_ID`      | read-only object-storage access key ID                             | S3 client credential               | local/preview/production；是       | storage 不创建                         |
| `S3_SECRET_ACCESS_KEY`  | 与 access key 配对的 read-only secret                              | S3 client credential               | local/preview/production；是       | storage 不创建                         |
| `S3_PRIVATE_BUCKET`     | bucket name，不带 protocol 或 `/`                                  | immutable release 和 pointer 对象  | local/preview/production；服务端值 | Content 不 ready                       |
| `CONTENT_PUBLISH_TOKEN` | 与 API 完全相同的高熵 token                                        | API → Content publication auth     | local/preview/production；是       | 内部发布返回 `401`                     |

Content origin、display name、resource 和 `realm-content/current.json` pointer 由 `siteConfig.content` 提供。

## Console：`apps/console/.env.local`

| 变量                                   | 填入内容与格式                                                | 作用和读取方                  | 作用域 / secret              | 缺失或错误行为                  |
| -------------------------------------- | ------------------------------------------------------------- | ----------------------------- | ---------------------------- | ------------------------------- |
| `SESSION_SECRET`                       | Console 专用长随机 secret                                     | opaque session 加密和签名     | local/preview/production；是 | session 创建/校验 fail closed   |
| `AUTH_OIDC_CLIENT_ID`                  | Auth 签发的 OAuth client ID；例 `console-client-id`           | authorize/token 请求          | local/preview/production；否 | OIDC authorize 和 exchange 失败 |
| `AUTH_OIDC_CLIENT_SECRET`              | Auth 签发的 OAuth client secret                               | 仅 BFF 的 token exchange      | local/preview/production；是 | exchange 失败，不能进浏览器     |
| `UPSTASH_REDIS_REST_URL`               | 绝对 HTTPS Upstash REST URL                                   | distributed session/limiter   | local/preview/production；否 | 使用进程内 session/limiter      |
| `UPSTASH_REDIS_REST_TOKEN`             | 与 REST URL 配对的 bearer token                               | distributed session/limiter   | local/preview/production；是 | 使用进程内 session/limiter      |
| `TRUST_PROXY`                          | `1`/`0` 或 `true`/`false`；自托管仅在代理覆盖 header 时为 `1` | client-IP rate-limit key      | local/self-hosted；否        | 默认不信任 forwarded header     |
| `NEXT_PUBLIC_ANALYTICS_ENABLED`        | `1` 开启，`0` 关闭                                            | 浏览器 Analytics feature flag | local/preview/production；否 | 非 `1` 时不挂载 Analytics       |
| `NEXT_PUBLIC_ANALYTICS_SCRIPT_ORIGIN`  | CSP `script-src` 使用的绝对 HTTPS origin                      | Console `next.config.ts`      | local/preview/production；否 | 不增加额外 script origin        |
| `NEXT_PUBLIC_ANALYTICS_CONNECT_ORIGIN` | CSP `connect-src` 使用的绝对 HTTPS origin                     | Console `next.config.ts`      | local/preview/production；否 | 不增加额外 connect origin       |

Console OIDC endpoint、issuer、API resource、scope、callback/logout URL 和 API origin 由 `siteConfig.console.oidc` 与 `siteConfig.api` 提供。

## CLI

```powershell
corepack pnpm envctl stats
corepack pnpm envctl stats --service api
corepack pnpm envctl query --key CORE_DATABASE_URL
corepack pnpm envctl prune --file .env.local
corepack pnpm env:check
```

`envctl stats` 只统计动态环境契约；固定拓扑请直接查看 `packages/site-config/src/index.mjs`。`envctl query` 只显示元数据、消费者和 set/unset 状态，永远不显示值。`envctl prune --file PATH` 需要显式指定文件，只保留契约中登记的变量并删除其余 assignment 行，适合清理聚合本地文件；服务正式配置仍放在各自应用目录。

新变量必须先用 `envctl register` 登记：

```powershell
corepack pnpm envctl register `
  --key NEW_SERVICE_SECRET `
  --service api `
  --description "Credential for the service" `
  --format "long random secret" `
  --scope local,preview,production `
  --requiredness conditional `
  --example "replace-with-a-long-random-secret" `
  --example-file apps/api/.env.example `
  --used-by apps/api/src/server.ts `
  --secret
```

如果一个值是固定拓扑、协议常量或服务 display metadata，应修改 `@arsvine/site-config`，不要注册成环境变量。
