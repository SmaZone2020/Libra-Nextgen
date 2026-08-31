import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

function scriptKindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.mjs' || ext === '.cjs' || ext === '.js') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function collectCommentRanges(text, scriptKind) {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, scriptKind);
  const ranges = [];
  const seen = new Set();
  const add = (r) => {
    if (r && !seen.has(r.pos)) {
      seen.add(r.pos);
      ranges.push({ pos: r.pos, end: r.end });
    }
  };
  const visit = (node) => {
    for (const r of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) add(r);
    for (const r of ts.getTrailingCommentRanges(text, node.end) ?? []) add(r);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const r of ts.getTrailingCommentRanges(text, sf.end) ?? []) add(r);
  ranges.sort((a, b) => a.pos - b.pos);
  return ranges;
}

function processFile(file) {
  const orig = readFileSync(file, 'utf8');
  const scriptKind = scriptKindOf(file);
  const ranges = collectCommentRanges(orig, scriptKind);

  const spans = [];
  for (const r of ranges) {
    const commentText = orig.slice(r.pos, r.end);
    if (!CJK.test(commentText)) continue;
    const lineStart = orig.lastIndexOf('\n', r.pos - 1) + 1;
    let lineEnd = orig.indexOf('\n', r.end);
    if (lineEnd === -1) lineEnd = orig.length;
    const before = orig.slice(lineStart, r.pos);
    const after = orig.slice(r.end, lineEnd);
    const wholeLine = /^\s*$/.test(before) && /^\s*$/.test(after);
    if (wholeLine) {
      spans.push([lineStart, lineEnd < orig.length ? lineEnd + 1 : lineEnd]);
    } else {
      spans.push([r.pos, r.end]);
    }
  }
  if (spans.length === 0) return { file, removed: 0 };

  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1];
    if (spans[i][0] <= prev[1]) prev[1] = Math.max(prev[1], spans[i][1]);
    else merged.push(spans[i]);
  }

  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += orig.slice(cursor, s);
    cursor = e;
  }
  out += orig.slice(cursor);
  if (out !== orig) writeFileSync(file, out, 'utf8');
  return { file, removed: merged.length };
}

const files = process.argv.slice(2);
let total = 0;
for (const f of files) {
  const r = processFile(f);
  if (r.removed > 0) {
    console.log(`${r.removed}\t${f}`);
    total += r.removed;
  }
}
console.log(`TOTAL COMMENT SPANS REMOVED: ${total}`);
