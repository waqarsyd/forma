/**
 * Hoist repeated appearance onto a shared `<StyleSheet>`.
 *
 * ## Why this is code and not a prompt instruction
 *
 * Every control the model emits carries its own `Font`, `ForeColor`, `BackColor`
 * and so on, so a migrated report that uses one heading treatment forty times
 * repeats it forty times. Restyling it in the designer then means selecting
 * forty controls, and changing it in the file means forty edits that must agree.
 * A real report has a style sheet; this is the one remaining gap that improves
 * *every* report rather than the subset containing some control.
 *
 * Asking the model to spot the repetition and name the styles would make it
 * responsible for a global property of the document while it writes controls one
 * at a time — the same shape as the margin lift and the parameter type lift,
 * both of which became arithmetic on the output for the same reason. This runs
 * after generation, sees the whole file at once, and is provably equivalent.
 *
 * ## Why it cannot change what the report prints
 *
 * A style supplies defaults; an attribute written on the control overrides it.
 * So for a group of controls whose appearance attributes are **exactly** equal,
 * moving that whole set into a style and deleting it from each control leaves
 * every control inheriting precisely what it had. A control keeping some extra
 * attribute keeps it, and it still wins. Equality of the full set is what makes
 * the transform safe, and it is why near-matches are left alone rather than
 * approximated into a shared style.
 *
 * ## Measured, not inferred (`RepxProbe emit-styles`)
 *
 * - `<StyleSheet>` is a root-level collection, a sibling of `<Bands>`, written
 *   **after** it.
 * - A control refers to a style **by name** — `StyleName="HeadingStyle"` — not by
 *   a `#Ref-N` pointer. That is why `repxRefs.ts` needs no change here, unlike
 *   parameters and cross-band controls.
 * - **A control's `Borders` is a style's `Sides`.** Same concept, different
 *   attribute name, and writing `Borders=` inside a style silently does nothing.
 * - A style item carries a `Ref` and **no `ControlType`** — the sixth collection
 *   where that holds.
 */

import { auditRefs } from './repxRefs';

/**
 * The appearance attributes that may move onto a style.
 *
 * Deliberately shorter than the list of things a style *can* hold. Each entry
 * here was seen in the probe's output, with the name it has in that position;
 * `BorderColor` and `BorderWidth` are omitted because their spelling inside a
 * style was never measured, and a guessed attribute name is silently ignored
 * rather than rejected. They stay on the control, where they still apply.
 */
const STYLABLE: { control: string; style: string }[] = [
  { control: 'Font', style: 'Font' },
  { control: 'ForeColor', style: 'ForeColor' },
  { control: 'BackColor', style: 'BackColor' },
  { control: 'TextAlignment', style: 'TextAlignment' },
  { control: 'Padding', style: 'Padding' },
  // The rename that makes this worth measuring rather than assuming.
  { control: 'Borders', style: 'Sides' },
];

/**
 * How many controls must share an appearance before it earns a style.
 *
 * Two is not worth the indirection: the style sheet entry plus two `StyleName`
 * attributes is longer than the two originals, and a reader gains nothing. Three
 * is where the file gets shorter and the intent — "these are the same thing" —
 * becomes visible.
 */
export const MIN_SHARED = 3;

export interface LiftedStyle {
  name: string;
  /** Attribute text as it will appear inside the style item. */
  attributes: string;
  /** How many controls now reference it. */
  used: number;
}

export interface StyleLift {
  xml: string;
  applied: boolean;
  reason: string;
  styles: LiftedStyle[];
}

/** One opening tag, with the offsets needed to rewrite its attribute list. */
interface Tag {
  attrs: string;
  start: number;
  end: number;
}

const OPEN_TAG = /<(Item\d+)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

const attrOf = (attrs: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
};

/**
 * Controls only — not bands, not rows, not cells, not collection items.
 *
 * A band carries no appearance worth sharing, and a table row or cell inherits
 * from its table, so hoisting from those would move a property up a level that
 * DevExpress resolves differently. `ControlType` starting `XR` is the test, and
 * it also excludes every collection item, which carries none at all.
 */
const INSIDE_A_TABLE = new Set(['XRTableRow', 'XRTableCell']);

const isControl = (attrs: string): boolean => {
  const type = attrOf(attrs, 'ControlType') ?? '';
  // `startsWith('XR')` alone is not enough, and the gap is easy to miss: a cell
  // is an XRTableCell, so it passes that test and would have been lifted from.
  // Its appearance is resolved against its table's OddStyleName/EvenStyleName,
  // so moving it to a report-level style changes which rule wins.
  return type.startsWith('XR') && !INSIDE_A_TABLE.has(type);
};

