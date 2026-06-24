---
name: deskit-yuque-confluence
description: >-
  Yuque export and Confluence conversion for DeskKit. Use when working on Yuque
  API/scraping, batch export, rate limiting, resume progress, markdown/HTML
  export, Confluence paste compatibility, image handling, mermaid diagrams, or
  debugging "无法保存页面" / Too Many Requests errors.
---

# DeskKit 语雀导出 & Confluence 转换

## 推荐用户路径

**语雀 → Confluence 最佳流程：**

1. 语雀导出页选 **API Token**（比分享链接更稳）
2. 导出格式勾选 **Confluence 网页 (.html)**
3. 图片处理选 **下载到本地 assets/**
4. 导出完成后，在浏览器打开 HTML → **全选复制** → 粘贴到 Confluence 编辑器

❌ 不要把原始 Markdown 直接粘贴进 Confluence（会报「无法保存页面」）

## 语雀认证方式

| 方式 | 适用 | 实现 |
|------|------|------|
| **API Token** | 批量导出整个知识库（推荐） | `server/yuque-api.js` |
| **分享链接** | 单篇或 fallback | `server/yuque.js` |

Token 在 https://www.yuque.com/settings/tokens 创建，存在浏览器 localStorage（`yuque-token`），**不写文件**。

### 知识库链接格式

- ✅ `https://www.yuque.com/用户/知识库/文档slug?singleDoc` — 含文档 slug，可解析目录
- ✅ API 模式：填知识库根路径 + Token 即可批量导出
- ❌ 仅有 `/用户/知识库` 无 slug — 无法批量导出（需至少一篇文档链接）

## 批量导出设计

核心文件：`server/yuque-api.js`（API）、`server/yuque.js`（通用）、`server/yuque-progress.js`

- **目录结构**：与语雀知识库一致，子目录对应文档层级
- **图片模式**：
  - `assets/` — 相对路径，适合备份和 Confluence HTML 粘贴
  - 外链 — 适合再导入语雀，不适合 Confluence
- **限流防护**：
  - 用户可设固定间隔（如 3–30s）或随机间隔
  - API 遇 429 → 自动退避重试（最多 5 次），仍失败提示等 5–10 分钟
- **断点续导**：
  - 进度存 `localStorage`（`deskit-yuque-progress`），key = `saveDir|url`
  - 记录 `completedSlugs`、`failed`、`docManifest`、当前 slug
  - 重启后可继续，不必从头

### 导出进度 UI

`YuqueView.vue` + `YuqueExportTree.vue`：

- 目录树展示，已完成打勾
- 数字进度如 `[||||....] 10/199`

## Confluence 兼容性（关键踩坑）

### HTML 粘贴 ✅

`server/markdown-to-confluence.js` 生成富文本 HTML：

- h1/h2/h3 标题结构（Confluence 用 h1 当页面标题）
- 表格、代码块、列表
- Mermaid：HTML 内嵌 `<pre class="mermaid">`，浏览器打开可渲染；粘贴 Confluence 需复制渲染后的图

### MD 直贴 Confluence ❌

Confluence 编辑器不接受 raw Markdown。直接粘贴会触发：

> 无法保存页面。请检查与服务器通信，或检查内容是否有特殊字符/emoji表情。

**修复方向**：走 HTML 导出路径，或在 Confluence 转换页把 MD 转为 HTML/DOCX/PDF。

### 图片粘贴问题

- HTML 内嵌 **base64 或外链** → 复制粘贴时图片常丢失
- **解决**：导出时选「下载到本地 assets/」，HTML 用相对路径；用户打开 HTML 文件后全选复制
- 若仍失败：检查 emoji、特殊 Unicode、框线字符（`┌┐└┘` 等 diagram chars）

### 特殊字符

`markdown-to-confluence.js` 对 Mermaid/HTML 做 escape；遇到保存失败优先排查：

1. emoji / 零宽字符
2. 未转义的 `<` `>` 在正文
3. 超大 base64 图片

## 格式转换模块

`ConfluenceView.vue` + `server/confluence.js`：

- 扫描本地文件夹中的 `.md` 文件
- 输出格式：HTML / DOCX / PDF / Confluence 粘贴 HTML
- 配置存 localStorage（`confluence-*` keys）

## 相关 localStorage keys

见 `src/composables/useModuleClear.ts` → `MODULE_STORAGE_KEYS.yuque` 和 `.confluence`。

清除语雀进度：`clearYuqueProgressStorage(url, saveDir)` 或清整个 `deskit-yuque-progress`。

## 调试 checklist

```
语雀导出问题：
- [ ] Token 是否有效？401 → 重新生成
- [ ] 429 Too Many Requests → 加大间隔，等几分钟
- [ ] 链接是否含文档 slug？
- [ ] 进度是否写入 localStorage？

Confluence 粘贴问题：
- [ ] 是否用的 HTML 而非 MD？
- [ ] 图片是否下载到 assets/？
- [ ] 是否在浏览器打开 HTML 后全选复制？
- [ ] 内容是否含 emoji / 特殊字符？
```

## 改代码入口

| 改动 | 文件 |
|------|------|
| API 批量导出 | `server/yuque-api.js` |
| 分享链接抓取 | `server/yuque.js`, `server/yuque-normalize.js` |
| MD→HTML 转换 | `server/markdown-to-confluence.js` |
| 图片下载 | `server/markdown-images.js` |
| Mermaid 渲染 | `server/mermaid-image.js` |
| 进度持久化 | `src/utils/appStorage.ts` |
| 前端 UI | `src/views/YuqueView.vue`, `ConfluenceView.vue` |
