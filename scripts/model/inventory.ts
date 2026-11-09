/**
 * Count what a folder of company reports holds, by type, size and distinct
 * content (2026-11-10, the owner's AI accuracy programme, batch AA, item 1).
 *
 *   npx tsx scripts/model/inventory.ts --data <dir> [--data <dir> ...] --out <file.json>
 *
 * --data  a folder of reports, searched recursively: the company share's local
 *         copy, the archives unpacked beside it. OUTSIDE the repository.
 * --out   the manifest, also outside the repository: per type, the files, the
 *         bytes and how many distinct contents (by MD5) there are. It names no
 *         file; the console prints the same counts.
 *
 * A remote-desktop connection (.rdp) is counted and never opened: it can hold
 * a server's address and a saved credential. Nothing else is read beyond its
 * bytes for the MD5. Pure ASCII, as every script here.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirs = args.flatMap((a, i) => (a === '--data' && args[i + 1] ? [resolve(args[i + 1])] : []));
const outAt = args.indexOf('--out');
const out = outAt >= 0 && args[outAt + 1] ? resolve(args[outAt + 1]) : '';
if (!dirs.length || !out) {
  console.error('--data <dir> and --out <file> are required. See the doc comment of scripts/model/inventory.ts.');
  process.exit(2);
}
const inside = (p: string) => {
  const r = relative(resolve('.'), p);
  return !r.startsWith('..') && !isAbsolute(r);
};
if (dirs.some(inside) || inside(out)) {
  console.error('--data and --out must be outside the repository: company reports never enter it.');
  process.exit(2);
}

/** Types whose content is hashed, so copies are counted once. */
const HASHED = new Set(['.rpt', '.repx', '.sql', '.pdf', '.rdl', '.rdlc', '.frx', '.xml']);
/** Counted, never opened. */
const NEVER_OPEN = new Set(['.rdp']);

interface TypeCount {
  files: number;
  bytes: number;
  distinct?: number;
}
const types = new Map<string, TypeCount & { hashes?: Set<string> }>();

function walk(dir: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      walk(path);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase() || '(none)';
    const t = types.get(ext) ?? { files: 0, bytes: 0 };
    t.files++;
    t.bytes += statSync(path).size;
    if (HASHED.has(ext) && !NEVER_OPEN.has(ext)) {
      t.hashes ??= new Set();
      t.hashes.add(createHash('md5').update(readFileSync(path)).digest('hex'));
    }
    types.set(ext, t);
  }
}
for (const d of dirs) walk(d);

const manifest = {
  date: new Date().toISOString().slice(0, 10),
  folders: dirs.length,
  types: Object.fromEntries(
    [...types.entries()]
      .sort((a, b) => b[1].files - a[1].files)
      .map(([ext, t]) => [ext, { files: t.files, bytes: t.bytes, ...(t.hashes ? { distinct: t.hashes.size } : {}) }]),
  ),
};
writeFileSync(out, JSON.stringify(manifest, null, 2));
const total = [...types.values()].reduce((a, t) => a + t.files, 0);
console.log(`${total} files in ${dirs.length} folder(s); by type (files, MB, distinct):`);
for (const [ext, t] of Object.entries(manifest.types).slice(0, 15)) {
  console.log(`  ${ext.padEnd(8)} ${String(t.files).padStart(6)}  ${(t.bytes / 1048576).toFixed(1).padStart(8)}${'distinct' in t ? `  ${t.distinct}` : ''}`);
}
console.log(`Written to ${out}`);
