# 配置、健康检查与发布

[返回文档目录](./INDEX.md)

## 配置所有权

完整的变量填写说明见 [`CONFIGURATION.md`](./CONFIGURATION.md)。机器契约是 [`config/env-contracts.json`](../config/env-contracts.json)；每个服务的 `.env.example` 是对应的安全模板。

| 服务    | 配置目录和职责                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------- |
| Auth    | `apps/auth/.env.example`：Better Auth、OIDC provider、数据库、Passkey 和 TOTP                  |
| API     | `apps/api/.env.example`：Core DB、JWT 校验、Content publication 和 Realm revalidation          |
| Content | `apps/content/.env.example`：S3 storage、published pointer、发布鉴权和 Auth JWKS/resource      |
| Console | `apps/console/.env.example`：Host-only session、OIDC BFF、API origin、Upstash 和公开 Analytics |

真实 secret 只配置在部署环境或本地未跟踪文件中。不要把 secret 放进 `NEXT_PUBLIC_*`、日志、测试 fixture 或提交。

环境变量 provider 使用 `readEnv()` 去空白并统一空值语义；API/Content 的 Node 入口使用 `@arsvine/env/dotenv` 加载相邻 `.env.local`，Auth/Console 的 Next 运行时由 Next.js 加载 dotenv。新增键先用 `corepack pnpm envctl register` 登记，再接入消费者。

```bash
corepack pnpm envctl stats
corepack pnpm envctl query --key CORE_DATABASE_URL
corepack pnpm env:check
```

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
