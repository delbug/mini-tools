# DeskKit 桌面版打包说明

本文档说明如何把 **DeskKit** 打成 **Mac / Windows 桌面应用**，发给同事后**双击即可使用**，无需安装 Node.js、无需执行 `npm install` 或 `npm start`。

> 日常使用与 Web 版功能相同（语雀导出、Confluence 转换、文件夹对比等）。  
> 通用功能说明见项目根目录 [README.md](./README.md)。

### 打包命令速查（M1 / Intel 双架构）

在项目根目录执行（将 `mini-tools` 换成你的实际目录名，如 `sync_file`）：

```bash
# 进入项目目录
cd mini-tools

# ① 安装项目依赖（首次或 package.json 变更后）
npm install

# ② 安装 Electron 与 electron-builder（仅桌面打包需要，首次或升级后）
npm run desktop:install

# ③ 一键打包 Mac：同时产出 Apple 芯片（arm64）与 Intel（x64）的 .dmg / .zip
npm run desktop:pack:mac
```

**③ 等价于依次执行：**

```bash
node scripts/prepare-desktop.js          # 检查 server.js、dist/、electron 等是否就绪
npm run build                            # 见下方「构建前端」
electron-builder --mac --arm64 --x64     # 打出 arm64 与 x64 安装包到 release/
```

**`npm run build` 等价于：**

```bash
vue-tsc --noEmit && vite build           # TypeScript 检查 + 构建前端到 dist/
```

**只打一种芯片时（可选）：**

```bash
npm run desktop:pack:mac:arm64   # 仅 M 系列（arm64）→ electron-builder --mac --arm64
npm run desktop:pack:mac:intel   # 仅 Intel（x64）   → electron-builder --mac --x64
```

**产物目录：** `release/`（如 `DeskKit-1.0.0-arm64.dmg`、`DeskKit-1.0.0-x64.dmg` 等）。

---

## 一、两种使用方式对比

| 方式 | 适合谁 | 同事需要 |
|------|--------|----------|
| **命令行 / start.command** | 开发、自用 | 安装 Node.js，执行 `npm install`、`npm run boot` |
| **桌面版（本文档）** | 分发给非技术人员 | 解压或安装后 **双击图标** |

桌面版内部仍会启动本机后端服务（端口默认从 **3457** 起自动避让），界面在 Electron 窗口中打开，同事无感知。

---

## 二、打包者：环境准备

### 1. 基础要求

