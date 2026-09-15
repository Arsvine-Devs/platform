# 环境变量配置

[返回文档目录](./INDEX.md) · [返回仓库地图](../INDEX.md)

Platform 的环境变量契约只有一个机器来源：[`config/env-contracts.json`](../config/env-contracts.json)。四个服务的 `.env.example` 是可复制的安全模板；两者由 `corepack pnpm env:check` 校验。变量值存放在对应服务的未跟踪 `.env.local` 或 Vercel 项目环境中，不进入 Git、浏览器 bundle、日志或测试 fixture。

## 使用方式

Platform 不使用根目录聚合环境文件作为服务配置。每个服务从自己的目录加载：

```powershell
Copy-Item apps/api/.env.example apps/api/.env.local
Copy-Item apps/auth/.env.example apps/auth/.env.local
Copy-Item apps/content/.env.example apps/content/.env.local
Copy-Item apps/console/.env.example apps/console/.env.local
corepack pnpm envctl stats
corepack pnpm envctl query --key BETTER_AUTH_SECRET
corepack pnpm envctl prune --file apps/console/.env.local --service console
corepack pnpm env:check
```

`@arsvine/env` 的 `readEnv()` 会去除首尾空白并把空字符串视为未配置；`readEnvList()` 使用逗号分隔并逐项去空白。API 和 Content 的 Node 入口通过 `@arsvine/env/dotenv` 按以下优先级加载文件：`.env.<mode>.local`、`.env.local`、`.env.<mode>`、`.env`，已经存在于进程环境的值优先。Auth 和 Console 由 Next.js 加载 dotenv，服务端读取仍使用同一个 provider 的规范化函数。Next 配置和浏览器公开 `NEXT_PUBLIC_*` 值保留框架要求的构建期直接读取。

生成随机 secret 的示例：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

把命令输出粘贴到对应的 secret 条目；不要把命令输出写进文档或提交。Vercel 上的变量名、值和环境 scope 必须与这里的服务归属一致，API/Content 之间明确标记为“相同值”的共享 token 必须同步轮换。

## API：`apps/api/.env.local`

API 监听端口默认 `3001`，线上 Vercel 不需要手工设置 `PORT`/`HOST`。API readiness 要求 Auth 验证、Core 数据库和 resource 配置；发布相关变量在执行 `/v1/publications` 前必须齐全。

| 变量                        | 填入内容与格式                                                                                                 | 作用和读取方                          | 作用域 / secret              | 缺失或错误行为                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------- | -------------------------------------------- |
| `PORT`                      | 十进制端口 `1`–`65535`；本地示例 `3001`                                                                        | API Node 入口监听端口                 | local/self-hosted；否        | 默认 `3001`                                  |
| `HOST`                      | 绑定主机名或 IP；本地通常为 `0.0.0.0`                                                                          | API Node 入口绑定地址                 | local/self-hosted；否        | 默认 `0.0.0.0`                               |
| `API_DISPLAY_NAME`          | 非空显示名称；例 `Arsvine Control API`                                                                         | OpenAPI/service display name          | local/preview/production；否 | 使用 `Control API`                           |
| `API_PUBLIC_URL`            | 绝对 HTTPS origin；例 `https://api.arsvine.com`；本地可用 localhost HTTP                                       | OpenAPI `servers`                     | local/preview/production；否 | OpenAPI 不写 `servers`                       |
| `AUTH_ISSUER`               | 绝对 HTTPS Auth issuer；例 `https://auth.arsvine.com`                                                          | API JWT issuer 校验                   | local/preview/production；否 | readiness 失败，认证不可用                   |
| `AUTH_JWKS_URL`             | 绝对 HTTPS JWKS URL；例 `https://auth.arsvine.com/jwks`                                                        | API JWT 公钥读取                      | local/preview/production；否 | readiness 失败，认证不可用                   |
| `API_RESOURCE`              | 绝对 HTTPS resource/audience URL；例 `https://api.arsvine.com`                                                 | API OAuth resource 与 JWT audience    | local/preview/production；否 | readiness 失败，Bearer 校验失败              |
| `CORE_DATABASE_URL`         | PostgreSQL URL；托管数据库带 `?sslmode=require`，例 `postgresql://user:password@host/database?sslmode=require` | `@arsvine/core-db` 和 Core migration  | local/preview/production；是 | readiness/数据库命令失败，不启动隐式替代存储 |
| `CONTENT_CURRENT_POINTER`   | 相对 object key，无前导 `/`、无 `..`；例 `realm-content/current.json`                                          | API 发布 payload 中的 current pointer | local/preview/production；否 | 默认 `realm-content/current.json`            |
| `CONTENT_PUBLISH_URL`       | 绝对 HTTPS Content 内部发布 URL；例 `https://content.arsvine.com/v1/internal/publications`                     | API → Content immutable release 写入  | local/preview/production；否 | 发布返回不可用错误                           |
| `CONTENT_PUBLISH_TOKEN`     | 高熵不透明 token；API 与 Content 必须使用相同值                                                                | API 请求头和 Content 发布鉴权         | local/preview/production；是 | Content 返回 `401`，发布失败                 |
| `REALM_REVALIDATE_URL`      | 绝对 HTTPS Realm internal revalidate URL；例 `https://arsvine.com/api/internal/revalidate`                     | API → Realm 缓存刷新                  | local/preview/production；否 | 发布不会报告成功                             |
| `REVALIDATE_WEBHOOK_SECRET` | API 与 Realm 共享的长随机 HMAC secret                                                                          | 对 `timestamp.body` 做 SHA-256 HMAC   | local/preview/production；是 | Realm 拒绝事件，发布链路失败                 |

