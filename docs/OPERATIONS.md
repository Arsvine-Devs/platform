# 配置、健康检查与发布

[返回文档目录](./INDEX.md)

## 配置所有权

环境变量按服务维护在对应 `.env.example`：

| 服务    | 关键配置                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------- |
| Auth    | `AUTH_DATABASE_URL`、`BETTER_AUTH_*`、`AUTH_TRUSTED_ORIGINS`、`OAUTH_RESOURCES`、Passkey 配置           |
| API     | `CORE_DATABASE_URL`、`AUTH_*`、`CONTENT_PUBLISH_*`、`REALM_REVALIDATE_URL`、`REVALIDATE_WEBHOOK_SECRET` |
| Content | `S3_*`、`CONTENT_CURRENT_POINTER`、`CONTENT_PUBLISH_TOKEN`、Auth JWKS 配置                              |
| Console | `SESSION_SECRET`、`AUTH_OIDC_*`、`API_BASE_URL`、`UPSTASH_REDIS_REST_*`                                 |

真实 secret 只配置在部署环境或本地未跟踪文件中。不要把 secret 放进 `NEXT_PUBLIC_*`、日志、测试 fixture 或提交。

### 完整变量目录

下面的名称必须与对应 `.env.example` 保持一致；`.env.example` 是具体示例值和注释的权威来源。

- API：`API_DISPLAY_NAME`、`API_PUBLIC_URL`、`AUTH_ISSUER`、`AUTH_JWKS_URL`、`API_RESOURCE`、`CORE_DATABASE_URL`、`CONTENT_CURRENT_POINTER`、`CONTENT_PUBLISH_URL`、`CONTENT_PUBLISH_TOKEN`、`REALM_REVALIDATE_URL`、`REVALIDATE_WEBHOOK_SECRET`。
- Auth：`AUTH_DATABASE_URL`、`AUTH_DISPLAY_NAME`、`BETTER_AUTH_URL`、`BETTER_AUTH_ISSUER`、`BETTER_AUTH_AUDIENCE`、`BETTER_AUTH_SECRET`、`AUTH_TRUSTED_ORIGINS`、`OAUTH_RESOURCES`、`PASSKEY_RP_ID`、`PASSKEY_ORIGIN`。
- Content：`CONTENT_DISPLAY_NAME`、`CONTENT_PUBLIC_URL`、`CONTENT_CURRENT_POINTER`、`AUTH_ISSUER`、`AUTH_JWKS_URL`、`CONTENT_RESOURCE`、`S3_ENDPOINT`、`S3_REGION`、`S3_FORCE_PATH_STYLE`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_PRIVATE_BUCKET`、`CONTENT_PUBLISH_TOKEN`。
- Console：`SESSION_SECRET`、`AUTH_OIDC_ISSUER`、`AUTH_OIDC_AUTHORIZATION_URL`、`AUTH_OIDC_TOKEN_URL`、`AUTH_OIDC_USERINFO_URL`、`AUTH_OIDC_JWKS_URL`、`AUTH_OIDC_END_SESSION_URL`、`AUTH_OIDC_CLIENT_ID`、`AUTH_OIDC_CLIENT_SECRET`、`AUTH_OIDC_REDIRECT_URI`、`AUTH_OIDC_POST_LOGOUT_REDIRECT_URI`、`AUTH_OIDC_RESOURCE`、`AUTH_OIDC_SCOPE`、`API_BASE_URL`、`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`、`TRUST_PROXY`、`NEXT_PUBLIC_ANALYTICS_ENABLED`、`NEXT_PUBLIC_ANALYTICS_SCRIPT_ORIGIN`、`NEXT_PUBLIC_ANALYTICS_CONNECT_ORIGIN`。

当前代码没有 `REDIS_URL`、`CONTENT_MIGRATION_URL`、`CONTENT_MIGRATION_TOKEN` 或独立仓库/GitHub/X worker 配置；这些名称不应回到任何 Platform 服务的环境文件或 Vercel 项目。

## 健康检查

每个服务提供 `/health/live`；readiness 还检查其实际运行所需的配置或 published pointer：

- Auth：数据库和 `BETTER_AUTH_SECRET`。
- API：`CORE_DATABASE_URL`。
- Content：object storage 和当前 release pointer/manifest。
- Console：Session、OIDC、API origin 等 BFF 配置。

`live` 只证明进程可响应，`ready` 只证明应用可以接受其声明的依赖；两者都不替代已认证的写入、发布和浏览器流程验收。

## 发布顺序

应用部署由各 Vercel project 的当前配置负责。代码侧的内容发布顺序是 API → Content immutable objects → current pointer → Realm HMAC revalidation。pointer 只在对象逐一验证后切换；中途失败时旧 release 保持可读。

发布前至少运行：

```bash
corepack pnpm check
```

然后针对目标服务验证 `/health/live` 与 `/health/ready`。真实 OIDC mutation、Content publish、数据库写入和生产域名 smoke test 需要相应外部权限，不由本地门禁代替。

## 故障边界

- Auth/API/Content readiness 失败时，先恢复其声明的依赖配置，不添加隐藏 fallback。
- Content 发布失败时，旧 pointer 保持有效；检查 object key、storage、publish token 和日志中的 release ID。
- Realm revalidation 失败时，Content release 可能已发布；检查 HMAC 配置和 Realm cache，再单独重试 revalidation。
- Console Redis 不可用时，当前实现使用本地限流状态；这只适用于短期可用性保护，不提供多实例一致性。

2026-09-15 已用 Vercel CLI 逐项目核对 `arsvine-admin`、`arsvine-auth`、`arsvine-api`、`arsvine-content` 的 production 变量；现存变量均有当前读取器或部署入口消费者，没有执行无证据删除。Platform 根目录的 `.env.local` 是历史本地 scratch 文件，不参与提交；按服务使用 `vercel env pull` 前应先备份，并确认不会覆盖自定义本地变量。
