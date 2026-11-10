/**
 * The chat scored: twenty requests, checked in code and by an AI judge
 * (2026-11-10, the owner's AI accuracy programme, batch AH, item 27).
 *
 * The chat's quality was measured once, by hand, on six requests
 * (scripts/fidelity/chatEdits.ts, 2026-11-05). These are twenty, each in
 * words the owner or the agent audits used, against made-up reports only:
 * - **What code can hold**, checked in code: the action the turn took
 *   (answer, edit, rebuild, new), that an edit was made, the facts the reply
 *   must state, that it names no field the report's data lacks, and the
 *   phrases it must not say.
 * - **What only reading can judge**, by a second model with a rubric
 *   (`judgePrompt`): is the reply correct, grounded in what it was given, and
 *   helpful, scored 1 to 5 with a reason. A judge is a model and can be
 *   wrong, so its score sits beside the code's checks, never in place of
 *   them, and its reason is kept to be read.
 *
 * Spends the owner's quota (some 40 requests: a turn and a judgement for each
 * request the AI answers), so `scripts/fidelity/chatJudge.ts` runs it by
 * hand with a key and its dry run, which spends nothing, is the check.
 */

export type ChatKind = 'facts' | 'docs' | 'edit' | 'rebuild' | 'new' | 'answer' | 'data';

export interface ChatQuery {
  id: string;
  text: string;
  /** Which made-up report is open: a house report's file name, or `data` for the one with a SQL data source. */
  report: 'sales-by-region' | 'supplier-invoice' | 'product-catalog' | 'data';
  kind: ChatKind;
  expect: {
    /** The action the turn should take; `forma` for a question Forma answers with no AI. */
    action: 'forma' | 'answer' | 'edit' | 'rebuild' | 'new';
    /** Words the reply must hold, each case-insensitively. */
    mentions?: string[];
    /** Words it must not hold. */
    forbids?: string[];
    /** For an edit: the op at least one edit made is. */
    op?: string;
  };
  /** Where the words come from. */
  origin: string;
}

