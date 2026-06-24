const { execSync } = require('child_process');
const { readPortFile, DEFAULT_PORT } = require('../server/port');

const ports = new Set([DEFAULT_PORT, 5174, 3467]);
const fromFile = readPortFile();
if (fromFile) ports.add(fromFile);

for (const port of ports) {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore', shell: true });
  } catch {
    // ignore
  }
}

console.log(`已尝试释放端口: ${[...ports].sort((a, b) => a - b).join(', ')}`);