## Auth：`apps/auth/.env.local`

Auth 是唯一身份提供者。`BETTER_AUTH_AUDIENCE`、`OAUTH_RESOURCES` 和 `AUTH_TRUSTED_ORIGINS` 都是逗号分隔列表；列表中的 origin/resource 必须包含 scheme，origin 不带 path。Passkey 两个值必须与浏览器实际访问的 Auth 域名一致。

| 变量                   | 填入内容与格式                                                                                          | 作用和读取方                                | 作用域 / secret              | 缺失或错误行为                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------- | ------------------------------------------ |
| `AUTH_DATABASE_URL`    | PostgreSQL URL；托管数据库带 TLS 参数                                                                   | Better Auth account/session/security 数据库 | local/preview/production；是 | readiness 失败，数据库请求不可用           |
| `AUTH_DISPLAY_NAME`    | 非空 UTF-8 名称；例 `Arsvine Auth`                                                                      | Auth 和 TOTP issuer 显示名                  | local/preview/production；否 | 使用框架默认显示名                         |
| `BETTER_AUTH_URL`      | 绝对 HTTPS Auth origin；本地可用 localhost HTTP                                                         | Better Auth base URL 与 OAuth provider 开关 | local/preview/production；否 | OAuth provider 被禁用                      |
| `BETTER_AUTH_ISSUER`   | 绝对 HTTPS issuer；例 `https://auth.arsvine.com`                                                        | JWT `iss` claim 与 provider 配置            | local/preview/production；否 | readiness 失败                             |
| `BETTER_AUTH_AUDIENCE` | 逗号分隔的绝对 resource URL；例 `https://api.arsvine.com,https://content.arsvine.com`                   | 下游 API/Content 接受的 JWT audience        | local/preview/production；否 | readiness 失败，token audience 不完整      |
| `BETTER_AUTH_SECRET`   | Auth 专用长随机 secret；用上方命令生成                                                                  | Better Auth 签名和加密                      | local/preview/production；是 | readiness 失败；开发 fallback 不可用于生产 |
| `AUTH_TRUSTED_ORIGINS` | 逗号分隔 exact origins；例 `http://localhost:3003,https://auth.arsvine.com,https://console.arsvine.com` | Better Auth 浏览器请求信任列表              | local/preview/production；否 | readiness 失败，未列 origin 被拒绝         |
| `OAUTH_RESOURCES`      | 逗号分隔绝对 resource URL；例 `https://api.arsvine.com,https://content.arsvine.com`                     | OAuth provider 的 resource indicators       | local/preview/production；否 | readiness 失败，resource 列表为空          |
| `PASSKEY_RP_ID`        | WebAuthn hostname，不带 scheme/path；例 `auth.arsvine.com`                                              | Passkey relying-party ID                    | local/preview/production；否 | readiness 失败，Passkey 操作失败           |
| `PASSKEY_ORIGIN`       | 与 RP 对应的 exact HTTPS origin；例 `https://auth.arsvine.com`                                          | Passkey origin 校验                         | local/preview/production；否 | readiness 失败，Passkey 操作被拒绝         |

## Content：`apps/content/.env.local`

Content 的 `S3_*` 是服务端 object-storage 配置。`S3_FORCE_PATH_STYLE=false` 才选择 virtual-hosted style；留空或其他值使用 path-style。`CONTENT_PUBLISH_TOKEN` 必须与 API 条目相同，`CONTENT_CURRENT_POINTER` 必须与 API 使用的 pointer key 相同。

