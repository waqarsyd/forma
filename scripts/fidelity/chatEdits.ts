/**
 * What the chat's edits in place cost against the redesign every change used
 * to be (2026-11-05). A measurement, not a check: it spends the owner's free
 * quota, so it is run by hand with their key and its numbers are quoted in
 * the commit that changes what it measures.
 *
 *   npx tsx scripts/fidelity/chatEdits.ts --key-from-clipboard [--old] [--report <file.repx>] [--out <file.json>]
 *
 * For each request below it sends the new turn: the open report's outline and
 * the message, answered with an action and edits (`chatReply` with a report),
 * which Forma applies itself. With `--old` it also sends what the same request
 * cost before: the chat turn that only decided "is this a change", then a
 * redesign of the whole report (`analyzeReportDesign` with the report as
 * `previousState`), for the requests that are edits. The open report is one of
 * the made-up house reports, never company material. The key is read once,
 * from the clipboard or FORMA_BENCH_KEY, and never printed or written; the
 * results carry tokens, actions and counts only.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeReportDesign, chatReply, type ReportConfig } from '../../src/services/geminiService';
import { applyEdits, EDIT_OPS, readReportOutcome, reportOutline, TOOL_LISTS } from '../../src/lib/agentEdit';

/*
 * Each edit changes something the report does not already have. The first
 * run (2026-11-05) asked for a bold title and a right-aligned page number,
 * which sales-by-region.repx already has, and the model rightly answered
 * instead of editing; that is kept below as the "nothing to change" case.
 */
const REQUESTS: { text: string; expect: 'edit' | 'answer' | 'rebuild' }[] = [
  { text: 'Make the subtitle bold.', expect: 'edit' },
  { text: 'Centre the footer note.', expect: 'edit' },
  { text: 'Print it on A4 landscape.', expect: 'edit' },
  { text: 'Make the report title bold.', expect: 'answer' },
  { text: 'Which fields does this report print?', expect: 'answer' },
  { text: 'Add a chart of sales by region at the end.', expect: 'rebuild' },
];

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

function readKey(): string {
  if (!process.argv.includes('--key-from-clipboard')) return process.env.FORMA_BENCH_KEY?.trim() ?? '';
  const result = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() : '';
}

async function main(): Promise<number> {
  const key = readKey();
  if (!key) {
    console.error('No key: copy your Gemini key and pass --key-from-clipboard, or set FORMA_BENCH_KEY for this one process.');
    return 1;
  }
  const reportPath = resolve(arg('--report') ?? 'scripts/fidelity/house/sales-by-region.repx');
  const report = readFileSync(reportPath, 'utf8');
  const old = process.argv.includes('--old');
  const config: ReportConfig = { version: '23.2', unit: 'HundredthsOfAnInch', pageSize: 'Letter', customApiKey: key };
  const outline = reportOutline(report);
  const rows: Record<string, unknown>[] = [];

  for (const request of REQUESTS) {
    const history = [{ role: 'user' as const, text: request.text }];
    const answered = await chatReply(history, config, undefined, undefined, { outline, ops: EDIT_OPS, tools: TOOL_LISTS });
    const outcome = readReportOutcome(answered, request.text);
    const done = outcome.action === 'edit' ? applyEdits(report, outcome.edits) : null;
    const row: Record<string, unknown> = {
      request: request.text,
      expected: request.expect,
      action: outcome.action,
      edits: outcome.edits.length,
      applied: done?.applied.length ?? 0,
      declined: done?.declined ?? [],
      // The model's words about a made-up report: worth keeping to read why.
      reply: outcome.reply,
      newTokens: answered.usage?.total ?? null,
    };
    if (old && request.expect === 'edit') {
      const decided = await chatReply(history, config);
      const redesign = await analyzeReportDesign(request.text, [], config, { repxContent: report });
      row.oldTokens = (decided.usage?.total ?? 0) + (redesign.usage?.total ?? 0);
      row.oldRequests = 2;
    }
    rows.push(row);
    console.log(
      `${request.text.padEnd(46)} ${String(outcome.action).padEnd(8)} applied ${String(row.applied).padStart(2)}  new ${String(row.newTokens ?? '?').padStart(6)} tokens` +
        (row.oldTokens !== undefined ? `  old ${String(row.oldTokens).padStart(6)} tokens in 2 requests` : ''),
    );
  }

  const out = resolve(arg('--out') ?? '../forma-model-data/work/chat-edits.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), report: reportPath.split(/[\\/]/).pop(), rows }, null, 2));
  console.log(`\nWritten to ${out} (tokens, actions and counts only; no key).`);
  return 0;
}

main().then((code) => process.exit(code), (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