export const CHAT_QUERIES: readonly ChatQuery[] = [
  // Answered by Forma from the file, no AI (batch AG, lib/reportFacts.ts).
  { id: 'facts-fields', text: 'Which fields does this report print?', report: 'sales-by-region', kind: 'facts', expect: { action: 'forma', mentions: ['no fields'] }, origin: 'chatEdits.ts, 2026-11-05' },
  { id: 'facts-totals', text: 'What totals does it have?', report: 'data', kind: 'facts', expect: { action: 'forma', mentions: ['Credit'] }, origin: 'agent audit item 24, a total asked about' },
  { id: 'facts-grouped', text: 'Is it grouped?', report: 'product-catalog', kind: 'facts', expect: { action: 'forma', mentions: ['grouped'] }, origin: 'owner, the house-style evaluation' },
  { id: 'facts-paper', text: 'What paper is it on?', report: 'supplier-invoice', kind: 'facts', expect: { action: 'forma', mentions: ['Letter'] }, origin: 'agent audit item 31, the paper' },
  // Questions about Forma, answered from its documentation (batch AG, lib/docsKnowledge.ts).
  { id: 'docs-share', text: 'How do I share this report with a colleague?', report: 'supplier-invoice', kind: 'docs', expect: { action: 'answer', mentions: ['Share'] }, origin: 'owner, the sharing loop (2026-11-06)' },
  { id: 'docs-designer', text: 'Can I open this in the DevExpress designer?', report: 'sales-by-region', kind: 'docs', expect: { action: 'answer', mentions: ['designer'] }, origin: 'owner, the designer download (2026-11-09)' },
  { id: 'docs-database', text: 'Does Forma send my database to the AI?', report: 'data', kind: 'docs', expect: { action: 'answer', mentions: ['share'] }, origin: 'owner, the SQL Server programme (2026-11-08)' },
  { id: 'docs-ollama', text: 'Can I use Ollama instead of Gemini?', report: 'product-catalog', kind: 'docs', expect: { action: 'answer', mentions: ['Ollama'] }, origin: 'owner, provider setup (2026-11-02)' },
  // Edits in place, in the owner's and the audits' words.
  { id: 'edit-bold', text: 'Make the subtitle bold.', report: 'sales-by-region', kind: 'edit', expect: { action: 'edit', op: 'font' }, origin: 'chatEdits.ts, 2026-11-05' },
  { id: 'edit-centre', text: 'Centre the footer note.', report: 'sales-by-region', kind: 'edit', expect: { action: 'edit', op: 'align' }, origin: 'chatEdits.ts; the align defect of 2026-11-06' },
  { id: 'edit-paper', text: 'Print it on A4 landscape.', report: 'sales-by-region', kind: 'edit', expect: { action: 'edit', op: 'paper' }, origin: 'chatEdits.ts, 2026-11-05' },
  { id: 'edit-colour', text: 'Make the column headings dark green with white text.', report: 'supplier-invoice', kind: 'edit', expect: { action: 'edit', op: 'color' }, origin: 'agent audit item 22, the four edit groups' },
  { id: 'edit-border', text: 'Put a line under the column headings.', report: 'product-catalog', kind: 'edit', expect: { action: 'edit' }, origin: 'agent audit item 22, borders' },
  // A redesign, a new report, a change already made.
  { id: 'rebuild-chart', text: 'Add a chart of sales by region at the end.', report: 'sales-by-region', kind: 'rebuild', expect: { action: 'rebuild' }, origin: 'chatEdits.ts, 2026-11-05' },
  { id: 'new-payslip', text: 'Now make me a payslip report.', report: 'supplier-invoice', kind: 'new', expect: { action: 'new' }, origin: 'agent audit item 20' },
  { id: 'answer-already', text: 'Make the report title bold.', report: 'sales-by-region', kind: 'answer', expect: { action: 'answer', mentions: ['already'] }, origin: 'chatEdits.ts, the title already bold' },
  { id: 'answer-absent', text: 'What does the Margin column show?', report: 'sales-by-region', kind: 'answer', expect: { action: 'answer', forbids: ['[Margin]'] }, origin: 'agent audit item 19, a column that is not there' },
  // Held to the report's data (batch AG item 24).
  { id: 'data-group', text: 'Group it by City and total the Credit in each group.', report: 'data', kind: 'data', expect: { action: 'edit', op: 'group' }, origin: 'SQL Server programme item 24, the group edit' },
  { id: 'data-bind', text: 'Show the phone number beside the company name.', report: 'data', kind: 'data', expect: { action: 'edit', mentions: ['Phone'] }, origin: 'SQL Server programme, a column matched to a field' },
  { id: 'data-invented', text: "Add a column for the customer's email address.", report: 'data', kind: 'data', expect: { action: 'answer', forbids: ['[Email]', '[EmailAddress]'] }, origin: 'agent audit item 19, a field the data lacks' },
];

/** What a turn did, as the judge's runner records it. */
export interface TurnRecord {
  action: string;
  reply: string;
  /** Ops of the edits Forma made. */
  applied: string[];
  declined: string[];
  /** Fields the reply names that the data lacks (`inventedFields`). */
  invented: string[];
}

export interface CodeCheck {
  id: string;
  pass: boolean;
  detail: string;
}

/** The checks code can make of a turn. */
export function codeChecks(q: ChatQuery, t: TurnRecord): CodeCheck[] {
  const text = t.reply.toLowerCase();
  const checks: CodeCheck[] = [{ id: 'action', pass: t.action === q.expect.action, detail: `${t.action}; wanted ${q.expect.action}` }];
  if (q.expect.action === 'edit') checks.push({ id: 'edited', pass: t.applied.length > 0, detail: t.applied.length ? `${t.applied.length} made` : `none made${t.declined.length ? `: ${t.declined[0]}` : ''}` });
  if (q.expect.op) checks.push({ id: 'op', pass: t.applied.includes(q.expect.op), detail: `${t.applied.join(', ') || 'none'}; wanted ${q.expect.op}` });
  for (const m of q.expect.mentions ?? []) checks.push({ id: `mentions:${m}`, pass: text.includes(m.toLowerCase()), detail: text.includes(m.toLowerCase()) ? 'said' : 'not said' });
  for (const f of q.expect.forbids ?? []) checks.push({ id: `forbids:${f}`, pass: !text.includes(f.toLowerCase()), detail: text.includes(f.toLowerCase()) ? 'said' : 'not said' });
  checks.push({ id: 'grounded', pass: t.invented.length === 0, detail: t.invented.length ? `names ${t.invented.join(', ')}` : 'no field the data lacks' });
  return checks;
}

