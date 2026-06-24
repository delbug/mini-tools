const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} = require('docx');
const { fetchMermaidPng } = require('./mermaid-image');
const { renderTextBlockToPng } = require('./text-block-image');
const { loadImageBuffer } = require('./markdown-images');
const {
  preprocessMarkdown,
  collectPreformattedBlock,
  isDiagramLikeLine,
  isHorizontalRuleLine,
  isTaskListLine,
  looksLikeMarkdownTable,
  parseTableRow,
} = require('./markdown-to-confluence');

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function plainText(text) {
  return sanitizeDocxText(String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim());
}

function sanitizeDocxText(text) {
  return String(text || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '');
}

function parseInlineTextRuns(text, opts = {}) {
  const size = opts.size || 24;
  const font = opts.font || 'PingFang SC';
  const src = String(text || '');
  const runs = [];
  const tokenRe = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|`[^`\n]+`|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_)/g;
  let last = 0;
  let match;

  while ((match = tokenRe.exec(src)) !== null) {
    if (match.index > last) {
      runs.push(new TextRun({
        text: sanitizeDocxText(src.slice(last, match.index)),
        size,
        font,
      }));
    }
    const tok = match[0];
    if (tok.startsWith('***')) {
      runs.push(new TextRun({
        text: sanitizeDocxText(tok.slice(3, -3)),
        bold: true,
        italics: true,
        size,
        font,
      }));
    } else if (tok.startsWith('**')) {
      runs.push(new TextRun({
        text: sanitizeDocxText(tok.slice(2, -2)),
        bold: true,
        size,
        font,
      }));
    } else if (tok.startsWith('`')) {
      runs.push(new TextRun({
        text: sanitizeDocxText(tok.slice(1, -1)),
        font: 'Courier New',
        size: 20,
      }));
    } else if (tok.startsWith('*')) {
      runs.push(new TextRun({
        text: sanitizeDocxText(tok.slice(1, -1)),
        italics: true,
        size,
        font,
      }));
    } else if (tok.startsWith('__')) {
      runs.push(new TextRun({
        text: sanitizeDocxText(tok.slice(2, -2)),
        bold: true,
        size,
        font,
      }));
    } else if (tok.startsWith('_')) {
      runs.push(new TextRun({
        text: sanitizeDocxText(tok.slice(1, -1)),
        italics: true,
        size,
        font,
      }));
    }
    last = match.index + tok.length;
  }

  if (last < src.length) {
    runs.push(new TextRun({ text: sanitizeDocxText(src.slice(last)), size, font }));
  }
  if (!runs.length) {
    runs.push(new TextRun({ text: sanitizeDocxText(src), size, font }));
  }
  return runs;
}

function bodyParagraph(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 120, after: 120, line: 276 },
    alignment: opts.alignment,
    children: parseInlineTextRuns(text, opts),
  });
}

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

function imageDimensions(buffer, maxWidth = 620) {
  let width = 620;
  let height = 400;
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  }
  if (width > maxWidth) {
    height = Math.max(1, Math.round(height * maxWidth / width));
    width = maxWidth;
  }
  return { width, height };
}

async function imageParagraphsFromRef(ref, baseDir) {
  try {
    const { buffer } = await loadImageBuffer(ref, baseDir);
    const { width, height } = imageDimensions(buffer);
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
    return [new Paragraph({
      spacing: { before: 120, after: 240 },
      children: [
        new ImageRun({
          type: isJpeg ? 'jpg' : 'png',
          data: buffer,
          transformation: { width, height },
        }),
      ],
    })];
  } catch {
    return [bodyParagraph(`[图片: ${ref}]`)];
  }
}

async function imageBlockParagraphs(content, options = {}) {
  try {
    const { buffer, width, height, format } = await renderTextBlockToPng(content, options);
    return [new Paragraph({
      spacing: { before: 120, after: 240 },
      children: [
        new ImageRun({
          type: format === 'jpg' ? 'jpg' : 'png',
          data: buffer,
          transformation: { width, height },
        }),
      ],
    })];
  } catch {
    return [codeParagraph(content)];
  }
}
function codeParagraph(text) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    shading: { type: ShadingType.CLEAR, fill: 'F4F5F7' },
    children: [
      new TextRun({
        text: sanitizeDocxText(String(text || '')),
        font: 'Courier New',
        size: 20,
      }),
    ],
  });
}

