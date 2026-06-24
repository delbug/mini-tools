#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  osascript -e 'display alert "需要安装 Node.js" message "请先安装 Node.js: https://nodejs.org"'
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "正在安装依赖..."
  npm install
fi

if [ ! -d dist ]; then
  echo "正在构建前端..."
  npm run build
fi

echo "启动服务..."
rm -f .deskit-port
node server.js &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if [ -f .deskit-port ]; then
    PORT="$(cat .deskit-port)"
    open "http://localhost:${PORT}"
    break
  fi
  sleep 0.1
done

wait "$SERVER_PID"
