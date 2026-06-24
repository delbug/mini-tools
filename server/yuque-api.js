const https = require('https');
const { URL } = require('url');
const path = require('path');
const { buildExportPlan, parseYuqueUrl, sleep, saveYuqueDocContent, imagesFromMarkdown } = require('./yuque');

const UA = 'deskit-yuque-exporter';

function isRateLimitError(statusCode, json) {
  const msg = String(json?.message || '');
  return statusCode === 429
    || json?.status === 429
    || /too many/i.test(msg);
}

function apiRequestOnce(token, apiPath, query = {}) {
  const url = new URL(`https://www.yuque.com/api/v2${apiPath}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'X-Auth-Token': token,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            reject(new Error(`API 响应非 JSON (HTTP ${res.statusCode})`));
            return;
          }
          if (res.statusCode === 401 || json.status === 401) {
            reject(new Error('Token 无效或已过期，请在语雀「设置 → Token」重新生成'));
            return;
          }
          if (res.statusCode === 403 || json.status === 403) {
            reject(new Error('Token 无权访问该知识库'));
            return;
          }
          if (isRateLimitError(res.statusCode, json)) {
            const err = new Error(json.message || 'Too Many Requests');
            err.code = 'RATE_LIMIT';
            err.statusCode = 429;
            reject(err);
            return;
          }
          if (res.statusCode >= 400 || (json.status && json.status >= 400)) {
            reject(new Error(json.message || `API 错误 HTTP ${res.statusCode}`));
            return;
          }
          resolve(json.data !== undefined ? json.data : json);
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('API 请求超时')));
  });
}

async function apiRequest(token, apiPath, query = {}, retryCount = 0) {
  try {
    return await apiRequestOnce(token, apiPath, query);
  } catch (err) {
    if (err.code !== 'RATE_LIMIT' || retryCount >= 5) {
      if (err.code === 'RATE_LIMIT') {
        throw new Error('语雀 API 请求过于频繁 (Too Many Requests)，请等待 5~10 分钟后再试');
      }
      throw err;
    }
    const waitSec = Math.min(90, 8 * (retryCount + 1));
    await sleep(waitSec * 1000);
    return apiRequest(token, apiPath, query, retryCount + 1);
  }
}

function namespaceFromParsed(parsed) {
  if (parsed.pathPrefix) return parsed.pathPrefix;
  throw new Error('无法识别知识库路径，请粘贴形如 yuque.com/用户/知识库 的链接');
}

async function fetchYuqueBookByApi(token, urlInput) {
  const parsed = parseYuqueUrl(urlInput);
  const namespace = namespaceFromParsed(parsed);
  const nsPath = namespace.split('/').map(encodeURIComponent).join('/');
  const [toc, bookInfo] = await Promise.all([
    apiRequest(token, `/repos/${nsPath}/toc`),
    apiRequest(token, `/repos/${nsPath}`).catch(() => null),
  ]);

  const plan = buildExportPlan(Array.isArray(toc) ? toc : []);
  if (!plan.length) {
    throw new Error('API 返回的知识库目录为空，请确认 Token 有该知识库权限');
  }

  return {
    parsed: { ...parsed, pathPrefix: namespace },
    book: {
      name: bookInfo?.name || namespace.split('/').pop() || '知识库',
      toc,
      docs: plan,
    },
  };
}

async function fetchDocMarkdownByApi(token, namespace, slug) {
  const nsPath = namespace.split('/').map(encodeURIComponent).join('/');
  const data = await apiRequest(token, `/repos/${nsPath}/docs/${encodeURIComponent(slug)}`, {
    raw: 1,
  });
  if (typeof data === 'string') return data;
  if (data?.body) return data.body;
  if (data?.content) return data.content;
  throw new Error(`无法获取文档正文: ${slug}`);
}

async function exportYuqueBatchByApi({
  token,
  url,
  saveDir,
  resume = true,
  progress: existingProgress = null,
  downloadImages: shouldDownloadImages = true,
  standardMarkdown = true,
  exportFormat = 'md',
  delayMode = 'random',
  delayFixedSec = 5,
  delayMinSec = 3,
  delayMaxSec = 30,
}) {
  const { runYuqueBatchExport } = require('./yuque-progress');
  const resolvedDir = path.resolve(String(saveDir || '').trim());
  if (!token) throw new Error('请填写语雀 Token');

  const { parsed, book } = await fetchYuqueBookByApi(token, url);
  const namespace = parsed.pathPrefix;
  const delayOpts = { mode: delayMode, fixedSec: delayFixedSec, minSec: delayMinSec, maxSec: delayMaxSec };

  const result = await runYuqueBatchExport({
    url,
    saveDir: resolvedDir,
    authMode: 'token',
    namespace,
    book,
    resume,
    existingProgress,
    delayOpts,
    exportOneDoc: async (doc, targetDir) => {
      const rawMd = await fetchDocMarkdownByApi(token, namespace, doc.slug);
      return saveYuqueDocContent({
        title: doc.title,
        markdown: rawMd,
        images: imagesFromMarkdown(rawMd),
        saveDir: targetDir,
        downloadImages: shouldDownloadImages,
        standardMarkdown,
        useDocFolder: true,
        exportFormat,
      });
    },
  });

  result.authMode = 'token';
  result.success = result.success.map((item) => ({
    ...item,
    relativePath: path.relative(result.bookDir, item.folderPath || item.filePath),
  }));
  return result;
}

module.exports = {
  fetchYuqueBookByApi,
  exportYuqueBatchByApi,
};
