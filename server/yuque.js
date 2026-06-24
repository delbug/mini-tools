const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { sanitizeName } = require('./rename');
const { normalizeYuqueMarkdown } = require('./yuque-normalize');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeUrlInput(input) {
  let text = String(input || '').trim();
  if (!text) return text;
  // 从多行文本中提取第一个语雀链接
  const urlMatch = text.match(/https?:\/\/[^\s<>"']*yuque\.com[^\s<>"']*/i);
  if (urlMatch) {
    text = urlMatch[0].replace(/[)\]}>，。；、]+$/g, '');
  } else if (/yuque\.com/i.test(text) && !/^https?:\/\//i.test(text)) {
    text = `https://${text.replace(/^\/+/, '')}`;
  }
  return text;
}

function parseYuqueUrl(input) {
  const raw = normalizeUrlInput(input);
  if (!raw) throw new Error('链接不能为空');

  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    throw new Error('链接格式无效');
  }

  if (!url.hostname.includes('yuque.com')) {
    throw new Error('仅支持语雀 (yuque.com) 链接');
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts.length < 1) {
    throw new Error('链接格式无效');
  }

  const token = url.searchParams.get('token') || url.searchParams.get('share_token');
  const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
  const tokenMd = token ? `&token=${encodeURIComponent(token)}` : '';

  // 语雀分享链接：/docs/share/{shareId}
  if (parts[0] === 'docs' && parts[1] === 'share' && parts[2]) {
    return {
      linkType: 'share',
      shareId: parts[2],
      pathPrefix: null,
      bookSlug: null,
      docSlug: null,
      token,
      tokenSuffix,
      tokenMd,
      bookPageUrl: `https://www.yuque.com/docs/share/${parts[2]}${tokenSuffix}`,
    };
  }

  // 文档链接：/.../知识库/文档 ；知识库链接：/.../知识库
  const docSlug = parts.length >= 3 ? parts[parts.length - 1] : null;
  const pathPrefix = docSlug ? parts.slice(0, -1).join('/') : parts.join('/');
  const bookSlug = docSlug ? parts[parts.length - 2] : parts[parts.length - 1];

  return {
    linkType: docSlug ? 'doc' : 'book',
    shareId: null,
    pathPrefix,
    bookSlug,
    docSlug,
    token,
    tokenSuffix,
    tokenMd,
    bookPageUrl: `https://www.yuque.com/${pathPrefix}${tokenSuffix}`,
  };
}

function buildDocUrls(parsed, docSlug) {
  const basePath = `https://www.yuque.com/${parsed.pathPrefix}/${docSlug}`;
  return {
    pageUrl: `${basePath}${parsed.tokenSuffix}`,
    markdownUrl: `${basePath}/markdown?plain=true&linebreak=false&anchor=false${parsed.tokenMd}`,
  };
}

function bookFromAppData(appData) {
  if (!appData?.book?.toc?.length) return null;
  const toc = appData.book.toc;
  return {
    name: appData.book.name || '知识库',
    toc,
    docs: buildExportPlan(toc),
  };
}

function enrichParsedFromAppData(parsed, appData) {
  if (appData?.doc?.slug) {
    parsed.docSlug = appData.doc.slug;
    parsed.linkType = 'doc';
  }
  if (!parsed.pathPrefix && appData?.book?.slug) {
    const login = appData.group?.login || appData.book?.user?.login;
    if (login) {
      parsed.pathPrefix = `${login}/${appData.book.slug}`;
      parsed.bookSlug = appData.book.slug;
      parsed.bookPageUrl = `https://www.yuque.com/${parsed.pathPrefix}${parsed.tokenSuffix}`;
    }
  }
}

