const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const isPackaged = app.isPackaged;
const serverRoot = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..');

let mainWindow = null;
let serverProcess = null;

function portFilePath() {
  if (isPackaged) {
    return path.join(app.getPath('userData'), '.deskit-port');
  }
  return path.join(serverRoot, '.deskit-port');
}

function readPortFromFile() {
  try {
    const n = Number(fs.readFileSync(portFilePath(), 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function waitForServer(timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const attempt = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('服务启动超时，请关闭后重试'));
        return;
      }

      const port = readPortFromFile();
      if (!port) {
        setTimeout(attempt, 200);
        return;
      }

      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(port);
        else setTimeout(attempt, 200);
      });
      req.on('error', () => setTimeout(attempt, 200));
      req.setTimeout(3000, () => {
        req.destroy();
        setTimeout(attempt, 200);
      });
    };

    attempt();
  });
}

function startBackend() {
  try {
    fs.unlinkSync(portFilePath());
  } catch {
    // ignore
  }

  const env = {
    ...process.env,
    SYNC_FILE_PORT_FILE: portFilePath(),
    MINI_TOOLS_USER_DATA: app.getPath('userData'),
  };

  if (isPackaged) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  const command = isPackaged ? process.execPath : process.platform === 'win32' ? 'node.exe' : 'node';
  const args = [path.join(serverRoot, 'server.js')];

  serverProcess = spawn(command, args, {
    cwd: serverRoot,
    env,
    stdio: isPackaged ? 'pipe' : 'inherit',
  });

  if (isPackaged && serverProcess.stderr) {
    serverProcess.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  }

  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (code && code !== 0 && !app.isQuitting) {
      dialog.showErrorBox('服务异常退出', `后端已停止 (code=${code}${signal ? `, signal=${signal}` : ''})`);
      app.quit();
    }
  });
}

function stopBackend() {
  if (!serverProcess) return;
  serverProcess.kill('SIGTERM');
  serverProcess = null;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'DeskKit',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.isQuitting = false;

app.whenReady().then(async () => {
  startBackend();
  try {
    const port = await waitForServer();
    createWindow(port);
  } catch (err) {
    stopBackend();
    dialog.showErrorBox('启动失败', err.message || String(err));
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', async () => {
  if (mainWindow) return;
  try {
    const port = readPortFromFile() || await waitForServer(10000);
    createWindow(port);
  } catch {
    app.quit();
  }
});
