const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpGetBuffer(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://www.yuque.com/',
          Accept: 'image/*,*/*;q=0.8',
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectCount > 5) return reject(new Error('重定向过多'));
          const next = new URL(res.headers.location, url).href;
          res.resume();
          resolve(httpGetBuffer(next, redirectCount + 1));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('下载超时')));
  });
}

function collectImageUrls(markdown) {
  const urls = new Set();
  const md = String(markdown || '');

  for (const match of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    urls.add(match[1].trim());
  }
  for (const match of md.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    urls.add(match[1].trim());
  }

  return [...urls];
}

function mimeFromExt(ext, contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'image/jpeg';
  if (ct.includes('png')) return 'image/png';
  if (ct.includes('gif')) return 'image/gif';
  if (ct.includes('webp')) return 'image/webp';
  if (ct.includes('svg')) return 'image/svg+xml';

  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return map[String(ext || '').toLowerCase()] || 'image/png';
}

function bufferToDataUrl(buffer, sourceUrl, contentType = '') {
  let ext = '';
  if (/^https?:\/\//i.test(String(sourceUrl || ''))) {
    try {
      ext = path.extname(new URL(sourceUrl).pathname);
    } catch {
      ext = '';
    }
  } else {
    ext = path.extname(String(sourceUrl || ''));
  }
  const mime = mimeFromExt(ext, contentType);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function loadImageBuffer(imageUrl, baseDir) {
  const raw = String(imageUrl || '').trim();
  if (!raw) {
    throw new Error('图片地址为空');
  }

  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('无效的 data URL');
    return {
      buffer: Buffer.from(match[2], 'base64'),
      sourceUrl: raw,
      contentType: match[1],
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    const buf = await httpGetBuffer(raw);
    return { buffer: buf, sourceUrl: raw, contentType: '' };
  }

  const localPath = path.resolve(baseDir, raw.replace(/^\.\//, ''));
  if (!fs.existsSync(localPath)) {
    throw new Error(`本地图片不存在: ${raw}`);
  }
  const stat = fs.statSync(localPath);
  if (!stat.isFile()) throw new Error(`不是图片文件: ${raw}`);
  return { buffer: fs.readFileSync(localPath), sourceUrl: raw, contentType: '' };
}

async function embedImagesInMarkdown(markdown, baseDir) {
  const urls = collectImageUrls(markdown);
  let result = String(markdown || '');
  const embedded = [];
  const failed = [];

  for (const url of urls) {
    if (url.startsWith('data:')) continue;
    try {
      const { buffer, sourceUrl, contentType } = await loadImageBuffer(url, baseDir);
      const dataUrl = bufferToDataUrl(buffer, sourceUrl, contentType);
      result = result.split(url).join(dataUrl);
      embedded.push(url);
    } catch (err) {
      failed.push({ url, message: err.message });
    }
  }

  return { markdown: result, embedded, failed };
}

module.exports = {
  embedImagesInMarkdown,
  collectImageUrls,
  loadImageBuffer,
};
