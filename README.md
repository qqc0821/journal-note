# Journal Note

面向 macOS 的本地日记应用。使用 Electron、React、Tiptap 与 SQLite，数据进程独立运行。

## 开始

需要 Node.js 22.12+ 和 macOS 开发环境。

```sh
npm install
npm run rebuild
npm start
```

`npm run build` 检查 TypeScript 并构建界面；`npm run package` 生成未签名的 macOS 应用目录。发布前还需要配置签名与公证。

## 数据与功能

- 月历定位与补写，一天一篇；标题选填。
- 富文本、列表、引用、链接、图片，自动保存与版本检查。
- 中文连续片段搜索，支持日期范围；回收站保留 30 天。
- 完整备份与整库恢复，恢复前保留保护副本；纯文本或 HTML 连同图片导出当前内容。
- 图片接受 JPEG、PNG、WebP，单张最多 20 MB。
- 备份使用单文件 JSON 容器，内含 SQLite 快照和图片，恢复上限 512 MB；此实现适合小型本地日记库，大库的流式归档仍需后续改进。

数据库及图片位于 Electron userData 目录。内容与备份均未独立加密。当前不自动清理孤立图片，以保护撤销及恢复过程。

## 测试

数据库集成测试使用 Electron 自带的 Node 执行，保持 SQLite 原生 ABI 一致：

```sh
npm test
npm run test:ui
```

`test:ui` 启动隔离临时数据目录中的 Electron，验证编辑、搜索与回收站恢复。

`docs/` 内记录产品、视觉与架构方案，按当前仓库要求忽略提交。
