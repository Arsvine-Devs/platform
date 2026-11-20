# 发布与日常操作

[返回文档目录](./INDEX.md)

Web 入口、编排、站点权限和诊断见 [Web 运维](../ops/WEB.md)。应用提供无缓存健康检查。Auth 和 API 检查 PostgreSQL，Console 检查会话配置与 Valkey，Content 检查当前快照。应用部署后可以在 Console 查询版本、健康、部署结果和访问日志。

## 数据服务

在 VPS 准备只监听本机的 PostgreSQL 和 Valkey 二进制。数据库初始化依据 Web 站点登记生成每个环境的角色和配置。Valkey 由独立的 Web 服务启动。

```sh
uv sync --project ops --locked --no-dev --python 3.12
uv run --project ops --locked --no-dev web-data provision --sites ops/config/sites.example.json
sudo ops/.venv/bin/web-data provision --apply
```

Auth、API 和 Realm 的数据库可以分别初始化。导入已有数据时使用各服务的 PostgreSQL custom dump，密钥文件随目标环境配置。

新环境用 `sudo ops/.venv/bin/web-initialize preview` 创建独立密钥和空发布内容。用同一环境的 Auth 配置执行 `apps/auth/scripts/initialize.mjs`，生成 owner 和 Console、Realm 的 OIDC 客户端。该命令把结果写入指定的私有文件。再用 `sudo ops/.venv/bin/web-initialize preview --auth-state <私有文件>` 关联客户端配置。Core 初始表定义在 [Core schema](../migrations/core/0001_core.sql)。

已导出的媒体和发布数据使用 `uv run --project ops --locked web-data import-media --help` 查看暂存参数。

## 内容发布

API 读取 Core 数据并构建发布快照。Content 验证各对象和清单，然后原子切换当前指针。Realm 接收带时间戳的 HMAC 通知，刷新公开页面。公开媒体在 VPS 的 `/media/` 路径提供。草稿、私有素材与受保护的文章正文由对应服务鉴权。

[公共状态页](https://status.arsvine.com) 从外部探测站点。诊断请求时可用 Console 的应用状态与请求标识关联 Cloudflare 安全事件。
