// Minimal, defensive unified-diff applier — ported verbatim from the Worker's
// src/diffApply.js (pure logic, no runtime deps). STRICT: a context mismatch fails
// rather than guessing. See the Worker copy for the full rationale.

export function parseUnifiedDiff(diff) {
  const lines = (diff || '').split('\n');
  const files = [];
  let cur = null;
  let hunk = null;

  const pushHunk = () => { if (cur && hunk) { cur.hunks.push(hunk); hunk = null; } };
  const pushFile = () => { pushHunk(); if (cur) { files.push(cur); cur = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git')) {
      pushFile();
      cur = { oldPath: null, newPath: null, isNew: false, isDelete: false, hunks: [] };
      continue;
    }
    if (line.startsWith('--- ')) {
      if (!cur) cur = { oldPath: null, newPath: null, isNew: false, isDelete: false, hunks: [] };
      const p = line.slice(4).trim();
      cur.oldPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
      if (p === '/dev/null') cur.isNew = true;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!cur) cur = { oldPath: null, newPath: null, isNew: false, isDelete: false, hunks: [] };
      const p = line.slice(4).trim();
      cur.newPath = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (p === '/dev/null') cur.isDelete = true;
      continue;
    }
    if (line.startsWith('@@')) {
      pushHunk();
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) { hunk = null; continue; }
      hunk = {
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] === undefined ? 1 : parseInt(m[2], 10),
        newStart: parseInt(m[3], 10),
        newLines: m[4] === undefined ? 1 : parseInt(m[4], 10),
        lines: [],
      };
      continue;
    }
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line === '')) {
      hunk.lines.push(line === '' ? ' ' : line);
      continue;
    }
    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }
  }
  pushFile();
  return files;
}

export function applyFilePatch(content, filePatch) {
  if (filePatch.isNew) {
    const added = [];
    for (const h of filePatch.hunks) {
      for (const l of h.lines) {
        if (l.startsWith('+')) added.push(l.slice(1));
      }
    }
    return { ok: true, content: added.join('\n') + (added.length ? '\n' : '') };
  }
  if (filePatch.isDelete) {
    return { ok: true, content: null };
  }

  const src = (content == null ? '' : content).split('\n');
  const out = [];
  let cursor = 0;

  const hunks = [...filePatch.hunks].sort((a, b) => a.oldStart - b.oldStart);

  for (const h of hunks) {
    const start = h.oldStart - 1;
    if (start < cursor) {
      return { ok: false, reason: `overlapping/out-of-order hunk at line ${h.oldStart}` };
    }
    while (cursor < start) {
      if (cursor >= src.length) return { ok: false, reason: `hunk starts past end of file (line ${h.oldStart})` };
      out.push(src[cursor++]);
    }
    for (const raw of h.lines) {
      const tag = raw[0];
      const text = raw.slice(1);
      if (tag === ' ') {
        if (src[cursor] !== text) {
          return { ok: false, reason: `context mismatch near line ${cursor + 1}: expected ${JSON.stringify(text)} got ${JSON.stringify(src[cursor])}` };
        }
        out.push(src[cursor++]);
      } else if (tag === '-') {
        if (src[cursor] !== text) {
          return { ok: false, reason: `removal mismatch near line ${cursor + 1}: expected ${JSON.stringify(text)} got ${JSON.stringify(src[cursor])}` };
        }
        cursor++;
      } else if (tag === '+') {
        out.push(text);
      } else {
        return { ok: false, reason: `unrecognised hunk line: ${JSON.stringify(raw)}` };
      }
    }
  }
  while (cursor < src.length) out.push(src[cursor++]);

  return { ok: true, content: out.join('\n') };
}

export function applyUnifiedDiff(diff, contentByPath) {
  const patches = parseUnifiedDiff(diff);
  if (!patches.length) return { ok: false, reason: 'no file patches found in diff' };
  const results = [];
  for (const fp of patches) {
    const path = fp.newPath || fp.oldPath;
    if (!path) return { ok: false, reason: 'patch with no path' };
    const current = fp.isNew ? '' : (contentByPath[path] != null ? contentByPath[path] : contentByPath[fp.oldPath]);
    if (!fp.isNew && current == null) {
      return { ok: false, reason: `no current content for ${path}`, path };
    }
    const res = applyFilePatch(current, fp);
    if (!res.ok) return { ok: false, reason: res.reason, path };
    results.push({ path, content: res.content, isNew: !!fp.isNew, isDelete: !!fp.isDelete });
  }
  return { ok: true, files: results };
}

export function pathsInDiff(diff) {
  return parseUnifiedDiff(diff)
    .map(fp => fp.newPath || fp.oldPath)
    .filter(Boolean);
}