/** The judge's question: the request, what the assistant was given, its reply, and the rubric. */
export function judgePrompt(q: ChatQuery, given: string, t: TurnRecord): string {
  return [
    'You judge one reply of Forma, an assistant that designs DevExpress reports. Score it against what it was given, not against what you know.',
    '',
    `REQUEST: ${q.text}`,
    `WHAT THE REQUEST NEEDED: ${q.expect.action === 'forma' ? 'a plain answer from the report' : q.expect.action === 'answer' ? 'an answer, changing nothing' : q.expect.action === 'edit' ? 'a change to the open report' : q.expect.action === 'rebuild' ? 'a redesign of the report' : 'a new report'}`,
    '',
    'WHAT THE ASSISTANT WAS GIVEN (the report outline and facts, and any documentation):',
    given,
    '',
    `ITS ACTION: ${t.action}`,
    `ITS REPLY: ${t.reply}`,
    t.applied.length || t.declined.length ? `EDITS MADE: ${t.applied.join(', ') || 'none'}${t.declined.length ? `; declined: ${t.declined.join(' | ')}` : ''}` : '',
    '',
    'Answer with JSON only: {"score": 1-5, "correct": true|false, "grounded": true|false, "reason": "one sentence"}.',
    '- correct: it does what the request needed, and what it says is true of the report or of Forma.',
    '- grounded: everything it states is in what it was given; a setting, button, field or number that is not there is ungrounded.',
    '- score: 5 right, grounded and clear; 4 right with a small flaw; 3 partly right; 2 mostly wrong; 1 wrong or invented.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export interface Judgement {
  score: number;
  correct: boolean;
  grounded: boolean;
  reason: string;
}

/** The judge's answer, read; null when it is not the JSON asked for. */
export function readJudgement(text: string): Judgement | null {
  const body = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/gi, ''))?.[0];
  if (!body) return null;
  try {
    const j = JSON.parse(body) as Partial<Judgement>;
    const score = Number(j.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) return null;
    return { score: Math.round(score), correct: j.correct === true, grounded: j.grounded === true, reason: String(j.reason ?? '').slice(0, 300) };
  } catch {
    return null;
  }
}

/** The scorecard of a run: code checks passed, the judge's mean and how many it found correct and grounded. */
export function scorecard(rows: readonly { q: ChatQuery; checks: CodeCheck[]; judgement: Judgement | null; requests: number }[]): string {
  const checks = rows.flatMap((r) => r.checks);
  const judged = rows.flatMap((r) => (r.judgement ? [r.judgement] : []));
  const mean = judged.length ? judged.reduce((n, j) => n + j.score, 0) / judged.length : null;
  const byKind = new Map<string, { pass: number; total: number }>();
  for (const r of rows) {
    const k = byKind.get(r.q.kind) ?? { pass: 0, total: 0 };
    k.total += r.checks.length;
    k.pass += r.checks.filter((c) => c.pass).length;
    byKind.set(r.q.kind, k);
  }
  return [
    `code checks ${checks.filter((c) => c.pass).length}/${checks.length}; requests ${rows.reduce((n, r) => n + r.requests, 0)}; answered with no AI ${rows.filter((r) => r.requests === 0).length}/${rows.length}`,
    `judge ${judged.length ? `mean ${mean!.toFixed(2)} over ${judged.length}, correct ${judged.filter((j) => j.correct).length}, grounded ${judged.filter((j) => j.grounded).length}` : 'not run'}`,
    `by kind: ${[...byKind].map(([k, v]) => `${k} ${v.pass}/${v.total}`).join(', ')}`,
  ].join('\n');
}
