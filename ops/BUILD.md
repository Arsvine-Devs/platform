# 站点构建

使用 Node 26、pnpm 12 和 Python 3.12。站点提供 `site.yaml`、源码和锁文件。GitHub Actions 读声明并生成制品，Console 从成功构建中选择一个版本发布。

## 创建站点

```sh
uv sync --project ops --locked --python 3.12
uv run --project ops --locked web-new journal journal.arsvine.com --starter astro --directory ../journal
cd ../journal
pnpm install
pnpm dev
```

`astro` 和 `vite` 构建为静态目录，`next` 构建为独立的 Node 应用。提交锁文件及声明后，在目标 VPS 的 `sites.json` 登记仓库、域名、运行类型、就绪检查和权限。节点应用分配一个本机端口，需要预览时再登记预览域名及 Access audience。站点在 Console 选用通过构建的版本。

## 开发工具

- Next App Router 的本地服务通过 Next DevTools MCP 提供路由、日志和错误。Console 使用端口 3000，Auth 使用 3003。
- Console 安装时链接 UI SDK 内置 skill。开发页面可通过 WebMCP 检查 UI SDK 组件状态。
- `uv run --project ops --locked web-build plan --environment production --branch main` 检查当前声明并预览构建矩阵。
- 使用 `webctl doctor --json` 查看 VPS 的进程、域名绑定和健康状态。

`pnpm check:ops` 执行 Ruff、BasedPyright 和 pytest。媒体导入的 Markdown 集成测试使用装好依赖的相邻 Realm 仓库，也可以用 `ARSVINE_OPS_TEST_REALM_REPO` 指定路径。

## 制品

`web.yml` 在登记的发布分支生成生产制品。预览从同仓库分支手动运行，选择 `preview`。生成的 `manifest.json` 固定提交、环境、运行方式、申明权限及 `release.tar` 的 SHA-256。Node 制品从根目录的 `entry.mjs` 启动，静态制品从根目录的 `index.html` 提供页面。

`web-build package` 在制品目录旁组装候选，只在归档和清单写完后发布目录。同一份制品可安全重跑。为不同的构建选择新的 `--output` 目录。
