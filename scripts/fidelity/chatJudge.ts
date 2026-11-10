/**
 * The chat scored on twenty requests, by code and by an AI judge (2026-11-10,
 * the owner's AI accuracy programme, batch AH, item 27; the requests, the
 * checks and the rubric are src/lib/chatJudge.ts).
 *
 *   npx tsx scripts/fidelity/chatJudge.ts --dry-run
 *   npx tsx scripts/fidelity/chatJudge.ts --key-from-clipboard [--only <id>] [--out <file.json>]
 *
 * Each request is sent as App sends a chat turn with a report open: a plain
 * question about the report is answered from its facts with no AI
 * (lib/reportFacts.ts), a question about Forma carries the Docs articles it
 * is about (lib/docsKnowledge.ts, the Docs page drawn under jsdom as the app
 * draws it off screen), the outline goes with its facts block, and the edits
 * are made with the data's fields held (`EditHooks.fields`). Then code checks
 * the turn and, for each turn the AI answered, a judge model scores the reply
 * against what the assistant was given (`judgePrompt`), on the same key, at
 * temperature 0, on the small model the chat itself uses.
 *
 * It spends the owner's quota, some 40 requests, so it is prepared and run by
 * hand. `--dry-run` spends nothing: it answers what Forma answers alone, picks
 * the Docs articles, and prints what a run would send and what it would cost.
 * The reports are made up (scripts/fidelity/house, and a customer list with a
 * SQL data source over a made-up database built below); the key is read once
 * and never written; the results carry actions, checks, scores and the
 * replies about made-up reports, and go outside the repository.
 *
 * Pure ASCII, as every script here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chatReply, resolveModel, generateSmall, type ReportConfig } from '../../src/services/geminiService';
import { applyEdits, EDIT_OPS, readReportOutcome, reportOutline, TOOL_LISTS } from '../../src/lib/agentEdit';
import { answerFromFacts, dataFieldsOf, factsBlock, inventedFields, reportFacts } from '../../src/lib/reportFacts';
import { docsFor } from '../../src/lib/docsKnowledge';
import { CHAT_QUERIES, codeChecks, judgePrompt, readJudgement, scorecard, type ChatQuery, type Judgement, type TurnRecord } from '../../src/lib/chatJudge';
import { lightModel } from '../../src/lib/modelCache';
import { loadGenAI } from '../../src/lib/genai';
import { readSchemaScript } from '../../src/lib/sqlSchema';
import { writeSqlDataSource } from '../../src/lib/repxSqlWriter';

const argv = process.argv.slice(2);
const valueOf = (flag: string) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
const dryRun = argv.includes('--dry-run');
const only = valueOf('--only');

/** A customer list grouped by region with a sum, reading a made-up database: the report the data requests are about. */
function dataReport(): string {
  const label = (n: number, name: string, expression: string, summary = '') =>
    `<Item${n} Ref="${n + 10}" ControlType="XRLabel" Name="${name}" LocationFloat="${(n - 1) * 160}, 0" SizeF="150,20" Dpi="100">${summary}<ExpressionBindings><Item1 Ref="${n + 50}" EventName="BeforePrint" PropertyName="Text" Expression="${expression}" /></ExpressionBindings></Item${n}>`;
  const report = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="Customers" DisplayName="Customers by region" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="40" Dpi="100"><Controls><Item1 Ref="9" ControlType="XRLabel" Name="labelTitle" Text="Customers by region" SizeF="400,30" Font="Arial, 16pt, style=Bold" Dpi="100" /></Controls></Item2>
    <Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>${label(1, 'labelCompany', '[CompanyName]')}${label(2, 'labelCity', '[City]')}${label(3, 'labelRegion', '[Region]')}</Controls></Item3>
    <Item4 Ref="5" ControlType="ReportFooterBand" Name="ReportFooter" HeightF="25" Dpi="100"><Controls>${label(4, 'labelTotal', 'sumSum([Credit])', '<Summary Ref="91" Running="Report" />')}</Controls></Item4>
    <Item5 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;
  const schema = readSchemaScript(
    'CREATE TABLE dbo.Customers (CustomerID int PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, City nvarchar(40) NULL, Region nvarchar(20) NULL, Credit decimal(10,2) NULL, Phone nvarchar(24) NULL);',
    'FormaSample',
  )!;
  return writeSqlDataSource(report, { connectionName: 'FormaSample', schema, query: { kind: 'table', object: 'dbo.Customers', columns: [], joins: [], sort: [] } }).xml;
}

function reportFor(q: ChatQuery): string {
  return q.report === 'data' ? dataReport() : readFileSync(resolve(`scripts/fidelity/house/${q.report}.repx`), 'utf8');
}

