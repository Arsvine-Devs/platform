# 安全边界

[返回文档目录](./INDEX.md)

## 身份与会话

- Auth 是唯一身份提供者，负责 OAuth/OIDC、JWKS、Passkey 和 TOTP。
- Console 只保存加密的 Host-only opaque session；浏览器不接触 OAuth access token。
- Console 写请求需要 CSRF token；BFF 再以 OIDC access token 调用 API。
- API 验证 Auth JWT 的 issuer、audience/JWKS 和 scope；资源写入需要 `content:write`，发布需要 `content:publish`。

## Content 保护

公开 Content endpoint 会清理 protected post 的 title、excerpt、variants 和 tags。受保护 variant 只通过 Auth 签发、带 `content:protected:read` scope 的 server-to-server token 读取。

发布 token 只用于 API → Content 的内部发布入口；它不等同于用户 access token，也不应在客户端复用。

## 密钥与日志

密钥来源是部署环境或未跟踪 `.env.local`。禁止在源码、文档、测试、错误响应和结构化日志中记录密码、token、Cookie、TOTP secret、数据库连接串或 object-storage secret。

结构化日志可以记录 service、operation、request ID 和 release ID；不要记录请求 Authorization header 或完整用户凭据。

## 变更规则

涉及 Auth、Session、JWT、scope、CSRF、Content protected read、发布 pointer、object storage 或环境 provider 的改动，必须同时检查对应服务 README/AGENTS、测试、`CONFIGURATION.md` 和 `OPERATIONS.md`。运行时入口由当前服务所有权决定。
