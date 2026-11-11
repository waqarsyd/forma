/**
 * The Docs page's search and feedback link (2026-11-08, site audit items 87
 * and 12).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { articleMatches, docsIssueUrl, DOCS_ISSUES, DOCS_SECTIONS, DOCS_TEMPLATE } from './docsSearch';

describe('articleMatches', () => {
  const article = { title: 'What you can upload', keys: 'upload pdf', text: 'A scan is read by OCR in your browser.' };

  it("finds an article by the words it says, not only its title and keywords", () => {
    expect(articleMatches('OCR', article)).toBe(true);
    expect(articleMatches('ocr browser', article)).toBe(true);
    expect(articleMatches('pdf', article)).toBe(true);
  });

  it('needs every word, and matches everything with no query', () => {
    expect(articleMatches('ocr ollama', article)).toBe(false);
    expect(articleMatches('   ', article)).toBe(true);
    expect(articleMatches('OCR', { title: 'Upload', keys: 'pdf' })).toBe(false);
  });
});

describe('docsIssueUrl', () => {
  // Through the docs form since 2026-11-11 (full audit PS-15): with blank
  // issues off, a plain ?body= link lost what was typed on the way.
  it('opens the docs issue form prefilled with what was typed and where', () => {
    const url = new URL(docsIssueUrl('How do I bind a stored procedure?\nMore detail here.', 'config'));
    expect(`${url.origin}${url.pathname}`).toBe(DOCS_ISSUES);
    expect(url.searchParams.get('template')).toBe('docs.yml');
    expect(url.searchParams.get('title')).toBe('Docs: How do I bind a stored procedure?');
    expect(url.searchParams.get('missing')).toBe('How do I bind a stored procedure?\nMore detail here.');
    expect(url.searchParams.get('page')).toBe('https://openforma.web.app/docs#config');
    expect(url.searchParams.has('body')).toBe(false);
    expect(url.searchParams.has('labels')).toBe(false);
  });

  it('still opens a usable issue when nothing was typed', () => {
    const url = new URL(docsIssueUrl('', ''));
    expect(url.searchParams.get('title')).toBe('Docs: something was missing');
    expect(url.searchParams.get('page')).toBe('https://openforma.web.app/docs');
  });

  it("fills the form's own fields, and the form files under the label the setup script makes", () => {
    const form = readFileSync(`.github/ISSUE_TEMPLATE/${DOCS_TEMPLATE}`, 'utf8');
    expect(form).toMatch(/^name: The docs missed something$/m);
    expect(form).toMatch(/^labels: \["documentation"\]$/m);
    const ids = [...form.matchAll(/^\s+id: ([\w-]+)$/gm)].map((m) => m[1]);
    for (const key of new URL(docsIssueUrl('x', 'y')).searchParams.keys()) {
      if (key !== 'template' && key !== 'title') expect(ids, key).toContain(key);
    }
    expect(readFileSync('scripts/github-setup.mjs', 'utf8')).toContain("['documentation', ");
  });
});

describe('DOCS_SECTIONS keys', () => {
  it('find the designer by its name, never by the words it no longer goes by, and the AI article by a limit', () => {
    const keys = (id: string) => DOCS_SECTIONS.find((s) => s.id === id)!.keys;
    expect(keys('designer')).not.toMatch(/companion|repxdesigner/);
    expect(keys('designer')).toContain('forma designer');
    for (const word of ['limit', 'page reader', 'chain']) expect(keys('ai')).toContain(word);
  });

  it('find the Learning section, which the Memory article describes (2026-11-11, PS-06)', () => {
    const memory = DOCS_SECTIONS.find((s) => s.id === 'memory')!;
    for (const query of ['learning', 'train', 'learning switch']) expect(articleMatches(query, memory), query).toBe(true);
  });

  // What the waves built, by the words a person searches with (2026-11-11, the re-audit's R4-04).
  it('find the waves’ features by their own names, the article that describes each', () => {
    const section = (id: string) => DOCS_SECTIONS.find((s) => s.id === id)!;
    const cases: Array<[string, string]> = [
      ['rdl', 'upload'],
      ['ssrs', 'upload'],
      ['fastreport frx', 'upload'],
      ['crystal rpt', 'upload'],
      ['word template', 'upload'],
      ['crooked', 'upload'],
      ['bilingual', 'run'],
      ['zip', 'run'],
      ['compare original', 'workspace'],
      ['learned changes', 'memory'],
      ['limit', 'saving'],
      // 'storage' kept when 'local storage' went, so a search for it still finds Saving (review, 2026-11-11).
      ['storage', 'saving'],
    ];
    for (const [query, id] of cases) expect(articleMatches(query, section(id)), `${query} -> ${id}`).toBe(true);
    // The signed-out projects are in the browser's own database, not local storage, since PR-15.
    expect(section('saving').keys).not.toMatch(/local storage/);
  });
});