- **Node.js LTS**（建议 20+）：[https://nodejs.org](https://nodejs.org)
- **Git**（若从仓库克隆）
- **磁盘空间**：建议预留 **2GB+**（含 `node_modules` 与打包产物）
- **网络**：打包桌面版需下载 Electron（约 100MB+），建议稳定网络或使用项目已配置的国内镜像

### 2. 安装依赖（分两步）

Electron 已设为 **可选依赖**，且项目根目录有 **`.npmrc` 国内镜像**。  
因此：**日常 `npm install` 不会因 Electron 下载失败而整体报错**；只有要打桌面包时才需单独装 Electron。

#### 第一步：安装项目依赖（必做）

```bash
git clone git@github.com:delbug/mini-tools.git
cd mini-tools
npm install
```

若出现大量 `npm warn deprecated ...`，**可忽略**，不影响使用。

安装成功后即可跑 Web 版：

```bash
npm run boot
```

浏览器打开终端里显示的地址（如 `http://localhost:3457`；若被占用会自动改用 3458 等）。

#### 第二步：安装 Electron（仅打包桌面版时需要）

```bash
npm run desktop:install
```

该命令会安装 `electron` 与 `electron-builder`，并自动使用 `.npmrc` 中的镜像：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

若仍报 `ETIMEDOUT`：

1. 多执行几次 `npm run desktop:install`
2. 或开 VPN / 代理后再试
3. 或手动指定镜像后安装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  npm install electron@^34.5.8 electron-builder@^25.1.8 --no-save
```

验证 Electron 是否装好：

```bash
test -d node_modules/electron && echo "Electron OK"
```

### 3. 确认 Web 版正常（建议）

```bash
npm run boot
```

抽测语雀导出、重复文件、Confluence 转换等，确认无误后 `npm run stop`。

---

## 三、打包者：构建桌面应用

### 命令一览

| 命令 | 说明 |
|------|------|
| `npm run desktop:install` | 安装 Electron（打包前必做，仅需一次） |
| `npm run desktop:dev` | 本地调试：构建前端 + 打开 Electron 窗口（不产出安装包） |
| `npm run desktop:pack:mac` | 打包 **macOS 双架构**（同时产出 Apple 芯片 + Intel 的 `.dmg` / `.zip`） |
| `npm run desktop:pack:mac:arm64` | 仅 Apple 芯片（M 系列） |
| `npm run desktop:pack:mac:intel` | 仅 Intel 芯片 |
| `npm run desktop:pack:win` | 打包 **Windows** 版（安装包 + `.zip`） |
| `npm run desktop:pack` | 按当前系统自动选择平台 |

### 推荐完整流程（Mac 示例）

```bash
cd mini-tools

# 1. 依赖（若已做过可跳过）
npm install
npm run desktop:install

# 2. 打包
npm run desktop:pack:mac
```

### macOS 产物位置

成功后文件在 **`release/`** 目录：

```text
release/
├── DeskKit-1.0.0-arm64.dmg       # Apple 芯片（M 系列 Mac）
├── DeskKit-1.0.0-x64.dmg         # Intel 芯片 Mac
├── DeskKit-1.0.0-arm64-mac.zip
├── DeskKit-1.0.0-x64-mac.zip
├── mac-arm64/DeskKit.app
└── mac/DeskKit.app
```

**发给同事：**

- **M 系列 Mac** → 发 `DeskKit-*-arm64.dmg`（或 `-arm64-mac.zip`）
- **Intel Mac** → 发 `DeskKit-*-x64.dmg`（或 `-x64-mac.zip`）
- 不确定芯片时：点  → **关于本机** → 看「芯片」或「处理器」（Apple M* = arm64，Intel = x64）
- **不要**只发 `dist/` 或源码（无法独立运行）

**只打一种架构（可选）：**

```bash
npm run desktop:pack:mac:arm64   # 仅 M 系列
npm run desktop:pack:mac:intel   # 仅 Intel
```

**复制到项目同级目录（可选）：**

```bash
# 假设项目在 ~/Downloads/sync_file
cp release/DeskKit-*.dmg ../
cp release/DeskKit-*-mac.zip ../
# 或整目录
cp -R release ../DeskKit-release
```

### Windows 打包（在 Windows 上执行）

```bash
npm install
npm run desktop:install
npm run desktop:pack:win
```

产物示例：

```text
release/
├── DeskKit Setup 1.0.0.exe    # NSIS 安装程序
└── DeskKit-1.0.0-win.zip
```

> Mac 包在 Mac 上打，Windows 包在 Windows 上打，不要混用。

### 打包过程说明

1. `scripts/prepare-desktop.js` 检查 `dist/`、`puppeteer`、`electron` 等  
2. `npm run build` 构建前端到 `dist/`  
3. `electron-builder` 打包：
   - `electron/main.js`（窗口 + 启动后端）
   - `server.js`、`server/`、`dist/`、`node_modules/`（作为 `extraResources`）

**体积：** 每个架构约 **400MB～550MB**（含 Electron + Puppeteer/Chromium）。  
**耗时：** 双架构首次约 **10～25 分钟**（需分别打包 arm64 与 x64）。

---

## 四、打包者：本地调试桌面壳（可选）

```bash
npm run desktop:dev
```

会：构建前端 → 启动 Electron → 内嵌 `server.js` → 打开窗口。  
关闭窗口即退出（后端一并停止）。

---

## 五、同事：安装与使用

### macOS

**DMG：** 双击 `.dmg` → 拖 **DeskKit** 到「应用程序」→ 双击打开  

**ZIP：** 解压 → 双击 **DeskKit.app**

**首次打开「无法验证开发者」：**

- 右键 `.app` → **打开** → 再点「打开」  
- 或「系统设置 → 隐私与安全性」中允许

### Windows

运行 `DeskKit Setup x.x.x.exe` 安装，或解压 zip 后运行 exe。

### 使用说明

- 界面与 Web 版一致  
- Token、路径等存在本机应用数据目录，不在项目 json 里  
- **不需要** Node、不需要终端  
- 设置页底部有维护者联系方式（遇 bug 可发邮件）

### 粘贴到 Confluence

1. 语雀导出时勾选 **Confluence 网页 (.html)**（可只勾 HTML）  
2. 用浏览器打开 `.html` → **Cmd+A / Ctrl+A** → 复制 → 粘贴到 Confluence  
3. **不要**粘贴 HTML 源码

---

## 六、原理简述

```text
┌─────────────────────────────────────┐
│  DeskKit.app / DeskKit.exe    │
│  ┌─────────────┐  ┌───────────────┐ │
│  │ Electron 窗口 │  │ 内嵌 Node 后端 │ │
│  │ (显示 dist)  │←→│ server.js     │ │
│  └─────────────┘  └───────────────┘ │
└─────────────────────────────────────┘
         ↑ 仅访问 127.0.0.1
```

- 桌面壳：`electron/main.js`  
- 后端：`Resources/server/`（Mac）或 `resources/server/`（Win）  
- 端口：3457 起自动找空闲端口  
- Puppeteer 缓存在 Electron `userData` 目录  

---

## 七、常见问题

### Q1：`npm install` 报 Electron ETIMEDOUT，整个安装失败

**A（新版已缓解）：** Electron 为可选依赖，`npm install` 应能成功完成，Web 版可正常使用。

若仍整体失败，可先：

```bash
npm install --omit=optional
```

要打桌面包时再：

```bash
npm run desktop:install
```

### Q2：`npm warn deprecated` 一堆黄色警告

**A：** 来自 Electron 等间接依赖，**可忽略**，不影响打包和使用。

### Q3：`desktop:pack:mac` 提示未安装 Electron

**A：** 先执行 `npm run desktop:install`，成功后再打包。

### Q4：同事双击后空白或「启动失败」

**A：** 检查杀毒/安全拦截、是否发完整 `.dmg`/`.zip`、Mac 是否已「右键打开」过。  
维护者本机用 `npm run desktop:dev` 复现。

### Q5：能不能只发 `dist`？

**A：不能。** 必须含后端与 Electron 壳，请发 `release/` 里的安装包。

### Q6：同事要装 Node 吗？

**A：不需要。**

### Q7：Mac 包能在 Windows 用吗？Intel Mac 能用吗？

**A：** Mac 包不能在 Windows 用。默认 `desktop:pack:mac` 会同时产出 **arm64**（M 系列）和 **x64**（Intel）两个包，发给同事时选对文件名即可；若只发了 `-arm64` 包，Intel Mac 无法使用。

### Q8：体积为什么这么大？

**A：** 内含 Electron、Chromium（PDF/流程图）、完整依赖树。

### Q9：如何更新同事版本？

**A：** 重新打包后发新安装包覆盖安装即可。

### Q10：和 `npm run stop` 的关系？

**A：** 桌面版退出时自动停后端；命令行版才需 `npm run stop`。

---

## 八、打包清单（发同事前自检）

- [ ] `npm install` 成功  
- [ ] `npm run desktop:install` 成功（`node_modules/electron` 存在）  
- [ ] `npm run desktop:dev` 能正常打开  
- [ ] 语雀导出 / Confluence HTML 抽测通过  
- [ ] `npm run desktop:pack:mac` 或 `pack:win` 成功  
- [ ] `release/` 里版本号与 `package.json` 一致  
- [ ] 发给同事的为 `.dmg` / `.zip` / `.exe`，不是源码  
- [ ] 说明 Mac 首次打开的「无法验证开发者」处理方式  

---

## 九、相关文件

| 路径 | 作用 |
|------|------|
| `.npmrc` | Electron 国内镜像配置 |
| `electron/main.js` | Electron 主进程 |
| `scripts/prepare-desktop.js` | 打包前检查 |
| `scripts/stop-ports.js` | 释放端口（命令行版） |
| `package.json` → `optionalDependencies` | Electron 可选，不阻塞 `npm install` |
| `package.json` → `build` | electron-builder 配置 |
| `release/` | 打包输出（已 gitignore） |

---

## 十、联系与许可

- 应用版本：`package.json` → `version`  
- 遇 bug 可联系维护者：**小江** — [okwujiang@gmail.com](mailto:okwujiang@gmail.com)  
- 语雀 API 须遵守 [语雀服务条款](https://www.yuque.com/terms)  

更多功能说明见 [README.md](./README.md)。
