# ARSVINE PLATFORM

`Arsvine-Devs/platform` 是 ARSVINE 系列站点的管理平台工作区，当前包含 Console、Auth、API、Content read plane 以及共享运行时包。

## 当前服务链路

```text
console.arsvine.com → Auth OIDC + api.arsvine.com
api.arsvine.com     → Core PostgreSQL + content.arsvine.com
arsvine.com         → content.arsvine.com
```

Console 浏览器只访问同源 BFF；OAuth token、数据库连接和 object-storage 凭据保持在服务端。内容 authoring 与 published read plane 由本 workspace 的 API、Content 服务和共享契约负责。

## 快速开始

前置条件：Node.js `24.x`，pnpm 版本以根目录 `package.json#packageManager` 为准。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

根目录 `dev` 启动 Console。Auth、API、Content 的单独启动命令和每个服务的配置见 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)。

## 质量检查

```bash
corepack pnpm check
```

该命令包含格式、文档链接与作用域入口、Oxlint、必要的 ESLint 兼容规则、TypeScript、Knip、jscpd、测试和各 workspace build。它不执行远程部署、数据库 migration、真实内容发布或已认证业务流程验收。

## 文档

- [仓库地图](./INDEX.md) — 服务、包和机器事实来源。
- [文档入口](./docs/README.md) — 面向维护者的开发、架构、运维和安全说明。
- [Console 入口](./apps/console/README.md) — 管理 UI、BFF 和当前配置。

工作范围、分支和验证规则见 [`AGENTS.md`](./AGENTS.md)。
