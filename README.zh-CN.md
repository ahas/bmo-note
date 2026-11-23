[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文**

# bmo-note

将平台上可编辑的笔记作为一个服务提供。每篇笔记都是 Nuxt UI 编辑器的富文本文档，以 TipTap JSON 的形式连同其元数据保存在
本单元的 SQLite 存储中。笔记在 Web 控制台的侧边栏中创建、编辑和查找。可以用 `[[` 或 `@` 互相链接笔记，链接到某篇笔记的
笔记会列在它下方，可以在文字上留下评论线程，也可以就笔记向 Agent 提问或讨论。显示笔记的控制台插件包同样由本仓库构建。
`docs/design.md` 说明这个服务是什么，`docs/api.md` 说明它的边界。

## 测试

`cargo test`(通过 testbed 运行)在临时 SQLite 文件和回环端口上运行 crate 唯一的测试入口 `tests/main.rs`。覆盖内容如下:
各账户笔记的写入、读取、保存、冲突、移入回收站、恢复和永久删除(`notes.rs`);服务从文档中读取的内容(`document.rs`);
笔记文档旁边的内容 — 文档所述、链接、图标、副本(`beside.rs`)— 以及笔记持有的图片(`blobs.rs`);评论线程
(`comments.rs`);通过链接和成员共享的笔记(`sharing.rs`);每个账号的文件夹及其中笔记的位置(`folders.rs`);每位读者自己的书签和打开记录(`own.rs`);搜索
(`search.rs`);写入所发布的事件流(`events.rs`);服务提供的控制台界面，以及在引入的发布版本上通过 bmo-ui 自身读取的
清单(`console.rs`);还有本单元自身的仓库检查(`repository.rs`)。控制台插件包的检查是 `client/` 中的 `bun run check`,
它会安装依赖、进行类型检查、构建插件包并运行单元测试。`client/tests/browser/` 中的浏览器测试在测试套件的浏览器通道中运行。

## 目录结构

| 文件夹 | 内容 |
|---|---|
| `src/` | 服务及其命令:路由、笔记存储、文档读取、评论、事件环、控制台界面的声明 |
| `client/` | 作为独立项目的控制台插件包 |
| `deploy/` | 服务的用户单元，以及部署发布的应用声明 |
| `tests/` | crate 唯一的测试入口及其使用的替身 |
| `docs/` | 规定服务是什么及其边界的正式文档 |

根目录下有 Cargo 清单和锁文件、`testbed.toml`、`rustfmt.toml`、`settings.toml`(内置于二进制文件的默认值)、
`CLAUDE.md`、`PERSONAL-DATA.md` 和许可证。

## 命令

- `bmo-note serve` 打开存储并响应路由，直到被要求停止。
- `bmo-note health` 在其设置所指的服务回答就绪时以 0 退出。
- `bmo-note console-reach` 输出控制台如何到达服务，供部署时的控制台检查使用。

设置的读取顺序为:二进制内置的 `settings.toml`,然后是发布目录旁部署的 `settings.toml` 与 `settings.local.toml`
(数据根目录下的 `env/note.toml`),最后是环境中的 `BMO_NOTE_<TABLE>__<KEY>`(`docs/api.md`,「Settings」)。

## 许可证

MIT,如 `LICENSE` 所述。
