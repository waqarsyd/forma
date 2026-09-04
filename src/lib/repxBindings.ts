/**
 * Column headings to DevExpress field names, for expression bindings.
 *
 * ## Why this is code and not prompt prose
 *
 * A bound report needs a field name per column: `Text="Widget"` becomes an
 * `<ExpressionBindings>` entry carrying `Expression="[Description]"`. The name
 * has to come from somewhere, and the only thing the source document offers is
 * the column heading a human wrote — "Unit Price", "Amount ($)", "Qty.".
 *
 * Deriving one from the other is a pure string function, so it belongs here
 * rather than in the mega-prompt. That is the whole argument: four of the five
 * fidelity fixes made by 2026-09-03 are prompt prose, which no suite can cover,
 * and a fifth would repeat the pattern. Binding is the first fidelity feature
 * with a large testable core -- this file is that core, and the prompt is left
 * to do only what a prompt can do, which is decide *which* region is a table.
 *
 * ## These names are a guess, and the design assumes it
 *
 * Nothing here can know the user's real schema. A heading reading "Amount" may
 * be `InvoiceAmount`, `amt`, or `Total` in the database it will eventually bind
 * to, and no amount of cleverness closes that gap. So the goal is not the right
 * name; it is a *plausible, valid and stable* one that a person can rename in
 * the designer in a few seconds. Two consequences worth stating:
 *
 * - **No case is invented that was not in the heading.** Each token gets its
 *   first letter upper-cased and the rest is left exactly as typed, so "unit
 *   price" gives `UnitPrice` and "VAT Amount" gives `VATAmount` -- the acronym
 *   survives without a list of acronyms to maintain. A shouty "UNIT PRICE"
 *   gives `UNITPRICE`, which looks wrong and is: the heading said so, and
 *   guessing that the user wanted `UnitPrice` is exactly the kind of invention
 *   that makes the output unpredictable across two similar documents.
 * - **Every derived name is safe in an XML attribute without escaping.** The
 *   output alphabet is `[A-Za-z0-9_]` and nothing else, so a name can never
 *   carry the `&`, `<` or `"` the prompt spends a paragraph on. `sanitised()`
 *   below is what guarantees it and `repxBindings.test.ts` asserts it over
 *   every fixture, including headings built to break it.
 *
 * ## Where this gets used
 *
 * Stage 1 of the binding work: nothing calls it yet. The integration is a
 * post-processing pass over the returned `layout` -- read a table's header row,
 * derive a name per column, rewrite the Detail band's single row -- which is
 * the same shape as `repxMargins.ts`, arithmetic applied to the model's output
 * rather than a request for the model to do it. That pass lands once a real
 * bound `.repx` from the installed 20.1 designer settles the serialized
 * `<ExpressionBindings>` shape, which the DevExpress docs describe only as an
 * API. Do not guess that XML from the class reference.
 */

/** Everything outside this is a separator, and separators do not survive. */
const TOKEN = /[A-Za-z0-9]+/g;

/**
 * Longest name we will emit.
 *
 * A heading can be a sentence -- "Description of goods supplied (incl. VAT)" --
 * and a 40-character field name is unusable in the designer's property grid.
 * The cap is applied after joining so it cannot split a token's first letter
 * from its tail and leave a lower-case start.
 */
const MAX_LENGTH = 64;

export interface DerivedField {
  /** The heading this came from, verbatim and untouched. */
  header: string;
  /** The field name, with no brackets. Always `[A-Za-z0-9_]+`. */
  name: string;
  /**
   * True when the heading yielded nothing usable and the name is positional.
   *
   * Worth surfacing rather than hiding: a synthesised `Column3` means the
   * source had a blank or symbol-only heading, which is a signal the region
   * may not have been a table at all.
   */
  synthesised: boolean;
}

/**
 * One heading to one identifier, or `''` when there is nothing to work with.
 *
 * Returns empty rather than a fallback so the caller owns the numbering --
 * a positional name needs to know its position, which a single heading does
 * not carry.
 */
export function toFieldName(header: string | undefined | null): string {
  const tokens = (header ?? '').match(TOKEN);
  if (!tokens) return '';

  const joined = tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join('');
  const capped = joined.slice(0, MAX_LENGTH);

  // An identifier cannot start with a digit. Prefixing beats dropping the
  // token: "1st Quarter" is about the 1, so `_1stQuarter` keeps the meaning
  // where `StQuarter` loses it.
  return /^[0-9]/.test(capped) ? `_${capped}`.slice(0, MAX_LENGTH) : capped;
}

/**
 * A whole header row to a field name each, unique and positionally complete.
 *
 * Returns one entry per input in input order, always -- a caller rewriting
 * cells indexes into this by column, so a dropped entry would silently shift
 * every binding to its right onto the wrong column.
 *
 * Collisions get a numeric suffix in first-seen order: two "Amount" columns
 * give `Amount` and `Amount2`. The suffix is applied against everything
 * already taken, including synthesised names, so a document with a blank
 * third heading and a literal "Column3" heading cannot produce two `Column3`.
 */
export function deriveFieldNames(headers: readonly (string | undefined | null)[]): DerivedField[] {
  const taken = new Set<string>();
  const out: DerivedField[] = [];

  headers.forEach((header, index) => {
    const derived = toFieldName(header);
    const synthesised = derived === '';
    // 1-based: `Column1` is the first column, which is what a person counting
    // columns in the source document will call it.
    const base = synthesised ? `Column${index + 1}` : derived;

    let name = base;
    let n = 2;
    while (taken.has(name)) {
      const suffix = String(n++);
      // Keep the suffix rather than the tail when a capped name collides.
      name = base.slice(0, MAX_LENGTH - suffix.length) + suffix;
    }
    taken.add(name);

    out.push({ header: header ?? '', name, synthesised });
  });

  return out;
}

/**
 * A field name as it appears inside an `Expression` attribute.
 *
 * Trivial, and centralised anyway: the bracket syntax is the one piece of
 * DevExpress expression grammar this module knows, and a second place writing
 * `[${name}]` by hand is the second source of truth that gemini.md warns about.
 */
export function fieldExpression(name: string): string {
  return `[${name}]`;
}
