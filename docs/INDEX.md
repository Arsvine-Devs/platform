# ARSVINE PLATFORM 文档目录

[返回文档入口](./README.md) · [返回仓库地图](../INDEX.md)

| 文档                                   | 用途                                              | 权威事实                                  |
| -------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md)   | 安装、开发、质量命令和测试边界                    | 根 `package.json` 与各 workspace manifest |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 服务拓扑、数据流、所有权和当前/废弃边界           | 当前源码、workspace 依赖和环境读取器      |
| [`OPERATIONS.md`](./OPERATIONS.md)     | 健康检查、配置分组、发布顺序和故障处理            | health routes、`.env.example`、发布代码   |
| [`SECURITY.md`](./SECURITY.md)         | OIDC、Session、JWT、scope、Content 保护和密钥边界 | Auth/API/Console/Content 实现与测试       |

## 阅读路径

- 修改 Console：`DEVELOPMENT.md` → `apps/console/README.md` → `SECURITY.md`
- 修改 API 或 Content：`ARCHITECTURE.md` → 对应服务 README/AGENTS → `OPERATIONS.md`
- 修改数据库或共享包：`ARCHITECTURE.md` → 对应 package README/AGENTS → `DEVELOPMENT.md`

Platform 的文档只描述当前 workspace。已退出的独立内容仓库不作为运行时来源，也不作为本仓库的维护范围。
