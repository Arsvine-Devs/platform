# 系统架构与所有权

[返回文档目录](./INDEX.md)

## 当前拓扑

```text
Browser
  ├─ console.arsvine.com
  │    └─ Console BFF → auth.arsvine.com (OIDC)
  │                 └→ api.arsvine.com (Core authoring)
  └─ arsvine.com (Realm)
       └→ content.arsvine.com (published read plane)

api.arsvine.com → content.arsvine.com/internal publication
content.arsvine.com → S3-compatible private object storage
auth.arsvine.com → Auth PostgreSQL
api.arsvine.com → Core PostgreSQL
console.arsvine.com → Upstash Redis for session/rate-limit state
```

Console 浏览器只访问同源 BFF。OAuth access token、Core 数据库连接、Content publish token、object-storage 凭据和 Session secret 不进入浏览器。

## 服务所有权

| 服务    | 拥有                                                   | 不拥有                                   |
| ------- | ------------------------------------------------------ | ---------------------------------------- |
| Auth    | 身份、OIDC、JWKS、Passkey、TOTP、Auth DB               | 内容发布、Console session、Core DB       |
| Console | 管理 UI、Host-only session、CSRF、BFF 路由             | Auth DB、Core DB、Content storage        |
| API     | Core 内容 CRUD、revision、发布编排、Realm revalidation | 用户身份源、浏览器 session、公开内容读取 |
| Content | release pointer、公开/保护内容读取、发布写入入口       | authoring 数据、用户身份、Console UI     |

## 共享包

- `@arsvine/authz`：验证 Auth JWT、解析 scope 和 role。
- `@arsvine/contracts`：API response 的线协议类型；应用视图模型仍由消费者拥有。
- `@arsvine/core-db`：Core schema 和事务/查询实现。
- `@arsvine/object-storage`：S3-compatible storage 的最小读写接口。
- `@arsvine/observability`：结构化日志输出。
- `@arsvine/env`：环境变量读取、规范化和 Node 服务的 dotenv 加载。

共享包不得成为跨服务业务逻辑的垃圾桶；只有跨边界且稳定的责任才下沉。

## 发布数据流

1. Console BFF 以当前 OIDC access token 调用 API。
2. API 在 Core DB 中完成内容读写，并要求 `content:publish` scope 才能发布。
3. API 将带有 release ID 的 immutable objects 发送到 Content。
4. Content 验证每个对象，再最后写入 current pointer。
5. API 对 Realm 发送带毫秒时间戳的 HMAC `content.published` 事件。
6. Realm 下一次读取通过 `CONTENT_BASE_URL` 获取新的 published release。

当前运行时拓扑只包含 Console、Auth、API、Content 和 Realm 的已发布 Content 读取链路；历史输入资料由架构快照独立记录。
