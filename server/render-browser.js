let browserPromise = null;

async function getRenderBrowser() {
  if (!browserPromise) {
    const path = require('path');
    const puppeteer = require('puppeteer');
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    };
    const userData = process.env.MINI_TOOLS_USER_DATA;
    if (userData) {
      launchOpts.userDataDir = path.join(userData, 'puppeteer-profile');
    }
    browserPromise = puppeteer.launch(launchOpts);
  }
  return browserPromise;
}

async function closeRenderBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

module.exports = { getRenderBrowser, closeRenderBrowser };
