/**
 * How the chat box routes a message before any AI is asked (2026-11-07, the
 * agent audit's batch B): what is kept as a memory, what goes straight to a
 * design, and what a reply typed while Forma's questions wait is. Pure and
 * small, so App.tsx imports it on the first render and the rules are tested
 * here rather than only by using the app.
 */

/**
 * A message that asks Forma to remember something, rather than to design
 * (the owner's rule, 2026-11-07): it starts "remember" or "from now on".
 * Until then it also took "always", "never", "note that", "I prefer" and "by
 * default", so "Never mind, make the title red" was kept as a memory and told
 * to every report after it; those words now go to the agent, which acts on
 * them for this report. One copy: App.tsx had its own, which had already
 * drifted from this one (agent audit items 2 and 92).
 */
export const REMEMBER = /^\s*(please\s+)?(remember(\s+that)?|from now on)\b[\s:,-]*/i;

/** Whether a message is one to keep as a memory: REMEMBER, and not a question. */
export function isRememberMessage(text: string): boolean {
  return REMEMBER.test(text) && !/\?\s*$/.test(text);
}

/** "Create / build / make … a … report" and its kin: a report asked for in so many words. */
const PLAIN_BUILD = /^\s*(please\s+)?(create|build|make|design|generate|produce|draft|prepare)\s+(me\s+)?(a|an|the|my|our)?\s*([\p{L}\p{N} ]{0,40}?)\b(report|list|register|invoice|statement|ledger|summary|payslips?|labels?|catalogue)\b(.*)$/isu;
/** Nouns that name a report without saying what it shows. */
const VAGUE_NOUNS = new Set(['report', 'list', 'summary']);
/** Words that say nothing about a report's content. */
const EMPTY_WORDS = new Set([
  'new', 'simple', 'basic', 'nice', 'good', 'quick', 'sample', 'test', 'small', 'short', 'one', 'another', 'proper', 'professional',
  'please', 'for', 'me', 'us', 'of', 'with', 'that', 'which', 'the', 'a', 'an', 'and', 'to', 'in', 'on', 'now', 'today', 'it', 'thanks',
]);

/**
 * A report asked for in words with something to design from (agent audit item
 * 80): "create a sales report", "make an invoice", "build a report of orders
 * by region". Such a message skips the chat turn, which would only say it is
 * a report request. "Create a report" or "make a new list" says nothing of
 * what it shows, so it goes to the chat, which asks; it went straight to a
 * design until 2026-11-07.
 */
export function isPlainBuild(text: string): boolean {
  const m = PLAIN_BUILD.exec(text);
  if (!m) return false;
  const noun = m[6].toLowerCase().replace(/s$/, '');
  if (!VAGUE_NOUNS.has(noun)) return true;
  const said = `${m[5]} ${m[7]}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return said.some((w) => !EMPTY_WORDS.has(w));
}

/**
 * What a message typed while Forma's questions wait is (agent audit item 87):
 * an answer to them, a new request (they are dropped and it is routed as any
 * message is), or a question of its own, which the chat answers while the
 * questions stay open. Until 2026-11-07 every typed message was the answer.
 */
export function pendingReplyKind(text: string): 'answer' | 'new' | 'question' {
  if (isPlainBuild(text)) return 'new';
  if (/\?\s*$/.test(text) && !/^\s*(yes|no|ok|sure)\b/i.test(text)) return 'question';
  return 'answer';
}

/**
 * The selection on the Preview as words for a redesign (agent audit item 19):
 * the chat turn sees it in the outline, and a redesign the turn hands on did
 * not, so "make these a table" redesigned the whole report blind to "these".
 */
export function withSelection(words: string, selected: readonly string[]): string {
  if (!selected.length) return words;
  return `${words}\n\nThe user has these controls selected on the Preview, and "this", "these" or "them" mean them: ${selected.join(', ')}.`;
}
