/**
 * Questions about the rows the Preview prints, with consent asked first
 * (2026-11-10, the second of the gaps `docs/proposals/ai-designers.md` found
 * beside Telerik's AI Insights).
 *
 * The Preview prints rows: sample rows from a shared database, the rows the
 * AI made up as test data, or the companion's live rows. A question about
 * them ("which customer has the highest balance?", "what do the amounts add
 * up to?") can be answered by the AI from those rows, and Forma keeps data
 * from the AI by default: a database's names and sample values go only when
 * the person ticks *Send names and sample values to the AI*. So the rows go
 * only after the person says so, once per project, asked in the thread the
 * first time a question looks like one about the data (`asksAboutData`),
 * with how many rows and which fields would go (`consentReply`). Answered
 * yes, the question is asked again with the rows fenced as `<preview_rows>`
 * data (`rowsBlock`), at most `MAX_ROWS` of them and `MAX_CHARS` in all, and
 * the reply says it is over those rows; answered no, the question goes
 * without them, and is not asked again in that project (2026-11-11, the full
 * audit's WS-01: a no asked it again at once, and a yes outlived the project).
 */

/** The most rows and characters that go with one question. */
export const MAX_ROWS = 50;
export const MAX_CHARS = 6_000;

const ASKS = /\?\s*$|^\s*(how many|how much|what|which|who|list|show me|sum|total|average|count|find|is there|are there|does|do)\b/i;
const ABOUT_DATA = /\b(highest|lowest|largest|smallest|biggest|most|least|average|mean|median|sum|total(?:s|led)?|add up|count|how many|how much|per|each|rows?|records?|values?|data|figures?|amounts?|balances?|top|bottom|first|last|oldest|newest|earliest|latest|between|over|under|above|below|more than|less than|greater|fewer)\b/i;
const CHANGE = /^\s*(please\s+)?(add|remove|delete|change|make|move|set|bind|put|rename|replace|resize|redesign|create|build|fix|export|insert|align|hide|increase|decrease|swap|sort|filter|group|translate|convert|undo)\b/i;

/** Whether a message asks about the rows: a question, about figures or named fields, not a change. */
export function asksAboutData(message: string, fields: readonly string[]): boolean {
  const text = message.trim();
  if (text.length < 4 || text.length > 400 || !ASKS.test(text) || CHANGE.test(text)) return false;
  const namesField = fields.some((f) => f.length > 2 && new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  return ABOUT_DATA.test(text) || namesField;
}

/** The rows as the AI is given them: a header line of fields, then one line a row, cut to the budget. */
export function rowsBlock(rows: readonly Record<string, unknown>[], fields: readonly string[]): string {
  if (!rows.length || !fields.length) return '';
  const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').slice(0, 80));
  const lines = [fields.join(' | ')];
  let size = lines[0].length;
  let kept = 0;
  for (const row of rows.slice(0, MAX_ROWS)) {
    const line = fields.map((f) => cell(row[f])).join(' | ');
    if (size + line.length + 1 > MAX_CHARS) break;
    lines.push(line);
    size += line.length + 1;
    kept++;
  }
  const left = rows.length - kept;
  return `${kept} of ${rows.length} rows the Preview prints${left ? ` (${left} more not sent)` : ''}, one a line, fields separated by |:\n${lines.join('\n')}`;
}

/**
 * What Forma asks before the rows go, in its own voice, naming the AI they
 * would go to (2026-11-11, the full audit's CV-19). Asked only of a
 * database's sample rows: test rows the AI made up are its own, and go with
 * a question without asking. The line a reply carried once they had gone
 * (`rowsNote`) went the same day: ROWS_RULE has the model say the answer is
 * over these rows, and the two said it twice.
 */
export function consentReply(rows: number, fields: readonly string[], ai = 'the AI'): string {
  const which = fields.length > 8 ? `${fields.slice(0, 8).join(', ')} and ${fields.length - 8} more` : fields.join(', ');
  return `To answer that I'd send the ${Math.min(rows, MAX_ROWS)} sample rows the Preview shows (${which}) to ${ai}. Nothing has been sent yet. Send them? For this project they'll go with data questions until you start a new one.`;
}
