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

auth.arsvine.com → Auth PostgreSQL
api.arsvine.com → Core PostgreSQL（写入）
content.arsvine.com → 同环境 Core PostgreSQL（发布视图）
content.arsvine.com → Auth JWKS（受保护正文）
console.arsvine.com → Valkey、Unix socket 上的 Web 发布服务
status.arsvine.com → public health probes and operational status
```

Console 浏览器访问同源 BFF。OAuth 访问令牌、数据库连接和会话签名密钥保存在服务端。

`status.arsvine.com` 是独立部署的运维检测与状态展示面。它观察公开健康路由，不参与 Console、Auth、API 或 Content 的业务请求链路。

## 服务所有权

| 服务    | 拥有                                       | 不拥有                             |
| ------- | ------------------------------------------ | ---------------------------------- |
| Auth    | 身份、OIDC、JWKS、Passkey、TOTP、Auth DB   | 内容发布、Console session、Core DB |
| Console | 管理 UI、Host-only session、CSRF、BFF 路由 | Auth DB、Core DB、Content storage  |
| API     | Core 内容写入、发布状态和 revision 检查    | 用户身份、浏览器会话               |
| Content | 公开和受保护内容读取                       | 编辑、用户身份、Console UI         |

## 共享包

- `@arsvine/authz`：验证 Auth JWT、解析 scope 和 role。
- `@arsvine/contracts`：API response 的线协议类型；应用视图模型仍由消费者拥有。
- `@arsvine/core-db`：Core schema 和事务/查询实现。
- `@arsvine/observability`：结构化日志输出。
- `@arsvine/env`：环境变量读取、规范化和 Node 服务的 dotenv 加载。
- `@arsvine/site-config`：服务地址、OAuth resource、OIDC 路径和 Passkey origin。

共享包不得成为跨服务业务逻辑的垃圾桶；只有跨边界且稳定的责任才下沉。

## 发布数据流

1. Console BFF 使用当前会话的访问令牌调用 API。
2. API 在同一事务写入文章与各语言版本。修改公开内容需要 `content:publish`。
3. Realm 在请求时通过 Content 读取已提交的发布视图。草稿和非公开短帖不会进入视图。
4. 受保护正文由 Realm 校验访问凭证，再用服务令牌向 Content 请求。

当前运行时拓扑包含 Console、Auth、API、Content 和 Realm 的已发布 Content 读取链路；`status.arsvine.com` 属于独立观测面，检测配置不由本仓库管理。历史输入资料由架构快照独立记录。
