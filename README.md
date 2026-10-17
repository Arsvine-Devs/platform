# ARSVINE PLATFORM

`Arsvine-Devs/platform` 是 ARSVINE 系列站点的管理平台：Console、Auth、API、Content，以及共享契约包（`@arsvine/site-config`、`@arsvine/service-health` 等）。

English: control plane for the Arsvine site system (OIDC, authoring, published content). Visitor-facing docs for the main site live in [`realm`](https://github.com/Arsvine-Devs/realm); system map: [Realm SYSTEM_MAP](https://github.com/Arsvine-Devs/realm/blob/master/docs/architecture/SYSTEM_MAP.md).

## 受众

| 受众 | 入口 |
| --- | --- |
| 访客 / GitHub | 本 README |
| 维护者 | [`docs/`](./docs/README.md) |
| AI | [`AGENTS.md`](./AGENTS.md) |

## 当前服务链路

```text
console.arsvine.com → Auth OIDC + api.arsvine.com
api.arsvine.com     → Core PostgreSQL + content.arsvine.com
arsvine.com         → content.arsvine.com
ripple.arsvine.com  → cdn.arsvine.com/ripple/catalog (via /api/music)
```

分支：默认 `main`（可部署）；开发用 `dev/<topic>` + PR。修改 `packages/site-config` 后运行 `pnpm packages:sync` 同步到 Realm/Ripple。

## 快速开始

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

详见 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)。质量门禁：`corepack pnpm check`（不含远程部署/发布）。
