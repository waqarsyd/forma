// @vitest-environment jsdom
/**
 * The chat's answers from Forma's own documentation (2026-11-10, the AI
 * accuracy programme, batch AG item 25): the real Docs page drawn off screen
 * as the chat draws it, and the articles a question is given. jsdom for the
 * page; this must stay line 1.
 *
 * The questions are the measurement as well as the test: twenty-one a person
 * might ask, each with the article that answers it. Before batch AG the chat
 * was given no article for any of them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDocsSections } from './docsCorpus';
import { docsBlock, docsFor, isDocsQuestion, pickSections, type DocsSection } from '../lib/docsKnowledge';
import { DOCS_SECTIONS } from '../lib/docsSearch';

const ASKED: Array<[string, string]> = [
  ['How do I share a report with a colleague?', 'share'],
  ['Can I use Ollama instead of Gemini?', 'ai'],
  ['Where is my API key stored?', 'key'],
  ['What file types can I upload?', 'upload'],
  ['How do I open the report in the DevExpress designer?', 'designer'],
  ['Which controls does Forma support?', 'controls'],
  ['How do I bind a field to a label?', 'data'],
  ['Can Forma read my SQL Server database?', 'sql'],
  ['How do I go back to an earlier version of the report?', 'revisions'],
  ['What keyboard shortcuts are there?', 'shortcuts'],
  ['How do I generate many reports at once?', 'batch'],
  ['Does Forma remember my preferences?', 'memory'],
  ['How do I delete my account?', 'account'],
  ['Is my work saved automatically?', 'saving'],
  ['How do I stop a report while it is generating?', 'run'],
  ['What is inside the .repx file it exports?', 'repx'],
  ['Does Forma cost anything?', 'faq'],
  ['Can I change the paper size or the units?', 'config'],
  ['What is the panel on the left of the workspace?', 'workspace'],
  ['How do I get started?', 'start'],
  ['The sign-in popup was blocked, what do I do?', 'trouble'],
];

let sections: DocsSection[] = [];

beforeAll(async () => {
  // jsdom has no IntersectionObserver, which the page's table of contents uses.
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  sections = await loadDocsSections();
}, 60_000);

describe('the Docs page, as the chat reads it', () => {
  it('reads every article, its heading and its words', () => {
    expect(sections.map((s) => s.id)).toEqual(DOCS_SECTIONS.map((s) => s.id));
    for (const s of sections) {
      expect(s.title.length).toBeGreaterThan(2);
      expect(s.text.length).toBeGreaterThan(200);
    }
    // A note's label and the paragraph after it are not run together.
    const sql = sections.find((s) => s.id === 'sql')!.text;
    expect(sql).toContain('What the AI sees Nothing of your database');
    expect(sql).not.toMatch(/seesNothing|databaseRun|oneIts/);
  });

  it('gives each question the article that answers it', () => {
    const first = ASKED.filter(([q, id]) => pickSections(q, sections)[0]?.id === id).length;
    const given = ASKED.filter(([q, id]) => pickSections(q, sections).some((s) => s.id === id)).length;
    // Measured 2026-11-10; a change to the scoring or to the Docs page that loses one shows here.
    console.info(`docs: the right article first for ${first} of ${ASKED.length} questions, among those given for ${given}`);
    for (const [q, id] of ASKED) {
      const got = pickSections(q, sections).map((s) => s.id);
      if (got[0] !== id) console.info(`docs: "${q}" wanted ${id}, given ${got.join(', ') || 'nothing'}`);
    }
    // 21 and 21 when measured; 20 first with a plural's s alone as the stemming.
    expect(given).toBeGreaterThanOrEqual(20);
    expect(first).toBeGreaterThanOrEqual(19);
  });

  it('gives nothing for a change, or for words the docs do not hold', () => {
    expect(isDocsQuestion('Make the title bold')).toBe(false);
    expect(isDocsQuestion('Add a total of Amount')).toBe(false);
    expect(isDocsQuestion('How do I share a report?')).toBe(true);
    expect(pickSections('zzz qqq?', sections)).toEqual([]);
  });

  it('draws the page only for a question, and names what it gave', async () => {
    let drawn = 0;
    const load = async () => {
      drawn++;
      return sections;
    };
    expect(await docsFor('Make the title bold', load)).toEqual({ block: '', ids: [] });
    expect(drawn).toBe(0);
    const given = await docsFor('How do I share a report?', load);
    expect(given.ids[0]).toBe('share');
    expect(given.block).toMatch(/^## Sharing a report/);
    expect(drawn).toBe(1);
  });

  it('keeps what it sends within its budget, each under its title', () => {
    const picked = pickSections('How do I share a report and what does sharing need?', sections);
    const block = docsBlock(picked);
    expect(block).toMatch(/^## Sharing a report \(forma docs, #share\)\n/);
    expect(block.length).toBeLessThan(7_400);
  });
});