/**
 * Lift shared appearance onto a `<StyleSheet>`.
 *
 * Returns the document unchanged, with a reason, whenever there is nothing worth
 * doing — no controls, no repetition, or a document that already has a style
 * sheet. The last of those is deliberate: an uploaded `.repx` may arrive with
 * styles already, and merging two style systems is a different and much less
 * safe operation than creating one.
 */
export function liftStyles(xml: string | undefined | null): StyleLift {
  const text = xml ?? '';
  const nothing = (reason: string): StyleLift => ({ xml: text, applied: false, reason, styles: [] });

  if (!text.trim()) return nothing('there is no REPX to restyle');
  if (/<StyleSheet[\s>]/.test(text)) return nothing('the report already has a style sheet');

  const bandsEnd = text.lastIndexOf('</Bands>');
  if (bandsEnd === -1) return nothing('the report has no <Bands> to hang a style sheet beside');

  // Collect every control tag with its appearance signature.
  const tags: Tag[] = [];
  const signatures = new Map<string, number[]>();
  OPEN_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPEN_TAG.exec(text)) !== null) {
    const attrs = match[2];
    if (!isControl(attrs)) continue;

    const present = STYLABLE.filter((a) => attrOf(attrs, a.control) !== null);
    if (present.length === 0) continue;

    const signature = present.map((a) => `${a.control}=${attrOf(attrs, a.control)}`).join('|');
    const index = tags.length;
    tags.push({ attrs, start: match.index, end: match.index + match[0].length });
    const bucket = signatures.get(signature);
    if (bucket) bucket.push(index);
    else signatures.set(signature, [index]);
  }

  const shared = [...signatures.entries()].filter(([, list]) => list.length >= MIN_SHARED);
  if (shared.length === 0) {
    return nothing(
      tags.length
        ? `no appearance is repeated across ${MIN_SHARED} or more controls`
        : 'no control carries appearance that could be shared',
    );
  }

  /*
   * Names are derived from the appearance itself rather than numbered blindly,
   * because the person who opens this in the designer reads the list. A bold
   * font is a heading in every report anyone has ever laid out; everything else
   * is body text until it proves otherwise.
   */
  let headings = 0;
  let bodies = 0;
  const styles: LiftedStyle[] = [];
  const styleNameFor = new Map<number, string>();

  let nextRef = auditRefs(text).max + 1;

  for (const [signature, members] of shared) {
    const sample = tags[members[0]].attrs;
    const bold = /style=Bold/i.test(attrOf(sample, 'Font') ?? '');
    const name = bold ? `HeadingStyle${++headings > 1 ? headings : ''}` : `BodyStyle${++bodies > 1 ? bodies : ''}`;

    const attributes = STYLABLE
      .filter((a) => attrOf(sample, a.control) !== null)
      .map((a) => `${a.style}="${attrOf(sample, a.control)}"`)
      .join(' ');

    styles.push({ name, attributes, used: members.length });
    for (const index of members) styleNameFor.set(index, name);
    void signature;
  }

  /*
   * Rewrite back to front so every offset before the current edit stays valid —
   * the same discipline as `ensureUniqueRefs` and `repxEdit`, and for the same
   * reason: these are byte offsets into the document being edited.
   */
  let out = text;
  for (let i = tags.length - 1; i >= 0; i--) {
    const name = styleNameFor.get(i);
    if (!name) continue;
    const tag = tags[i];
    let attrs = tag.attrs;
    for (const attribute of STYLABLE) {
      attrs = attrs.replace(new RegExp(`\\s${attribute.control}\\s*=\\s*"[^"]*"`), '');
    }
    const whole = out.slice(tag.start, tag.end);
    const rebuilt = whole.replace(tag.attrs, `${attrs} StyleName="${name}"`);
    out = out.slice(0, tag.start) + rebuilt + out.slice(tag.end);
  }

  const sheet =
    '\n  <StyleSheet>\n' +
    styles.map((s, i) => `    <Item${i + 1} Ref="${nextRef++}" Name="${s.name}" ${s.attributes} />`).join('\n') +
    '\n  </StyleSheet>';

  const insertAt = out.lastIndexOf('</Bands>') + '</Bands>'.length;
  out = out.slice(0, insertAt) + sheet + out.slice(insertAt);

  const moved = styles.reduce((sum, s) => sum + s.used, 0);
  return {
    xml: out,
    applied: true,
    reason:
      `lifted ${styles.length} shared appearance${styles.length === 1 ? '' : 's'} onto a style sheet, ` +
      `used by ${moved} controls (${styles.map((s) => `${s.name}x${s.used}`).join(', ')})`,
    styles,
  };
}
