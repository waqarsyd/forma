/**
 * DevExpress expressions: the reference the model is shown, and the checks a
 * generated one is held to before it is written into a report.
 *
 * ## Where it comes from
 *
 * DevExpress's designers have *Prompt-to-Expression*: the Filter Editor and the
 * Expression Editor carry a field where a sentence becomes an expression
 * ("Expression prompt in natural language" / "Type in a detailed expression
 * description" / "Final expression appears here", read from the Web designer's
 * own string table on 2026-10-28). Forma writes expressions in three places --
 * a binding's `Expression`, a calculated field, a `FilterString` -- and until
 * this date a user could only get one by asking the model to regenerate the
 * whole report. `promptToExpression` in `geminiService.ts` is the call; this
 * module is what it is told and what it is checked against.
 *
 * ## The language, as far as a binding needs it
 *
 * DevExpress's criteria language, which `RepxProbe` has already measured in the
 * forms this project emits: `[Field]` for a column, `[Parameters.Name]` and
 * `?Name` for a parameter, `sumSum([Amount])`-style aggregates for a cell whose
 * `<Summary>` runs over records, `Iif(cond, a, b)`, `FormatString('{0:c}', x)`,
 * `Concat`, `Upper`, `Lower`, `Round`, `GetDate`, `Now()`, `=`/`<>`/`And`/`Or`/
 * `Not`/`Like`/`In`, and string literals in single quotes. The reference below
 * is deliberately that short: the model is good at this syntax and bad at
 * being told too much about it, and the check that matters is not grammar but
 * **which fields it used**, because a reference to a field the data does not
 * have is a cell that prints blank with no error anywhere.
 */

/** Shown to the model verbatim. Kept short on purpose; see the header. */
export const EXPRESSION_REFERENCE = `DevExpress criteria-language expressions, as written in a report's Expression= attribute:
- A data field is [FieldName]; a report parameter is [Parameters.Name] (or ?Name inside a FilterString).
- Operators: + - * / %, comparison = <> < <= > >=, logic And Or Not, text Like with % wildcards, membership In (a, b, c). String literals use single quotes: 'text'.
- Functions: Iif(condition, whenTrue, whenFalse), IsNull(x, fallback), Concat(a, b, ...), Upper(s), Lower(s), Trim(s), Len(s), Substring(s, start, len), Round(n, digits), Abs(n), FormatString('{0:c2}', x) for formatting (c for currency, n for number, d for date, {0:MM/dd/yyyy}), Now(), Today(), GetDate(d), GetYear(d), GetMonth(d), AddDays(d, n), DateDiffDay(a, b).
- Aggregates over the records a cell's Summary runs over: sumSum([Amount]), sumAvg, sumCount, sumMin, sumMax, sumRecordNumber(). Use these ONLY for a total, subtotal or running count; a detail cell uses the plain field.
- No semicolons, no assignment, no SQL, no JavaScript. One expression, nothing else.`;

/** `Amount` of `sumSum([Amount])`, `Qty` of `[Qty] * [Price]`; parameters excluded. */
export function fieldsIn(expression: string): string[] {
  const out: string[] = [];
  for (const m of expression.matchAll(/\[([A-Za-z_][\w.]*)\]/g)) {
    const name = m[1];
    if (name.startsWith('Parameters.')) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export interface ExpressionCheck {
  ok: boolean;
  /** Each a sentence worth showing beside the expression. */
  problems: string[];
  /** Fields the expression names that the data does not have. */
  unknownFields: string[];
}

/**
 * Hold a generated expression to the two things that fail silently.
 *
 * Grammar is checked only as far as balance -- a stray bracket or quote is
 * the one syntax error that reaches a running report as a blank cell rather
 * than a designer complaint -- and field names are checked against the list
 * the user supplied, when there is one. An empty field list skips that check
 * rather than failing every field, since a report can be bound before its
 * schema is known.
 */
export function checkExpression(expression: string, knownFields: readonly string[] = []): ExpressionCheck {
  const problems: string[] = [];
  const text = expression.trim();
  if (!text) return { ok: false, problems: ['The expression is empty.'], unknownFields: [] };

  if (/;|\bSELECT\b|\bFROM\b|=>|\bfunction\b/i.test(text)) {
    problems.push('This reads as SQL or code rather than a DevExpress expression.');
  }

  const counts = (open: string, close: string) => (text.split(open).length - 1) - (text.split(close).length - 1);
  if (counts('(', ')') !== 0) problems.push('Parentheses do not balance.');
  if (counts('[', ']') !== 0) problems.push('Square brackets do not balance.');
  if ((text.split("'").length - 1) % 2 !== 0) problems.push('A string literal is not closed.');

  const used = fieldsIn(text);
  const unknownFields = knownFields.length ? used.filter((f) => !knownFields.includes(f)) : [];
  if (unknownFields.length) {
    problems.push(`${unknownFields.map((f) => `[${f}]`).join(', ')} ${unknownFields.length === 1 ? 'is not a field' : 'are not fields'} in the data; a cell bound to it prints blank.`);
  }

  return { ok: problems.length === 0, problems, unknownFields };
}
