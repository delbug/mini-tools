# GitHub 官网与 Release 发布指南

本文说明如何让别人通过 **官网 URL** 访问介绍页，并从 **GitHub Releases** 下载安装包。

---

## 一、最终效果

| 用途 | 地址 |
|------|------|
| **项目官网**（GitHub Pages） | https://delbug.github.io/mini-tools/ |
| **源码仓库** | https://github.com/delbug/mini-tools |
| **安装包下载** | https://github.com/delbug/mini-tools/releases |

官网会自动读取最新 Release，显示 Mac / Windows 下载按钮。

在 GitHub 仓库首页右侧 **About → Website** 可填官网链接，访客一眼能看到。

---

## 二、首次启用 GitHub Pages（只需做一次）

### 方式 A：推送代码后自动部署（推荐，已配置 Actions）

1. 将含 `docs/` 和 `.github/workflows/pages.yml` 的代码 **push 到 GitHub**
2. 打开仓库：**Settings → Pages**
3. **Build and deployment** 选择：
   - Source: **GitHub Actions**
4. 等待 Actions 里 **Deploy GitHub Pages** 工作流跑绿
5. 访问 https://delbug.github.io/mini-tools/

### 方式 B：不用 Actions，手动选 docs 目录

1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**，Folder: **/docs**
4. Save

---

## 三、设置仓库「官网」链接（可选）

1. 仓库首页点 **⚙️**（About 旁）
2. **Website** 填：`https://delbug.github.io/mini-tools/`
3. 可勾选 **Releases**、**Packages** 等展示项
4. Save changes

---

## 四、发布安装包（每次出新版本）

### 1. 本地打包

```bash
cd mini-tools
npm install
npm run desktop:install
npm run desktop:pack:mac    # Mac 上
# npm run desktop:pack:win  # Windows 上（需在 Windows 执行）
```

产物在 `release/` 目录（`.dmg`、`-mac.zip` 等）。

### 2. 上传到 GitHub Releases

**方式 A：脚本（需安装 [GitHub CLI](https://cli.github.com)）**

```bash
gh auth login
chmod +x scripts/publish-release.sh
./scripts/publish-release.sh
```

**方式 B：网页手动上传**

1. 打开 https://github.com/delbug/mini-tools/releases
2. **Draft a new release**
3. Tag：`v1.0.0`（与 `package.json` 的 `version` 一致）
4. Title：`DeskKit v1.0.0`
5. 把 `release/` 里的 `.dmg`、`.zip` 拖到 **Attach binaries**
6. **Publish release**

发布后，官网下载区会自动显示最新版链接（约 1 分钟内刷新页面即可）。

### 3. 更新版本号

发新版前改 `package.json` 的 `version`，再打包、再发 Release。

---

## 五、目录说明

| 路径 | 作用 |
|------|------|
| `docs/index.html` | GitHub Pages 官网首页 |
| `.github/workflows/pages.yml` | 推送后自动部署官网 |
| `scripts/publish-release.sh` | 一键打包 + 创建 Release |
| `release/` | 本地打包输出（不提交 git） |

---

## 六、常见问题

**Q：官网 404？**  
A：确认 Pages 已启用，Actions 部署成功，或 docs 目录已在 main 分支。

**Q：官网没有下载按钮？**  
A：尚未创建 GitHub Release，或 Release 里没有 `.dmg`/`.exe` 附件。

**Q：能否用自定义域名？**  
A：可以。在 `docs/CNAME` 写域名，并在 DNS 配置 CNAME 指向 `delbug.github.io`。

**Q：Windows 包谁打？**  
A：在 Windows 电脑执行 `npm run desktop:pack:win`，上传到同一 Release 即可。

---

维护者：吴江 · [okwujiang@gmail.com](mailto:okwujiang@gmail.com)
