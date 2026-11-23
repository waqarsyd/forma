/**
 * Forma's REPX knowledge from a command line (2026-11-11, the full audit's
 * CP-12), for a person or a coding assistant working on a report outside the
 * web app.
 *
 *   npx tsx scripts/repx.ts audit  <file.repx>            what is still wrong, one finding a line
 *   npx tsx scripts/repx.ts repair <file.repx> [out.repx]  every repair Forma makes, then the audit
 *   npx tsx scripts/repx.ts pdf    <file.repx> [out.pdf]   the report's pages as Forma lays them out
 *
 * `audit` exits 1 when an error is found, so it can gate a build. `repair`
 * runs `repairRepx`, the chain the generation runs (src/lib/repairChain.ts),
 * writes `<name>.repaired.repx` beside the input unless told where, and
 * exits 1 when the audit of what it wrote finds an error. Since 2026-11-24
 * (findings GAP1-2 and GAP1-3 of the MCP design audit) it keeps the code a
 * report already had, as the generation keeps the user's own, and it writes
 * Visual Studio's working-file mark only into a `.vsrepx`. The audit still
 * names kept code as the error `report-has-scripts`, so `repair` on a report
 * with scripts of its own now exits 1 where it exited 0 before, when it
 * stripped them (the wave-4 review's REV4-7): a build that gates on `repair`
 * fails for such a report until its code is moved out or the gate reads the
 * audit's codes. `pdf` draws the report with src/lib/draftPdf.ts, which
 * the MCP server's repx_pdf shares: a draft for checking where things fall,
 * not the Preview's PDF export.
 *
 * What each repair and finding means, and how it was measured against
 * DevExpress, is docs/skills/devexpress-repx/SKILL.md and the gemini.md
 * headings it links.
 *
 * Pure ASCII, as every script here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { repairRepx, versionOf } from '../src/lib/repairChain';
import { auditRepx } from '../src/lib/repxAudit';
import { draftPdf } from '../src/lib/draftPdf';
import { hasReportScripts } from '../src/lib/shares';

const [command, file, out] = process.argv.slice(2);
const USAGE = 'usage: npx tsx scripts/repx.ts audit|repair|pdf <file.repx> [out]';

/** A file beside the input, its extension replaced. */
const beside = (path: string, suffix: string) => join(dirname(path), `${basename(path, extname(path))}${suffix}`);

async function main(): Promise<number> {
  if (!command || !file || !['audit', 'repair', 'pdf'].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  const xml = readFileSync(file, 'utf8');
  if (command === 'audit') {
    const audit = auditRepx(xml);
    for (const f of audit.findings) console.log(`${f.severity.padEnd(7)} ${f.code}: ${f.message}`);
    console.log(audit.summary);
    return audit.errors ? 1 : 0;
  }
  if (command === 'repair') {
    const target = out ?? beside(file, '.repaired.repx');
    const repaired = repairRepx(xml, { version: versionOf(xml), keepScripts: hasReportScripts(xml), target: /\.vsrepx$/i.test(target) ? 'vsrepx' : 'repx' });
    writeFileSync(target, repaired.xml);
    const applied = repaired.steps.filter((s) => s.applied);
    for (const s of applied) console.log(`repaired ${s.name}: ${s.reason}`);
    if (!applied.length) console.log('nothing to repair');
    const audit = auditRepx(repaired.xml);
    console.log(`written: ${target}`);
    console.log(audit.summary);
    return audit.errors ? 1 : 0;
  }
  const drawn = await draftPdf(xml, basename(file));
  if (!drawn) {
    console.error('No band could be read from this file.');
    return 1;
  }
  const target = out ?? beside(file, '.pdf');
  writeFileSync(target, drawn.bytes);
  console.log(`written: ${target} (${drawn.pages} page${drawn.pages === 1 ? '' : 's'})`);
  for (const p of drawn.problems) console.log(`note: ${p}`);
  return 0;
}

// Run only as a script, so a test can import it without running it.
if (process.argv[1] && /repx\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
