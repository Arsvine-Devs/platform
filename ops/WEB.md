# VPS Web 平台

GitHub Actions 构建网站。部署控制器从已登记的 Actions 运行拉取制品，通过本机 HTTPS 健康检查后确认发布。Caddy 和 cloudflared 使用独立服务身份。站点来源、运行端口、数据与入口权限由宿主机管理员登记。

## 宿主机

使用具备 systemd、nftables 和 polkit 的 Linux，安装 Python 3.12+、Caddy、cloudflared 和与制品一致的 Node。运行程序需可通过 `/usr/bin/caddy`、`/usr/bin/cloudflared`、`/usr/bin/node` 与 `/usr/sbin/nft` 调用。为 `/var/lib/arsvine-web` 预留制品、站点数据与构建下载空间。

- 将 [站点登记表](config/sites.example.json) 复制到 `/etc/arsvine-web/sites.json`。填写真实的 Console Access audience。预览可追加 `preview`，写入独立的 `hostname`、`accessAudience` 和 Node `port`。同名服务的生产与预览分别保存在自己的目录。
- 在 `/etc/arsvine-web/credentials/tunnel-token` 放独立 Web Tunnel 的连接凭据。如需从 GitHub 导入制品，在 `github-token` 另放只限已登记仓库、具有 Actions 读取权限的凭据，再运行安装命令。生产环境的配置放在 `/etc/arsvine-web/env/<site>-production.env`，预览使用 `/etc/arsvine-web/env/<site>-preview.env`。预览使用专有数据库及缓存凭据。
- 在开发机运行 `uv run --project ops webctl bundle web.pyz`，将生成的文件复制到 VPS。VPS 以 root 运行 `python3 web.pyz install`，安装 Web 服务、访问控制和网关，并启动本机管理套接字。

部署第一版 Console 可从宿主机提交已成功的构建。

```sh
/usr/local/libexec/arsvine-ops/web.pyz deploy console production RUN_ID COMMIT_SHA
```

## 本机源站试点

将试点站点登记在 `/etc/arsvine-web/sites.json` 后，以管理员身份运行下列命令。安装时 Caddy 自动签发本机源站证书，并将本地 CA 的公有证书固定到 `/etc/arsvine-web/tls/origin-ca.pem`。此模式仅启动本机网关、发布 API 和 Web 专属防火墙。

```sh
sudo python3 web.pyz install --origin-only
sudo /usr/local/libexec/arsvine-ops/web.pyz bootstrap-archive ripple production \
  --archive /path/release.tar --manifest /path/manifest.json --digest sha256:EXPECTED_DIGEST
sudo /usr/local/libexec/arsvine-ops/web.pyz doctor --json
```

`--digest` 填经管理员确认的 tar 的 SHA-256。导入会核对站点登记、能力、制品与本机 TLS 健康状态。管理员也可在 Tunnel 运行时导入本机制品。

## 入口

Cloudflare Tunnel 使用 HTTPS 连接 `127.0.0.1:8080`，按登记主机名校验 SNI 和 Caddy 本地 CA。Caddy 自动续期证书，私钥保存在网关账号的专用状态目录。安装只为控制器和 Tunnel 安排 CA 公钥信任。Console 与预览还要求对应的 Cloudflare Access 应用及 audience。Caddy 拒绝未知 SNI，并对 Host 与 SNI 不匹配的请求响应 421。宿主机应用可通过指定 DB/缓存端口访问本地数据，Web 源站和相邻站点的 loopback 接口受独立 nftables 规则限制。

Realm 生产站的 `redirectAliases` 为已登记别名提供 308 跳转。示例把 `www.arsvine.com` 跳转到 `arsvine.com`，保留路径和查询参数。预览有独立的登记主机名。

[Cloudflare 登记示例](config/edge.example.json) 放在 `/etc/arsvine-web/edge.json`。`web.pyz edge-plan` 输出建议的入口与 DNS 记录。对于受管的 Cloudflare Zone，`web.pyz sync-edge` 可在本机源站健康后配置 Tunnel 并补齐不存在的 CNAME。该命令仅由 root 执行，并使用两个独立文件 `credentials/edge-tunnel-token` 和 `credentials/edge-dns-token`。已有冲突记录应在切换完成后再同步。只给该命令指定 Web 专用 Tunnel。

预览试点用 `edge-plan --preview ripple` 查看对应域名，再用 `sync-edge --preview ripple` 发布这一条路由。同步核验该预览源站的 TLS 健康，保留 Tunnel 的其他路由，并仅查询和补齐这一条预览 DNS 记录。

`web.pyz security-plan` 输出 Cache Rules 和可选登录限流。`web.pyz sync-security` 使用单独的 `credentials/edge-security-token` 更新 Web 平台按引用标识登记的规则。Access 域名和指定媒体路径绕过共享缓存。Free 方案可显式选择 `--rate-limit path`，一条规则在 Zone 内匹配登录路径。支持 Host 和 Method 的方案可选择 `--rate-limit host-post`，仅对登记身份服务的登录 POST 生效。两个模式均为同一 IP 10 秒 10 次，超出后阻断 10 秒。Cloudflare Free Managed Ruleset 和自动 DDoS 防护由 Cloudflare 管理。

## 数据和日志

Node 服务通过站点登记的 `dependencies` 访问同环境的本机服务。平台生成 `ARS_WEB_INTERNAL_ORIGINS`，每个站点账号只获准连接直接登记的依赖端口。为站点添加预览时，也应为其依赖登记独立预览入口和端口。平台从同环境已登记的核心站点生成 `ARS_WEB_ORIGINS`，供浏览器和协议标识使用。Realm 的 Content 和 Auth 环境变量也从这些登记生成。

- Content 写入 `/var/lib/arsvine-web/content/<env>`，目录由该环境的 Content 账号独占。
- Realm 从 `/var/lib/arsvine-web/media/<env>/private` 读取 Catalog，从同环境的 `public/realm/site-catalog/current.json` 读取当前版本。公开树由 root 写入，组为 `ars-web-media-live` 或 `ars-web-media-pr`，目录建议用 `2750`，文件用 `0640`。Realm 私有 Catalog 树的读取组是 `aw-realm-live` 或 `aw-realm-pr`，Caddy 只读取公开树。
- Realm 的 `/media/*` 映射到该环境的公开目录，允许同环境 Ripple 的媒体跨域请求。Ripple 预览也提供同源 `/media/*`。Ripple 的 `/api/music` 优先读取同环境的 `public/ripple/music.json`，缺少时使用站点制品里的同路径响应。
- Console 通过 `/run/arsvine-web/control.sock` 访问构建、发布与运行观测。系统账号决定允许的操作，Console 预览只能读取预览状态、发布记录和观测。观测含当前部署、本机健康、服务计数和最近一小时内至多 1,000 条入口样本。访问样本最多返回 50 条，并移除请求查询、凭据和请求头。

本机检查可运行 `uv run --project ops pytest ops/tests/test_web_runtime.py`。
