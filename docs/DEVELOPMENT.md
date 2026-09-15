# 开发与验证

[返回文档目录](./INDEX.md)

## 前置条件

Node.js 版本为 `24.x`，pnpm 版本以根目录 `package.json#packageManager` 为准。安装依赖：

```bash
corepack pnpm install --frozen-lockfile
```

## 本地启动

根目录 `dev` 脚本启动 Console：

```bash
corepack pnpm dev
```

单独启动服务时使用其 workspace manifest 中的脚本，例如：

```bash
corepack pnpm --filter @arsvine/auth dev
corepack pnpm --filter @arsvine/api dev
corepack pnpm --filter @arsvine/content dev
```

每个服务的配置从对应的 `.env.example` 开始。没有必要的数据库、storage 或 Auth 配置时，服务可以编译，但 readiness 应保持失败。

## 检查层级

迭代时先运行最窄的检查：

```bash
corepack pnpm --filter arsvine-admin typecheck
corepack pnpm --filter arsvine-admin test
corepack pnpm --filter arsvine-admin lint
```

提交前运行根门禁：

```bash
corepack pnpm format:check
corepack pnpm docs:check
corepack pnpm env:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm quality
corepack pnpm test
corepack pnpm build
```

`corepack pnpm check` 将以上检查按根脚本顺序串联。它不执行远程部署、数据库 migration、真实发布或外部业务验收。

## 测试边界

- `apps/api/src/publication.test.ts` 保护 Content 发布和 Realm revalidation 的签名顺序。
- `apps/content/src/server.test.ts` 保护 release 读取、公开清理和受保护读取边界。
- `apps/console/**/*.test.*` 保护 BFF、OIDC、限流、预览和当前 UI helper。
- `apps/auth` 当前依赖 typecheck/build 与运行时服务验证；增加测试前应先证明测试隔离能保护真实 Auth 契约。

测试只保护当前服务、数据和安全契约；新增测试前先写清实际回归风险或未解决的不确定性。
