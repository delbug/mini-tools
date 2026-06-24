const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 3457;
const PORT_FILE = process.env.SYNC_FILE_PORT_FILE
  || path.join(__dirname, '..', '.deskit-port');
const MAX_ATTEMPTS = 30;

function readPortFile() {
  try {
    const n = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writePortFile(port) {
  fs.writeFileSync(PORT_FILE, String(port), 'utf8');
}

function clearPortFile() {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {
    // ignore
  }
}

function listenOnce(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve(port);
    };
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function startOnAvailablePort(server, options = {}) {
  const preferred = Number(options.preferred ?? process.env.PORT ?? DEFAULT_PORT);
  const maxAttempts = Number(options.maxAttempts ?? process.env.PORT_MAX_ATTEMPTS ?? MAX_ATTEMPTS);
  const host = options.host || '127.0.0.1';

  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    try {
      await listenOnce(server, port, host);
      writePortFile(port);
      return { port, preferred, shifted: i > 0 };
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }

  throw new Error(`端口 ${preferred}~${preferred + maxAttempts - 1} 均已被占用`);
}

module.exports = {
  DEFAULT_PORT,
  PORT_FILE,
  MAX_ATTEMPTS,
  readPortFile,
  writePortFile,
  clearPortFile,
  startOnAvailablePort,
};
