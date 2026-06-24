const fs = require('fs');
const path = require('path');
const { sanitizeName } = require('./rename');
const { resolveDelayMs, sleep } = require('./yuque');

/** 导出进行中的进度（仅内存，供轮询；持久化由浏览器 localStorage 负责） */
const activeProgressStore = new Map();

function safeFileName(name) {
  const cleaned = sanitizeName(String(name || 'untitled'));
  return cleaned || 'untitled';
}

function uniqueDirPath(parentDir, baseName) {
  let candidate = path.join(parentDir, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  let i = 1;
  while (fs.existsSync(path.join(parentDir, `${baseName}_${i}`))) i += 1;
  return path.join(parentDir, `${baseName}_${i}`);
}

function normalizeUrlKey(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'docs' && parts[1] === 'share') {
      return `share:${parts[2] || ''}`;
    }
    if (parts.length >= 2) {
      return `book:${parts.slice(0, 2).join('/')}`;
    }
    return u.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function progressStoreKey(saveDir, url) {
  return `${path.resolve(String(saveDir || '').trim())}|${normalizeUrlKey(url)}`;
}

function setActiveProgress(saveDir, url, state) {
  state.updatedAt = new Date().toISOString();
  activeProgressStore.set(progressStoreKey(saveDir, url), state);
}

function getActiveProgress(saveDir, url) {
  return activeProgressStore.get(progressStoreKey(saveDir, url)) || null;
}

function clearActiveProgress(saveDir, url) {
  activeProgressStore.delete(progressStoreKey(saveDir, url));
}

function docOutputExists(bookDir, doc) {
  const targetDir = doc.dirSegments?.length
    ? path.join(bookDir, ...doc.dirSegments)
    : bookDir;
  if (!fs.existsSync(targetDir)) return false;

  const baseName = safeFileName(doc.title);
  const folderCandidates = [baseName];
  for (let i = 1; i <= 20; i += 1) folderCandidates.push(`${baseName}_${i}`);

  for (const folderName of folderCandidates) {
    const folder = path.join(targetDir, folderName);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) continue;
    if (fs.readdirSync(folder).some((f) => f.endsWith('.md') || f.endsWith('.html'))) return true;
  }
  return false;
}

function buildProgressSummary(progress) {
  if (!progress) return { found: false };

  const completedSlugs = Array.isArray(progress.completedSlugs) ? progress.completedSlugs : [];
  const failedList = Array.isArray(progress.failed) ? progress.failed : [];
  const total = Number(progress.total) || completedSlugs.length;
  const completed = completedSlugs.length;
  const failedCount = failedList.length;
  const completedSet = new Set(completedSlugs);
  const failedMap = new Map(failedList.map((f) => [f.slug, f]));

  const manifest = Array.isArray(progress.docManifest) ? progress.docManifest : [];
  const docs = manifest.map((d) => {
    let status = 'pending';
    if (progress.currentSlug === d.slug) status = 'exporting';
    else if (completedSet.has(d.slug)) status = 'done';
    else if (failedMap.has(d.slug)) status = 'failed';
    const fail = failedMap.get(d.slug);
    return {
      slug: d.slug,
      title: d.title,
      dirPath: d.dirPath || '(根目录)',
      status,
      failMessage: fail?.message,
    };
  });

  return {
    found: true,
    bookName: progress.bookName,
    bookDir: progress.bookDir,
    total,
    completed,
    remaining: Math.max(0, total - completed),
    failedCount,
    status: progress.status || 'in_progress',
    updatedAt: progress.updatedAt,
    startedAt: progress.startedAt,
    currentSlug: progress.currentSlug || null,
    completedSlugs,
    failed: failedList,
    docs,
    progress,
  };
}

function getExportProgressSummary(saveDir, url, authMode, clientProgress) {
  const active = getActiveProgress(saveDir, url);
  if (active) {
    if (authMode && active.authMode && active.authMode !== authMode) {
      return { found: false };
    }
    return buildProgressSummary(active);
  }

  if (clientProgress) {
    if (authMode && clientProgress.authMode && clientProgress.authMode !== authMode) {
      return { found: false };
    }
    if (normalizeUrlKey(clientProgress.url) !== normalizeUrlKey(url)) {
      return { found: false };
    }
    return buildProgressSummary(clientProgress);
  }

  return { found: false };
}

function hasPendingDocs(book, completedSet, bookDir) {
  return book.docs.some((doc) => !completedSet.has(doc.slug) && !docOutputExists(bookDir, doc));
}

