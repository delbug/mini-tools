const fs = require('fs');
const path = require('path');
const {
  convertMarkdownToConfluenceHtml,
  preprocessMarkdown,
} = require('./markdown-to-confluence');
const { convertMarkdownToDocx } = require('./markdown-to-docx');
const { convertMarkdownToPdf } = require('./markdown-to-pdf');
const { convertMarkdownToPasteHtml } = require('./markdown-to-paste-html');
const { embedImagesInMarkdown } = require('./markdown-images');

const DEFAULT_IGNORE = new Set(['.DS_Store', 'node_modules', '.git']);
const FORMAT_EXT = { html: '.html', docx: '.docx', md: '.md', pdf: '.pdf' };

function shouldIgnore(name) {
  return DEFAULT_IGNORE.has(name);
}

function normalizeOutputFormat(format) {
  const raw = String(format || 'docx').trim().toLowerCase();
  if (raw === 'doc' || raw === 'word') return 'docx';
  if (raw === 'confluence' || raw === 'paste') return 'html';
  if (FORMAT_EXT[raw]) return raw;
  throw new Error('导出格式无效，请选择 html、docx、md 或 pdf');
}

function findMarkdownFiles(rootDir, recursive = true) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (shouldIgnore(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (recursive) walk(full);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        results.push(full);
      }
    }
  }

  walk(rootDir);
  return results.sort();
}

function outputPathFor(inputPath, sourceDir, outputDir, sameDir, format) {
  const ext = FORMAT_EXT[format];
  const rel = path.relative(sourceDir, inputPath);
  const base = rel.replace(/\.md$/i, ext);
  if (sameDir) {
    return path.join(sourceDir, base);
  }
  return path.join(outputDir, base);
}

async function writeConvertedFile(format, markdown, baseName, outPath, imageBaseDir) {
  if (format === 'md') {
    fs.writeFileSync(outPath, preprocessMarkdown(markdown), 'utf8');
    return;
  }
  if (format === 'html') {
    const { markdown: mdWithImages, failed } = await embedImagesInMarkdown(markdown, imageBaseDir);
    const html = await convertMarkdownToPasteHtml(mdWithImages, {
      title: baseName,
      embedFailures: failed,
    });
    fs.writeFileSync(outPath, html, 'utf8');
    const docxPath = outPath.replace(/\.html$/i, '-confluence.docx');
    const docxBuffer = await convertMarkdownToDocx(markdown, {
      title: baseName,
      imageBaseDir,
    });
    fs.writeFileSync(docxPath, docxBuffer);
    return;
  }
  if (format === 'docx') {
    const buffer = await convertMarkdownToDocx(markdown, {
      title: baseName,
      imageBaseDir,
    });
    fs.writeFileSync(outPath, buffer);
    return;
  }
  if (format === 'pdf') {
    const buffer = await convertMarkdownToPdf(markdown, { title: baseName });
    fs.writeFileSync(outPath, buffer);
  }
}

async function previewMarkdownFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`不是文件: ${resolved}`);
  if (!resolved.toLowerCase().endsWith('.md')) throw new Error('仅支持 .md 文件');

  const markdown = fs.readFileSync(resolved, 'utf8');
  const baseName = path.basename(resolved, path.extname(resolved));
  const baseDir = path.dirname(resolved);
  const { markdown: markdownWithImages, embedded, failed } = await embedImagesInMarkdown(markdown, baseDir);
  const html = convertMarkdownToConfluenceHtml(markdownWithImages, { title: baseName, wrapDocument: true });
  const bodyOnly = convertMarkdownToConfluenceHtml(markdownWithImages, { title: baseName, wrapDocument: false });

  return {
    filePath: resolved,
    fileName: path.basename(resolved),
    title: baseName,
    charCount: markdown.length,
    html,
    bodyHtml: bodyOnly,
    imagesEmbedded: embedded.length,
    imagesFailed: failed,
  };
}

