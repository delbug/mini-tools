const { fetchMermaidPng } = require('./mermaid-image');
const { renderTextBlockToPng } = require('./text-block-image');
const {
  preprocessMarkdown,
  collectPreformattedBlock,
  isDiagramLikeLine,
  isHorizontalRuleLine,
  isTaskListLine,
  looksLikeMarkdownTable,
  parseTableRow,
  escapeHtml,
  parseInline,
} = require('./markdown-to-confluence');

const LANG_LABELS = {
  javascript: 'JavaScript',
  js: 'JavaScript',
  vue: 'Vue',
  plain: '文本',
  latex: '结构图',
  text: '文本',
  mermaid: 'Mermaid',
};

function blockKindForLang(lang) {
  const normalized = String(lang || '').toLowerCase();
  if (['latex', 'plain', 'text', 'diagram', 'mermaid'].includes(normalized)) return 'diagram';
  return 'code';
}

function blockLabelForLang(lang) {
  const normalized = String(lang || '').toLowerCase();
  return LANG_LABELS[normalized] || (normalized ? normalized : '代码');
}

function wrapImgTag(attrs) {
  const style = 'max-width:620px;width:100%;height:auto;display:block;margin:16px 0;';
  const merged = /style=/i.test(attrs)
    ? attrs
    : `${attrs} style="${style}"`;
  return `<span class="confluence-embedded-file-wrapper image-center-wrapper confluence-embedded-manual">` +
    `<img class="confluence-embedded-image image-center"${merged} />` +
    `</span>`;
}

function wrapImagesForConfluence(html) {
  return String(html || '').replace(/<img([^>]*)\s*\/?>/gi, (match, attrs) => {
    if (/confluence-embedded-file-wrapper/i.test(match)) return match;
    return wrapImgTag(attrs);
  });
}

function renderImageHtml(buffer, format = 'png', alt = '') {
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const src = `data:${mime};base64,${buffer.toString('base64')}`;
  return `<p class="embed-image">${wrapImgTag(` src="${src}" alt="${escapeHtml(alt)}"`)}</p>`;
}

async function renderBlockImage(content, options = {}) {
  try {
    const { buffer, format } = await renderTextBlockToPng(content, options);
    return renderImageHtml(buffer, format, options.label || '代码');
  } catch {
    return `<pre class="code-fallback"><code>${escapeHtml(content)}</code></pre>`;
  }
}

async function renderMermaidHtml(source) {
  try {
    const { buffer, format } = await fetchMermaidPng(source);
    return renderImageHtml(buffer, format, '流程图');
  } catch {
    return renderBlockImage(source, { label: 'Mermaid', kind: 'diagram' });
  }
}

