/**
 * 将 Markdown 转为 Confluence 可粘贴的 HTML（h1 标题 + 富文本结构）。
 */

const DIAGRAM_BOX_CHARS = /[┌┐└┘├┤┬┴┼─│║═╔╗╚╝╠╣]/;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseInline(text) {
  let result = escapeHtml(text);

  result = result.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const safeSrc = escapeHtml(src.trim());
    const safeAlt = escapeHtml(alt);
    return `<img src="${safeSrc}" alt="${safeAlt}" />`;
  });
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = escapeHtml(href.trim());
    return `<a href="${safeHref}">${escapeHtml(label)}</a>`;
  });
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

  return result;
}

function formatMermaidSource(source) {
  let s = String(source || '').replace(/\r\n/g, '\n').trim();
  if (s.includes('\n')) return s.replace(/(?:\s+-->\s*)+$/, '');

  s = s.replace(/\s+/g, ' ');
  s = s.replace(/([\]\}"\)])\s+-->\s+/g, '$1\n  --> ');
  s = s.replace(/\s+([A-Za-z0-9_]+)\s+-->\s+/g, '\n  $1 --> ');
  s = s.replace(/\s+\|\s+/g, '\n  | ');
  return s.replace(/(?:\s+-->\s*)+$/, '');
}

function sanitizeMermaidForHtml(content) {
  return String(content || '').replace(/<\/pre/gi, '<\\/pre');
}

function renderMermaidBlock(content) {
  const source = content.trim();
  const safeMermaid = sanitizeMermaidForHtml(source);
  return `<div class="mermaid-wrapper">
  <p class="diagram-hint"><em>流程图：打开 HTML 文件或在下方预览中可自动渲染；粘贴到 Confluence 时请复制渲染后的图，或展开源码使用 Mermaid 宏。</em></p>
  <div class="mermaid-render">
    <pre class="mermaid">${safeMermaid}</pre>
  </div>
  <details class="mermaid-source">
    <summary>Mermaid 源码</summary>
    <pre class="text-diagram diagram-block"><code>${escapeHtml(source)}</code></pre>
  </details>
</div>`;
}

const MERMAID_BOOTSTRAP = `<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
});
await mermaid.run({ querySelector: '.mermaid' });
</script>`;

/** 语雀文本绘图：<!-- 这是一个文本绘图，源码为：flowchart LR A --> B --> --> */
function extractDiagramSourceFromCommentLine(line) {
  const trimmed = String(line || '').trim();
  const prefixMatch = trimmed.match(/^<!--\s*(?:这是一个)?文本绘图[，,]?\s*源码为[：:]\s*/);
  if (!prefixMatch) return null;

  const start = prefixMatch[0].length;
  const end = trimmed.lastIndexOf('-->');
  if (end <= start) return null;

  return trimmed.slice(start, end).trim().replace(/(?:\s+-->\s*)+$/, '');
}

function preprocessYuqueDiagramComments(md) {
  const lines = String(md || '').split('\n');
  const out = [];

  for (const line of lines) {
    const source = extractDiagramSourceFromCommentLine(line);
    if (source) {
      out.push('');
      out.push('```mermaid');
      out.push(formatMermaidSource(source));
      out.push('```');
      out.push('');
      continue;
    }

    // 非文本绘图的 HTML 注释直接丢弃，避免干扰正文
    if (/^\s*<!--[\s\S]*-->\s*$/.test(line.trim())) {
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function preprocessBlockquoteMeta(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (/^>\s/.test(trimmed)) {
      out.push(lines[i]);
      i += 1;
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        if (!nextTrimmed) {
          out.push(lines[i]);
          i += 1;
          break;
        }
        if (/^>\s?/.test(nextTrimmed)) {
          out.push(lines[i]);
          i += 1;
          continue;
        }
        if (/^#{1,6}\s/.test(nextTrimmed) || isHorizontalRuleLine(lines[i]) || nextTrimmed.startsWith('```')) {
          break;
        }
        if (looksLikeMarkdownTable(lines, i)) break;
        out.push(`> ${lines[i].replace(/^\s+/, '')}`);
        i += 1;
      }
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }

  return out.join('\n');
}

function preprocessMarkdown(markdown) {
  let md = preprocessYuqueDiagramComments(String(markdown || ''));
  md = preprocessBlockquoteMeta(md);
  md = md.replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/gi, (_, inner) => {
    const text = inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?code[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '');
    return `\n\`\`\`text\n${text.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n`;
  });
  return md.replace(/\r\n/g, '\n');
}

function isHorizontalRuleLine(line) {
  const t = String(line || '').trim();
  return /^(-{3,}|\*{3,}|_{3,})$/.test(t);
}

function isMarkdownListLine(line) {
  const t = String(line || '').trim();
  return /^[-*+]\s+/.test(t) || /^\d+\.\s+/.test(t);
}

function isTaskListLine(line) {
  return /^[-*+]\s+\[[ xX]\]\s+/.test(String(line || '').trim());
}

function isDiagramLikeLine(line) {
  if (line == null) return false;
  if (/^\s*<!--/.test(line)) return false;
  if (isHorizontalRuleLine(line)) return false;
  if (isMarkdownListLine(line)) return false;
  if (isTaskListLine(line)) return false;
  if (/^#{1,6}\s+/.test(String(line).trim())) return false;
  if (String(line).trim().startsWith('>')) return false;
  if (String(line).trim().startsWith('```')) return false;

  const trimmed = String(line).trim();
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) return false;
  }

  if (/^(?: {4}|\t)/.test(line)) return true;
  if (DIAGRAM_BOX_CHARS.test(line)) return true;

  const t = line.replace(/\s+$/, '');
  if (!t.trim()) return false;

  if (/^[\s|+]{0,3}[+\-=|/\\]{3,}[+\-=|/\\\s]*$/.test(t.trim()) && !/^[-*+]\s+/.test(t.trim())) {
    return true;
  }
  if (/^[\s|+\\/].*[|+\\/]\s*$/.test(t) && /[-=]{2,}/.test(t) && !/^[-*+]\s+/.test(t.trim())) return true;

  if (/^\s*\|/.test(t)) {
    const cells = t.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length <= 1) return true;
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) return true;
  }

  if (/ {2,}/.test(t) && t.length > 8) {
    const parts = t.split(/ {2,}/).filter(Boolean);
    if (parts.length >= 2) return true;
  }

  if (/(-{2,}>|>{1,2}|<-{2,})/.test(t) && /[+\[\]|(){}]/.test(t) && !/`.+--.+`/.test(t)) return true;

  return false;
}

