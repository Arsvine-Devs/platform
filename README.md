# ARSVINE PLATFORM

`Arsvine-Devs/platform` 管理 Arsvine 站点的构建、发布、身份和内容。Realm 和 Ripple 通过各自的 `site.yaml` 接入。Console 提供项目、部署、请求日志和内容编辑。

English: control plane for the Arsvine site system (OIDC, authoring, published content). Visitor-facing docs for the main site live in [`realm`](https://github.com/Arsvine-Devs/realm); system map: [Realm SYSTEM_MAP](https://github.com/Arsvine-Devs/realm/blob/master/docs/architecture/SYSTEM_MAP.md).

## 受众

| 受众          | 入口                        |
| ------------- | --------------------------- |
| 访客 / GitHub | 本 README                   |
| 维护者        | [`docs/`](./docs/README.md) |
| AI            | [`AGENTS.md`](./AGENTS.md)  |

## 当前服务链路

```text
Cloudflare Tunnel → Caddy → 静态目录和 Node 服务
Console → 本机发布控制器、Auth OIDC、API
API → PostgreSQL、Content
Content → VPS 私有发布目录
Realm /media/ → VPS 公开媒体目录
```

公共包由此仓库维护，跨仓库使用锁定的包来源。Web 运行时安装、站点登记和发布见 [Web 运维](./ops/WEB.md)。新增站点从 [站点构建](./ops/BUILD.md) 开始。

## 快速开始

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

详见 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)。质量门禁：`corepack pnpm check`（不含远程部署/发布）。