function tableFromMarkdown(headerCells, bodyRows) {
  const colCount = Math.max(headerCells.length, ...bodyRows.map((row) => (row ? row.length : 0)), 1);
  const normalizeRow = (cells) => {
    const row = [...(cells || [])];
    while (row.length < colCount) row.push('');
    return row.slice(0, colCount);
  };
  const header = normalizeRow(headerCells);
  const rows = [];
  rows.push(new TableRow({
    children: header.map((cell) => new TableCell({
      width: { size: 100 / colCount, type: WidthType.PERCENTAGE },
      children: [bodyParagraph(cell)],
      shading: { fill: 'F4F5F7' },
    })),
  }));
  for (const row of bodyRows) {
    if (!row) continue;
    rows.push(new TableRow({
      children: normalizeRow(row).map((cell) => new TableCell({
        width: { size: 100 / colCount, type: WidthType.PERCENTAGE },
        children: [bodyParagraph(cell)],
      })),
    }));
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'DFE1E6' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DFE1E6' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'DFE1E6' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'DFE1E6' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DFE1E6' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DFE1E6' },
    },
    rows,
  });
}

async function mermaidParagraphs(source) {
  try {
    const { buffer, width, height, format } = await fetchMermaidPng(source);
    return [new Paragraph({
      spacing: { before: 120, after: 240 },
      children: [
        new ImageRun({
          type: format === 'jpg' ? 'jpg' : 'png',
          data: buffer,
          transformation: { width, height },
        }),
      ],
    })];
  } catch {
    return imageBlockParagraphs(source, { label: 'Mermaid', kind: 'diagram' });
  }
}

async function parseLinesToDocxChildren(lines, baseDir = '') {
  const children = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const soloImage = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (soloImage) {
      children.push(...await imageParagraphsFromRef(soloImage[2], baseDir));
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
        children.push(...await mermaidParagraphs(content));
      } else {
        children.push(...await imageBlockParagraphs(content, {
          label: blockLabelForLang(lang),
          kind: blockKindForLang(lang),
        }));
      }
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      children.push(new Paragraph({
        heading: HEADINGS[Math.min(level, 6) - 1],
        spacing: { before: 240, after: 120 },
        children: [new TextRun({
          text: plainText(headingMatch[2]),
          bold: true,
          size: 28 - level * 2,
          font: 'PingFang SC',
        })],
      }));
      i += 1;
      continue;
    }

    if (isHorizontalRuleLine(line)) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 200 },
        border: { bottom: { color: 'DFE1E6', space: 1, style: BorderStyle.SINGLE, size: 6 } },
        children: [new TextRun('')],
      }));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      children.push(new Paragraph({
        indent: { left: 720 },
        spacing: { before: 120, after: 120 },
        children: [new TextRun({
          text: plainText(quoteLines.filter(Boolean).join(' ')),
          italics: true,
          color: '5E6C84',
          size: 24,
          font: 'PingFang SC',
        })],
      }));
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
      if (headerCells) children.push(tableFromMarkdown(headerCells, bodyRows));
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
      for (const item of items) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { before: 60, after: 60 },
          children: parseInlineTextRuns(`${item.checked ? '☑' : '☐'} ${item.text}`, { size: 24 }),
        }));
      }
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) && !isDiagramLikeLine(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim()) && !isDiagramLikeLine(lines[i]) && !isTaskListLine(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      for (const item of items) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { before: 60, after: 60 },
          children: parseInlineTextRuns(item, { size: 24 }),
        }));
      }
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      items.forEach((item, idx) => {
        children.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          children: parseInlineTextRuns(`${idx + 1}. ${item}`, { size: 24 }),
        }));
      });
      continue;
    }

    const preBlock = collectPreformattedBlock(lines, i);
    if (preBlock) {
      children.push(...await imageBlockParagraphs(preBlock.content, { label: '结构图', kind: 'diagram' }));
      i = preBlock.end;
      continue;
    }

    if (isDiagramLikeLine(line)) {
      children.push(...await imageBlockParagraphs(line.replace(/\s+$/, ''), { label: '结构图', kind: 'diagram' }));
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
    children.push(bodyParagraph(paraLines.join(' ')));
  }

  return children;
}

async function convertMarkdownToDocx(markdown, options = {}) {
  const { title = '文档', imageBaseDir = '' } = options;
  const lines = preprocessMarkdown(markdown).split('\n');
  const children = await parseLinesToDocxChildren(lines, imageBaseDir);

  if (!children.length) {
    children.push(bodyParagraph(''));
  }

  const doc = new Document({
    creator: 'DeskKit',
    title: plainText(title),
    sections: [{
      properties: {},
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { convertMarkdownToDocx };
