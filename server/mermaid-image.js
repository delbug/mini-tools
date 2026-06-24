/**
 * 将 Mermaid 源码渲染为 PNG/JPEG（用于 Word / Confluence 粘贴）。
 * mermaid.ink 要求 URL 段使用 URL-safe Base64 或 pako 压缩，否则含 `/` 的编码会 404。
 */

const zlib = require('zlib');
const { formatMermaidSource } = require('./markdown-to-confluence');

function normalizeMermaidSource(source) {
  return formatMermaidSource(String(source || ''));
}

function toUrlSafeBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toPakoPayload(code) {
  const payload = JSON.stringify({
    code,
    mermaid: {
      theme: 'neutral',
      securityLevel: 'loose',
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: 'basis' },
    },
  });
  const compressed = zlib.deflateSync(Buffer.from(payload, 'utf8'));
  return compressed.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function imageDimensions(buffer) {
  if (!buffer || buffer.length < 24) {
    return { width: 600, height: 360 };
  }
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16) || 600,
      height: buffer.readUInt32BE(20) || 360,
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { width: 900, height: 540 };
  }
  return { width: 600, height: 360 };
}

function scaleToMaxWidth(width, height, maxWidth = 620) {
  if (width <= maxWidth) return { width, height };
  const ratio = maxWidth / width;
  return { width: maxWidth, height: Math.round(height * ratio) };
}

function detectImageFormat(buffer) {
  if (!buffer || !buffer.length) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'jpg';
  }
  return null;
}

function buildMermaidInkUrls(code) {
  const normalized = normalizeMermaidSource(code);
  const query = 'type=png&width=1400&scale=2&bgColor=!white';
  return [
    `https://mermaid.ink/img/pako:${toPakoPayload(normalized)}?${query}`,
    `https://mermaid.ink/img/${toUrlSafeBase64(normalized)}?${query}`,
  ];
}

async function fetchMermaidPng(source) {
  const urls = buildMermaidInkUrls(source);
  let lastError = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) {
        lastError = new Error('空响应');
        continue;
      }
      const format = detectImageFormat(buffer);
      if (!format) {
        lastError = new Error('非 PNG/JPEG 图片');
        continue;
      }
      const dim = scaleToMaxWidth(imageDimensions(buffer).width, imageDimensions(buffer).height);
      return { buffer, format, ...dim };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Mermaid 图片渲染失败');
}

module.exports = {
  fetchMermaidPng,
  buildMermaidInkUrls,
  normalizeMermaidSource,
  scaleToMaxWidth,
  imageDimensions,
};
