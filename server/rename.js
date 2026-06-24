const path = require('path');

function sanitizeName(name) {
  return String(name)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/, '')
    .slice(0, 255);
}

function splitBaseExt(filename) {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return { base, ext };
}

function applyRemove(base, patterns = []) {
  let n = base;
  for (const pat of patterns) {
    if (!pat) continue;
    try {
      n = n.replace(new RegExp(pat, 'g'), '');
    } catch {
      n = n.split(pat).join('');
    }
  }
  return n;
}

function applyReplace(base, from, to) {
  if (!from) return base;
  return base.split(from).join(to ?? '');
}

function formatSequence(num, padWidth) {
  const s = String(num);
  if (!padWidth || padWidth <= 0) return s;
  return s.padStart(padWidth, '0');
}

function applyDeleteAt(base, start, count) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return base;
  // start：保留前几个字符，其后删除 count 个（例：123456 保留 2 删 2 → 1256）
  const keep = Math.max(0, Number(start) || 0);
  if (keep >= base.length) return base;
  return base.slice(0, keep) + base.slice(keep + n);
}

function applyInsert(base, index, content) {
  const i = Math.max(0, Math.min(base.length, Number(index) || 0));
  return base.slice(0, i) + content + base.slice(i);
}

/**
 * @param {string} originalName - full filename with extension
 * @param {object} rules
 * @param {number} seqIndex - 0-based index in batch for sequence
 */
function transformFileName(originalName, rules, seqIndex = 0) {
  const { base, ext } = splitBaseExt(originalName);
  let name = rules.includeExtension ? originalName : base;
  let outExt = rules.includeExtension ? '' : ext;

  if (!rules.includeExtension) {
    name = base;
    if (rules.removePatterns?.length) {
      name = applyRemove(name, rules.removePatterns);
    }
    if (rules.deleteAt?.enabled) {
      name = applyDeleteAt(name, rules.deleteAt.start ?? 1, rules.deleteAt.count ?? 0);
    }
    if (rules.replaceFrom) {
      name = applyReplace(name, rules.replaceFrom, rules.replaceTo ?? '');
    }
    if (Array.isArray(rules.replacements)) {
      for (const pair of rules.replacements) {
        if (pair?.from) name = applyReplace(name, pair.from, pair.to ?? '');
      }
    }

    if (rules.insert?.enabled) {
      const insertContent = rules.insert.useSequence
        ? formatSequence(
            (rules.sequence?.start ?? 1) + seqIndex * (rules.sequence?.step ?? 1),
            rules.sequence?.padWidth ?? 0,
          )
        : (rules.insert.content ?? '');
      if (insertContent) {
        name = applyInsert(name, rules.insert.index ?? 0, insertContent);
      }
    }

    if (rules.sequence?.enabled && rules.sequence.position === 'insert') {
      const seq = formatSequence(
        (rules.sequence.start ?? 1) + seqIndex * (rules.sequence.step ?? 1),
        rules.sequence.padWidth ?? 0,
      );
      const sep = rules.sequence.separator ?? '';
      name = applyInsert(name, rules.sequence.insertIndex ?? 0, sep + seq);
    }

    if (rules.prefix) name = rules.prefix + name;
    if (rules.suffix) name = name + rules.suffix;

    if (rules.sequence?.enabled) {
      const seq = formatSequence(
        (rules.sequence.start ?? 1) + seqIndex * (rules.sequence.step ?? 1),
        rules.sequence.padWidth ?? 0,
      );
      const sep = rules.sequence.separator ?? '';
      if (rules.sequence.position === 'prefix') {
        name = seq + sep + name;
      } else if (rules.sequence.position === 'suffix') {
        name = name + sep + seq;
      }
    }

    name = sanitizeName(name);
    if (!name) return { newName: '', error: '处理后名称为空' };
    return { newName: name + ext, error: null };
  }

  // includeExtension mode - rare
  name = sanitizeName(name);
  return { newName: name, error: name ? null : '处理后名称为空' };
}

