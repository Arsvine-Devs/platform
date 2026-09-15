# ARSVINE PLATFORM 仓库地图

[项目主页](./README.md) · [文档入口](./docs/README.md)

Platform 是管理系统的服务工作区，集中维护 Console、Auth、API、Content 和共享运行时包。

## 应用与服务

| 范围            | 责任                                                               | 入口                                                 |
| --------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `apps/console/` | `console.arsvine.com` 的 UI、Host-only session 和 BFF              | [`apps/console/README.md`](./apps/console/README.md) |
| `apps/auth/`    | `auth.arsvine.com` 的 Better Auth、OAuth/OIDC、JWKS、Passkey、TOTP | [`apps/auth/README.md`](./apps/auth/README.md)       |
| `apps/api/`     | `api.arsvine.com` 的 Core authoring API 与发布编排                 | [`apps/api/README.md`](./apps/api/README.md)         |
| `apps/content/` | `content.arsvine.com` 的已发布 release read plane                  | [`apps/content/README.md`](./apps/content/README.md) |

## 共享包

| 范围                       | 责任                                     | 入口                                                                       |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `packages/authz/`          | Auth JWT/JWKS 校验和 scope/role 判定     | [`packages/authz/README.md`](./packages/authz/README.md)                   |
| `packages/contracts/`      | API 线协议 TypeScript 类型               | [`packages/contracts/README.md`](./packages/contracts/README.md)           |
| `packages/core-db/`        | Core PostgreSQL schema 与 authoring 查询 | [`packages/core-db/README.md`](./packages/core-db/README.md)               |
| `packages/object-storage/` | S3-compatible object storage 适配        | [`packages/object-storage/README.md`](./packages/object-storage/README.md) |
| `packages/observability/`  | 结构化服务日志                           | [`packages/observability/README.md`](./packages/observability/README.md)   |

## 人类文档

- 文档入口：[`docs/README.md`](./docs/README.md)
- 文档目录：[`docs/INDEX.md`](./docs/INDEX.md)
- 开发与验证：[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
- 架构与所有权：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- 配置、健康检查与发布：[`docs/OPERATIONS.md`](./docs/OPERATIONS.md)
- 安全边界：[`docs/SECURITY.md`](./docs/SECURITY.md)

## 机器事实来源

- workspace 边界与命令：根目录 `package.json`、`pnpm-workspace.yaml`
- 每个服务的命令与依赖：对应 `apps/*/package.json`
- 环境变量：`config/env-contracts.json`、对应 `apps/*/.env.example` 与 `corepack pnpm envctl ...`
- Core 数据结构：`migrations/core/` 与 `packages/core-db/src/schema.ts`
- API wire types：`packages/contracts/src/index.ts`
- 质量工具：`config/` 与根目录脚本
