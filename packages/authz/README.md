# AuthZ shared package

[返回仓库地图](../../INDEX.md) · [安全边界](../../docs/SECURITY.md)

`@arsvine/authz` 集中 Auth JWT/JWKS 验证、Bearer header 解析以及 scope/role 判定。API 和 Content 复用它来保持同一套 issuer、audience、JWKS 和授权语义。

```bash
corepack pnpm --filter @arsvine/authz typecheck
corepack pnpm --filter @arsvine/authz build
```