async function fetchBookFromHtmlCandidates(parsed) {
  const candidates = [];

  if (parsed.linkType === 'share' && parsed.shareId) {
    candidates.push(`https://www.yuque.com/docs/share/${parsed.shareId}${parsed.tokenSuffix}`);
  }

  if (parsed.docSlug && parsed.pathPrefix) {
    const base = `https://www.yuque.com/${parsed.pathPrefix}/${parsed.docSlug}`;
    candidates.push(`${base}${parsed.tokenSuffix}`);
    const singleDoc = parsed.token
      ? `${base}?singleDoc&token=${encodeURIComponent(parsed.token)}`
      : `${base}?singleDoc`;
    candidates.push(singleDoc);
    candidates.push(base);
  }

  if (parsed.pathPrefix && parsed.linkType === 'book') {
    candidates.push(parsed.bookPageUrl);
    candidates.push(`${parsed.bookPageUrl}${parsed.bookPageUrl.includes('?') ? '&' : '?'}singleDoc`);
  }

  const tried = new Set();
  let lastReason = '';

  for (const pageUrl of candidates) {
    if (!pageUrl || tried.has(pageUrl)) continue;
    tried.add(pageUrl);

    let html;
    try {
      html = await httpGet(pageUrl);
    } catch (err) {
      lastReason = `请求失败: ${err.message}`;
      continue;
    }

    const appData = extractAppData(html);
    if (!bookFromAppData(appData)) {
      lastReason = describeFetchFailure(appData, html);
    }

    enrichParsedFromAppData(parsed, appData);

    const book = bookFromAppData(appData);
    if (book?.docs.length) {
      return { parsed, book };
    }

    if (appData?.doc?.slug && parsed.pathPrefix) {
      try {
        const docHtml = await httpGet(buildDocUrls(parsed, appData.doc.slug).pageUrl);
        const docAppData = extractAppData(docHtml);
        enrichParsedFromAppData(parsed, docAppData);
        const bookInfo = bookFromAppData(docAppData);
        if (bookInfo?.docs.length) return { parsed, book: bookInfo };
        lastReason = describeFetchFailure(docAppData, docHtml);
      } catch (err) {
        lastReason = `文档页请求失败: ${err.message}`;
      }
    }
  }

  const linkHint = parsed.docSlug
    ? `已识别：/${parsed.pathPrefix}/${parsed.docSlug}`
    : parsed.pathPrefix
      ? `已识别：/${parsed.pathPrefix}（缺少文档段）`
      : parsed.shareId
        ? `已识别：/docs/share/${parsed.shareId}`
        : '未能识别链接结构';

  throw new Error(
    `无法读取知识库目录（${lastReason || '未知原因'}）。\n\n${linkHint}\n\n` +
    '分享链接模式需粘贴知识库内任意一篇文档的链接，格式类似：\n' +
    'https://www.yuque.com/用户/知识库/文档slug?singleDoc\n\n' +
    '若只有「用户/知识库」链接，请切换到「API Token」模式，填写 Token 后可直接用知识库链接批量导出。',
  );
}

function extractAppData(html) {
  const patterns = [
    /window\.appData = JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/,
    /window\.appData = JSON\.parse\(decodeURIComponent\('([^']+)'\)\)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      return JSON.parse(decodeURIComponent(match[1]));
    } catch {
      // try next pattern
    }
  }
  return null;
}

function describeFetchFailure(appData, html) {
  if (!appData) {
    if (/登录|login|password|密码/i.test(html)) return '需要登录或访问密码';
    return '页面未返回有效数据';
  }
  if (appData.matchCondition?.page === '404') return '页面不存在或未开启分享';
  if (appData.book && !(appData.book.toc || []).length) return '分享页未包含知识库目录';
  if (appData.book && !(appData.book.toc || []).some((i) => i.type === 'DOC')) {
    return '知识库目录中没有可导出的文档';
  }
  return '未能解析知识库目录';
}

function extractTitleFromHtml(html) {
  const appData = extractAppData(html);
  if (appData?.doc?.title) return appData.doc.title;
  const og = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (og) return og[1].replace(/\s*·\s*语雀\s*$/, '');
  return 'untitled';
}

function extractBookFromHtml(html) {
  const appData = extractAppData(html);
  if (!appData?.book) return null;
  const toc = appData.book.toc || [];
  const plan = buildExportPlan(toc);
  return {
    name: appData.book.name || '知识库',
    toc,
    docs: plan,
  };
}

function buildExportPlan(toc) {
  const titlePathByUuid = new Map();
  const plan = [];

  for (const item of toc) {
    if (item.type === 'TITLE') {
      const parentSegments = item.parent_uuid ? titlePathByUuid.get(item.parent_uuid) || [] : [];
      const segments = [...parentSegments, safeFileName(item.title || '未命名分组')];
      titlePathByUuid.set(item.uuid, segments);
    } else if (item.type === 'DOC' && item.url) {
      const dirSegments = item.parent_uuid ? titlePathByUuid.get(item.parent_uuid) || [] : [];
      plan.push({
        title: item.title || item.url,
        slug: item.url,
        dirSegments: [...dirSegments],
      });
    }
  }

  return plan;
}

