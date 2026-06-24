import type {
  AppConfig,
  CompareMode,
  CompareResult,
  DuplicateGroup,
  FavoriteItem,
  FolderItem,
  RenamePlanItem,
  RenameRules,
  SyncPreviewOperation,
  SyncPreviewSummary,
  SyncStrategy,
} from '@/types';
import {
  YuqueProgressState,
  loadAppConfig,
  loadYuqueProgress,
  saveAppConfigPartial,
  saveFavoriteAction,
  saveYuqueProgress,
} from '@/utils/appStorage';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    throw new Error('无法连接后端服务。请先运行 npm start；开发模式需同时运行 npm start 与 npm run dev，或使用 npm run boot。');
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const msg = data.message || '请求失败';
    if (res.status === 404 && msg === 'Not found') {
      throw new Error('后端接口不存在，请重启服务：npm run restart');
    }
    throw new Error(msg);
  }
  return data as T;
}

export async function pickFolder() {
  let res: Response;
  try {
    res = await fetch('/api/pick-folder');
  } catch {
    throw new Error('无法连接后端服务。请先运行 npm start；开发模式需同时运行 npm start 与 npm run dev，或使用 npm run boot。');
  }
  const data = await res.json();
  if (data.cancelled) return { cancelled: true as const, path: '', name: '' };
  if (!res.ok || data.ok === false) throw new Error(data.message || '选择文件夹失败');
  return data as { path: string; name: string };
}

export function getConfig() {
  return Promise.resolve({ config: loadAppConfig() });
}

export function saveConfig(partial: Partial<AppConfig>) {
  return Promise.resolve({ config: saveAppConfigPartial(partial) });
}

export function saveFavorite(action: 'add' | 'remove' | 'update', favorite: Partial<FavoriteItem> & { id?: string }) {
  return Promise.resolve({ favorites: saveFavoriteAction(action, favorite) });
}

export async function compareFolders(folders: FolderItem[], mode: CompareMode, ignorePatterns?: string[]) {
  return request<CompareResult & { ok: true }>('/api/compare', {
    method: 'POST',
    body: JSON.stringify({ folders, mode, ignorePatterns }),
  });
}

export async function previewSyncFolders(params: {
  strategy: SyncStrategy;
  folders: FolderItem[];
  relativePaths: string[];
  deleteExtra?: boolean;
  sourceFolderId?: string;
  targetFolderId?: string;
}) {
  return request<{ operations: SyncPreviewOperation[]; summary: SyncPreviewSummary }>(
    '/api/sync/preview',
    { method: 'POST', body: JSON.stringify(params) },
  );
}

