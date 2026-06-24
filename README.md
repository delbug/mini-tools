# DeskKit

本地小工具集合：**文件夹对比与同步**、**语雀文档导出**、**Confluence 格式转换** 等。在浏览器里操作，数据默认保存在本机。

- **官网**：https://delbug.github.io/mini-tools/
- **下载安装包**：[GitHub Releases](https://github.com/delbug/mini-tools/releases)
- **发布官网与安装包**：[docs/PUBLISH.md](./docs/PUBLISH.md)

| 菜单 | 功能 |
|------|------|
| **文件夹对比** | MD5/路径对比、主辅同步、并集、删除、移动 |
| **批量重命名** | 前缀/后缀/替换/序号/指定位置插入/清理非法字符 |
| **收藏管理** | 保存常用文件夹组合 |
| **重复文件** | 按 MD5 查找同目录重复文件 |
| **语雀导出** | 批量导出语雀文档（可选 Markdown / Confluence 网页） |
| **Confluence 转换** | 将本地 Markdown 转为 HTML / Word / PDF 等 |
| **设置** | 忽略规则、默认对比模式 |

---

## 一、完全新手教程（不用懂编程）

适合：第一次用、只想完成「备份语雀 → 粘贴到 Confluence」或「对比两个文件夹」。

### 1. 准备环境（只需做一次）

1. **安装 Node.js**（若尚未安装）
   - 打开 [https://nodejs.org](https://nodejs.org)
   - 下载 **LTS** 版本，一路「下一步」安装

2. **拿到本项目**
   - 从 GitHub 克隆，或解压下载的 zip 到任意目录（例如 `~/Downloads/sync_file`）

### 2. 启动应用（每次使用前）

**方式 A：双击启动（macOS 推荐）**

1. 在项目文件夹里找到 **`start.command`**
2. 双击它（若提示无法打开：右键 → 打开）
3. 终端窗口会显示「启动服务…」，浏览器自动打开 **http://localhost:3457**

> 不要关闭那个终端窗口，关了服务就停了。

**方式 B：命令行启动**

打开「终端」，执行：

```bash
cd /你的项目路径/sync_file
npm install          # 第一次需要，以后可跳过
npm run boot         # 构建并启动，地址 http://localhost:3457
```

若端口被占用，执行 `npm run restart` 再试。

### 3. 界面说明

- 左侧是菜单，点不同模块切换功能
- 选文件夹时，点输入框旁的 **文件夹图标**，在系统对话框里选目录
- 各页面右上角有 **「清除历史数据」**，可清掉本页记住的路径、Token 等（存在浏览器里，不在项目文件里）

### 4. 常用流程：语雀 → Confluence（推荐路径）

目标：把语雀知识库变成能在 Confluence 里粘贴的网页，**不必先导出 md 再转换**。

#### 步骤 1：语雀导出

1. 左侧点 **「语雀导出」**
2. **认证方式** 选 **API Token（推荐）**
   - 登录 [语雀 Token 设置](https://www.yuque.com/settings/tokens) 创建 Token，粘贴到输入框
3. **语雀知识库链接** 填知识库地址，例如 `https://www.yuque.com/你的用户名/知识库名`
4. **保存目录** 选一个空文件夹（导出结果会放这里）
5. **导出模式** 选「批量导出整个知识库」
6. **导出文件格式（可多选）**
   - 只导入 Confluence：只勾选 **Confluence 网页 (.html)**
   - 既要备份又要粘贴：两个都勾
7. **图片处理**
   - 粘贴 Confluence 建议选 **「下载到本地 assets/」**（HTML 内嵌图片更稳）
8. 点 **「预览知识库」** 确认篇数，再点 **「批量导出知识库」**
9. 等待完成，点 **「打开导出目录」**

导出目录示例：

```text
我的知识库/
  第一篇文档/
    第一篇文档.html
    assets/          # 若下载了图片
  第二篇文档/
    第二篇文档.html
```

#### 步骤 2：粘贴到 Confluence

1. **双击** `.html` 文件，用 **Chrome / Safari / Edge** 打开（看到排版后的正文，不是代码）
2. 在浏览器里 **Cmd+A**（Windows：**Ctrl+A**）全选
3. **Cmd+C** 复制
4. 打开 Confluence 页面 → 点 **编辑** → 在正文 **Cmd+V** 粘贴

**常见错误：**

| 错误做法 | 结果 |
|---------|------|
| 把 HTML 源码贴进 Confluence | 显示成代码 |
| 在记事本里复制 `<html>…` | 显示成代码 |
| 从 Word 复制再贴 Confluence | 图片常丢失 |

正确做法是：**浏览器里看效果 → 全选复制 → 贴到 Confluence 编辑器**。

#### 备选：已有 Markdown 时再转换

若你已经有 `.md` 文件：

1. 左侧 **「Confluence 转换」**
2. 选 Markdown 源目录
3. 导出格式选 **「Confluence 网页 (.html)」**
4. 树形列表勾选要转换的文件 → 转换
5. 同样用浏览器打开 html 再复制粘贴

### 5. 文件夹对比（简要）

1. 左侧 **「文件夹对比」**
2. 添加 2 个或以上文件夹，标记一个为 **主文件夹**
3. 选对比模式（一般选 **MD5**）
4. 看差异列表，需要同步时点 **同步** → 先看预览 → 确认执行

### 6. 停止服务

- 关掉运行 `start.command` 或 `node server.js` 的终端窗口  
- 或在项目目录执行：`npm run stop`

### 7. 新手 FAQ

**Q：页面打不开 / 一直转圈？**  
A：确认终端里有没有 `DeskKit 服务已启动: http://localhost:3457`；没有就重新 `npm run boot`。

**Q：语雀导出失败 / Too Many Requests？**  
A：被限流了，把「下载间隔」调大（例如随机 10~60 秒），等几分钟再「继续导出」。

**Q：Confluence 里图片不显示？**  
A：导出 HTML 时改用「下载图片到本地 assets/」；粘贴前务必在**浏览器**里打开 html，不要贴源码。

**Q：我的 Token、路径会提交到 Git 吗？**  
A：不会。它们存在**浏览器 localStorage**，不在项目 json 文件里。详见下文「数据与隐私」。

### 8. 给同事用：桌面版（推荐，无需安装 Node）

若同事**不想装 Node、不想敲命令**，由你打包成桌面软件发给他们即可。

**详细打包教程见：[README-DESKTOP.md](./README-DESKTOP.md)**（含 Mac/Windows 步骤、分发方式、FAQ）。

**同事怎么用（Mac）：**

1. 根据 Mac 芯片选择安装包：M 系列用 `DeskKit-x.x.x-arm64.dmg`，Intel 用 `DeskKit-x.x.x-x64.dmg`；或打开对应 `.zip` 后双击 **DeskKit.app**
2. **双击** `DeskKit` 图标
3. 等窗口自动打开，直接使用（与浏览器访问 localhost 相同）

**同事怎么用（Windows）：**

1. 解压 `DeskKit Setup x.x.x.exe` 安装包并安装，或解压 zip 里的 exe
2. 双击桌面快捷方式启动

无需安装 Node.js，无需 `npm install`。

**你怎么打包（只需在你自己的开发机上做一次）：**

```bash
cd sync_file
npm install                 # 装项目依赖（Electron 失败也不影响 Web 版）
npm run desktop:install     # 仅打包桌面前需要，使用 .npmrc 国内镜像
npm run desktop:pack:mac    # 产出 Mac 双架构包（arm64 + x64）→ release/ 目录
# 或 npm run desktop:pack:win（需在 Windows 上执行）
```

打包产物在 **`release/`** 目录，把 `.dmg` / `.zip`（Mac）或 `.exe`（Windows）发给同事即可。详见 [README-DESKTOP.md](./README-DESKTOP.md)。

---

## 二、有开发经验人员教程

适合：需要二次开发、调试 API、改构建流程的开发者。

### 1. 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vue Router + Element Plus + Vite |
| 后端 | Node.js 原生 `http` 模块（单文件 `server.js` + `server/` 目录） |
| 文档转换 | `docx`、`puppeteer`（流程图/代码块截图、PDF） |
| 默认端口 | 后端 **3457**；开发前端 **5174**（代理 `/api` → 3457） |

### 2. 本地开发

```bash
git clone git@github.com:delbug/mini-tools.git
cd mini-tools
npm install

# 终端 1：后端
npm start                 # node server.js → :3457

# 终端 2：前端热更新
npm run dev               # vite → :5174，访问 http://localhost:5174
```

生产/自测一体启动：

```bash
npm run boot              # vue-tsc + vite build + node server.js
# 访问 http://localhost:3457
```

其他脚本：

```bash
npm run build             # 仅构建前端到 dist/
npm run stop              # 释放 3457、3467 端口
npm run restart           # stop + boot
```

**打包桌面应用（分发给无 Node 环境的同事）：**

完整说明见 **[README-DESKTOP.md](./README-DESKTOP.md)**。

```bash
npm install
npm run desktop:install    # 安装 Electron（打包前）
npm run desktop:pack:mac   # Mac → release/*.dmg, *.zip
npm run desktop:pack:win   # Windows 安装包（需在 Windows 构建）
npm run desktop:dev        # 本地调试 Electron 窗口
```

环境变量：

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 后端监听端口 | `3457` |

### 3. 目录结构

```text
sync_file/
├── server.js                 # HTTP 入口、路由、静态 dist
├── server/
│   ├── yuque.js              # 语雀分享链接抓取、单篇/批量导出
│   ├── yuque-api.js          # 语雀 Open API（Token 模式）
│   ├── yuque-progress.js     # 批量导出调度、断点续导（内存 + 客户端 progress）
│   ├── confluence.js         # Markdown 批量转换入口
│   ├── markdown-to-paste-html.js   # Confluence 粘贴用 HTML
│   ├── markdown-to-confluence.js   # 预览 HTML
│   ├── markdown-to-docx.js
│   ├── markdown-to-pdf.js
│   ├── markdown-images.js    # 远程/本地图片 → data URL
│   ├── mermaid-image.js      # mermaid.ink / puppeteer
│   └── rename.js             # 重命名、重复文件
├── src/
│   ├── views/                # 各功能页
│   ├── api.ts                # 前端 API 封装
│   └── utils/appStorage.ts   # localStorage 配置与语雀进度
├── dist/                     # 构建产物（git 忽略）
└── start.command             # macOS 一键启动
```

### 4. 主要 API（节选）

Base URL：`http://localhost:3457/api`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查、功能列表 |
| POST | `/yuque/preview-book` | 预览知识库目录 |
| POST | `/yuque/export-batch` | 批量导出（body 含 `token`、`exportFormat`） |
| POST | `/yuque/export` | 单篇导出 |
| POST | `/confluence/list` | 列出目录下 md |
| POST | `/confluence/preview` | 预览单文件转换 HTML |
| POST | `/confluence/convert` | 批量转换（`format`: html/docx/md/pdf） |
| POST | `/compare` | 文件夹对比 |
| POST | `/sync/preview` | 同步预览 |
| POST | `/sync/execute` | 执行同步 |

**语雀 `exportFormat`：** `md` | `html` | `both`（前端由两个 checkbox 组合）

**Confluence `format`：** `html` | `docx` | `md` | `pdf`

示例：

```bash
curl -s -X POST http://localhost:3457/api/yuque/export-batch \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.yuque.com/user/repo",
    "saveDir": "/tmp/yuque-out",
    "token": "YOUR_TOKEN",
    "exportFormat": "html",
    "downloadImages": true
  }'
```

### 5. 数据与隐私

- **服务端不写入**用户配置 JSON；`server/config.js` 仅为 API 缺省值
- **浏览器 localStorage** 存储：收藏、最近路径、语雀 Token、导出进度、Confluence 目录等
- 清除方式：各模块「清除历史数据」，或 DevTools → Application → Local Storage
- 语雀/API Token 仅随请求发到本机 `localhost` 后端，再转发语雀 API

### 6. 扩展开发提示

| 需求 | 建议改动的文件 |
|------|----------------|
| 新增语雀导出格式 | `server/yuque.js` → `saveYuqueDocContent`，`YuqueView.vue` |
| Confluence 粘贴 HTML 样式 | `server/markdown-to-paste-html.js` |
| 新增转换输出格式 | `server/confluence.js` → `writeConvertedFile` |
| 新菜单页 | `src/views/*.vue` + `src/router/index.ts` + `AppLayout.vue` |
| 新 API | `server.js` 路由 + `src/api.ts` |

类型检查：

```bash
npm run build    # 含 vue-tsc
```

### 7. Git 推送注意（GitHub）

若开启「阻止暴露私人邮箱」，提交时需使用 GitHub 提供的 `@users.noreply.github.com` 邮箱，否则 push 会报 **GH007**。

```bash
git config user.email "你的用户名@users.noreply.github.com"
```

历史被改写后推送需：

```bash
git push --force-with-lease origin main
```

### 8. 开发者 FAQ

**Q：`puppeteer` 下载 Chromium 失败？**  
A：检查网络/代理；PDF、复杂流程图依赖 puppeteer。

**Q：修改前端后生产环境没变化？**  
A：需重新 `npm run build` 或 `npm run boot`；`npm start` 只跑后端，不会自动构建。

**Q：循环依赖？**  
A：`yuque.js` 按需 `require('./confluence')`，避免顶层互引。

---

## 三、功能补充说明

### 批量重命名

- **自然数序号**：起始值、步长、补零、前缀/后缀/插入位置
- **指定位置插入**：第 N 个字符处插入文字或序号
- **一键清理**：将 `:` `/` `\` 等替换为 `_`

### 同步策略

- **主 → 辅**：主文件夹镜像到次要文件夹（执行前 Dry-run 预览）
- **并集**：互补各文件夹缺失文件
- **选中项**：自定义源 → 目标复制

### 智能识别

- MD5 相同但路径不同 → 「路径不同」
- 同步前展示复制/覆盖/删除清单，确认后执行

---

## 许可证

见仓库内 LICENSE（若有）；语雀 API 使用须遵守[语雀服务条款](https://www.yuque.com/terms)。
