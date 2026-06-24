#!/usr/bin/env bash
# 本地打包并创建 GitHub Release（需已安装 gh 并完成 gh auth login）
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

echo "==> 版本: ${TAG}"

if ! command -v gh &>/dev/null; then
  echo "请先安装 GitHub CLI: https://cli.github.com"
  echo "然后执行: gh auth login"
  exit 1
fi

echo "==> 安装 Electron（若尚未安装）"
npm run desktop:install || true

echo "==> 打包 macOS"
npm run desktop:pack:mac

ASSETS=()
shopt -s nullglob
for f in release/*.{dmg,zip}; do
  ASSETS+=("$f")
done

if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "release/ 下未找到 .dmg 或 .zip，打包可能失败"
  exit 1
fi

echo "==> 将上传: ${ASSETS[*]}"

if gh release view "$TAG" &>/dev/null; then
  echo "Release ${TAG} 已存在，上传资源..."
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
else
  gh release create "$TAG" "${ASSETS[@]}" \
    --title "DeskKit ${TAG}" \
    --notes "桌面版安装包。Mac 用户下载 .dmg 或 -mac.zip；详见 README-DESKTOP.md。"
fi

echo ""
echo "完成！"
echo "  Releases: https://github.com/delbug/mini-tools/releases/tag/${TAG}"
echo "  官网（部署后）: https://delbug.github.io/mini-tools/"