async function runYuqueBatchExport({
  url,
  saveDir,
  authMode,
  namespace,
  book,
  resume,
  delayOpts,
  exportOneDoc,
  existingProgress,
}) {
  const resolvedDir = path.resolve(String(saveDir || '').trim());
  if (!resolvedDir) throw new Error('保存目录不能为空');
  fs.mkdirSync(resolvedDir, { recursive: true });

  let resumedProgress = null;
  if (resume) {
    resumedProgress = getActiveProgress(resolvedDir, url)
      || (existingProgress?.bookDir && fs.existsSync(existingProgress.bookDir) ? existingProgress : null);
  }

  let bookDir;
  let progress;

  if (resumedProgress?.bookDir && fs.existsSync(resumedProgress.bookDir)) {
    bookDir = resumedProgress.bookDir;
    progress = { ...resumedProgress };
    progress.total = book.docs.length;
  } else {
    bookDir = uniqueDirPath(resolvedDir, safeFileName(book.name));
    fs.mkdirSync(bookDir, { recursive: true });
    progress = {
      version: 1,
      url,
      authMode,
      namespace: namespace || null,
      bookName: book.name,
      bookDir,
      saveDir: resolvedDir,
      total: book.docs.length,
      completedSlugs: [],
      failed: [],
      startedAt: new Date().toISOString(),
      status: 'in_progress',
    };
  }

  progress.docManifest = book.docs.map((d) => ({
    slug: d.slug,
    title: d.title,
    dirPath: d.dirSegments?.length ? d.dirSegments.join('/') : '(根目录)',
  }));
  progress.currentSlug = null;
  setActiveProgress(resolvedDir, url, progress);

  const completedSet = new Set(progress.completedSlugs || []);
  for (const doc of book.docs) {
    if (completedSet.has(doc.slug)) continue;
    if (docOutputExists(bookDir, doc)) completedSet.add(doc.slug);
  }
  progress.completedSlugs = [...completedSet];

  const success = [];
  const failed = [];
  let skippedCount = 0;
  let newlyExported = 0;

  for (let i = 0; i < book.docs.length; i += 1) {
    const doc = book.docs[i];

    if (completedSet.has(doc.slug)) {
      skippedCount += 1;
      continue;
    }

    const targetDir = doc.dirSegments?.length
      ? path.join(bookDir, ...doc.dirSegments)
      : bookDir;
    fs.mkdirSync(targetDir, { recursive: true });

    progress.currentSlug = doc.slug;
    setActiveProgress(resolvedDir, url, progress);

    try {
      const result = await exportOneDoc(doc, targetDir);
      completedSet.add(doc.slug);
      progress.completedSlugs = [...completedSet];
      progress.failed = (progress.failed || []).filter((f) => f.slug !== doc.slug);
      progress.currentSlug = null;
      setActiveProgress(resolvedDir, url, progress);

      success.push({ ...result, slug: doc.slug });
      newlyExported += 1;
    } catch (err) {
      const failEntry = {
        slug: doc.slug,
        title: doc.title,
        message: err.message,
        at: new Date().toISOString(),
      };
      progress.failed = [
        ...(progress.failed || []).filter((f) => f.slug !== doc.slug),
        failEntry,
      ];
      progress.currentSlug = null;
      setActiveProgress(resolvedDir, url, progress);
      failed.push({
        ...failEntry,
        dirPath: doc.dirSegments?.join('/') || '(根目录)',
      });
    }

    if (i < book.docs.length - 1 && hasPendingDocs({ docs: book.docs.slice(i + 1) }, completedSet, bookDir)) {
      const waitMs = resolveDelayMs(delayOpts);
      if (waitMs > 0) await sleep(waitMs);
    }
  }

  const exportedTotal = completedSet.size;
  progress.status = exportedTotal >= book.docs.length && !(progress.failed || []).length
    ? 'completed'
    : 'in_progress';
  progress.currentSlug = null;
  setActiveProgress(resolvedDir, url, progress);

  return {
    bookName: book.name,
    bookDir,
    total: book.docs.length,
    exported: exportedTotal,
    newlyExported,
    skippedCount,
    failedCount: (progress.failed || []).length,
    remainingCount: Math.max(0, book.docs.length - exportedTotal),
    resume: Boolean(resumedProgress),
    delayMode: delayOpts.mode,
    success,
    failed,
    progress,
  };
}

module.exports = {
  getExportProgressSummary,
  runYuqueBatchExport,
  clearActiveProgress,
  safeFileName,
  uniqueDirPath,
};