| 变量                      | 填入内容与格式                                                        | 作用和读取方                       | 作用域 / secret                    | 缺失或错误行为                      |
| ------------------------- | --------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ----------------------------------- |
| `PORT`                    | 十进制端口 `1`–`65535`；本地示例 `3002`                               | Content Node 入口监听端口          | local/self-hosted；否              | 默认 `3002`                         |
| `HOST`                    | 绑定主机名或 IP；本地通常为 `0.0.0.0`                                 | Content Node 入口绑定地址          | local/self-hosted；否              | 默认 `0.0.0.0`                      |
| `CONTENT_DISPLAY_NAME`    | 非空显示名称；例 `Arsvine Published Content`                          | Content/OpenAPI display name       | local/preview/production；否       | 使用 `Published Content`            |
| `CONTENT_PUBLIC_URL`      | 绝对 HTTPS origin；例 `https://content.arsvine.com`                   | OpenAPI `servers`                  | local/preview/production；否       | OpenAPI 不写 `servers`              |
| `CONTENT_CURRENT_POINTER` | 相对 object key，无前导 `/`、无 `..`；例 `realm-content/current.json` | 当前 release selector              | local/preview/production；否       | 默认 `realm-content/current.json`   |
| `AUTH_ISSUER`             | 绝对 HTTPS Auth issuer；例 `https://auth.arsvine.com`                 | protected variant JWT issuer       | local/preview/production；否       | readiness/protected read 失败       |
| `AUTH_JWKS_URL`           | 绝对 HTTPS JWKS URL；例 `https://auth.arsvine.com/jwks`               | protected variant JWT 公钥         | local/preview/production；否       | readiness/protected read 失败       |
| `CONTENT_RESOURCE`        | 绝对 HTTPS resource/audience URL；例 `https://content.arsvine.com`    | Content protected-read audience    | local/preview/production；否       | readiness 失败，protected read 拒绝 |
| `S3_ENDPOINT`             | 绝对 HTTPS S3-compatible endpoint；例 `https://s3.example.invalid`    | `@arsvine/object-storage` endpoint | local/preview/production；否       | storage 不创建，readiness 为 `503`  |
| `S3_REGION`               | provider region identifier；例 `ap-beijing`                           | S3 client region                   | local/preview/production；否       | storage 不创建                      |
| `S3_FORCE_PATH_STYLE`     | `true`/`false`；例 `false`                                            | S3 addressing mode                 | local/preview/production；否       | 默认 path-style                     |
| `S3_ACCESS_KEY_ID`        | read-only object-storage access key ID                                | S3 client credential               | local/preview/production；是       | storage 不创建                      |
| `S3_SECRET_ACCESS_KEY`    | 与 access key 配对的 read-only secret                                 | S3 client credential               | local/preview/production；是       | storage 不创建                      |
| `S3_PRIVATE_BUCKET`       | bucket name，无 protocol/slash；例 `replace-with-content-bucket`      | immutable release 和 pointer 对象  | local/preview/production；服务端值 | storage 不创建，Content 不 ready    |
| `CONTENT_PUBLISH_TOKEN`   | 与 API 完全相同的高熵 token                                           | API → Content 发布鉴权             | local/preview/production；是       | 内部发布返回 `401`                  |

## Console：`apps/console/.env.local`

Console 浏览器只访问同源 BFF。`AUTH_OIDC_*` 的 callback/logout/resource 值必须同时登记在 Auth 客户端配置中；`AUTH_OIDC_SCOPE` 是空格分隔。`NEXT_PUBLIC_ANALYTICS_*` 会进入浏览器或 CSP，只能填公开 origin，不能放 secret。

