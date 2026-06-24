/**
 * 将语雀 /markdown 接口返回的内容整理为标准 Markdown。
 */

function stripFontTags(text) {
  let result = text;
  let prev;
  do {
    prev = result;
    result = result.replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1');
  } while (result !== prev);
  return result;
}

function stripCommonHtml(text) {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(span|div|p|u|sub|sup|section|article)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeHeadings(text) {
  let result = text.replace(/^(#{1,6})\s+\*\*(.+)\*\*\s*$/gm, (_, hashes, inner) => {
    const title = inner.replace(/\*{2,}/g, '').replace(/\s+/g, ' ').trim();
    return `${hashes} ${title}`;
  });

  // 语雀文档常有灰色副标题 + 正文一级标题，将连续两个 # 的第一个降为引用块
  result = result.replace(/^# ([^\n]+)\n(# .+)/m, (_, subtitle, heading) => `> ${subtitle.trim()}\n\n${heading}`);

  return result;
}

function normalizeBoldFragments(text) {
  return text
    .replace(/\*{4,}/g, '')
    .replace(/\*\*\s+\*\*/g, ' ')
    .replace(/\*\*\*\*/g, '');
}

function normalizeTableCells(text) {
  return text.replace(/^\|(.+)\|$/gm, (line) => {
    if (/^\|[\s:|-]+\|$/.test(line.replace(/\s/g, ''))) return line;
    const cells = line.slice(1, -1).split('|');
    const cleaned = cells.map((cell) => {
      let c = cell.trim();
      c = c.replace(/^\*\*(.+)\*\*$/g, '$1');
      c = c.replace(/\*{2,}/g, '');
      return ` ${c.trim()} `;
    });
    return `|${cleaned.join('|')}|`;
  });
}

function normalizeImages(text) {
  let result = text;
  // 同一行多张图片分行
  result = result.replace(/(!\[[^\]]*\]\([^)]+\))\s*(!\[[^\]]*\]\([^)]+\))/g, '$1\n\n$2');
  // 图片前后补空行
  result = result.replace(/([^\n])\n?(!\[[^\]]*\]\([^)]+\))/g, '$1\n\n$2');
  result = result.replace(/(!\[[^\]]*\]\([^)]+\))\n?([^\n!])/g, '$1\n\n$2');
  return result;
}

function normalizeLists(text) {
  return text.replace(/^(\s*)(\d+\.)\s+/gm, '$1$2 ');
}

function normalizeWhitespace(text) {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeYuqueMarkdown(raw, options = {}) {
  const { standard = true } = options;
  if (!standard) return raw;

  let md = String(raw || '');
  md = stripCommonHtml(md);
  md = stripFontTags(md);
  md = normalizeBoldFragments(md);
  md = normalizeHeadings(md);
  md = normalizeTableCells(md);
  md = normalizeImages(md);
  md = normalizeLists(md);
  md = normalizeWhitespace(md);

  return md.trim() + '\n';
}

module.exports = { normalizeYuqueMarkdown };
