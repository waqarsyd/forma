/**
 * Binding a report's detail row to data: finding the cells, proving they line
 * up, and writing the bindings in.
 *
 * ## The syntax here was measured, not inferred
 *
 * DevExpress documents `ExpressionBinding` as an API -- a constructor taking
 * `EventName`, `PropertyName` and `Expression` -- and nowhere states what the
 * serializer writes into a `.repx`. Guessing that from a class reference would
 * be the `X.Y.3.0` mistake with a worse failure mode, because a malformed
 * binding makes the file refuse to open rather than merely render wrong.
 *
 * So it was not guessed. `SaveLayoutToXml` is a library call rather than
 * anything to do with the designer window, so on 2026-09-04 a console program
 * compiled against the installed DevExpress 20.1 assemblies wrote a bound
 * report and the output was read directly. Verbatim, that is:
 *
 *     <Item1 Ref="10" ControlType="XRTableCell" Name="cellDesc" Weight="3" Text="Widget">
 *       <ExpressionBindings>
 *         <Item1 Ref="11" EventName="BeforePrint" PropertyName="Text" Expression="[Description]" />
 *       </ExpressionBindings>
 *     </Item1>
 *
 * Four things that shape the code below came out of that file:
 *
 * - The binding item carries **no `ControlType`**, unlike every other element
 *   in the document. `parseElements` finds things *by* `ControlType`, so a
 *   binding is invisible to it -- which is why `EXISTING_BINDING` is a plain
 *   substring test rather than a lookup through the element list.
 * - **`Text=` survives** alongside the binding, so it is kept. It is a
 *   harmless fallback for a cell whose field never resolves.
 * - **`Ref` must be unique, need not be sequential, and may be omitted.** This
 *   is the one the first probe got wrong, and it is worth the space because
 *   the failure is silent. The designer numbers bindings in document order, so
 *   inserting one *looks* like it invalidates every later `Ref`. It does not:
 *   sequence is irrelevant, and a renumbered 101..114 document loads fine.
 *   **But a duplicate `Ref` makes the loader alias the two elements onto one
 *   object**, and the second one's content simply disappears -- measured on
 *   one document that differed only in its `Ref` values: unique gave 6 cells
 *   and 3 bindings, duplicated gave 3 cells and 0 bindings, no error either
 *   time. The first probe missed it by counting bindings without checking
 *   identity. So this emitter **omits `Ref` entirely** on the element it adds,
 *   which is both proven to round-trip and the only choice that cannot
 *   introduce a collision -- and that is why no renumbering step is needed.
 *
 *   Note this leaves a *separate* and larger question open, which is not this
 *   file's to answer: nothing makes the **model's** own `Ref` values unique.
 *   The prompt never asks for it, `checkRepx` does not test it, and the cheat
 *   sheet's snippets each restart numbering at `Ref="1"` -- which, by the rule
 *   in gemini.md that an example outranks an instruction, is exactly how a
 *   collision gets copied into real output. Unverified on a live generation as
 *   of 2026-09-04.
 * - A summary is just an expression: `Expression="sumSum([Amount])"`, and
 *   `TextFormatString="{0:c2}"` is a plain attribute on the cell. Neither
 *   needs new structure when stages 3 and 4 arrive.
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
  /** The tag name -- `Item1`, `Item2` -- needed to close it when splicing. */
  tag: string;
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
  const stack: { controlType: string; tag: string; start: number }[] = [];

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(scannable)) !== null) {
    const [, closing, tag, attrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (open) out.push({ ...open, end: TAG.lastIndex });
    } else if (selfClosing) {
      out.push({ controlType: attr(attrs, 'ControlType'), tag, start: m.index, end: TAG.lastIndex });
    } else {
      stack.push({ controlType: attr(attrs, 'ControlType'), tag, start: m.index });
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
  /** The tag name -- `Item1`, `Item2` -- so a splice can close it. */
  tag: string;
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
      tag: cell.tag,
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

/**
 * The binding element for one field, in the shape the 20.1 serializer writes.
 *
 * No `Ref`: the probe proved the loader ignores it and regenerates it on save,
 * and the no-`Ref` variant round-tripped byte-identically. Emitting one would
 * mean choosing a number that is either wrong or requires renumbering the rest
 * of the document, in exchange for nothing.
 *
 * No escaping either, and that is guaranteed rather than assumed: a name from
 * `deriveFieldNames` is `[A-Za-z0-9_]+`, which `repxBindings.test.ts` asserts
 * over headings built to break it. That invariant is what lets this be a
 * string concatenation.
 */
function bindingElement(field: string): string {
  return (
    '<ExpressionBindings>' +
    `<Item1 EventName="BeforePrint" PropertyName="Text" Expression="[${field}]" />` +
    '</ExpressionBindings>'
  );
}

export interface BoundRepx {
  /** The rewritten document, or the input untouched when it declined. */
  xml: string;
  applied: boolean;
  /** Why, in a form worth logging. */
  reason: string;
  /** What was bound, empty when it declined. */
  fields: DerivedField[];
}

/**
 * Bind the detail row's cells to one field each.
 *
 * A splice, not a re-serialisation: every byte outside the cells being changed
 * survives exactly as the model wrote it. Cells are rewritten back-to-front so
 * that each edit leaves the offsets of the ones before it valid.
 *
 * `Text=` is deliberately kept. The designer keeps it on a bound cell, and it
 * is a useful fallback for a field that never resolves -- these names are a
 * guess at the user's schema, so some of them will not.
 *
 * Declines for any of the reasons `planDetailBinding` declines, returning the
 * input untouched with the reason. Running it twice is safe: the second run
 * sees the bindings from the first and declines.
 */
export function bindDetailRow(xml: string | undefined | null): BoundRepx {
  const text = xml ?? '';
  const { plan, reason } = planDetailBinding(text);
  if (!plan) return { xml: text, applied: false, reason, fields: [] };

  let out = text;
  for (let i = plan.cells.length - 1; i >= 0; i--) {
    const cell = plan.cells[i];
    const slice = out.slice(cell.start, cell.end);
    const children = bindingElement(plan.fields[i].name);

    const rewritten = slice.endsWith('/>')
      ? // `<Item1 … />` has to grow a body and a closing tag.
        `${slice.slice(0, -2).trimEnd()}>${children}</${cell.tag}>`
      : // `<Item1 …>…</Item1>` already has one; go in at the end of it.
        slice.replace(new RegExp(`</${cell.tag}>$`), `${children}</${cell.tag}>`);

    out = out.slice(0, cell.start) + rewritten + out.slice(cell.end);
  }

  return {
    xml: out,
    applied: true,
    reason: `bound ${plan.fields.length} columns: ${plan.fields.map((f) => f.name).join(', ')}`,
    fields: plan.fields,
  };
}
