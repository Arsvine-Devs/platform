# 结构化日志

[返回仓库地图](../../INDEX.md) · [运维文档](../../docs/OPERATIONS.md)

`@arsvine/observability` 提供 API、Content 和其他服务共享的结构化 stdout 日志函数。日志字段用于定位 service、operation、request ID 和 release ID，不拥有日志存储或告警配置。

```bash
corepack pnpm --filter @arsvine/observability typecheck
corepack pnpm --filter @arsvine/observability build
```
