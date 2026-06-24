---
name: deskit-dev
description: >-
  Develop DeskKit (deskit / sync_file): Vue3 + Express local tool for folder
  sync, Yuque export, Confluence conversion. Use when modifying this repo,
  adding features, fixing bugs, or asking about project architecture, storage,
  routing, server APIs, or Electron desktop packaging entry points.
---

# DeskKit 开发

DeskKit 是本地 Web/Electron 工具集：文件夹对比、语雀导出、Confluence 转换等。

- 产品名：**DeskKit**（npm name: `deskit`，GitHub: `delbug/mini-tools`）
- 默认端口：**3457**（被占用时自动递增，见 `server/port.js`）
- 官网：https://delbug.github.io/mini-tools/

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + TypeScript + Element Plus + Vue Router (hash) |
| 后端 | Node.js 原生 `http`（`server.js`，无框架） |
| 桌面 | Electron（optionalDependencies，打包时才装） |
| 构建 | Vite + vue-tsc |

## 目录结构

```
src/views/          # 各功能页面（CompareView, YuqueView, ConfluenceView…）
src/components/     # 共享组件
src/composables/    # useConfig, useModuleClear, useServerHealth
src/utils/appStorage.ts   # 浏览器 localStorage 读写（唯一用户数据入口）
src/api.ts          # 前端调用后端 API
server/             # 后端模块（yuque, confluence, rename…）
server.js           # HTTP 路由入口
electron/main.js    # 桌面版启动
scripts/            # prepare-desktop, publish-release, stop-ports
docs/               # GitHub Pages 官网
```

## 硬约束（必须遵守）

### 用户数据只存浏览器

**所有**用户配置、历史路径、Token、语雀进度等 → **仅** `localStorage`，通过 `src/utils/appStorage.ts` 和 `src/composables/useModuleClear.ts` 管理。

- ❌ 不要写入项目内的 json/js 配置文件作为用户数据持久化
- ❌ 不要把 Token 或路径硬编码进源码
- ✅ 各页面用 localStorage key（见 `MODULE_STORAGE_KEYS`）记住上次输入
- ✅ 「清除历史数据」按钮走 `useModuleClear`，清对应模块 keys

### 新功能页面

1. 在 `src/views/` 新建 Vue 组件
2. 在 `src/router/index.ts` 注册路由
3. 在 `src/layout/AppLayout.vue` 侧边栏加菜单项
4. 如需后端 API → 在 `server.js` 加路由，逻辑放 `server/` 子模块
5. 如需持久化 → 在 `MODULE_STORAGE_KEYS` 注册 keys，**不要**写文件

## 常用命令

```bash
npm install              # 安装依赖（Electron 为 optional，日常不强制）
npm run boot             # 构建前端 + 启动 server（开发/自用）
npm run dev              # 仅 Vite 热更新（需另开 server）
npm run restart          # 停端口 + boot
npm run desktop:install  # 安装 Electron（打包前）
npm run desktop:pack:mac # Mac arm64 + x64 双架构打包
```

## 后端 API 约定

- 统一 JSON 响应，CORS 开放
- 路径参数通过 POST body 传递
- 文件操作必须 `resolveSafeDir()` 校验，禁止任意路径读写
- 语雀/Confluence 领域逻辑 → 见 [deskit-yuque-confluence](../deskit-yuque-confluence/SKILL.md)

## 改代码前先读

| 任务 | 先读 |
|------|------|
| 语雀导出 | `server/yuque.js`, `server/yuque-api.js`, `YuqueView.vue` |
| Confluence | `server/confluence.js`, `server/markdown-to-confluence.js`, `ConfluenceView.vue` |
| 文件夹对比 | `server.js` compare/sync 相关路由, `CompareView.vue` |
| 存储/清除 | `appStorage.ts`, `useModuleClear.ts` |
| 桌面版 | `electron/main.js`, `scripts/prepare-desktop.js`, `README-DESKTOP.md` |

## 代码风格

- 匹配现有代码：Vue Composition API、Element Plus 组件、中文 UI 文案
- 最小 diff，不重构无关代码
- 注释只写非显而易见的业务逻辑

## 发布

打包与 GitHub Release 流程见个人 Skill `deskit-release`（`~/.cursor/skills/deskit-release/`）及 `docs/PUBLISH.md`。
