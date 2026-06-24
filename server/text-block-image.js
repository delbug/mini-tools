const { getRenderBrowser } = require('./render-browser');
const { scaleToMaxWidth } = require('./mermaid-image');

const MAX_RENDER_WIDTH = 720;
const MAX_RENDER_HEIGHT = 10000;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildBlockHtml(content, options = {}) {
  const { label = '', kind = 'code' } = options;
  const safe = escapeHtml(String(content || ''));
  const badge = label ? `<span class="badge">${escapeHtml(label)}</span>` : '';
  const blockClass = kind === 'diagram' ? 'block diagram' : 'block code';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body { padding: 12px; }
    .wrap { display: inline-block; max-width: ${MAX_RENDER_WIDTH}px; }
    .badge {
      display: inline-block;
      margin-bottom: 8px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #ebecf0;
      color: #5e6c84;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .block {
      margin: 0;
      padding: 14px 16px;
      border: 1px solid #dfe1e6;
      border-radius: 8px;
      background: #f4f5f7;
      color: #172b4d;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace;
    }
    .block.diagram {
      background: #fff;
      letter-spacing: 0;
    }
  </style>
</head>
<body>
  <div class="wrap" id="wrap">
    ${badge}
    <pre class="${blockClass}" id="block">${safe}</pre>
  </div>
</body>
</html>`;
}

async function renderTextBlockToPng(content, options = {}) {
  const browser = await getRenderBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: MAX_RENDER_WIDTH + 48, height: 600, deviceScaleFactor: 2 });
    await page.setContent(buildBlockHtml(content, options), { waitUntil: 'domcontentloaded', timeout: 30000 });

    const size = await page.evaluate(() => {
      const wrap = document.getElementById('wrap');
      const block = document.getElementById('block');
      const rect = wrap.getBoundingClientRect();
      return {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scrollHeight: Math.ceil(block.scrollHeight + (wrap.offsetHeight - block.offsetHeight)),
      };
    });

    const height = Math.min(Math.max(size.height, 40), MAX_RENDER_HEIGHT);
    await page.setViewport({
      width: Math.min(size.width + 32, MAX_RENDER_WIDTH + 48),
      height: height + 24,
      deviceScaleFactor: 2,
    });

    const buffer = Buffer.from(await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: Math.min(size.width + 24, MAX_RENDER_WIDTH + 48),
        height: height + 12,
      },
    }));

    const dim = scaleToMaxWidth(size.width, height, 620);
    return { buffer, format: 'png', ...dim };
  } finally {
    await page.close();
  }
}

module.exports = { renderTextBlockToPng, buildBlockHtml };
