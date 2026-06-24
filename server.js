const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execFileSync } = require('child_process');
const { DEFAULT_CONFIG } = require('./server/config');
const {
  buildRenamePlan,
  executeRenamePlan,
  findDuplicates,
  sanitizeName,
} = require('./server/rename');
const { fetchYuqueDoc, fetchYuqueBook, exportYuqueDoc, exportYuqueBatch, normalizeExportFormat } = require('./server/yuque');
const { fetchYuqueBookByApi, exportYuqueBatchByApi } = require('./server/yuque-api');
const { getExportProgressSummary } = require('./server/yuque-progress');
const { batchConvertMarkdown, previewMarkdownFile, listMarkdownFiles } = require('./server/confluence');
const { startOnAvailablePort, clearPortFile, DEFAULT_PORT } = require('./server/port');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
let listenPort = DEFAULT_PORT;

const DEFAULT_IGNORE = new Set([
  '.DS_Store',
  '.git',
  '.stignore',
  'node_modules',
  '.sync-state.json',
]);

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}

function resolveSafeDir(inputPath) {
  const resolved = path.resolve(String(inputPath || '').trim());
  if (!resolved) throw new Error('路径不能为空');
  if (!fs.existsSync(resolved)) throw new Error(`目录不存在: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`不是文件夹: ${resolved}`);
  return resolved;
}

function shouldIgnore(name, extraIgnore = []) {
  if (DEFAULT_IGNORE.has(name)) return true;
  if (name.startsWith('.')) return false;
  return extraIgnore.some((p) => name.includes(p));
}

function walkFiles(root, extraIgnore = []) {
  const files = new Map();
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (shouldIgnore(ent.name, extraIgnore)) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full);
          files.set(rel, {
            relativePath: rel,
            absolutePath: full,
            size: st.size,
            mtime: st.mtimeMs,
          });
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  walk(root);
  return files;
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function hashFiles(fileMap, onProgress) {
  const result = new Map();
  const entries = [...fileMap.entries()];
  let done = 0;
  for (const [rel, meta] of entries) {
    try {
      const hash = await md5File(meta.absolutePath);
      result.set(rel, { ...meta, md5: hash });
    } catch {
      result.set(rel, { ...meta, md5: null, error: '无法读取' });
    }
    done += 1;
    if (onProgress && done % 50 === 0) onProgress(done, entries.length);
  }
  return result;
}

function classifyEntry(relativePath, folderMaps, folderIds, mode, primaryId) {
  const presence = {};
  const sizes = {};
  const md5s = {};
  const mtimes = {};

  for (const id of folderIds) {
    const info = folderMaps[id]?.get(relativePath);
    presence[id] = !!info;
    sizes[id] = info?.size ?? null;
    md5s[id] = info?.md5 ?? null;
    mtimes[id] = info?.mtime ?? null;
  }

  const presentIds = folderIds.filter((id) => presence[id]);
  const count = presentIds.length;

  let status = 'identical';
  if (count === 0) status = 'unknown';
  else if (count < folderIds.length) status = 'missing';
  else if (mode === 'md5') {
    const hashes = presentIds.map((id) => md5s[id]).filter(Boolean);
    const unique = new Set(hashes);
    status = unique.size <= 1 ? 'identical' : 'content-diff';
  } else {
    status = 'identical';
  }

  if (count === 1) {
    status = `only-${presentIds[0]}`;
  }

  const primaryHas = presence[primaryId];
  const secondaryMissing = folderIds.some((id) => id !== primaryId && !presence[id]);
  const primaryOnly = primaryHas && folderIds.some((id) => id !== primaryId && !presence[id]);
  const secondaryOnly = !primaryHas && presentIds.length > 0;

  return {
    relativePath,
    status,
    presence,
    sizes,
    md5s,
    mtimes,
    presentCount: count,
    primaryHas,
    primaryOnly,
    secondaryOnly,
    presentIds,
  };
}

function detectRelocated(entries, folderMaps, folderIds, mode, primaryId) {
  if (mode !== 'md5') return { entries, relocatedCount: 0 };

  const byMd5 = new Map();
  for (const id of folderIds) {
    for (const [rel, info] of folderMaps[id]) {
      if (!info?.md5) continue;
      if (!byMd5.has(info.md5)) byMd5.set(info.md5, []);
      byMd5.get(info.md5).push({ folderId: id, relativePath: rel, info });
    }
  }

  const removeKeys = new Set();
  const newEntries = [];

  for (const [md5, locations] of byMd5) {
    const pathsByFolder = {};
    let ambiguous = false;
    for (const loc of locations) {
      if (pathsByFolder[loc.folderId] !== undefined && pathsByFolder[loc.folderId] !== loc.relativePath) {
        ambiguous = true;
        break;
      }
      pathsByFolder[loc.folderId] = loc.relativePath;
    }
    if (ambiguous) continue;

    const validPaths = Object.entries(pathsByFolder);
    const uniquePaths = new Set(validPaths.map(([, p]) => p));
    if (validPaths.length < 2 || uniquePaths.size <= 1) continue;

    for (const [fid, p] of validPaths) removeKeys.add(`${fid}:${p}`);

    const displayPath = pathsByFolder[primaryId] || validPaths[0][1];
    const presence = {};
    const sizes = {};
    const md5s = {};
    const mtimes = {};
    for (const id of folderIds) {
      const p = pathsByFolder[id];
      if (p && folderMaps[id].has(p)) {
        const info = folderMaps[id].get(p);
        presence[id] = true;
        sizes[id] = info.size ?? null;
        md5s[id] = info.md5 ?? null;
        mtimes[id] = info.mtime ?? null;
      } else {
        presence[id] = false;
        sizes[id] = null;
        md5s[id] = null;
        mtimes[id] = null;
      }
    }

    newEntries.push({
      relativePath: displayPath,
      status: 'relocated',
      pathsByFolder,
      md5,
      presence,
      sizes,
      md5s,
      mtimes,
      presentCount: validPaths.length,
      primaryHas: !!pathsByFolder[primaryId],
      primaryOnly: false,
      secondaryOnly: false,
      presentIds: validPaths.map(([fid]) => fid),
    });
  }

  const filtered = entries.filter((e) => {
    for (const id of folderIds) {
      if (e.presence[id] && removeKeys.has(`${id}:${e.relativePath}`)) return false;
    }
    return true;
  });

  const merged = [...filtered, ...newEntries].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, 'zh-CN'),
  );
  return { entries: merged, relocatedCount: newEntries.length };
}

async function compareFolders(folders, mode = 'md5', ignorePatterns = []) {
  const folderIds = folders.map((f) => f.id);
  const folderMaps = {};
  const folderMeta = {};

  for (const folder of folders) {
    const root = resolveSafeDir(folder.path);
    const raw = walkFiles(root, ignorePatterns);
    folderMeta[folder.id] = {
      id: folder.id,
      path: root,
      label: folder.label || path.basename(root),
      isPrimary: !!folder.isPrimary,
      fileCount: raw.size,
    };
    folderMaps[folder.id] = mode === 'md5' ? await hashFiles(raw) : raw;
  }

  const primary = folders.find((f) => f.isPrimary) || folders[0];
  const primaryId = primary.id;

  const allPaths = new Set();
  for (const id of folderIds) {
    for (const rel of folderMaps[id].keys()) allPaths.add(rel);
  }

  let entryList = [];
  const stats = {
    total: 0,
    identical: 0,
    missing: 0,
    contentDiff: 0,
    relocated: 0,
    onlyIn: {},
  };
  for (const id of folderIds) stats.onlyIn[id] = 0;

  for (const rel of [...allPaths].sort()) {
    entryList.push(classifyEntry(rel, folderMaps, folderIds, mode, primaryId));
  }

  const relocatedResult = detectRelocated(entryList, folderMaps, folderIds, mode, primaryId);
  entryList = relocatedResult.entries;
  stats.relocated = relocatedResult.relocatedCount;

  for (const entry of entryList) {
    stats.total += 1;
    if (entry.status === 'identical') stats.identical += 1;
    else if (entry.status === 'missing') stats.missing += 1;
    else if (entry.status === 'content-diff') stats.contentDiff += 1;
    else if (entry.status === 'relocated') { /* counted separately */ }
    else if (entry.status.startsWith('only-')) {
      const fid = entry.status.slice(5);
      stats.onlyIn[fid] = (stats.onlyIn[fid] || 0) + 1;
    }
  }

  return {
    mode,
    primaryId,
    folders: folderMeta,
    entries: entryList,
    stats,
  };
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFileSafe(src, dst) {
  ensureDirForFile(dst);
  fs.copyFileSync(src, dst);
}

function deleteFileSafe(root, relativePath) {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) return { ok: false, reason: '文件不存在' };
  fs.unlinkSync(full);
  return { ok: true };
}

function moveFileSafe(fromRoot, toRoot, relativePath, targetRelativePath) {
  const src = path.join(fromRoot, relativePath);
  const dst = path.join(toRoot, targetRelativePath || relativePath);
  if (!fs.existsSync(src)) throw new Error(`源文件不存在: ${relativePath}`);
  ensureDirForFile(dst);
  fs.renameSync(src, dst);
  return dst;
}

function syncPrimaryOverwrite(primaryRoot, targetRoot, relativePaths = null, deleteExtra = true) {
  const copied = [];
  const deleted = [];
  const errors = [];

  const primaryFiles = walkFiles(primaryRoot);
  const targetFiles = walkFiles(targetRoot);

  const toCopy = relativePaths
    ? relativePaths.filter((p) => primaryFiles.has(p))
    : [...primaryFiles.keys()];

  for (const rel of toCopy) {
    try {
      const src = primaryFiles.get(rel).absolutePath;
      const dst = path.join(targetRoot, rel);
      copyFileSafe(src, dst);
      copied.push(rel);
    } catch (err) {
      errors.push({ path: rel, message: err.message });
    }
  }

  if (deleteExtra && !relativePaths) {
    for (const rel of targetFiles.keys()) {
      if (!primaryFiles.has(rel)) {
        try {
          fs.unlinkSync(path.join(targetRoot, rel));
          deleted.push(rel);
        } catch (err) {
          errors.push({ path: rel, message: `删除失败: ${err.message}` });
        }
      }
    }
  } else if (deleteExtra && relativePaths) {
    for (const rel of relativePaths) {
      if (targetFiles.has(rel) && !primaryFiles.has(rel)) {
        try {
          fs.unlinkSync(path.join(targetRoot, rel));
          deleted.push(rel);
        } catch (err) {
          errors.push({ path: rel, message: `删除失败: ${err.message}` });
        }
      }
    }
  }

  return { copied, deleted, errors };
}

function syncUnion(folderRoots, primaryRoot, relativePaths = null) {
  const copied = [];
  const errors = [];
  const folderIds = Object.keys(folderRoots);

  const allMaps = {};
  for (const [id, root] of Object.entries(folderRoots)) {
    allMaps[id] = walkFiles(root);
  }

  const paths = relativePaths
    ? relativePaths
    : [...new Set(folderIds.flatMap((id) => [...allMaps[id].keys()]))];

  for (const rel of paths) {
    const holders = folderIds.filter((id) => allMaps[id].has(rel));
    if (holders.length === 0) continue;

    const primaryKey = Object.entries(folderRoots).find(([, r]) => r === primaryRoot)?.[0];
    let sourceId = primaryKey && holders.includes(primaryKey) ? primaryKey : holders[0];
    if (!primaryKey || !holders.includes(primaryKey)) {
      if (holders.length > 1) {
        sourceId = holders.reduce((best, id) => {
          const m = allMaps[id].get(rel)?.mtime || 0;
          const bm = allMaps[best].get(rel)?.mtime || 0;
          return m > bm ? id : best;
        }, holders[0]);
      }
    }

    const src = allMaps[sourceId].get(rel).absolutePath;
    for (const id of folderIds) {
      if (id === sourceId) continue;
      if (allMaps[id].has(rel)) continue;
      try {
        copyFileSafe(src, path.join(folderRoots[id], rel));
        copied.push({ path: rel, to: folderRoots[id], from: folderRoots[sourceId] });
      } catch (err) {
        errors.push({ path: rel, message: err.message });
      }
    }
  }

  return { copied, errors };
}

function syncSelected({ sourceRoot, targetRoot, relativePaths, overwrite = true }) {
  const copied = [];
  const skipped = [];
  const errors = [];

  for (const rel of relativePaths) {
    const src = path.join(sourceRoot, rel);
    const dst = path.join(targetRoot, rel);
    try {
      if (!fs.existsSync(src)) {
        skipped.push({ path: rel, reason: '源不存在' });
        continue;
      }
      if (fs.existsSync(dst) && !overwrite) {
        skipped.push({ path: rel, reason: '目标已存在' });
        continue;
      }
      copyFileSafe(src, dst);
      copied.push(rel);
    } catch (err) {
      errors.push({ path: rel, message: err.message });
    }
  }

  return { copied, skipped, errors };
}

function classifyFileAction(srcMeta, dstMeta) {
  if (!dstMeta) return 'copy';
  if (srcMeta.size !== dstMeta.size || Math.abs(srcMeta.mtime - dstMeta.mtime) > 1000) {
    return 'overwrite';
  }
  return 'skip';
}

function previewPrimaryOverwrite(primaryRoot, targetRoot, targetLabel, relativePaths, deleteExtra) {
  const operations = [];
  const primaryFiles = walkFiles(primaryRoot);
  const targetFiles = walkFiles(targetRoot);

  const toProcess = relativePaths?.length
    ? relativePaths.filter((p) => primaryFiles.has(p))
    : [...primaryFiles.keys()];

  for (const rel of toProcess) {
    const src = primaryFiles.get(rel);
    const dst = targetFiles.get(rel);
    const action = classifyFileAction(src, dst);
    if (action === 'skip') continue;
    operations.push({
      action,
      relativePath: rel,
      targetLabel,
      detail: action === 'copy' ? '复制到目标' : '覆盖目标文件',
    });
  }

  if (deleteExtra && !relativePaths?.length) {
    for (const rel of targetFiles.keys()) {
      if (!primaryFiles.has(rel)) {
        operations.push({
          action: 'delete',
          relativePath: rel,
          targetLabel,
          detail: '从目标删除（主文件夹无此文件）',
        });
      }
    }
  }

  return operations;
}

function previewUnion(folderRoots, folderLabels, primaryRoot, relativePaths) {
  const operations = [];
  const folderIds = Object.keys(folderRoots);
  const allMaps = {};
  for (const [id, root] of Object.entries(folderRoots)) {
    allMaps[id] = walkFiles(root);
  }

  const paths = relativePaths?.length
    ? relativePaths
    : [...new Set(folderIds.flatMap((id) => [...allMaps[id].keys()]))];

  for (const rel of paths) {
    const holders = folderIds.filter((id) => allMaps[id].has(rel));
    if (holders.length === 0) continue;
    if (holders.length === folderIds.length) continue;

    const primaryKey = Object.entries(folderRoots).find(([, r]) => r === primaryRoot)?.[0];
    let sourceId = primaryKey && holders.includes(primaryKey) ? primaryKey : holders[0];
    const src = allMaps[sourceId].get(rel).absolutePath;

    for (const id of folderIds) {
      if (holders.includes(id)) continue;
      operations.push({
        action: 'copy',
        relativePath: rel,
        targetLabel: folderLabels[id],
        detail: `从 ${folderLabels[sourceId]} 复制缺失文件`,
      });
    }
  }
  return operations;
}

function previewSelected(sourceRoot, targetRoot, sourceLabel, targetLabel, relativePaths) {
  const operations = [];
  const sourceFiles = walkFiles(sourceRoot);
  const targetFiles = walkFiles(targetRoot);

  for (const rel of relativePaths) {
    if (!sourceFiles.has(rel)) {
      operations.push({ action: 'skip', relativePath: rel, targetLabel, detail: '源不存在，跳过' });
      continue;
    }
    const action = classifyFileAction(sourceFiles.get(rel), targetFiles.get(rel));
    if (action === 'skip') {
      operations.push({ action: 'skip', relativePath: rel, targetLabel, detail: '已相同，跳过' });
      continue;
    }
    operations.push({
      action,
      relativePath: rel,
      targetLabel,
      detail: `${action === 'copy' ? '复制' : '覆盖'} → ${targetLabel}`,
    });
  }
  return operations;
}

function previewSync({ strategy, folders, relativePaths, deleteExtra, sourceFolderId, targetFolderId }) {
  const primary = folders.find((f) => f.isPrimary) || folders[0];
  const primaryRoot = resolveSafeDir(primary.path);
  const paths = relativePaths?.length ? relativePaths : null;
  const allOperations = [];

  const labels = Object.fromEntries(folders.map((f) => [f.id, f.label || path.basename(f.path)]));

  if (strategy === 'primary-overwrite') {
    for (const sec of folders.filter((f) => f.id !== primary.id)) {
      const targetRoot = resolveSafeDir(sec.path);
      allOperations.push(
        ...previewPrimaryOverwrite(primaryRoot, targetRoot, labels[sec.id], paths, deleteExtra),
      );
    }
  } else if (strategy === 'union') {
    const folderRoots = Object.fromEntries(folders.map((f) => [f.id, resolveSafeDir(f.path)]));
    allOperations.push(...previewUnion(folderRoots, labels, primaryRoot, paths));
  } else if (strategy === 'selected') {
    const src = folders.find((f) => f.id === sourceFolderId);
    const tgt = folders.find((f) => f.id === targetFolderId);
    if (!src || !tgt) throw new Error('文件夹 ID 无效');
    allOperations.push(
      ...previewSelected(
        resolveSafeDir(src.path),
        resolveSafeDir(tgt.path),
        labels[src.id],
        labels[tgt.id],
        paths || [],
      ),
    );
  } else {
    throw new Error('未知同步策略');
  }

  const summary = {
    copy: allOperations.filter((o) => o.action === 'copy').length,
    overwrite: allOperations.filter((o) => o.action === 'overwrite').length,
    delete: allOperations.filter((o) => o.action === 'delete').length,
    skip: allOperations.filter((o) => o.action === 'skip').length,
    total: allOperations.filter((o) => o.action !== 'skip').length,
  };

  return { operations: allOperations, summary };
}

function pickFolderMacOS() {
  const script = 'POSIX path of (choose folder with prompt "选择文件夹")';
  try {
    const output = execFileSync('osascript', ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!output) return { cancelled: true };
    const normalized = output.endsWith('/') ? output.slice(0, -1) : output;
    return { cancelled: false, path: normalized, name: path.basename(normalized) };
  } catch (err) {
    const msg = String(err.stderr || err.message || '');
    if (msg.includes('User canceled') || err.status === 1) return { cancelled: true };
    throw new Error('无法打开系统文件夹选择器');
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${listenPort}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
    const staticPath = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (serveStatic(res, staticPath)) return;
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      serveStatic(res, indexPath);
      return;
    }
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端未构建，请先运行 npm run dev 或 npm run build');
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        version: 1,
        port: listenPort,
        features: ['compare', 'sync', 'sync-preview', 'delete', 'move', 'pick-folder', 'rename', 'favorites', 'duplicates', 'yuque', 'confluence', 'config'],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/pick-folder') {
      if (process.platform !== 'darwin') {
        sendJson(res, 400, { ok: false, message: '系统选择器目前仅支持 macOS' });
        return;
      }
      const result = pickFolderMacOS();
      if (result.cancelled) {
        sendJson(res, 200, { ok: false, cancelled: true });
        return;
      }
      sendJson(res, 200, { ok: true, path: result.path, name: result.name });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/compare') {
      const body = await parseBody(req);
      const { folders = [], mode = 'md5', ignorePatterns = [] } = body;
      if (!Array.isArray(folders) || folders.length < 2) {
        sendJson(res, 400, { ok: false, message: '请至少添加 2 个文件夹' });
        return;
      }
      const hasPrimary = folders.some((f) => f.isPrimary);
      if (!hasPrimary) folders[0].isPrimary = true;
      const result = await compareFolders(folders, mode, ignorePatterns);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sync/preview') {
      const body = await parseBody(req);
      const {
        strategy = 'primary-overwrite',
        folders = [],
        relativePaths = [],
        deleteExtra = true,
        sourceFolderId,
        targetFolderId,
      } = body;

      if (folders.length < 2) {
        sendJson(res, 400, { ok: false, message: '请至少 2 个文件夹' });
        return;
      }

      const result = previewSync({
        strategy,
        folders,
        relativePaths,
        deleteExtra,
        sourceFolderId,
        targetFolderId,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sync') {
      const body = await parseBody(req);
      const {
        strategy = 'primary-overwrite',
        folders = [],
        relativePaths = [],
        deleteExtra = true,
        sourceFolderId,
        targetFolderId,
      } = body;

      if (folders.length < 2) {
        sendJson(res, 400, { ok: false, message: '请至少 2 个文件夹' });
        return;
      }

      const primary = folders.find((f) => f.isPrimary) || folders[0];
      const primaryRoot = resolveSafeDir(primary.path);
      const secondaries = folders.filter((f) => f.id !== primary.id);
      const paths = relativePaths.length ? relativePaths : null;
      const results = [];

      if (strategy === 'primary-overwrite') {
        for (const sec of secondaries) {
          const targetRoot = resolveSafeDir(sec.path);
          results.push({
            targetId: sec.id,
            targetPath: targetRoot,
            ...syncPrimaryOverwrite(primaryRoot, targetRoot, paths, deleteExtra),
          });
        }
      } else if (strategy === 'union') {
        const folderRoots = Object.fromEntries(
          folders.map((f) => [f.id, resolveSafeDir(f.path)]),
        );
        results.push({
          strategy: 'union',
          ...syncUnion(folderRoots, primaryRoot, paths),
        });
      } else if (strategy === 'selected') {
        if (!sourceFolderId || !targetFolderId) {
          sendJson(res, 400, { ok: false, message: '请指定源和目标文件夹' });
          return;
        }
        const src = folders.find((f) => f.id === sourceFolderId);
        const tgt = folders.find((f) => f.id === targetFolderId);
        if (!src || !tgt) {
          sendJson(res, 400, { ok: false, message: '文件夹 ID 无效' });
          return;
        }
        results.push({
          sourceId: sourceFolderId,
          targetId: targetFolderId,
          ...syncSelected({
            sourceRoot: resolveSafeDir(src.path),
            targetRoot: resolveSafeDir(tgt.path),
            relativePaths: paths || [],
            overwrite: true,
          }),
        });
      } else {
        sendJson(res, 400, { ok: false, message: '未知同步策略' });
        return;
      }

      sendJson(res, 200, { ok: true, results });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/delete') {
      const body = await parseBody(req);
      const { items = [] } = body;
      const deleted = [];
      const errors = [];
      for (const item of items) {
        try {
          const root = resolveSafeDir(item.folderPath);
          const r = deleteFileSafe(root, item.relativePath);
          if (r.ok) deleted.push(item);
          else errors.push({ ...item, message: r.reason });
        } catch (err) {
          errors.push({ ...item, message: err.message });
        }
      }
      sendJson(res, 200, { ok: true, deleted, errors });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/move') {
      const body = await parseBody(req);
      const { items = [] } = body;
      const moved = [];
      const errors = [];
      for (const item of items) {
        try {
          const fromRoot = resolveSafeDir(item.fromFolderPath);
          const toRoot = resolveSafeDir(item.toFolderPath);
          moveFileSafe(fromRoot, toRoot, item.relativePath, item.targetRelativePath);
          moved.push(item);
        } catch (err) {
          errors.push({ ...item, message: err.message });
        }
      }
      sendJson(res, 200, { ok: true, moved, errors });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/open-folder') {
      const p = url.searchParams.get('path');
      if (!p) {
        sendJson(res, 400, { ok: false, message: '缺少 path' });
        return;
      }
      const resolved = resolveSafeDir(p);
      execFileSync('open', [resolved], { stdio: 'ignore' });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rename/preview') {
      const body = await parseBody(req);
      const root = resolveSafeDir(body.rootPath);
      const plan = buildRenamePlan(root, body.rules || {}, {
        recursive: body.recursive !== false,
        scope: body.scope || 'files',
        ignorePatterns: body.ignorePatterns || DEFAULT_CONFIG.settings.ignorePatterns,
      });
      sendJson(res, 200, {
        ok: true,
        plan,
        stats: {
          total: plan.length,
          ready: plan.filter((p) => p.status === 'ready').length,
          unchanged: plan.filter((p) => p.status === 'unchanged').length,
          collision: plan.filter((p) => p.status === 'collision').length,
          invalid: plan.filter((p) => p.status === 'invalid').length,
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rename/execute') {
      const body = await parseBody(req);
      const root = resolveSafeDir(body.rootPath);
      const items = (body.items || []).filter((p) => p.status === 'ready');
      if (!items.length) {
        sendJson(res, 400, { ok: false, message: '没有可执行的重命名项' });
        return;
      }
      const result = executeRenamePlan(root, items);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rename/sanitize') {
      const body = await parseBody(req);
      const root = resolveSafeDir(body.rootPath);
      const plan = buildRenamePlan(
        root,
        {
          replacements: [
            { from: ':', to: '_' },
            { from: '：', to: '_' },
            { from: '/', to: '_' },
            { from: '／', to: '_' },
            { from: '\\', to: '_' },
          ],
        },
        {
          recursive: body.recursive !== false,
          scope: body.scope || 'both',
          ignorePatterns: body.ignorePatterns || DEFAULT_CONFIG.settings.ignorePatterns,
        },
      );
      const ready = plan.filter((p) => p.status === 'ready');
      const result = executeRenamePlan(root, ready);
      sendJson(res, 200, { ok: true, ...result, planned: ready.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/duplicates') {
      const body = await parseBody(req);
      const root = resolveSafeDir(body.rootPath);
      const groups = findDuplicates(root, body.ignorePatterns || DEFAULT_CONFIG.settings.ignorePatterns);
      sendJson(res, 200, {
        ok: true,
        groups,
        stats: {
          groupCount: groups.length,
          duplicateFiles: groups.reduce((s, g) => s + g.count, 0),
          wastedBytes: groups.reduce((s, g) => s + g.size * (g.count - 1), 0),
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/yuque/preview') {
      const body = await parseBody(req);
      const yuqueUrl = String(body.url || '').trim();
      if (!yuqueUrl) {
        sendJson(res, 400, { ok: false, message: '请提供语雀链接' });
        return;
      }
      const standardMarkdown = body.standardMarkdown !== false;
      const { normalizeYuqueMarkdown } = require('./server/yuque-normalize');
      const doc = await fetchYuqueDoc(yuqueUrl);
      const markdown = normalizeYuqueMarkdown(doc.markdown, { standard: standardMarkdown });
      sendJson(res, 200, {
        ok: true,
        title: doc.title,
        preview: markdown.slice(0, 3000),
        imageCount: doc.images.length,
        charCount: markdown.length,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/yuque/preview-book') {
      const body = await parseBody(req);
      const yuqueUrl = String(body.url || '').trim();
      const token = String(body.token || '').trim();
      if (!yuqueUrl) {
        sendJson(res, 400, { ok: false, message: '请提供语雀链接' });
        return;
      }
      const { book } = token
        ? await fetchYuqueBookByApi(token, yuqueUrl)
        : await fetchYuqueBook(yuqueUrl);
      sendJson(res, 200, {
        ok: true,
        authMode: token ? 'token' : 'share',
        bookName: book.name,
        total: book.docs.length,
        docs: book.docs.map((d) => ({
          title: d.title,
          slug: d.slug,
          dirPath: d.dirSegments.length ? d.dirSegments.join('/') : '(根目录)',
        })),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/yuque/export-progress') {
      const body = await parseBody(req);
      const saveDir = String(body.saveDir || '').trim();
      const yuqueUrl = String(body.url || '').trim();
      const token = String(body.token || '').trim();
      if (!saveDir || !yuqueUrl) {
        sendJson(res, 400, { ok: false, message: '请提供保存目录和语雀链接' });
        return;
      }
      const summary = getExportProgressSummary(saveDir, yuqueUrl, token ? 'token' : 'share', body.progress || null);
      sendJson(res, 200, { ok: true, ...summary });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/yuque/export-batch') {
      const body = await parseBody(req);
      const yuqueUrl = String(body.url || '').trim();
      const saveDir = String(body.saveDir || '').trim();
      const token = String(body.token || '').trim();
      if (!yuqueUrl) {
        sendJson(res, 400, { ok: false, message: '请提供语雀链接' });
        return;
      }
      if (!saveDir) {
        sendJson(res, 400, { ok: false, message: '请选择保存目录' });
        return;
      }
      const batchOpts = {
        url: yuqueUrl,
        saveDir,
        resume: body.resume !== false,
        progress: body.progress || null,
        downloadImages: body.downloadImages !== false,
        standardMarkdown: body.standardMarkdown !== false,
        exportFormat: normalizeExportFormat(body.exportFormat, body.exportConfluenceHtml === true),
        delayMode: body.delayMode || 'random',
        delayFixedSec: Math.min(120, Math.max(0, Number(body.delayFixedSec) || 5)),
        delayMinSec: Math.min(120, Math.max(0, Number(body.delayMinSec) || 3)),
        delayMaxSec: Math.min(120, Math.max(0, Number(body.delayMaxSec) || 30)),
      };
      const result = token
        ? await exportYuqueBatchByApi({ token, ...batchOpts })
        : await exportYuqueBatch(batchOpts);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/confluence/list') {
      const body = await parseBody(req);
      const sourceDir = resolveSafeDir(body.sourceDir);
      const recursive = body.recursive !== false;
      const files = listMarkdownFiles(sourceDir, recursive);
      sendJson(res, 200, { ok: true, files, count: files.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/confluence/preview') {
      const body = await parseBody(req);
      const filePath = String(body.filePath || '').trim();
      if (!filePath) {
        sendJson(res, 400, { ok: false, message: '请提供 Markdown 文件路径' });
        return;
      }
      const result = await previewMarkdownFile(filePath);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/confluence/convert') {
      const body = await parseBody(req);
      const sourceDir = resolveSafeDir(body.sourceDir);
      const sameDir = body.sameDir === true;
      let outputDir = sourceDir;
      if (!sameDir) {
        outputDir = resolveSafeDir(body.outputDir);
      }
      const result = await batchConvertMarkdown({
        sourceDir,
        outputDir,
        sameDir,
        recursive: body.recursive !== false,
        overwrite: body.overwrite === true,
        format: body.format,
        files: Array.isArray(body.files) ? body.files : null,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/yuque/export') {
      const body = await parseBody(req);
      const yuqueUrl = String(body.url || '').trim();
      const saveDir = String(body.saveDir || '').trim();
      if (!yuqueUrl) {
        sendJson(res, 400, { ok: false, message: '请提供语雀链接' });
        return;
      }
      if (!saveDir) {
        sendJson(res, 400, { ok: false, message: '请选择保存目录' });
        return;
      }
      const result = await exportYuqueDoc({
        url: yuqueUrl,
        saveDir,
        downloadImages: body.downloadImages !== false,
        standardMarkdown: body.standardMarkdown !== false,
        useDocFolder: body.useDocFolder === true,
        exportFormat: normalizeExportFormat(body.exportFormat, body.exportConfluenceHtml === true),
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    sendJson(res, 404, { ok: false, message: 'Not found' });
  } catch (err) {
    sendJson(res, 400, { ok: false, message: err.message });
  }
});

async function bootServer() {
  try {
    const { port, preferred, shifted } = await startOnAvailablePort(server);
    listenPort = port;
    console.log(`DeskKit 服务已启动: http://localhost:${port}`);
    if (shifted) {
      console.log(`（端口 ${preferred} 已被占用，已自动改用 ${port}）`);
    }
  } catch (err) {
    console.error(`\n${err.message}`);
    console.error('请先执行 npm run stop 关闭旧进程，或设置 PORT 指定其他起始端口。\n');
    process.exit(1);
  }
}

function shutdown() {
  clearPortFile();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootServer();
