/**
 * Locating the cells a data binding would go on, and proving they line up.
 *
 * ## What this is, and what it deliberately is not
 *
 * Stage 2 of the binding work, minus its last step. This file finds the header
 * row and the detail row, proves they describe the same columns, derives a
 * field name per column, and hands back the exact character spans a rewrite
 * would splice into. It does **not** write any binding XML.
 *
 * That omission is the point. DevExpress documents `ExpressionBinding` as an
 * API -- a constructor taking `EventName`, `PropertyName` and `Expression` --
 * and nowhere states what the serializer writes into a `.repx` for one. This
 * project's standard is that REPX syntax is grounded in observed real files:
 * the `X.Y.3.0` version pattern was inferred from two of them, and the note in
 * gemini.md says outright not to guess a build number. Guessing an element
 * name and nesting from a class reference is the same error with a larger
 * blast radius, because a malformed binding makes the file fail to open rather
 * than merely render wrong.
 *
 * So the emitter waits for one file out of the installed 20.1 designer. Every
 * part that does not depend on that answer is here and tested, which is most
 * of the work: the walking, the correspondence check, and the five ways this
 * can honestly decline.
 *
 * ## Why the correspondence check is the interesting part
 *
 * Banding put the column headings in `PageHeader` and left a single row in
 * `Detail`. Nothing structurally ties them together -- they are two `XRTable`s
 * in two bands -- so binding column n of the detail row to heading n is an
 * assumption, and it is wrong exactly when a header cell spans two columns or
 * a total sits under a merged heading. When the counts disagree the
 * correspondence is unprovable, and an unprovable binding is worse than none:
 * it puts confident, plausible, wrong field names into a file the user will
 * trust. Hence a decline rather than a best effort.
 *
 * ## Why string spans and not a DOM
 *
 * The same reason `repxTruncation.ts` gives: `DOMParser` exists in a browser
 * and not in this suite's node environment, and the whole point of doing this
 * in code is that it can be tested. Spans also make the eventual rewrite a
 * splice rather than a re-serialisation, so every byte the model wrote that we
 * are not deliberately changing survives untouched.
 */
import { deriveFieldNames, type DerivedField } from './repxBindings';

/** One complete `<Tag …>`, `</Tag>` or `<Tag … />`, as repxTruncation reads them. */
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

/** Comments, CDATA and the declaration, which do not nest. */
const NON_ELEMENT = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

/**
 * A binding already present, under either of the two names DevExpress uses.
 *
 * Checked for both because which one this codebase will emit is precisely the
 * open question -- but whichever it turns out to be, a cell carrying either is
 * one somebody has already bound, and re-binding it would discard their work.
 */
const EXISTING_BINDING = /<(?:ExpressionBindings|DataBindings)\b/;

interface Element {
  /** The `ControlType` attribute, or `''` when the element has none. */
  controlType: string;
  /** Index of this element's opening `<`. */
  start: number;
  /** Index just past this element's final `>`. */
  end: number;
}

/** Read one attribute out of a raw attribute string. */
function attr(attrs: string, name: string): string {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : '';
}

/**
 * The five predefined XML entities, plus numeric escapes.
 *
 * Headings are read out of `Text=`, where they are escaped. Deriving a field
 * name from the raw attribute would turn `R&amp;D` into `RAmpD`, because the
 * entity's letters survive sanitisation as an ordinary token. Unescaping first
 * turns it into `RD`, which is what a person reading the page would write.
 */
export function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, so that an escaped entity like &amp;lt; survives as the text
    // "&lt;" rather than decoding twice into "<".
    .replace(/&amp;/g, '&');
}

/**
 * Every element in the document, with its span.
 *
 * Order is by closing position, which is what makes "the first XRTable inside
 * this band" answerable by a linear scan of the results.
 */
function parseElements(xml: string): Element[] {
  // Blank out what does not nest, preserving length so every offset recorded
  // here still indexes the caller's original string.
  const scannable = xml.replace(NON_ELEMENT, (m) => ' '.repeat(m.length));
  const out: Element[] = [];
  const stack: { controlType: string; start: number }[] = [];

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(scannable)) !== null) {
    const [, closing, , attrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (open) out.push({ ...open, end: TAG.lastIndex });
    } else if (selfClosing) {
      out.push({ controlType: attr(attrs, 'ControlType'), start: m.index, end: TAG.lastIndex });
    } else {
      stack.push({ controlType: attr(attrs, 'ControlType'), start: m.index });
    }
  }

  return out;
}