/** The Docs page drawn under jsdom, as the app draws it off screen, so a docs question is given what the site says. */
async function docsLoader() {
  // jsdom is the test suite's, without type declarations here; loaded by a specifier TypeScript does not resolve.
  const jsdom = 'jsdom';
  const { JSDOM } = (await import(jsdom)) as { JSDOM: new (html: string, options: { url: string }) => { window: unknown } };
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'getComputedStyle', 'matchMedia', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    if (g[k] === undefined) g[k] = (dom.window as unknown as Record<string, unknown>)[k];
  }
  g.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  (dom.window as unknown as Record<string, unknown>).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.matchMedia ??= (dom.window as unknown as Record<string, unknown>).matchMedia;
  // The page's ruler reads a frame and the window's width; jsdom has neither.
  const w = dom.window as unknown as Record<string, unknown>;
  w.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 0);
  w.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
  g.requestAnimationFrame ??= w.requestAnimationFrame;
  g.cancelAnimationFrame ??= w.cancelAnimationFrame;
  const { loadDocsSections } = await import('../../src/components/docsCorpus');
  return loadDocsSections;
}

function readKey(): string {
  if (!argv.includes('--key-from-clipboard')) return process.env.FORMA_BENCH_KEY?.trim() ?? '';
  const result = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() : '';
}

async function main(): Promise<number> {
  const key = dryRun ? '' : readKey();
  if (!dryRun && !key) {
    console.error('No key: copy your Gemini key and pass --key-from-clipboard, or set FORMA_BENCH_KEY for this one process, or use --dry-run.');
    return 1;
  }
  const config: ReportConfig = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter', customApiKey: key };
  const load = await docsLoader();
  const judgeModel = dryRun ? '' : lightModel(await resolveModel(key));
  const ai = dryRun ? null : new (await loadGenAI()).GoogleGenAI({ apiKey: key });
  const rows: { q: ChatQuery; checks: ReturnType<typeof codeChecks>; judgement: Judgement | null; requests: number; turn: TurnRecord; docs: string[] }[] = [];

  for (const q of CHAT_QUERIES.filter((x) => !only || x.id === only)) {
    const report = reportFor(q);
    const facts = reportFacts(report);
    const known = answerFromFacts(q.text, facts);
    const docs = await docsFor(q.text, load);
    const outline = `${reportOutline(report)}\n${factsBlock(facts)}`;
    let turn: TurnRecord;
    let requests = 0;
    if (known) {
      turn = { action: 'forma', reply: known, applied: [], declined: [], invented: [] };
    } else if (dryRun) {
      turn = { action: '(not sent)', reply: '', applied: [], declined: [], invented: [] };
      requests = 2;
    } else {
      const answered = await chatReply([{ role: 'user', text: q.text }], config, undefined, undefined, { outline, ops: EDIT_OPS, tools: TOOL_LISTS }, '', undefined, docs.block);
      const outcome = readReportOutcome(answered, q.text);
      const done = outcome.action === 'edit' ? applyEdits(report, outcome.edits, { fields: (xml) => dataFieldsOf(xml) }) : null;
      turn = {
        action: outcome.action,
        reply: outcome.reply,
        applied: done ? outcome.edits.filter((_, i) => i < done.applied.length).map((e) => e.op) : [],
        declined: done?.declined ?? [],
        invented: inventedFields(outcome.reply, facts),
      };
      requests = 1;
    }
    let judgement: Judgement | null = null;
    if (ai && !known) {
      const given = [outline, docs.block].filter(Boolean).join('\n\n');
      const answer = await generateSmall(ai, { model: judgeModel, contents: judgePrompt(q, given, turn), config: { temperature: 0, maxOutputTokens: 300 } });
      judgement = readJudgement(answer.text ?? '');
      requests++;
    }
    const checks = dryRun && !known ? [] : codeChecks(q, turn);
    rows.push({ q, checks, judgement, requests, turn, docs: docs.ids });
    console.log(
      `${q.id.padEnd(16)} ${q.kind.padEnd(7)} ${known ? 'Forma, no AI' : dryRun ? `would send 2 requests${docs.ids.length ? `, docs ${docs.ids.join(', ')}` : ''}` : `${turn.action}, ${checks.filter((c) => c.pass).length}/${checks.length} checks, judge ${judgement?.score ?? '?'}`}`,
    );
  }

  console.log(`\n${scorecard(rows)}`);
  if (dryRun) {
    console.log('\nDry run: nothing was sent. A run with a key sends the requests counted above, on the small model the chat uses.');
    return 0;
  }
  const out = resolve(valueOf('--out') ?? `../forma-model-data/work/chat-judge-${new Date().toISOString().slice(0, 10)}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), judgeModel, rows: rows.map((r) => ({ id: r.q.id, kind: r.q.kind, turn: r.turn, checks: r.checks, judgement: r.judgement, requests: r.requests, docs: r.docs })) }, null, 2));
  console.log(`Written to ${out} (no key).`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
