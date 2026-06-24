#!/usr/bin/env node
/**
 * 打包前检查：需已 npm install 且 npm run build
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  'server.js',
  'dist/index.html',
  'node_modules/puppeteer',
  'electron/main.js',
];

let ok = true;
for (const rel of required) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.error(`缺少: ${rel}`);
    ok = false;
  }
}

if (!fs.existsSync(path.join(root, 'node_modules/electron'))) {
  console.error('未安装 Electron（可选依赖，网络失败时可忽略）。打包桌面版请先执行：');
  console.error('  npm run desktop:install');
  console.error('若仍超时，可多试几次，或使用代理后再执行上述命令。');
  console.error('（项目已配置 .npmrc 国内镜像 npmmirror）');
  ok = false;
}

if (!fs.existsSync(path.join(root, 'node_modules/electron-builder'))) {
  console.error('未安装 electron-builder，请执行: npm run desktop:install');
  ok = false;
}

if (!ok) {
  console.error('\n日常使用 Web 版无需 Electron，直接: npm run boot');
  process.exit(1);
}

console.log('桌面打包前置检查通过');
