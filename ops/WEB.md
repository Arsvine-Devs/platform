# VPS Web 平台

GitHub Actions 构建网站。部署控制器从已登记的 Actions 运行拉取制品，通过本机 HTTPS 健康检查后确认发布。Caddy 和 cloudflared 使用独立服务身份。站点来源、运行端口、数据与入口权限由宿主机管理员登记。

## 基础设施与故障影响

| 基础服务                               | 消费方                              | 故障影响                                                                                         |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cloudflare DNS、TLS、WAF 与 Web Tunnel | 公网访客、Console、预览             | 公网入口依赖这条链路。本机源站可用私有 CA 独立检查。                                             |
| Caddy 与公开文件树                     | 全部 Web 主机、CDN、Ripple          | 网关中断影响 Web 入口。CDN 使用同一个网关和磁盘，可以独立于 Realm、Auth 和数据库提供已发布文件。 |
| PostgreSQL                             | Auth、Core、Content、Realm 访客统计 | Auth 登录和 Core 内容读写依赖数据库。静态资源、Ripple 和 Realm 的代码内作品及经历仍可访问。      |
| Valkey                                 | Realm 验证码及 Console 的限流       | 这些限流使用同环境 Redis 协议连接，断连时由单个应用实例在进程内执行。                            |
| GitHub Actions 与本机发布控制器        | Console 部署页面、运维人员          | 暂时无法取新制品或提交发布，正在运行的站点继续处理访问。                                         |

| 应用    | 直接依赖                                                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth    | 自己的 PostgreSQL 数据库，签发 OIDC 身份和服务令牌。                                                                                                                       |
| API     | Core PostgreSQL 写权限和 Auth 公钥。编辑、发布、短帖可见性在数据库提交后生效。                                                                                             |
| Content | 同环境 Core 的三个只读发布视图。公开读取直接走 PostgreSQL，获取受保护正文才校验 Auth 服务令牌。                                                                            |
| Realm   | 本地 Catalog、CDN 和 Content。作品及经历来自站点数据，博客及短帖按请求读取。保护正文另外需要 Realm 访问凭证及 Content 服务授权。Content 失联时内容聚合页仍显示作品和经历。 |
| Ripple  | 静态制品由 Caddy 提供。同源曲库接口读取同环境文件，公开音频和封面使用 CDN。曲库或音频不可用时产品站仍可打开。                                                              |
| Console | Auth、API 与本机发布套接字。运营写入和发布各有权限检查。                                                                                                                   |

Web 与 VPN 各自拥有服务账号、启动单元和防火墙表。宿主机与物理资源同机共享。生产与预览分别拥有应用账号、PostgreSQL 角色、缓存凭据与媒体目录。

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

`web.pyz security-plan` 输出扫描拦截、Cache Rules 和可选登录限流。扫描规则仅覆盖 Web 登记主机上的私有配置和未使用软件路径。`web.pyz sync-security` 使用 `credentials/edge-security-token` 按引用标识更新规则。Access 入口和曲库 JSON 绕过共享缓存。Free 方案的现有单条限流匹配登录、Passkey 和 TOTP 验证路径，同时保留泄露凭据检测。同一 IP 在 10 秒内超过 5 次时阻断 10 秒。支持 Host 和 Method 的方案可用 `--rate-limit host-post` 收窄验证请求范围。边缘 TLS 下限为 1.2，HSTS 规则匹配 Web 主机和状态页。Cloudflare 承担边缘托管防护与 DDoS 防护。

Web 安装程序通过 `arsvine-web-guard.service` 更新独立的 nftables 表。管理员更新宿主机其他防火墙表时应使用各自的规则入口，系统级规则集刷新会一并删除 Web 和 VPN 的表。

## 数据和日志

Node 服务通过站点登记的 `dependencies` 访问同环境的本机服务。平台生成 `ARS_WEB_INTERNAL_ORIGINS`，每个站点账号只获准连接直接登记的依赖端口。为站点添加预览时，也应为其依赖登记独立预览入口和端口。平台从同环境已登记的核心站点生成 `ARS_WEB_ORIGINS`，供浏览器和协议标识使用。Realm 的 Content 和 Auth 环境变量也从这些登记生成。

- Content 用独立账号读取同环境 Core 的三个发布视图。
- Realm 从 `/var/lib/arsvine-web/media/<env>/private/realm/catalog/current.json` 读取当前 Catalog 版本。公开树由 root 写入，组为 `ars-web-media-live` 或 `ars-web-media-pr`，目录建议用 `2750`，文件用 `0640`。Realm 私有 Catalog 树的读取组是 `aw-realm-live` 或 `aw-realm-pr`，Caddy 只读取公开树。
- 登记表的 `assets.hostname` 为公共资产入口。Caddy 将该主机的 `/media/*` 映射到生产公开文件树，支持匿名跨域读取、条件请求和 Range。带摘要的文件可长期缓存，曲库 JSON 由应用域名的同源 `/api/music` 读取且每次取当前文件。预览继续通过各自受 Access 保护的同源 `/media/*` 使用预览文件树。
- Console 通过 `/run/arsvine-web/control.sock` 访问构建、发布与运行观测。系统账号决定允许的操作，Console 预览只能读取预览状态、发布记录和观测。观测含当前部署、本机健康、服务计数和最近一小时内至多 1,000 条入口样本。访问样本最多返回 50 条，并移除请求查询、凭据和请求头。

本机检查可运行 `uv run --project ops pytest ops/tests/test_web_runtime.py`。
