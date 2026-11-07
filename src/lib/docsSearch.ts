/**
 * The Docs page's search and its feedback link (2026-11-08, site audit items
 * 87 and 12). Pure, so a test holds both.
 *
 * Search matched each article's title and a hand-written keyword list, so
 * "OCR", "export", "share", "Ollama" or "PDF/A" found nothing although the
 * articles said them. It reads the articles' own words now too: the page
 * collects each article's text once it has drawn (an effect, so the render
 * stays pure, which is why it was keywords in the first place), and every
 * word of the query has to be somewhere in the title, the keywords or the
 * text.
 *
 * The feedback box said "it gets fixed in the next pass" and threw what was
 * typed away: nothing was wired behind it. It opens an issue on GitHub now,
 * prefilled with what was typed and the article it was typed on, which the
 * person sends themselves; nothing is collected by Forma.
 */

/** Whether every word of `query` appears in the article. An empty query matches everything. */
export function articleMatches(query: string, article: { title: string; keys: string; text?: string }): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${article.title} ${article.keys} ${article.text ?? ''}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Where a docs issue is filed. */
export const DOCS_ISSUES = 'https://github.com/waqarsyd/forma/issues/new';

/** A new GitHub issue about the docs, prefilled with what was typed and where; the person sends it. */
export function docsIssueUrl(comment: string, section: string): string {
  const said = comment.trim();
  const first = said.split('\n')[0].slice(0, 70);
  const title = `Docs: ${first || 'something was missing'}`;
  const body = [
    said || '(what were you looking for?)',
    '',
    `Page: https://openforma.web.app/docs${section ? `#${section}` : ''}`,
  ].join('\n');
  return `${DOCS_ISSUES}?${new URLSearchParams({ title, body, labels: 'documentation' }).toString()}`;
}