| 变量                                   | 填入内容与格式                                                                              | 作用和读取方                  | 作用域 / secret              | 缺失或错误行为                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------- | ------------------------------- |
| `SESSION_SECRET`                       | Console 专用长随机 secret                                                                   | opaque session 加密和签名     | local/preview/production；是 | session 创建/校验 fail closed   |
| `AUTH_OIDC_ISSUER`                     | 绝对 HTTPS Auth issuer origin                                                               | ID token `iss` 校验           | local/preview/production；否 | OIDC callback 失败              |
| `AUTH_OIDC_AUTHORIZATION_URL`          | 绝对 HTTPS OAuth authorize URL；例 `https://auth.arsvine.com/api/auth/oauth2/authorize`     | 登录浏览器跳转                | local/preview/production；否 | 登录无法开始                    |
| `AUTH_OIDC_TOKEN_URL`                  | 绝对 HTTPS OAuth token URL；例 `https://auth.arsvine.com/api/auth/oauth2/token`             | 服务端 code exchange          | local/preview/production；否 | 无法建立 Console session        |
| `AUTH_OIDC_USERINFO_URL`               | 绝对 HTTPS userinfo URL；例 `https://auth.arsvine.com/api/auth/oauth2/userinfo`             | 服务端读取身份 claims         | local/preview/production；否 | callback 拒绝不完整身份         |
| `AUTH_OIDC_JWKS_URL`                   | 绝对 HTTPS Auth JWKS URL；例 `https://auth.arsvine.com/jwks`                                | ID token 签名校验             | local/preview/production；否 | callback 校验失败               |
| `AUTH_OIDC_END_SESSION_URL`            | 绝对 HTTPS RP-initiated logout URL                                                          | Auth provider logout          | local/preview/production；否 | provider session 步骤失败       |
| `AUTH_OIDC_CLIENT_ID`                  | Auth 签发的 OAuth client ID；例 `console-client-id`                                         | authorize/token 请求          | local/preview/production；否 | OIDC authorize 和 exchange 失败 |
| `AUTH_OIDC_CLIENT_SECRET`              | Auth 签发的 OAuth client secret                                                             | 仅 BFF 的 token exchange      | local/preview/production；是 | exchange 失败，不能进浏览器     |
| `AUTH_OIDC_REDIRECT_URI`               | Auth 登记的 exact HTTPS callback；例 `https://console.arsvine.com/auth/callback`            | authorization-code callback   | local/preview/production；否 | Auth 拒绝 callback              |
| `AUTH_OIDC_POST_LOGOUT_REDIRECT_URI`   | Auth 登记的 exact HTTPS signed-out URL；例 `https://console.arsvine.com/auth/signed-out`    | logout 返回地址               | local/preview/production；否 | logout redirect 被拒绝          |
| `AUTH_OIDC_RESOURCE`                   | 绝对 HTTPS API resource；例 `https://api.arsvine.com`                                       | token resource indicator      | local/preview/production；否 | token 不面向 Control API        |
| `AUTH_OIDC_SCOPE`                      | 空格分隔 OAuth scopes；例 `openid profile email content:read content:write content:publish` | authorize 请求 scope          | local/preview/production；否 | 使用内置 scope 集合             |
| `API_BASE_URL`                         | 无 path/query/hash 的绝对 HTTPS API origin；例 `https://api.arsvine.com`                    | BFF → Control API             | local/preview/production；否 | readiness/BFF 请求 fail closed  |
| `UPSTASH_REDIS_REST_URL`               | 绝对 HTTPS Upstash REST URL                                                                 | distributed session/limiter   | local/preview/production；否 | 使用进程内 session/limiter      |
| `UPSTASH_REDIS_REST_TOKEN`             | 与 REST URL 配对的 bearer token                                                             | distributed session/limiter   | local/preview/production；是 | 使用进程内 session/limiter      |
| `TRUST_PROXY`                          | `1`/`0` 或 `true`/`false`；自托管仅在代理覆盖 header 时为 `1`                               | client-IP rate-limit key      | local/self-hosted；否        | 默认不信任 forwarded header     |
| `NEXT_PUBLIC_ANALYTICS_ENABLED`        | `1` 开启，`0` 关闭                                                                          | 浏览器 Analytics feature flag | local/preview/production；否 | 非 `1` 时不挂载 Analytics       |
| `NEXT_PUBLIC_ANALYTICS_SCRIPT_ORIGIN`  | CSP `script-src` 使用的绝对 HTTPS origin；例 `https://va.vercel-scripts.com`                | Console `next.config.ts`      | local/preview/production；否 | 不增加额外 script origin        |
| `NEXT_PUBLIC_ANALYTICS_CONNECT_ORIGIN` | CSP `connect-src` 使用的绝对 HTTPS origin；例 `https://vitals.vercel-insights.com`          | Console `next.config.ts`      | local/preview/production；否 | 不增加额外 connect origin       |

## CLI 查询与注册

```powershell
corepack pnpm envctl stats
corepack pnpm envctl stats --service api
corepack pnpm envctl query --key CORE_DATABASE_URL
corepack pnpm envctl register `
  --key NEW_SERVICE_URL `
  --service api `
  --description "Destination for the service" `
  --format "absolute HTTPS origin" `
  --scope local,preview,production `
  --requiredness conditional `
  --example "https://service.example.com" `
  --example-file apps/api/.env.example `
  --used-by apps/api/src/server.ts
```

`envctl query` 只显示元数据、消费者和 local 文件中的 set/unset 状态，永远不显示值。`envctl register` 在写入前检查 key、消费者路径、示例文件和 requiredness；成功后同步更新契约并向 `.env.example` 追加格式说明。Secret 注册只能填安全占位符，真实值由维护者另行写入未跟踪文件或 Vercel。

`envctl prune --file PATH` 需要显式指定文件，只保留契约中登记的变量并删除其余 assignment 行；它适合清理聚合 `.env` 文件。命令会保留已登记的原始值，但会丢弃注释和空行，因此只对明确的本地配置文件使用。服务文件仍以各自目录为准。

`corepack pnpm env:check` 会检查：每个示例 key 都已注册；每个注册 key 都出现在声明的示例文件；source-only provider input 没有误入示例；每个 `usedBy` 路径真实存在；契约没有重复 key。新增变量必须先注册再接入消费者。
