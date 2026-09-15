# API 线协议类型

[返回仓库地图](../../INDEX.md) · [系统架构](../../docs/ARCHITECTURE.md)

`@arsvine/contracts` 是 API/Console 之间共享的 TypeScript response 类型，当前包含 principal、Post、Tweet、publication 和错误 envelope。业务视图模型仍由各消费者拥有，避免把 UI 结构误当成服务协议。

```bash
corepack pnpm --filter @arsvine/contracts typecheck
corepack pnpm --filter @arsvine/contracts build
```
