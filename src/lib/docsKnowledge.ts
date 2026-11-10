/**
 * Questions about Forma answered from Forma's own documentation (2026-11-10,
 * the owner's AI accuracy programme, batch AG, item 25).
 *
 * Asked "how do I share a report?" or "can I use Ollama?", the chat answered
 * from what the model knew of Forma, which is nothing it was not told, and a
 * plausible answer about a button that does not exist reads exactly like a
 * right one. The Docs page is the record of what Forma does, kept current
 * with the code, so the chat is given the articles a question is about:
 * - **Which articles:** the question's words scored against each article's
 *   title, the keywords the Docs search already uses (`DOCS_SECTIONS`) and
 *   its text, a title or keyword counting for more than a word in the text.
 *   The best two that score at all, at most `DOCS_MAX_CHARS` between them.
 * - **Their words:** the page itself, drawn off screen when the first such
 *   question is asked (components/docsCorpus.tsx), so the chat reads what the
 *   site says and never a copy that has drifted from it.
 * - **When:** a question, never a change, with or without a report open; a
 *   change goes to the edits as before.
 *
 * The AI is told to answer from them when they cover the question, to name
 * the article, and never to name a setting, button or menu they do not
 * (`DOCS_RULE` in services/geminiService.ts).
 */
import { DOCS_SECTIONS } from './docsSearch';

/** One article of the Docs page, as drawn. */
export interface DocsSection {
  id: string;
  title: string;
  text: string;
}

/** The most of the articles' text sent with one question. */
export const DOCS_MAX_CHARS = 7_000;

const STOP = new Set(
  'a an and are as at be but by can could do does for from had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your about any some more most other such only own same too very just should now forma report reports'.split(' '),
);

/**
 * A word reduced as both sides are: lower case, and its ending gone, so
 * "share", "shares", "shared" and "sharing" are one word. Measured: with the
 * plural's s alone, "How do I share a report?" was given the SQL Server
 * article first, whose text says "share" more often than "Sharing a report"
 * says it in its title.
 */
const stem = (w: string) =>
  w
    .toLowerCase()
    .replace(/(?<=\w{3})ies$/, 'y')
    .replace(/(?<=\w{3})(ing|ed|es|s)$/, '')
    .replace(/(?<=\w{3})e$/, '');

/** The words a question is about. */
export function questionWords(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z0-9][a-z0-9.+-]*[a-z0-9]|[a-z0-9]/g) ?? [];
  return [...new Set(words.filter((w) => w.length > 1 && !STOP.has(w)).map(stem))];
}

/**
 * How well an article matches the question's words: a title word 6, a
 * keyword 3, its own text 1, and 1 more for a word it says often. The title
 * counts for twice a keyword: at 4 against 3, the SQL Server article, which
 * says `share` six times, came before "Sharing a report" for a question
 * about sharing.
 */
export function scoreSection(words: readonly string[], section: DocsSection): number {
  const keys = DOCS_SECTIONS.find((s) => s.id === section.id)?.keys ?? '';
  const titleWords = new Set(questionWords(section.title));
  const keyWords = new Set(questionWords(keys));
  const text = section.text.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (titleWords.has(w)) score += 6;
    else if (keyWords.has(w)) score += 3;
    const hits = text.split(w).length - 1;
    if (hits) score += hits >= 3 ? 2 : 1;
  }
  return score;
}

/**
 * Whether a word of the question is in the article's title or keywords, not
 * only its text (2026-11-10, found by the chat judge's dry run, batch AH):
 * "What does the Margin column show?", a question about the open report,
 * was given the SQL Server and Data articles, some 7,000 characters, for the
 * words their text holds. A raised score threshold lost three of the 21
 * questions; this lost none.
 */
function namesIt(words: readonly string[], section: DocsSection): boolean {
  const keys = DOCS_SECTIONS.find((s) => s.id === section.id)?.keys ?? '';
  const named = new Set([...questionWords(section.title), ...questionWords(keys)]);
  return words.some((w) => named.has(w));
}

/** The articles a question is about, best first, within `DOCS_MAX_CHARS`; none when nothing scores. */
export function pickSections(question: string, sections: readonly DocsSection[], k = 2): DocsSection[] {
  const words = questionWords(question);
  if (!words.length) return [];
  const ranked = sections
    .map((s) => ({ s, score: scoreSection(words, s), named: namesIt(words, s) }))
    .filter((r) => r.score >= 4 && r.named)
    .sort((a, b) => b.score - a.score);
  const out: DocsSection[] = [];
  let room = DOCS_MAX_CHARS;
  for (const { s } of ranked.slice(0, k)) {
    if (room <= 400) break;
    const text = s.text.length > room ? `${s.text.slice(0, room)} ...` : s.text;
    out.push({ ...s, text });
    room -= text.length;
  }
  return out;
}

const CHANGE = /^\s*(please\s+)?(add|remove|delete|change|make|move|set|bind|put|rename|replace|resize|redesign|create|build|fix|export|insert|align|hide|increase|decrease|swap|sort|filter|group|translate|convert|undo)\b/i;
const ASKS = /\?\s*$|^\s*(how|what|which|why|where|when|who|can|could|does|do|is|are|should|will|would|tell me|explain|help)\b/i;

/** Whether a message is a question the docs may answer, rather than a change to make. */
export function isDocsQuestion(message: string): boolean {
  const text = message.trim();
  return text.length > 3 && text.length <= 400 && ASKS.test(text) && !CHANGE.test(text);
}

/** The articles as the chat is given them, each under its title. */
export function docsBlock(sections: readonly DocsSection[]): string {
  return sections.map((s) => `## ${s.title} (forma docs, #${s.id})\n${s.text}`).join('\n\n');
}

/** What reads as a block: the tags, and a span the page styles as one (a note's label). */
const BLOCKS = 'p,li,h1,h2,h3,h4,h5,dt,dd,pre,tr,td,th,div,br,figcaption,summary,blockquote,[class~="block"]';

/**
 * An element's words with a space after each block, as a reader sees them.
 * A page drawn off screen has no layout, so `innerText` is `textContent`,
 * which runs one paragraph's last word into the next one's first.
 */
function wordsOf(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(BLOCKS).forEach((b) => b.append(' '));
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Each article of a drawn Docs page: its id, its heading and its words, spaces made single. */
export function sectionsFromPage(root: ParentNode): DocsSection[] {
  return [...root.querySelectorAll<HTMLElement>('article[id]')].map((el) => {
    const title = el.querySelector('h2')?.textContent?.trim() ?? el.id;
    const all = wordsOf(el).replace(/^(Guide|Setup|Input|Reference|Output|Support)\s*/, '');
    const text = all.startsWith(title) ? all.slice(title.length).trim() : all;
    return { id: el.id, title, text };
  });
}

/**
 * The Docs block a message is given: the articles it is about when it is a
 * question, '' otherwise. `load` draws the Docs page (components/docsCorpus.tsx),
 * asked only for a question.
 */
export async function docsFor(message: string, load: () => Promise<DocsSection[]>): Promise<{ block: string; ids: string[] }> {
  if (!isDocsQuestion(message)) return { block: '', ids: [] };
  const picked = pickSections(message, await load());
  return { block: docsBlock(picked), ids: picked.map((s) => s.id) };
}