function renderTableHtml(headerCells, bodyRows) {
  let html = '<table><thead><tr>';
  for (const cell of headerCells) {
    html += `<th>${parseInline(cell)}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const row of bodyRows) {
    if (!row) continue;
    html += '<tr>';
    for (const cell of row) {
      html += `<td>${parseInline(cell)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

async function parseLinesToPasteHtml(lines) {
  const blocks = [];
  let i = 0;
  let docTitle = '';

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const soloImage = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (soloImage) {
      blocks.push(`<p class="embed-image">${wrapImagesForConfluence(parseInline(trimmed))}</p>`);
      i += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = (fenceMatch[1] || '').toLowerCase();
      i += 1;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const content = codeLines.join('\n');
      if (lang === 'mermaid') {
        blocks.push(await renderMermaidHtml(content));
      } else {
        blocks.push(await renderBlockImage(content, {
          label: blockLabelForLang(lang),
          kind: blockKindForLang(lang),
        }));
      }
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (level === 1 && !docTitle) docTitle = text.replace(/\*\*/g, '').trim();
      blocks.push(`<h${level}>${parseInline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (isHorizontalRuleLine(line)) {
      blocks.push('<hr />');
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(`<blockquote><p>${parseInline(quoteLines.filter(Boolean).join(' '))}</p></blockquote>`);
      continue;
    }

    if (looksLikeMarkdownTable(lines, i)) {
      const headerCells = parseTableRow(line);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(parseTableRow(lines[i]));
        i += 1;
      }
      if (headerCells) blocks.push(renderTableHtml(headerCells, bodyRows));
      continue;
    }

    if (isTaskListLine(line)) {
      const items = [];
      while (i < lines.length && isTaskListLine(lines[i])) {
        const match = lines[i].trim().match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (match) {
          items.push({ checked: match[1].toLowerCase() === 'x', text: match[2] });
        }
        i += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${parseInline(`${item.checked ? '☑' : '☐'} ${item.text}`)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) && !isDiagramLikeLine(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim()) && !isDiagramLikeLine(lines[i]) && !isTaskListLine(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${parseInline(item)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${parseInline(item)}</li>`).join('')}</ol>`);
      continue;
    }

    const preBlock = collectPreformattedBlock(lines, i);
    if (preBlock) {
      blocks.push(await renderBlockImage(preBlock.content, { label: '结构图', kind: 'diagram' }));
      i = preBlock.end;
      continue;
    }

    if (isDiagramLikeLine(line)) {
      blocks.push(await renderBlockImage(line.replace(/\s+$/, ''), { label: '结构图', kind: 'diagram' }));
      i += 1;
      continue;
    }

    const paraLines = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();
      if (!nextTrimmed) break;
      if (nextTrimmed.match(/^```|^#{1,6}\s|^>\s?|^\d+\.\s+|^[-*+]\s+/)) break;
      if (isHorizontalRuleLine(next) || looksLikeMarkdownTable(lines, i) || isTaskListLine(next)) break;
      if (isDiagramLikeLine(next) || collectPreformattedBlock(lines, i)) break;
      paraLines.push(nextTrimmed);
      i += 1;
    }
    blocks.push(`<p>${parseInline(paraLines.join(' '))}</p>`);
  }

  return { bodyHtml: blocks.join('\n'), docTitle };
}

function buildEmbedFailureNote(failures) {
  if (!failures?.length) return '';
  const items = failures.slice(0, 5).map((f) => escapeHtml(f.url || '')).join('、');
  const more = failures.length > 5 ? ` 等 ${failures.length} 张` : '';
  return `<div class="paste-tip warn">有 ${failures.length} 张图片未能内嵌到 HTML：${items}${more}。请检查 assets/ 是否存在，或重新导出。</div>`;
}

async function convertMarkdownToPasteHtml(markdown, options = {}) {
  const { title: fallbackTitle = '', embedFailures = [] } = options;
  const lines = preprocessMarkdown(markdown).split('\n');
  const { bodyHtml, docTitle } = await parseLinesToPasteHtml(lines);
  const pageTitle = escapeHtml(docTitle || fallbackTitle || '未命名文档');
  const contentHtml = wrapImagesForConfluence(bodyHtml);
  const failureNote = buildEmbedFailureNote(embedFailures);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; max-width: 900px; margin: 24px auto; padding: 0 24px 40px; color: #172b4d; }
    .paste-tip { background: #e9f2ff; border: 1px solid #b3d4ff; color: #0747a6; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    .paste-tip.warn { background: #fff7e6; border-color: #ffd666; color: #874d00; }
    .paste-toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    .paste-toolbar button { font-size: 14px; padding: 8px 14px; border-radius: 6px; border: 1px solid #b3d4ff; background: #fff; color: #0747a6; cursor: pointer; }
    .paste-toolbar button.primary { background: #0052cc; border-color: #0052cc; color: #fff; }
    .paste-toolbar button:hover { filter: brightness(0.96); }
    h1 { font-size: 28px; border-bottom: 1px solid #dfe1e6; padding-bottom: 8px; }
    h2 { font-size: 22px; margin-top: 28px; }
    h3 { font-size: 18px; margin-top: 22px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; }
    th { background: #f4f5f7; }
    blockquote { border-left: 4px solid #dfe1e6; margin: 16px 0; padding: 4px 16px; color: #5e6c84; }
    code { font-family: SFMono-Regular, Consolas, Menlo, monospace; font-size: 0.9em; background: #f4f5f7; padding: 1px 4px; border-radius: 3px; }
    pre.code-fallback { background: #f4f5f7; padding: 12px 16px; border-radius: 4px; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #dfe1e6; margin: 24px 0; }
    img { max-width: 100%; height: auto; }
    .embed-image { margin: 16px 0; }
  </style>
</head>
<body>
  <div class="paste-tip">
  <strong>粘贴到 Confluence（推荐带图片）：</strong>用同目录下的 <strong>-confluence.docx</strong>，用 Word / WPS 打开 → 全选复制 → 粘贴到 Confluence（图片通常能带上）。<br />
  若用本页 HTML：点下方「复制正文」；若图片仍未带上，把 <code>assets/</code> 里的图片拖进 Confluence 编辑器。
  </div>
  ${failureNote}
  <div class="paste-toolbar">
    <button type="button" class="primary" id="btn-copy-body">复制正文到 Confluence</button>
  </div>
  <div id="paste-content">${contentHtml}</div>
  <script>
    (function () {
      function copySelectionFrom(node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        return ok;
      }
      document.getElementById('btn-copy-body').addEventListener('click', async function () {
        const el = document.getElementById('paste-content');
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            const html = el.innerHTML;
            const blob = new Blob([html], { type: 'text/html' });
            const textBlob = new Blob([el.innerText || ''], { type: 'text/plain' });
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': blob,
                'text/plain': textBlob,
              }),
            ]);
            alert('已复制正文。请粘贴到 Confluence；若图片缺失，请用 -confluence.docx 方式。');
            return;
          }
        } catch (e) { /* fallback */ }
        if (copySelectionFrom(el)) {
          alert('已复制正文。若图片未带上，请用 -confluence.docx 用 Word 打开后复制。');
        } else {
          alert('自动复制失败：请手动选中正文区域后 Cmd+C / Ctrl+C。');
        }
      });
    })();
  </script>
</body>
</html>
`;
}

module.exports = { convertMarkdownToPasteHtml };