function isDiagramContent(text) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  if (!lines.length) return false;
  const diagramLines = lines.filter(isDiagramLikeLine).length;
  return diagramLines >= Math.max(1, Math.ceil(lines.length * 0.5));
}

function collectPreformattedBlock(lines, start) {
  const line = lines[start];
  if (!line || !line.trim()) return null;

  if (/^(?: {4}|\t)/.test(line)) {
    const block = [];
    let i = start;
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim()) {
        if (i + 1 < lines.length && /^(?: {4}|\t)/.test(lines[i + 1])) {
          block.push('');
          i += 1;
          continue;
        }
        break;
      }
      if (!/^(?: {4}|\t)/.test(current)) break;
      block.push(current.replace(/^(?: {4}|\t)/, ''));
      i += 1;
    }
    if (block.length) return { end: i, content: block.join('\n') };
    return null;
  }

  if (!isDiagramLikeLine(line)) return null;

  const block = [];
  let i = start;
  while (i < lines.length) {
    const current = lines[i];
    if (!current.trim()) break;
    if (!isDiagramLikeLine(current)) break;
    block.push(current.replace(/\s+$/, ''));
    i += 1;
  }

  if (block.length >= 2 || (block.length === 1 && block[0].length >= 10)) {
    return { end: i, content: block.join('\n') };
  }
  return null;
}

function renderPreBlock(content, extraClass = '') {
  const classes = ['text-diagram', extraClass].filter(Boolean).join(' ');
  return `<pre class="${classes}"><code>${escapeHtml(content)}</code></pre>`;
}

function wrapFenceBlock(codeLines, lang) {
  const content = codeLines.join('\n');
  const normalizedLang = (lang || '').toLowerCase();
  if (normalizedLang === 'mermaid') {
    return renderMermaidBlock(content);
  }

  const extra = [];
  if (normalizedLang) extra.push(`language-${escapeHtml(normalizedLang)}`);
  if (normalizedLang === 'plantuml' || isDiagramContent(content)) {
    extra.push('diagram-block');
  }
  return renderPreBlock(content, extra.join(' '));
}

