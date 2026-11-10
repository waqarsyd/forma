/**
 * The chat scored (2026-11-10, the AI accuracy programme, batch AH item 27):
 * the requests, the checks code makes, the judge's question and the reading
 * of its answer. The run itself spends the owner's quota and is not here.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_QUERIES, codeChecks, judgePrompt, readJudgement, scorecard, type TurnRecord } from './chatJudge';

const q = (id: string) => CHAT_QUERIES.find((x) => x.id === id)!;
const turn = (t: Partial<TurnRecord>): TurnRecord => ({ action: 'answer', reply: '', applied: [], declined: [], invented: [], ...t });

describe('the requests', () => {
  it('are twenty, each named once, with where its words come from', () => {
    expect(CHAT_QUERIES).toHaveLength(20);
    expect(new Set(CHAT_QUERIES.map((x) => x.id)).size).toBe(20);
    for (const x of CHAT_QUERIES) expect(x.origin.length).toBeGreaterThan(5);
    expect(new Set(CHAT_QUERIES.map((x) => x.kind))).toEqual(new Set(['facts', 'docs', 'edit', 'rebuild', 'new', 'answer', 'data']));
  });
});

describe('what code checks', () => {
  it('passes an edit that was made with the op asked for', () => {
    const checks = codeChecks(q('edit-bold'), turn({ action: 'edit', applied: ['font'] }));
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(checks.map((c) => c.id)).toEqual(['action', 'edited', 'op', 'grounded']);
  });

  it('fails an edit declined, a wrong action, a missing fact and an invented field', () => {
    const declined = codeChecks(q('edit-centre'), turn({ action: 'edit', declined: ['align footer: no alignment was given'] }));
    expect(declined.find((c) => c.id === 'edited')).toMatchObject({ pass: false, detail: 'none made: align footer: no alignment was given' });
    expect(codeChecks(q('rebuild-chart'), turn({ action: 'edit' }))[0]).toMatchObject({ pass: false, detail: 'edit; wanted rebuild' });
    expect(codeChecks(q('docs-ollama'), turn({ reply: 'Yes, choose Local AI.' })).find((c) => c.id === 'mentions:Ollama')?.pass).toBe(false);
    const invented = codeChecks(q('data-invented'), turn({ reply: 'I added [Email].', invented: ['Email'] }));
    expect(invented.filter((c) => !c.pass).map((c) => c.id)).toEqual(['forbids:[Email]', 'grounded']);
  });
});

describe('the judge', () => {
  it('is asked against what the assistant was given, with the rubric', () => {
    const prompt = judgePrompt(q('docs-share'), '## Sharing a report (forma docs, #share)\nShare is at the top right.', turn({ reply: 'Press Share.' }));
    expect(prompt).toMatch(/REQUEST: How do I share this report with a colleague\?/);
    expect(prompt).toMatch(/WHAT THE REQUEST NEEDED: an answer, changing nothing/);
    expect(prompt).toMatch(/Share is at the top right\./);
    expect(prompt).toMatch(/Answer with JSON only/);
    expect(prompt).not.toMatch(/EDITS MADE/);
  });

  it('is read when it answers the JSON asked for, fenced or not, and not otherwise', () => {
    expect(readJudgement('```json\n{"score": 4, "correct": true, "grounded": true, "reason": "Right."}\n```')).toEqual({ score: 4, correct: true, grounded: true, reason: 'Right.' });
    expect(readJudgement('{"score": 9}')).toBeNull();
    expect(readJudgement('A fine reply.')).toBeNull();
  });

  it('sums a run, saying what code passed, what it cost and what the judge found', () => {
    const rows = [
      { q: q('facts-fields'), checks: codeChecks(q('facts-fields'), turn({ action: 'forma', reply: 'It prints no fields.' })), judgement: null, requests: 0 },
      { q: q('edit-bold'), checks: codeChecks(q('edit-bold'), turn({ action: 'edit', applied: ['font'] })), judgement: { score: 5, correct: true, grounded: true, reason: '' }, requests: 2 },
    ];
    expect(scorecard(rows)).toBe('code checks 7/7; requests 2; answered with no AI 1/2\njudge mean 5.00 over 1, correct 1, grounded 1\nby kind: facts 3/3, edit 4/4');
  });
});
