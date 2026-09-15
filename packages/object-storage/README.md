# Object storage

[返回仓库地图](../../INDEX.md) · [Content 服务](../../apps/content/README.md)

`@arsvine/object-storage` 提供 S3-compatible private bucket 的最小 text 读写适配。Content service 通过它读取 release 并写入待发布对象；它不拥有发布策略或内容 schema。

```bash
corepack pnpm --filter @arsvine/object-storage typecheck
corepack pnpm --filter @arsvine/object-storage build
```