function resolveDelayMs({ mode = 'fixed', fixedSec = 5, minSec = 3, maxSec = 30 } = {}) {
  if (mode === 'none') return 0;
  if (mode === 'fixed') {
    return Math.max(0, Number(fixedSec) || 0) * 1000;
  }
  const min = Math.max(0, Math.min(Number(minSec) || 0, Number(maxSec) || 0));
  const max = Math.max(Number(minSec) || 0, Number(maxSec) || 0);
  if (max <= min) return min * 1000;
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

function httpGet(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,*/*' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectCount > 5) return reject(new Error('重定向过多'));
          const next = new URL(res.headers.location, url).href;
          res.resume();
          resolve(httpGet(next, redirectCount + 1));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) {
            reject(new Error(`请求失败 HTTP ${res.statusCode}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('请求超时')));
  });
}

function httpGetBuffer(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': UA } },
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
            reject(new Error(`下载失败 HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('下载超时')));
  });
}

function uniqueDirPath(parentDir, baseName) {
  let candidate = path.join(parentDir, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  let i = 1;
  while (fs.existsSync(path.join(parentDir, `${baseName}_${i}`))) i += 1;
  return path.join(parentDir, `${baseName}_${i}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imagesFromMarkdown(md) {
  return [...md.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

function safeFileName(name) {
  const cleaned = sanitizeName(String(name || 'untitled'));
  return cleaned || 'untitled';
}

function uniqueFilePath(dir, baseName, ext = '.md') {
  let candidate = path.join(dir, `${baseName}${ext}`);
  if (!fs.existsSync(candidate)) return candidate;
  let i = 1;
  while (fs.existsSync(path.join(dir, `${baseName}_${i}${ext}`))) i += 1;
  return path.join(dir, `${baseName}_${i}${ext}`);
}

async function fetchYuqueMarkdown(docUrls) {
  const markdown = await httpGet(docUrls.markdownUrl);
  if (!markdown || markdown.trimStart().startsWith('<!doctype') || markdown.trimStart().startsWith('<!DOCTYPE')) {
    throw new Error('无法获取 Markdown，文档可能未公开或需要 token');
  }
  return markdown;
}

async function fetchYuqueBook(urlInput) {
  const parsed = parseYuqueUrl(urlInput);
  return fetchBookFromHtmlCandidates(parsed);
}

async function fetchYuqueDoc(urlInput) {
  const parsed = parseYuqueUrl(urlInput);
  if (!parsed.docSlug || !parsed.pathPrefix) {
    throw new Error('单篇导出需要文档级链接，格式：yuque.com/用户/知识库/文档');
  }
  const docUrls = buildDocUrls(parsed, parsed.docSlug);
  const [markdown, html] = await Promise.all([
    fetchYuqueMarkdown(docUrls),
    httpGet(docUrls.pageUrl),
  ]);
  const title = extractTitleFromHtml(html);
  const images = imagesFromMarkdown(markdown);
  return { title, markdown, images, parsed, docUrls };
}

function normalizeExportFormat(format, legacyConfluenceHtml) {
  const raw = String(format || '').trim().toLowerCase();
  if (raw === 'html' || raw === 'confluence') return 'html';
  if (raw === 'both' || raw === 'md+html' || raw === 'md_html') return 'both';
  if (raw === 'md' || raw === 'markdown') return 'md';
  if (legacyConfluenceHtml === true) return 'both';
  return 'md';
}

async function saveYuqueDocContent({
  title,
  markdown,
  images,
  saveDir,
  downloadImages: shouldDownloadImages = true,
  standardMarkdown = true,
  useDocFolder = false,
  exportFormat = 'md',
}) {
  const format = normalizeExportFormat(exportFormat);
  const docDir = useDocFolder ? uniqueDirPath(saveDir, safeFileName(title)) : saveDir;
  fs.mkdirSync(docDir, { recursive: true });

  let content = normalizeYuqueMarkdown(markdown, { standard: standardMarkdown });
  let downloadedImages = 0;
  if (shouldDownloadImages && images.length) {
    const dl = await downloadImages(content, docDir);
    content = dl.markdown;
    downloadedImages = dl.downloaded;
  }

  const baseName = safeFileName(title);
  let filePath = null;
  let htmlPath = null;

  if (format === 'md' || format === 'both') {
    filePath = uniqueFilePath(docDir, baseName);
    fs.writeFileSync(filePath, content, 'utf8');
  }

  if (format === 'html' || format === 'both') {
    const { writeConvertedFile } = require('./confluence');
    if (format === 'both' && filePath) {
      htmlPath = path.join(docDir, `${path.basename(filePath, '.md')}.html`);
    } else {
      htmlPath = uniqueFilePath(docDir, baseName, '.html');
    }
    await writeConvertedFile('html', content, title, htmlPath, docDir);
  }

  const primaryPath = htmlPath || filePath;

  return {
    title,
    fileName: path.basename(primaryPath),
    filePath: primaryPath,
    mdPath: filePath,
    mdFileName: filePath ? path.basename(filePath) : null,
    htmlPath,
    htmlFileName: htmlPath ? path.basename(htmlPath) : null,
    exportFormat: format,
    folderPath: useDocFolder ? docDir : null,
    imageCount: images.length,
    downloadedImages: shouldDownloadImages ? downloadedImages : 0,
    charCount: content.length,
  };
}

async function exportYuqueDocBySlug(parsed, docSlug, docTitle, saveDir, options) {
  const docUrls = buildDocUrls(parsed, docSlug);
  const [markdown, html] = await Promise.all([
    fetchYuqueMarkdown(docUrls),
    httpGet(docUrls.pageUrl),
  ]);
  const title = docTitle || extractTitleFromHtml(html);
  const images = imagesFromMarkdown(markdown);
  return saveYuqueDocContent({
    title,
    markdown,
    images,
    saveDir,
    ...options,
  });
}

async function downloadImages(markdown, saveDir, assetsDirName = 'assets') {
  const assetsDir = path.join(saveDir, assetsDirName);
  fs.mkdirSync(assetsDir, { recursive: true });

  let result = markdown;
  let downloaded = 0;
  const urls = [...new Set(imagesFromMarkdown(markdown))];

  for (const imgUrl of urls) {
    try {
      const buf = await httpGetBuffer(imgUrl);
      const parsed = new URL(imgUrl);
      let ext = path.extname(parsed.pathname);
      if (!ext || ext.length > 6) ext = '.png';
      const hash = crypto.createHash('md5').update(imgUrl).digest('hex').slice(0, 8);
      const fileName = `${hash}${ext}`;
      fs.writeFileSync(path.join(assetsDir, fileName), buf);
      const localRef = `${assetsDirName}/${fileName}`;
      result = result.split(imgUrl).join(localRef);
      downloaded += 1;
    } catch {
      // 单张图片失败不影响整体导出
    }
  }

  return { markdown: result, downloaded };
}

async function exportYuqueDoc({
  url,
  saveDir,
  downloadImages: shouldDownloadImages = true,
  standardMarkdown = true,
  useDocFolder = false,
  exportFormat = 'md',
}) {
  const resolvedDir = path.resolve(String(saveDir || '').trim());
  if (!resolvedDir) throw new Error('保存目录不能为空');
  if (!fs.existsSync(resolvedDir)) throw new Error(`保存目录不存在: ${resolvedDir}`);
  const stat = fs.statSync(resolvedDir);
  if (!stat.isDirectory()) throw new Error(`不是文件夹: ${resolvedDir}`);

  const { title, markdown, images } = await fetchYuqueDoc(url);
  return saveYuqueDocContent({
    title,
    markdown,
    images,
    saveDir: resolvedDir,
    downloadImages: shouldDownloadImages,
    standardMarkdown,
    useDocFolder,
    exportFormat,
  });
}

async function exportYuqueBatch({
  url,
  saveDir,
  resume = true,
  progress: existingProgress = null,
  downloadImages: shouldDownloadImages = true,
  standardMarkdown = true,
  exportFormat = 'md',
  delayMode = 'fixed',
  delayFixedSec = 5,
  delayMinSec = 3,
  delayMaxSec = 30,
}) {
  const { runYuqueBatchExport } = require('./yuque-progress');
  const { parsed, book } = await fetchYuqueBook(url);
  const delayOpts = { mode: delayMode, fixedSec: delayFixedSec, minSec: delayMinSec, maxSec: delayMaxSec };

  const result = await runYuqueBatchExport({
    url,
    saveDir,
    authMode: 'share',
    namespace: parsed.pathPrefix,
    book,
    resume,
    existingProgress,
    delayOpts,
    exportOneDoc: (doc, targetDir) => exportYuqueDocBySlug(parsed, doc.slug, doc.title, targetDir, {
      downloadImages: shouldDownloadImages,
      standardMarkdown,
      useDocFolder: true,
      exportFormat,
    }),
  });

  result.authMode = 'share';
  result.success = result.success.map((item) => ({
    ...item,
    relativePath: path.relative(result.bookDir, item.folderPath || item.filePath),
  }));
  return result;
}

module.exports = {
  parseYuqueUrl,
  fetchYuqueDoc,
  fetchYuqueBook,
  exportYuqueDoc,
  exportYuqueBatch,
  saveYuqueDocContent,
  normalizeExportFormat,
  normalizeYuqueMarkdown,
  buildExportPlan,
  resolveDelayMs,
  sleep,
  imagesFromMarkdown,
};
