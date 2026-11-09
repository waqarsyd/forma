/**
 * What the company's SQL scripts say about how its reports are fed, as
 * statistics with no name in them (2026-11-10, the owner's AI accuracy
 * programme, batch AA, item 4).
 *
 *   npx tsx scripts/model/sqlStats.ts --data <dir> [--data <dir> ...] --out <file.json>
 *
 * Reads every .sql under the folders (OUTSIDE the repository) and counts, per
 * distinct file: the statements (tables, views, procedures, functions created),
 * each procedure's parameters and their SQL types, the joins and their kinds,
 * GROUP BY, ORDER BY, aggregates, temporary tables and dynamic SQL, and the
 * SQL types the columns are declared with. Those are the shapes the AI meets
 * when it binds a report to a database (the SQL Server programme, batches DB to
 * DG), measured on the company's own scripts.
 *
 * No table, column, procedure or parameter name, no literal and no comment
 * reaches the output or the console: only counts and SQL type keywords. The
 * output stays local; nothing here ships.
 *
 * Pure ASCII, as every script here.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirs = args.flatMap((a, i) => (a === '--data' && args[i + 1] ? [resolve(args[i + 1])] : []));
const outAt = args.indexOf('--out');
const out = outAt >= 0 && args[outAt + 1] ? resolve(args[outAt + 1]) : '';
if (!dirs.length || !out) {
  console.error('--data <dir> and --out <file> are required. See the doc comment of scripts/model/sqlStats.ts.');
  process.exit(2);
}
const inside = (p: string) => {
  const r = relative(resolve('.'), p);
  return !r.startsWith('..') && !isAbsolute(r);
};
if (dirs.some(inside) || inside(out)) {
  console.error('--data and --out must be outside the repository.');
  process.exit(2);
}

function* sqlFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* sqlFiles(path);
    else if (e.isFile() && extname(e.name).toLowerCase() === '.sql') yield path;
  }
}

/** A script's text as SQL Server Management Studio saves it: UTF-16 with a BOM, or UTF-8. */
function textOf(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

/** Comments and string literals out, so no literal reaches a count by accident. */
function codeOf(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/N?'(?:[^']|'')*'/g, "''");
}

const counts: Record<string, number> = {};
const add = (key: string, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};
const histogram: Record<string, Record<string, number>> = { procParams: {}, joinsPerSelect: {} };
const bump = (h: string, key: string) => {
  histogram[h][key] = (histogram[h][key] ?? 0) + 1;
};
const sqlTypes: Record<string, number> = {};
const TYPE = /\b(bigint|int|smallint|tinyint|bit|decimal|numeric|money|smallmoney|float|real|date|datetime2?|smalldatetime|datetimeoffset|time|char|varchar|nchar|nvarchar|text|ntext|uniqueidentifier|varbinary|binary|image|xml)\b/gi;

const seen = new Set<string>();
for (const dir of dirs) {
  for (const path of sqlFiles(dir)) {
    const bytes = readFileSync(path);
    const md5 = createHash('md5').update(bytes).digest('hex');
    add('files');
    if (seen.has(md5)) continue;
    seen.add(md5);
    add('distinctFiles');
    const code = codeOf(textOf(bytes));
    const lower = code.toLowerCase();
    for (const [key, re] of Object.entries({
      createTable: /\bcreate\s+table\b/g,
      createView: /\bcreate\s+(or\s+alter\s+)?view\b/g,
      createProcedure: /\bcreate\s+(or\s+alter\s+)?proc(edure)?\b/g,
      alterProcedure: /\balter\s+proc(edure)?\b/g,
      createFunction: /\bcreate\s+(or\s+alter\s+)?function\b/g,
      select: /\bselect\b/g,
      insert: /\binsert\s+into\b/g,
      update: /\bupdate\b/g,
      delete: /\bdelete\b/g,
      groupBy: /\bgroup\s+by\b/g,
      orderBy: /\border\s+by\b/g,
      union: /\bunion\b/g,
      tempTable: /#[a-z_]\w*/g,
      dynamicSql: /\b(sp_executesql|exec\s*\()/g,
      cte: /\bwith\s+\w+\s+as\s*\(/g,
      sum: /\bsum\s*\(/g,
      count: /\bcount\s*\(/g,
      avg: /\bavg\s*\(/g,
      min: /\bmin\s*\(/g,
      max: /\bmax\s*\(/g,
      joins: /\bjoin\b/g,
      leftJoin: /\bleft\s+(outer\s+)?join\b/g,
      rightJoin: /\bright\s+(outer\s+)?join\b/g,
      crossApply: /\bcross\s+apply\b/g,
      pivot: /\bpivot\b/g,
    })) {
      const n = (lower.match(re) ?? []).length;
      if (n) add(key, n);
    }
    // Each procedure's parameters: between its name and AS, the @names (counted, never kept).
    for (const m of lower.matchAll(/\b(?:create|alter)\s+(?:or\s+alter\s+)?proc(?:edure)?\s+[^\s(]+\s*\(?([\s\S]*?)\bas\b/g)) {
      const params = (m[1].match(/@\w+/g) ?? []).length;
      bump('procParams', params >= 10 ? '10+' : String(params));
      for (const t of m[1].match(TYPE) ?? []) sqlTypes[`param:${t.toLowerCase()}`] = (sqlTypes[`param:${t.toLowerCase()}`] ?? 0) + 1;
    }
    // Joins per SELECT, by splitting at each select.
    for (const part of lower.split(/\bselect\b/).slice(1)) {
      const joins = (part.split(/\bselect\b/)[0].match(/\bjoin\b/g) ?? []).length;
      bump('joinsPerSelect', joins >= 6 ? '6+' : String(joins));
    }
    // Column types in CREATE TABLE bodies.
    for (const m of lower.matchAll(/\bcreate\s+table\s+[^\s(]+\s*\(([\s\S]*?)\)\s*(?:on\b|;|\bgo\b|$)/g)) {
      for (const t of m[1].match(TYPE) ?? []) sqlTypes[`column:${t.toLowerCase()}`] = (sqlTypes[`column:${t.toLowerCase()}`] ?? 0) + 1;
    }
  }
}

const result = { date: new Date().toISOString().slice(0, 10), counts, histogram, sqlTypes };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${counts.files ?? 0} .sql files, ${counts.distinctFiles ?? 0} distinct.`);
for (const key of ['createTable', 'createView', 'createProcedure', 'alterProcedure', 'createFunction', 'select', 'groupBy', 'orderBy', 'tempTable', 'dynamicSql', 'cte', 'joins', 'leftJoin', 'pivot']) {
  console.log(`  ${key.padEnd(16)} ${counts[key] ?? 0}`);
}
console.log(`  parameters per procedure: ${JSON.stringify(histogram.procParams)}`);
console.log(`  joins per SELECT: ${JSON.stringify(histogram.joinsPerSelect)}`);
console.log(`Written to ${out}`);