export async function syncFolders(params: {
  strategy: SyncStrategy;
  folders: FolderItem[];
  relativePaths: string[];
  deleteExtra?: boolean;
  sourceFolderId?: string;
  targetFolderId?: string;
}) {
  return request<{ results: unknown[] }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function deleteFiles(items: { folderPath: string; relativePath: string }[]) {
  return request<{ deleted: unknown[]; errors: unknown[] }>('/api/delete', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function moveFiles(items: {
  fromFolderPath: string;
  toFolderPath: string;
  relativePath: string;
  targetRelativePath?: string;
}[]) {
  return request<{ moved: unknown[]; errors: unknown[] }>('/api/move', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function openFolder(folderPath: string) {
  const q = encodeURIComponent(folderPath);
  return request<{ ok: true }>(`/api/open-folder?path=${q}`);
}

export async function previewRename(params: {
  rootPath: string;
  rules: RenameRules;
  recursive?: boolean;
  scope?: 'files' | 'directories' | 'both';
  ignorePatterns?: string[];
}) {
  const ignorePatterns = params.ignorePatterns ?? loadAppConfig().settings.ignorePatterns;
  return request<{ plan: RenamePlanItem[]; stats: Record<string, number> }>('/api/rename/preview', {
    method: 'POST',
    body: JSON.stringify({ ...params, ignorePatterns }),
  });
}

export async function executeRename(rootPath: string, items: RenamePlanItem[]) {
  return request<{ renamed: RenamePlanItem[]; errors: unknown[] }>('/api/rename/execute', {
    method: 'POST',
    body: JSON.stringify({ rootPath, items }),
  });
}

export async function sanitizeNames(
  rootPath: string,
  scope: 'files' | 'directories' | 'both' = 'both',
  ignorePatterns?: string[],
) {
  const patterns = ignorePatterns ?? loadAppConfig().settings.ignorePatterns;
  return request<{ renamed: RenamePlanItem[]; errors: unknown[]; planned: number }>('/api/rename/sanitize', {
    method: 'POST',
    body: JSON.stringify({ rootPath, scope, ignorePatterns: patterns }),
  });
}

export async function findDuplicates(rootPath: string, ignorePatterns?: string[]) {
  const patterns = ignorePatterns ?? loadAppConfig().settings.ignorePatterns;
  return request<{ groups: DuplicateGroup[]; stats: { groupCount: number; duplicateFiles: number; wastedBytes: number } }>(
    '/api/duplicates',
    { method: 'POST', body: JSON.stringify({ rootPath, ignorePatterns: patterns }) },
  );
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultFolders(): FolderItem[] {
  return [
    { id: uid(), path: '', label: '文件夹 A', isPrimary: true },
    { id: uid(), path: '', label: '文件夹 B', isPrimary: false },
  ];
}

export async function previewYuque(url: string, standardMarkdown = true) {
  return request<{
    title: string;
    preview: string;
    imageCount: number;
    charCount: number;
  }>('/api/yuque/preview', {
    method: 'POST',
    body: JSON.stringify({ url, standardMarkdown }),
  });
}

export async function previewYuqueBook(url: string, token?: string) {
  return request<{
    authMode: 'token' | 'share';
    bookName: string;
    total: number;
    docs: { title: string; slug: string; dirPath: string }[];
  }>('/api/yuque/preview-book', {
    method: 'POST',
    body: JSON.stringify({ url, token: token || undefined }),
  });
}

export type YuqueExportFormat = 'md' | 'html' | 'both';

export async function exportYuque(params: {
  url: string;
  saveDir: string;
  downloadImages?: boolean;
  standardMarkdown?: boolean;
  useDocFolder?: boolean;
  exportFormat?: YuqueExportFormat;
  /** @deprecated 兼容旧版，等同 both */
  exportConfluenceHtml?: boolean;
}) {
  return request<{
    title: string;
    fileName: string;
    filePath: string;
    exportFormat: YuqueExportFormat;
    mdPath?: string | null;
    mdFileName?: string | null;
    htmlPath?: string | null;
    htmlFileName?: string | null;
    folderPath: string | null;
    imageCount: number;
    downloadedImages: number;
    charCount: number;
  }>('/api/yuque/export', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchYuqueExportProgress(url: string, saveDir: string, token?: string) {
  const progress = loadYuqueProgress(url, saveDir) || undefined;
  const data = await request<{
    found: boolean;
    bookName?: string;
    bookDir?: string;
    total?: number;
    completed?: number;
    remaining?: number;
    failedCount?: number;
    status?: string;
    updatedAt?: string;
    startedAt?: string;
    currentSlug?: string | null;
    completedSlugs?: string[];
    failed?: { slug: string; title?: string; message: string }[];
    docs?: {
      slug: string;
      title: string;
      dirPath: string;
      status: 'pending' | 'done' | 'failed' | 'exporting';
      failMessage?: string;
    }[];
    progress?: YuqueProgressState;
  }>('/api/yuque/export-progress', {
    method: 'POST',
    body: JSON.stringify({ url, saveDir, token: token || undefined, progress }),
  });

  if (data.progress) {
    saveYuqueProgress(url, saveDir, data.progress);
  }

  return data;
}

export async function exportYuqueBatch(params: {
  url: string;
  saveDir: string;
  token?: string;
  resume?: boolean;
  downloadImages?: boolean;
  standardMarkdown?: boolean;
  exportFormat?: YuqueExportFormat;
  /** @deprecated 兼容旧版，等同 both */
  exportConfluenceHtml?: boolean;
  delayMode?: 'none' | 'fixed' | 'random';
  delayFixedSec?: number;
  delayMinSec?: number;
  delayMaxSec?: number;
}) {
  const storedProgress = params.resume !== false ? loadYuqueProgress(params.url, params.saveDir) : null;
  const result = await request<{
    bookName: string;
    bookDir: string;
    total: number;
    exported: number;
    newlyExported: number;
    skippedCount: number;
    remainingCount: number;
    failedCount: number;
    resume: boolean;
    delayMode: string;
    success: { title: string; filePath: string; folderPath: string | null; relativePath?: string }[];
    failed: { title: string; slug: string; dirPath?: string; message: string }[];
    progress?: YuqueProgressState;
  }>('/api/yuque/export-batch', {
    method: 'POST',
    body: JSON.stringify({ ...params, progress: storedProgress || undefined }),
  });

  if (result.progress) {
    saveYuqueProgress(params.url, params.saveDir, result.progress);
  }

  return result;
}

export function clearYuqueProgress(url: string, saveDir: string) {
  saveYuqueProgress(url, saveDir, null);
  return Promise.resolve({ clearedCount: 1 });
}

export async function listConfluenceFiles(sourceDir: string, recursive = true) {
  return request<{
    files: { absolutePath: string; relativePath: string; fileName: string }[];
    count: number;
  }>('/api/confluence/list', {
    method: 'POST',
    body: JSON.stringify({ sourceDir, recursive }),
  });
}

export async function previewConfluenceFile(filePath: string) {
  return request<{
    filePath: string;
    fileName: string;
    title: string;
    charCount: number;
    html: string;
    bodyHtml: string;
    imagesEmbedded?: number;
    imagesFailed?: { url: string; message: string }[];
  }>('/api/confluence/preview', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
}

export type ConfluenceOutputFormat = 'html' | 'docx' | 'md' | 'pdf';

export async function convertToConfluence(params: {
  sourceDir: string;
  outputDir?: string;
  sameDir?: boolean;
  recursive?: boolean;
  overwrite?: boolean;
  format?: ConfluenceOutputFormat;
  files?: string[];
}) {
  return request<{
    sourceDir: string;
    outputDir: string;
    outputFormat: ConfluenceOutputFormat;
    total: number;
    selectedCount?: number;
    allCount?: number;
    convertedCount: number;
    skippedCount: number;
    failedCount: number;
    converted: { relativePath: string; outputPath: string; title: string }[];
    skipped: { relativePath: string; outputPath: string }[];
    failed: { relativePath: string; message: string }[];
  }>('/api/confluence/convert', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