async function batchConvertMarkdown({
  sourceDir,
  outputDir,
  sameDir = false,
  recursive = true,
  overwrite = false,
  format = 'docx',
  files = null,
}) {
  const outputFormat = normalizeOutputFormat(format);
  const resolvedSource = path.resolve(String(sourceDir || '').trim());
  if (!fs.existsSync(resolvedSource)) throw new Error(`源目录不存在: ${resolvedSource}`);
  if (!fs.statSync(resolvedSource).isDirectory()) throw new Error(`不是文件夹: ${resolvedSource}`);

  let resolvedOutput = resolvedSource;
  if (!sameDir) {
    resolvedOutput = path.resolve(String(outputDir || '').trim());
    if (!fs.existsSync(resolvedOutput)) throw new Error(`输出目录不存在: ${resolvedOutput}`);
    if (!fs.statSync(resolvedOutput).isDirectory()) throw new Error(`输出目录不是文件夹: ${resolvedOutput}`);
  }

  const allMdFiles = findMarkdownFiles(resolvedSource, recursive);
  const mdFiles = resolveSelectedFiles(resolvedSource, allMdFiles, files);
  if (!mdFiles.length) throw new Error('请至少选择一个 Markdown 文件');

  const converted = [];
  const skipped = [];
  const failed = [];

  for (const inputPath of mdFiles) {
    const outPath = outputPathFor(inputPath, resolvedSource, resolvedOutput, sameDir, outputFormat);
    const relPath = path.relative(resolvedSource, inputPath);

    if (outputFormat === 'md' && path.resolve(outPath) === path.resolve(inputPath) && !overwrite) {
      skipped.push({ relativePath: relPath, outputPath: outPath, reason: 'same-md' });
      continue;
    }

    if (fs.existsSync(outPath) && !overwrite) {
      skipped.push({ relativePath: relPath, outputPath: outPath });
      continue;
    }

    try {
      const markdown = fs.readFileSync(inputPath, 'utf8');
      const baseName = path.basename(inputPath, path.extname(inputPath));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await writeConvertedFile(outputFormat, markdown, baseName, outPath, path.dirname(inputPath));
      converted.push({ relativePath: relPath, outputPath: outPath, title: baseName });
    } catch (err) {
      failed.push({ relativePath: relPath, message: err.message });
    }
  }

  return {
    sourceDir: resolvedSource,
    outputDir: sameDir ? resolvedSource : resolvedOutput,
    outputFormat,
    total: mdFiles.length,
    selectedCount: mdFiles.length,
    allCount: allMdFiles.length,
    convertedCount: converted.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    converted,
    skipped,
    failed,
  };
}

function resolveSelectedFiles(sourceDir, allFiles, files) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return allFiles;
  }

  const allSet = new Set(allFiles.map((p) => path.resolve(p)));
  const selected = [];
  const seen = new Set();

  for (const item of files) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(sourceDir, raw);
    if (!allSet.has(resolved)) {
      throw new Error(`所选文件不在源目录内或不是 .md: ${raw}`);
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    selected.push(resolved);
  }

  return selected.sort();
}

function listMarkdownFiles(sourceDir, recursive = true) {
  const resolved = path.resolve(String(sourceDir || '').trim());
  if (!fs.existsSync(resolved)) throw new Error(`目录不存在: ${resolved}`);
  const files = findMarkdownFiles(resolved, recursive);
  return files.map((abs) => ({
    absolutePath: abs,
    relativePath: path.relative(resolved, abs).split(path.sep).join('/'),
    fileName: path.basename(abs),
  }));
}

async function exportConfluenceHtmlFromMarkdown(markdown, mdFilePath, title) {
  const resolvedMd = path.resolve(mdFilePath);
  const baseDir = path.dirname(resolvedMd);
  const baseName = path.basename(resolvedMd, path.extname(resolvedMd));
  const htmlPath = path.join(baseDir, `${baseName}.html`);
  await writeConvertedFile('html', markdown, title || baseName, htmlPath, baseDir);
  return htmlPath;
}

module.exports = {
  batchConvertMarkdown,
  previewMarkdownFile,
  listMarkdownFiles,
  findMarkdownFiles,
  normalizeOutputFormat,
  FORMAT_EXT,
  resolveSelectedFiles,
  exportConfluenceHtmlFromMarkdown,
  writeConvertedFile,
};