/** Elements of one control type whose span sits inside `[start, end)`. */
function within(elements: readonly Element[], type: string, start: number, end: number): Element[] {
  return elements.filter((e) => e.controlType === type && e.start >= start && e.end <= end);
}

/** The cells of the first table inside a band, or an empty list. */
function tableCells(elements: readonly Element[], band: Element | undefined): Element[] {
  if (!band) return [];
  const table = within(elements, 'XRTable', band.start, band.end)[0];
  if (!table) return [];
  return within(elements, 'XRTableCell', table.start, table.end);
}

export interface CellTarget {
  /** Index of the cell element's opening `<`. */
  start: number;
  /** Index just past the cell element's final `>`. */
  end: number;
  /** The cell's `Text` attribute, unescaped. */
  text: string;
  /** True when this cell already carries a binding of either kind. */
  bound: boolean;
}

export interface BindingPlan {
  /** Column headings read from the PageHeader table, in order, unescaped. */
  headings: string[];
  /** One derived field per column, aligned with `headings` and `cells`. */
  fields: DerivedField[];
  /** The Detail row's cells, in document order, aligned with `fields`. */
  cells: CellTarget[];
}

export interface BindingPlanResult {
  /** Null whenever the plan could not be proved; `reason` says why. */
  plan: BindingPlan | null;
  /** Worth logging either way, in the shape `repxMargins` uses. */
  reason: string;
}

/**
 * Work out what a binding pass would do, without doing any of it.
 *
 * Declines -- `plan: null` plus a reason -- rather than guessing, whenever:
 *
 * - there is no `DetailBand`, or no table in it (a flat report, or a design
 *   with no repeating region; neither is a binding target)
 * - there is no `PageHeaderBand` table, so there are no headings to name
 *   fields from
 * - the two tables disagree about how many columns there are, which is what a
 *   merged or spanning header cell looks like from here
 * - any detail cell already carries a binding, so the pass is idempotent and
 *   cannot discard work somebody else did
 * - every heading is blank, so every field name would be positional -- a
 *   region with no headings at all is more likely not to have been a table
 */
export function planDetailBinding(xml: string | undefined | null): BindingPlanResult {
  const text = xml ?? '';
  if (!text.trim()) return { plan: null, reason: 'there is no REPX to bind' };

  const elements = parseElements(text);
  const detail = elements.find((e) => e.controlType === 'DetailBand');
  if (!detail) return { plan: null, reason: 'the report has no DetailBand' };

  const cells = tableCells(elements, detail);
  if (!cells.length) return { plan: null, reason: 'the DetailBand has no table to bind' };

  const header = elements.find((e) => e.controlType === 'PageHeaderBand');
  const headerCells = tableCells(elements, header);
  if (!headerCells.length) {
    return { plan: null, reason: 'there is no PageHeader table to read column headings from' };
  }

  if (headerCells.length !== cells.length) {
    return {
      plan: null,
      reason:
        `the header row has ${headerCells.length} columns and the detail row has ${cells.length}, ` +
        `so which heading names which column cannot be proved`,
    };
  }

  const targets: CellTarget[] = cells.map((cell) => {
    const slice = text.slice(cell.start, cell.end);
    return {
      start: cell.start,
      end: cell.end,
      text: unescapeXml(attr(slice, 'Text')),
      bound: EXISTING_BINDING.test(slice),
    };
  });

  const alreadyBound = targets.filter((c) => c.bound).length;
  if (alreadyBound) {
    return {
      plan: null,
      reason: `${alreadyBound} of ${targets.length} detail cells are already bound`,
    };
  }

  const headings = headerCells.map((cell) => unescapeXml(attr(text.slice(cell.start, cell.end), 'Text')));
  const fields = deriveFieldNames(headings);

  if (fields.every((f) => f.synthesised)) {
    return {
      plan: null,
      reason: 'every column heading is blank, so this region is probably not a table',
    };
  }

  return {
    plan: { headings, fields, cells: targets },
    reason: `${fields.length} columns: ${fields.map((f) => f.name).join(', ')}`,
  };
}
