[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文**

# bmo-note

以单个服务提供平台中可编辑的笔记：每篇笔记都是一个 BlockSuite 文档（AFFiNE 的编辑器），以二进制 Yjs 状态连同其
元数据保存在本单元的 SQLite 存储中；笔记在 Web 控制台的侧边栏中创建、编辑和查找；显示笔记的控制台插件包由本仓库内置
的编辑器构建而成。`docs/design.md` 说明它是什么，`docs/api.md` 说明它的边界，`docs/affine.md` 说明研究了 AFFiNE 的
哪些内容以及遵循哪种许可证。本仓库是 AFFiNE Community Edition 的一个 fork，并保留 `upstream` 以便日后合并。

## 测试

`cargo test`（通过 testbed 运行）在一个临时 SQLite 文件和回环端口上运行 crate 唯一的测试 harness `tests/main.rs`，
涵盖：各账户自己的笔记的写入、读取、保存、冲突、移入回收站、恢复和彻底删除（`notes.rs`）；笔记文档旁附带的内容
（`beside.rs`）及笔记所含的图片（`blobs.rs`）；通过链接和成员共享的笔记（`sharing.rs`）；每位读者自己的置顶和打开
记录（`own.rs`）；搜索（`search.rs`）；写入所发布的事件流（`events.rs`）；服务提供的控制台界面，以及在内置发布版本
上通过 bmo-ui 自身的读取方式读取的其清单（`console.rs`）；以及本单元自己的仓库检查（`repository.rs`）。控制台包的
检查是 `client/` 中的 `bun run check`，它会复制内置的编辑器、安装依赖、用 TypeScript 编译器转译带装饰器的源码，然后
进行类型检查和测试（`docs/affine.md`，「The client's build path to the vendored editor」）。

## 目录结构

| 目录 | 内容 |
|---|---|
| `src/` | 服务及其命令：路由、笔记存储、事件环、控制台界面的声明 |
| `client/` | 控制台插件包，一个独立项目；`client/blocksuite/`（不纳入版本控制）存放构建用的编辑器副本 |
| `deploy/` | 服务的用户单元 |
| `tests/` | crate 唯一的测试 harness 及其使用的替身，旁边是 fork 上游的端到端测试目录 |
| `docs/` | 关于服务是什么及其边界的规范文档、AFFiNE 研究记录，以及 fork 上游的手册和博客内容 |
| `blocksuite/` | fork 的 BlockSuite 编辑器（MIT），即客户端构建所内置的源码 |
| `packages/` | fork 的 AFFiNE 包：`frontend/` 和 `common/` 下的 MIT 前端（`common/native` 除外），以及采用 Enterprise 许可证的 `backend/` 和 `common/native`，本单元从不构建它们，也不为复用而阅读它们 |
| `tools/`、`scripts/` | fork 上游的工具和发布脚本，本单元不使用 |
| `.github/`、`.cargo/`、`.codesandbox/`、`.devcontainer/`、`.docker/`、`.husky/`、`.render/` | fork 上游的配置和 CI 目录，本单元不使用 |

根目录下有 Cargo 清单和 lockfile、`testbed.toml`、`rustfmt.toml`、`settings.toml`（内置于二进制文件的默认值）、
`CLAUDE.md`、`PERSONAL-DATA.md`、许可证文件，以及 fork 自身的 JavaScript 清单和各个 tsconfig。

## 命令

- `bmo-note serve` 打开存储并响应路由，直到被要求停止。
- `bmo-note health` 在其设置所指定的服务回应已就绪时以 0 退出。
- `bmo-note console-reach` 输出控制台如何访问该服务，供部署时的控制台探测使用。

设置的读取顺序为：二进制文件内置的 `settings.toml`，然后是发布版本旁部署的 `settings.toml` 和 `settings.local.toml`
（数据根目录的 `env/note.toml`），最后是环境变量 `BMO_NOTE_<TABLE>__<KEY>`（`docs/api.md`，「Settings」）。
