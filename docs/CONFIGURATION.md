# 运行配置

[返回文档目录](./INDEX.md)

站点的公开域名、服务绑定和环境来自 Web 登记。发布制品只包含应用和静态资源。Web 安装器生成绑定与运行目录，应用密钥由 VPS 管理员放在 `/etc/arsvine-web/env/<站点>-<环境>.env`。每个服务使用自己的 PostgreSQL 角色、Valkey ACL、文件权限和客户端凭据。

| 服务    | 运行输入                                                                               |
| ------- | -------------------------------------------------------------------------------------- |
| Auth    | `AUTH_DATABASE_URL`、`BETTER_AUTH_SECRET` 和 `AUTH_TRUSTED_ORIGINS`                    |
| Console | OIDC 客户端、`SESSION_SECRET`、`REDIS_URL`、`REDIS_KEY_PREFIX` 和本地 `WEB_OPS_SOCKET` |
| API     | `CORE_DATABASE_URL`，同环境 Core 写入账号                                              |
| Content | `CORE_DATABASE_URL`，同环境 Core 发布视图的只读账号                                    |

`ARS_WEB_ORIGINS` 传入服务使用的正式 HTTPS origins，值为 JSON 对象。典型预览环境提供自己的 Auth、Console、API 和 Content origins，与预览数据库和客户端注册一起配置。

本地填写相应应用的 `.env.example`。变量的作用域和示例由 [环境契约](../config/env-contracts.json) 声明。使用 `corepack pnpm envctl query --key CORE_DATABASE_URL` 查询键的用途。