function isTableSeparator(line) {
  return /^\|[\s:|\-]+\|$/.test(line.trim()) && /-{3,}/.test(line);
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|');
  return cells.map((c) => c.trim());
}

function looksLikeMarkdownTable(lines, index) {
  const header = parseTableRow(lines[index]);
  if (!header || header.length < 2) return false;
  if (index + 1 >= lines.length) return false;
  if (!isTableSeparator(lines[index + 1])) return false;
  if (header.some(isDiagramLikeLine)) return false;
  return true;
}

function convertMarkdownToConfluenceHtml(markdown, options = {}) {
  const { title: fallbackTitle = '', wrapDocument = true } = options;
  const lines = preprocessMarkdown(markdown).split('\n');
  const blocks = [];
  let i = 0;
  let docTitle = fallbackTitle;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const preBlock = collectPreformattedBlock(lines, i);
    if (preBlock) {
      blocks.push(renderPreBlock(preBlock.content, 'diagram-block'));
      i = preBlock.end;
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
      blocks.push(wrapFenceBlock(codeLines, lang));
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

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) && !isDiagramLikeLine(line)) {
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
      blocks.push(`<blockquote><p>${parseInline(quoteLines.join(' '))}</p></blockquote>`);
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
      if (headerCells) {
        let table = '<table><thead><tr>';
        for (const cell of headerCells) {
          table += `<th>${parseInline(cell)}</th>`;
        }
        table += '</tr></thead><tbody>';
        for (const row of bodyRows) {
          if (!row) continue;
          table += '<tr>';
          for (const cell of row) {
            table += `<td>${parseInline(cell)}</td>`;
          }
          table += '</tr>';
        }
        table += '</tbody></table>';
        blocks.push(table);
      }
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) && !isDiagramLikeLine(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim()) && !isDiagramLikeLine(lines[i])) {
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

    if (isDiagramLikeLine(line)) {
      blocks.push(renderPreBlock(line.replace(/\s+$/, ''), 'diagram-block'));
      i += 1;
      continue;
    }

    blocks.push(`<p>${parseInline(trimmed)}</p>`);
    i += 1;
  }

  const bodyHtml = blocks.join('\n');
  const pageTitle = docTitle || fallbackTitle || '未命名文档';

  if (!wrapDocument) {
    return bodyHtml;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #172b4d; }
    h1 { font-size: 28px; border-bottom: 1px solid #dfe1e6; padding-bottom: 8px; }
    h2 { font-size: 22px; margin-top: 28px; }
    h3 { font-size: 18px; margin-top: 22px; }
    pre, pre code { white-space: pre; word-wrap: normal; overflow-x: auto; tab-size: 4; }
    pre { background: #f4f5f7; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    pre.text-diagram, pre.diagram-block { font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, "Courier New", monospace; line-height: 1.35; font-size: 13px; letter-spacing: 0; }
    .diagram-hint { color: #5e6c84; font-size: 13px; margin: 16px 0 6px; }
    .mermaid-wrapper { margin: 20px 0 28px; }
    .mermaid-render { background: #fff; border: 1px solid #dfe1e6; border-radius: 8px; padding: 16px; overflow-x: auto; }
    pre.mermaid { background: transparent; padding: 0; margin: 0; white-space: pre-wrap; font-family: inherit; }
    .mermaid-render svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
    .mermaid-source { margin-top: 10px; }
    .mermaid-source summary { cursor: pointer; color: #5e6c84; font-size: 13px; user-select: none; }
    code { font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; }
    th { background: #f4f5f7; }
    blockquote { border-left: 4px solid #dfe1e6; margin: 16px 0; padding: 4px 16px; color: #5e6c84; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 1px solid #dfe1e6; margin: 24px 0; }
  </style>
</head>
<body>
${bodyHtml}
${MERMAID_BOOTSTRAP}
</body>
</html>
`;
}

module.exports = {
  convertMarkdownToConfluenceHtml,
  preprocessMarkdown,
  collectPreformattedBlock,
  isDiagramLikeLine,
  isHorizontalRuleLine,
  isMarkdownListLine,
  isTaskListLine,
  looksLikeMarkdownTable,
  parseTableRow,
  escapeHtml,
  parseInline,
  isDiagramContent,
  extractDiagramSourceFromCommentLine,
  formatMermaidSource,
};