function collectEntries(root, options = {}) {
  const {
    recursive = true,
    scope = 'files',
    ignorePatterns = [],
  } = options;

  const entries = [];
  const shouldIgnore = (name) => {
    if (['.DS_Store', '.git'].includes(name)) return true;
    return ignorePatterns.some((p) => name.includes(p));
  };

  function walk(dir, relDir = '') {
    let list;
    try {
      list = require('fs').readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const ent of sorted) {
      if (shouldIgnore(ent.name)) continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (scope === 'directories' || scope === 'both') {
          entries.push({ relativePath: rel, name: ent.name, kind: 'directory', parent: relDir, absolutePath: full });
        }
        if (recursive) walk(full, rel);
      } else if (ent.isFile() && (scope === 'files' || scope === 'both')) {
        entries.push({ relativePath: rel, name: ent.name, kind: 'file', parent: relDir, absolutePath: full });
      }
    }
  }

  walk(root);
  return entries;
}

function buildRenamePlan(root, rules, options = {}) {
  const entries = collectEntries(root, options);
  const plan = [];
  const usedNames = new Map();

  entries.forEach((entry, idx) => {
    const { newName, error } = transformFileName(entry.name, rules, idx);
    const newRelative = entry.parent ? `${entry.parent}/${newName}` : newName;
    let status = 'ready';
    let reason = '';

    if (error) {
      status = 'invalid';
      reason = error;
    } else if (newName === entry.name) {
      status = 'unchanged';
      reason = '名称未变化';
    } else {
      const key = `${entry.parent}\0${newName}`;
      if (usedNames.has(key)) {
        status = 'collision';
        reason = `与「${usedNames.get(key)}」重名`;
      } else {
        const exists = entries.some(
          (e) => e.parent === entry.parent && e.name === newName && e.relativePath !== entry.relativePath,
        );
        if (exists) {
          status = 'collision';
          reason = '目标名称已存在';
        }
      }
      usedNames.set(key, entry.relativePath);
    }

    plan.push({
      ...entry,
      oldName: entry.name,
      newName,
      newRelativePath: newRelative,
      status,
      reason,
    });
  });

  return plan;
}

function executeRenamePlan(root, planItems) {
  const fs = require('fs');
  const renamed = [];
  const errors = [];

  const sorted = [...planItems]
    .filter((p) => p.status === 'ready')
    .sort((a, b) => b.relativePath.length - a.relativePath.length);

  for (const item of sorted) {
    const oldPath = path.join(root, item.relativePath);
    const newPath = path.join(root, item.newRelativePath);
    try {
      if (!fs.existsSync(oldPath)) {
        errors.push({ ...item, message: '源不存在' });
        continue;
      }
      if (fs.existsSync(newPath)) {
        errors.push({ ...item, message: '目标已存在' });
        continue;
      }
      fs.renameSync(oldPath, newPath);
      renamed.push(item);
    } catch (err) {
      errors.push({ ...item, message: err.message });
    }
  }

  return { renamed, errors };
}

function findDuplicates(root, ignorePatterns = []) {
  const crypto = require('crypto');
  const fs = require('fs');
  const files = collectEntries(root, { recursive: true, scope: 'files', ignorePatterns });
  const byHash = new Map();

  for (const f of files) {
    try {
      const buf = fs.readFileSync(f.absolutePath);
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push({ ...f, md5: hash, size: buf.length });
    } catch {
      /* skip */
    }
  }

  const groups = [];
  for (const [hash, items] of byHash) {
    if (items.length > 1) {
      groups.push({ md5: hash, size: items[0].size, count: items.length, files: items });
    }
  }
  groups.sort((a, b) => b.count - a.count);
  return groups;
}

module.exports = {
  sanitizeName,
  transformFileName,
  collectEntries,
  buildRenamePlan,
  executeRenamePlan,
  findDuplicates,
};
