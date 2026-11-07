/**
 * The Docs page's search and feedback link (2026-11-08, site audit items 87
 * and 12).
 */
import { describe, expect, it } from 'vitest';
import { articleMatches, docsIssueUrl, DOCS_ISSUES } from './docsSearch';

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
  it('opens a GitHub issue prefilled with what was typed and where', () => {
    const url = new URL(docsIssueUrl('How do I bind a stored procedure?\nMore detail here.', 'config'));
    expect(`${url.origin}${url.pathname}`).toBe(DOCS_ISSUES);
    expect(url.searchParams.get('title')).toBe('Docs: How do I bind a stored procedure?');
    expect(url.searchParams.get('body')).toBe('How do I bind a stored procedure?\nMore detail here.\n\nPage: https://openforma.web.app/docs#config');
    expect(url.searchParams.get('labels')).toBe('documentation');
  });

  it('still opens a usable issue when nothing was typed', () => {
    const url = new URL(docsIssueUrl('', ''));
    expect(url.searchParams.get('title')).toBe('Docs: something was missing');
    expect(url.searchParams.get('body')).toContain('Page: https://openforma.web.app/docs');
  });
});
