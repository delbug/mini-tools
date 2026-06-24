const { convertMarkdownToConfluenceHtml } = require('./markdown-to-confluence');

const { getRenderBrowser, closeRenderBrowser } = require('./render-browser');

async function waitForMermaid(page, timeoutMs = 45000) {
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll('.mermaid');
    if (!nodes.length) return true;
    return Array.from(nodes).every((node) => node.querySelector('svg'));
  }, { timeout: timeoutMs }).catch(() => {});
}

async function convertMarkdownToPdf(markdown, options = {}) {
  const { title = '文档' } = options;
  const html = convertMarkdownToConfluenceHtml(markdown, { title, wrapDocument: true });
  const browser = await getRenderBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await waitForMermaid(page);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

async function closePdfBrowser() {
  return closeRenderBrowser();
}

module.exports = { convertMarkdownToPdf, closePdfBrowser };
