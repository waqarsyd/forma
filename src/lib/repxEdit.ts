/**
 * Moving, resizing and retyping a control, written straight into the REPX.
 *
 * ## Why this edits the REPX and not the layout
 *
 * The obvious place to put direct manipulation is the Mockup, and it is the
 * wrong one. The mockup draws `layout.sections` -- a picture of the document
 * the user uploaded, kept for comparing fidelity against the source. Dragging
 * a label there would move it in the picture and change nothing about the file
 * that gets exported, and there is no reliable way back: a layout element and a
 * REPX control share no identifier, so matching them means guessing from
 * position and order, which is wrong exactly when two controls overlap.
 *
 * The Preview is drawn from `repxContent` itself. Every control on screen came
 * from a known span of the document, so an edit is a splice at that span and
 * the thing the user drags is the thing they download.
 *
 * ## Splices, not re-serialisation
 *
 * Every function here rewrites one opening tag's attribute list and copies the
 * rest of the document through untouched. That is deliberate for the reason
 * `repxBindingPlan.ts` gives: the model wrote attributes this project does not
 * model -- `Padding`, `StylePriority`, `Multiline`, anything a future version
 * adds -- and a parse-and-re-emit would quietly drop each one. A byte the user
 * did not ask to change should not change.
 *
 * ## The units are the report's, not the screen's
 *
 * Everything crossing this boundary is in report units, already converted by
 * the caller through `reportGeometry.ts`. Accepting pixels here would put a
 * second conversion site in the codebase, which is the thing that file exists
 * to prevent.
 */
import { parseReportStructure, type PreviewControl } from './reportPreview';
import { escapeXmlAttribute } from './xmlEscape';

/** Which control, by its position in the parsed structure. */
export interface ControlRef {
  /** Index into `parseReportStructure(...).bands`, which is print order. */
  band: number;
  /** Index into that band's `controls`, in document order. */
  control: number;
}

export interface EditResult {
  xml: string;
  applied: boolean;
  /** Worth logging and, when it declined, worth showing. */
  reason: string;
}

const decline = (xml: string, reason: string): EditResult => ({ xml, applied: false, reason });

/** Attribute values go inside double quotes; the one copy is lib/xmlEscape.ts (2026-11-07). */
export { escapeXmlAttribute };

/**
 * Set attributes on one opening tag, replacing what is there and appending
 * what is not.
 *
 * `openTag` is everything from `<` to `>` inclusive. The trailing `/` of a
 * self-closing element is preserved, because turning `<Item1 … />` into
 * `<Item1 …>` silently swallows every following sibling into it as a child.
 */
function withAttributes(openTag: string, attrs: Record<string, string>): string {
  const selfClosing = /\/>$/.test(openTag);
  let body = openTag.slice(1, selfClosing ? -2 : -1).trimEnd();

  for (const [name, value] of Object.entries(attrs)) {
    const existing = new RegExp(`(\\s${name}\\s*=\\s*")[^"]*(")`);
    if (existing.test(body)) {
      body = body.replace(existing, `$1${escapeXmlAttribute(value)}$2`);
    } else {
      body += ` ${name}="${escapeXmlAttribute(value)}"`;
    }
  }

  return `<${body}${selfClosing ? ' />' : '>'}`;
}

/** Round to a whole report unit. Sub-unit precision is noise the file keeps forever. */
const unit = (n: number) => Math.round(n);

function locate(xml: string, ref: ControlRef): PreviewControl | null {
  const band = parseReportStructure(xml).bands[ref.band];
  return band?.controls[ref.control] ?? null;
}

function applyAttributes(xml: string, ref: ControlRef, attrs: Record<string, string>, what: string): EditResult {
  const control = locate(xml, ref);
  if (!control) return decline(xml, `no control at band ${ref.band}, control ${ref.control}`);

  const openTag = xml.slice(control.openStart, control.openEnd + 1);
  if (!openTag.startsWith('<') || !openTag.endsWith('>')) {
    return decline(xml, 'the control span does not look like an opening tag; the REPX may have changed underneath');
  }

  const rewritten = withAttributes(openTag, attrs);
  return {
    xml: xml.slice(0, control.openStart) + rewritten + xml.slice(control.openEnd + 1),
    applied: true,
    reason: `${what} ${control.type}${control.name ? ` "${control.name}"` : ''}`,
  };
}

/**
 * Move a control to an absolute band-relative position.
 *
 * Clamped at zero on both axes: a negative `LocationFloat` puts a control off
 * the top or the left of its band, where DevExpress draws nothing and reports
 * nothing. The clamp is silent because dragging past the edge is a gesture, not
 * a mistake worth interrupting.
 */
export function moveControl(xml: string, ref: ControlRef, x: number, y: number): EditResult {
  return applyAttributes(
    xml,
    ref,
    { LocationFloat: `${unit(Math.max(0, x))},${unit(Math.max(0, y))}` },
    'moved',
  );
}

/**
 * Resize a control.
 *
 * A minimum of one unit rather than zero: a control sized 0 is invisible and
 * unselectable, so a careless drag would lose it with no way back short of
 * undo. One unit is still tiny and still there.
 */
export function resizeControl(xml: string, ref: ControlRef, width: number, height: number): EditResult {
  return applyAttributes(
    xml,
    ref,
    { SizeF: `${unit(Math.max(1, width))},${unit(Math.max(1, height))}` },
    'resized',
  );
}

/**
 * Retype a control's text. Escaped on the way in; `&` in a label is ordinary.
 * A line break is written as the serializer writes one (`&#xD;&#xA;`, see
 * xmlEscape.ts) and turns `Multiline` on (2026-11-07, agent audit item 49),
 * without which DevExpress prints the lines run together.
 */
export function setControlText(xml: string, ref: ControlRef, text: string): EditResult {
  return applyAttributes(xml, ref, { Text: text, ...(/[\r\n]/.test(text) ? { Multiline: 'true' } : {}) }, 'retyped');
}

/**
 * Set any attributes on a control's opening tag, worked out from the tag as
 * it stands and the control as parsed (2026-11-05, for the chat's edits: a
 * font made bold keeps its family and size, an alignment keeps its vertical
 * half). Values are escaped on the way in, as everywhere here.
 */
export function updateControl(
  xml: string,
  ref: ControlRef,
  attrs: (openTag: string, control: PreviewControl) => Record<string, string>,
  what: string,
): EditResult {
  const control = locate(xml, ref);
  if (!control) return decline(xml, `no control at band ${ref.band}, control ${ref.control}`);
  const openTag = xml.slice(control.openStart, control.openEnd + 1);
  return applyAttributes(xml, ref, attrs(openTag, control), what);
}

/**
 * Keep a control inside its band, or say the band has to grow.
 *
 * Not enforced by the movers above, and that is deliberate: a control dragged
 * below its band's `HeightF` is a real edit with a real consequence -- the
 * designer silently pushes the band taller or drops the control onto a second
 * page -- and the honest response is to tell the user, not to refuse the drag
 * or to quietly resize the band under them. `repxAudit` reports the same class
 * of problem after generation; this is the interactive equivalent.
 */
export function overflowsBand(control: PreviewControl, bandHeight: number): boolean {
  // A panel's child is placed inside its panel; the band holds the panel's offset too (2026-11-06).
  return control.y + (control.offsetY ?? 0) + control.height > bandHeight + 0.5;
}

/*
 * Deleting and adding a control, and retyping a table cell (2026-11-04, the
 * PRD's last "not yet" for direct manipulation). Splices still, so a byte the
 * user did not ask to change does not change.
 */

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

interface Element {
  name: string;
  start: number;
  /** Just past its opening tag. */
  openEnd: number;
  /** Just past its closing tag, or its opening tag when it closes itself. */
  end: number;
  selfClosing: boolean;
}

/** The elements directly inside [from, to), in order. */
function childrenIn(xml: string, from: number, to: number): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [];
  TAG.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null && m.index < to) {
    const [whole, closing, name, , selfClose] = m;
    if (closing) {
      const el = stack.pop();
      if (el && !stack.length) {
        el.end = m.index + whole.length;
        out.push(el);
      }
      continue;
    }
    const el: Element = { name, start: m.index, openEnd: m.index + whole.length, end: m.index + whole.length, selfClosing: !!selfClose };
    if (selfClose) {
      if (!stack.length) out.push(el);
    } else {
      stack.push(el);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The element whose opening tag starts at `start`, measured to its end; null when there is none. */
function elementAt(xml: string, start: number): Element | null {
  const found = childrenIn(xml, start, xml.length)[0];
  return found && found.start === start ? found : null;
}

/** The element that directly holds the one starting at `start`. */
function parentOf(xml: string, start: number): Element | null {
  const stack: Element[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    if (m.index === start) return stack[stack.length - 1] ? { ...stack[stack.length - 1], end: elementAt(xml, stack[stack.length - 1].start)?.end ?? xml.length } : null;
    const [whole, closing, name, , selfClose] = m;
    if (closing) stack.pop();
    else if (!selfClose) stack.push({ name, start: m.index, openEnd: m.index + whole.length, end: 0, selfClosing: false });
  }
  return null;
}

/** A collection's items numbered Item1, Item2... again, as the serializer writes them. */
function renumberItems(xml: string, parent: Element): string {
  const items = childrenIn(xml, parent.openEnd, parent.end).filter((c) => /^Item\d+$/.test(c.name));
  let out = xml;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const name = `Item${i + 1}`;
    if (item.name === name) continue;
    if (!item.selfClosing) {
      const close = `</${item.name}>`;
      const closeAt = item.end - close.length;
      out = out.slice(0, closeAt) + `</${name}>` + out.slice(item.end);
    }
    out = out.slice(0, item.start + 1) + name + out.slice(item.start + 1 + item.name.length);
  }
  return out;
}

/** The span of `[start, end)` widened over the indentation and line break before it. */
function withLeadingSpace(xml: string, start: number, end: number): [number, number] {
  let s = start;
  while (s > 0 && (xml[s - 1] === ' ' || xml[s - 1] === '\t')) s--;
  if (s > 0 && xml[s - 1] === '\n') s--;
  if (s > 0 && xml[s - 1] === '\r') s--;
  return [s, end];
}

/**
 * Delete a control. Declined when another part of the report names it, or
 * anything inside it, by `#Ref-N` (a band's drill-down toggle, a cross-band
 * line's ends, a chart's series): a dangling reference is a file DevExpress
 * may refuse to load. The items after it in its collection are numbered
 * again, and a `<Controls>` left empty goes with it.
 */
export function deleteControl(xml: string, ref: ControlRef): EditResult {
  const control = locate(xml, ref);
  if (!control) return decline(xml, `no control at band ${ref.band}, control ${ref.control}`);
  const el = elementAt(xml, control.openStart);
  if (!el) return decline(xml, 'the control span does not look like an element; the REPX may have changed underneath');
  const inside = xml.slice(el.start, el.end);
  const outside = xml.slice(0, el.start) + xml.slice(el.end);
  const named = [...inside.matchAll(/\sRef="(\d+)"/g)].map((r) => r[1]).find((n) => outside.includes(`"#Ref-${n}"`));
  if (named) return decline(xml, `${control.name || control.type} is named elsewhere in the report (#Ref-${named}); remove what names it first`);
  const parent = parentOf(xml, el.start);
  const [from, to] = withLeadingSpace(xml, el.start, el.end);
  let out = xml.slice(0, from) + xml.slice(to);
  if (parent) {
    const after = elementAt(out, parent.start);
    if (after) {
      if (!childrenIn(out, after.openEnd, after.end).length && after.name === 'Controls') {
        const [pf, pt] = withLeadingSpace(out, after.start, after.end);
        out = out.slice(0, pf) + out.slice(pt);
      } else {
        out = renumberItems(out, after);
      }
    }
  }
  return { xml: out, applied: true, reason: `deleted ${control.type}${control.name ? ` "${control.name}"` : ''}` };
}

/**
 * Duplicate a control beside itself (2026-11-05), as Stitch's Duplicate
 * (Ctrl+D): the whole element copied to the end of its own collection,
 * shifted down and right by 8 hundredths of an inch at its own `Dpi`. Every
 * `Ref` in the copy is numbered past the file's highest, because two equal
 * Refs make DevExpress's loader drop content without an error, and every
 * `Name` in it is made unique (`labelTitle` -> `labelTitle1`, `label3` ->
 * the next free `labelN`). A control that names a part of itself by
 * `#Ref-N` (a chart's series, a cross-tab's cells) is declined rather than
 * copied with a reference back into the original.
 */
export function duplicateControl(xml: string, ref: ControlRef): EditResult {
  const control = locate(xml, ref);
  if (!control) return decline(xml, `no control at band ${ref.band}, control ${ref.control}`);
  const el = elementAt(xml, control.openStart);
  if (!el) return decline(xml, 'the control span does not look like an element; the REPX may have changed underneath');
  const parent = parentOf(xml, el.start);
  if (!parent || parent.name !== 'Controls') return decline(xml, `${control.name || control.type} is not in a band's controls`);
  let copy = xml.slice(el.start, el.end);
  // Declined only when it names one of its own parts by Ref, which the fresh
  // Refs below would leave pointing at the original's. A link out of it, as
  // every formatting rule is (`Value="#Ref-N"`), stays as it is: the copy
  // follows the same rule. Until 2026-11-06 any link declined it.
  const own = new Set([...copy.matchAll(/\sRef="(\d+)"/g)].map((m) => m[1]));
  if ([...copy.matchAll(/"#Ref-(\d+)"/g)].some((m) => own.has(m[1]))) {
    return decline(xml, `${control.name || control.type} refers to its own parts; copy it in the designer`);
  }

  let nextRef = Math.max(0, ...[...xml.matchAll(/\sRef="(\d+)"/g)].map((r) => Number(r[1]))) + 1;
  copy = copy.replace(/(\sRef=")\d+(")/g, (_, a, b) => `${a}${nextRef++}${b}`);
  const taken = new Set([...xml.matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  let firstName = '';
  copy = copy.replace(/(\sName=")([^"]*)(")/g, (_, a, name: string, b) => {
    const base = name.replace(/\d+$/, '');
    let n = 1;
    while (taken.has(`${base}${n}`)) n++;
    const fresh = `${base}${n}`;
    taken.add(fresh);
    if (!firstName) firstName = fresh;
    return `${a}${fresh}${b}`;
  });
  const open = /^<[^>]*>/.exec(copy)![0];
  const dpi = Number(/\sDpi="([\d.]+)"/.exec(open)?.[1] ?? 100);
  const at = /\sLocationFloat="([-\d.]+),\s*([-\d.]+)"/.exec(open);
  if (at) {
    const step = 8 * (dpi / 100);
    copy = withAttributes(open, { LocationFloat: `${unit(Number(at[1]) + step)}, ${unit(Number(at[2]) + step)}` }) + copy.slice(open.length);
  }

  const count = childrenIn(xml, parent.openEnd, parent.end).filter((c) => /^Item\d+$/.test(c.name)).length;
  const item = `Item${count + 1}`;
  copy = copy.replace(new RegExp(`^<${el.name}\\b`), `<${item}`);
  if (!el.selfClosing) copy = copy.replace(new RegExp(`</${el.name}>$`), `</${item}>`);
  const closeAt = parent.end - '</Controls>'.length;
  return {
    xml: xml.slice(0, closeAt) + copy + xml.slice(closeAt),
    applied: true,
    reason: `duplicated ${control.type}${control.name ? ` "${control.name}"` : ''} as "${firstName}"`,
  };
}

/** A band's element in the file, by the name the parse gives it. */
function bandElement(xml: string, name: string): Element | null {
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    if (m[1]) continue;
    const attrs = m[3];
    if (/\sControlType="[^"]*Band"/.test(attrs) && new RegExp(`\\sName="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(attrs)) return elementAt(xml, m.index);
  }
  return null;
}

/**
 * Add a label to a band at `x`, `y` in report units: a fresh `Ref` above every
 * other, a name no control has, the default XRLabel padding, and the band's
 * own `Dpi` (parity row 33), so it prints where it was put in a millimetre
 * report too. Its box is 100 by 23 hundredths of an inch, as the designer
 * makes one.
 */
export function addLabel(xml: string, bandIndex: number, x: number, y: number, text = 'New label', name?: string): EditResult {
  return insertControl(xml, bandIndex, 'XRLabel', 'label', ({ dpi, per, scale }) =>
    `Text="${escapeXmlAttribute(text)}" TextAlignment="TopLeft"` +
      ` LocationFloat="${unit(Math.max(0, x / scale))}, ${unit(Math.max(0, y / scale))}" SizeF="${unit(100 * per)}, ${unit(23 * per)}"` +
      ` Padding="2,2,0,0,${dpi}"`, name);
}

/**
 * Retype one cell of a table, by its row and its place in the row, in file
 * order. A cell whose text is bound to a field is declined: the binding wins
 * when it prints, so typed text would never be seen.
 */
export function setCellText(xml: string, ref: ControlRef, row: number, cell: number, text: string): EditResult {
  return updateCellElement(xml, ref, row, cell, (_, bound) => (bound ? null : { Text: text, ...(/[\r\n]/.test(text) ? { Multiline: 'true' } : {}) }), 'retyped', 'the cell prints a field, not typed text: bind another in the Data tab');
}

/**
 * A band's height, in its own units as the file writes them (2026-11-07,
 * agent audit item 22). Never below the lowest edge of what it holds, which
 * would leave a control hanging below its band, where DevExpress grows the
 * band anyway and the report no longer reads as designed.
 */
export function setBandHeight(xml: string, bandIndex: number, height: number): EditResult {
  const band = parseReportStructure(xml).bands[bandIndex];
  if (!band) return decline(xml, `no band at ${bandIndex}`);
  if (band.sub) return decline(xml, 'a detail report has no height of its own; set one of its bands');
  const el = bandElement(xml, band.name);
  if (!el) return decline(xml, `band "${band.name}" was not found in the file`);
  const scale = band.dpiScale ?? 1;
  const lowest = Math.max(0, ...band.controls.filter((c) => c.panel === undefined).map((c) => (c.y + c.height) / scale));
  if (!(height > 0)) return decline(xml, 'no height was given');
  if (height < lowest) return decline(xml, `${band.name} holds a control reaching ${unit(lowest)}; move or shrink it first`);
  const openTag = xml.slice(el.start, el.openEnd);
  return {
    xml: xml.slice(0, el.start) + withAttributes(openTag, { HeightF: String(unit(height)) }) + xml.slice(el.openEnd),
    applied: true,
    reason: `set the height of ${band.name} to ${unit(height)}`,
  };
}

/**
 * Put a new control into a band (2026-11-07): a fresh `Ref` above every
 * other, a name no control has, the band's own `Dpi` when it writes one, and
 * the attributes `build` returns. `addLabel` and the chat's line and page
 * number go through it.
 */
function insertControl(
  xml: string,
  bandIndex: number,
  type: 'XRLabel' | 'XRLine' | 'XRPageInfo',
  stem: string,
  build: (ctx: { dpi: number; per: number; scale: number }) => string,
  wantedName?: string,
): EditResult {
  const band = parseReportStructure(xml).bands[bandIndex];
  if (!band) return decline(xml, `no band at ${bandIndex}`);
  if (band.sub) return decline(xml, 'a detail report holds bands, not controls');
  const el = bandElement(xml, band.name);
  if (!el) return decline(xml, `band "${band.name}" was not found in the file`);
  const openTag = xml.slice(el.start, el.openEnd);
  const dpi = Number(/\sDpi="([\d.]+)"/.exec(openTag)?.[1] ?? 100);
  const ref = Math.max(0, ...[...xml.matchAll(/\sRef="(\d+)"/g)].map((r) => Number(r[1]))) + 1;
  const taken = new Set([...xml.matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  const clean = (wantedName ?? '').trim();
  const name = /^[A-Za-z_][\w]*$/.test(clean) && !taken.has(clean)
    ? clean
    : `${stem}${Math.max(0, ...[...xml.matchAll(new RegExp(`\\sName="${stem}(\\d+)"`, 'g'))].map((r) => Number(r[1]))) + 1}`;
  const attrs =
    `Ref="${ref}" ControlType="${type}" Name="${name}" ` +
    build({ dpi, per: dpi / 100, scale: band.dpiScale ?? 1 }) +
    (/\sDpi="/.test(openTag) ? ` Dpi="${dpi}"` : '');

  const controls = el.selfClosing ? undefined : childrenIn(xml, el.openEnd, el.end).find((c) => c.name === 'Controls');
  let out: string;
  if (controls && !controls.selfClosing) {
    const count = childrenIn(xml, controls.openEnd, controls.end).filter((c) => /^Item\d+$/.test(c.name)).length;
    const closeAt = controls.end - '</Controls>'.length;
    out = xml.slice(0, closeAt) + `<Item${count + 1} ${attrs} />` + xml.slice(closeAt);
  } else if (controls) {
    out = xml.slice(0, controls.start) + `<Controls><Item1 ${attrs} /></Controls>` + xml.slice(controls.end);
  } else if (el.selfClosing) {
    const tag = /^<([A-Za-z_][\w.:-]*)/.exec(openTag)![1];
    out = xml.slice(0, el.start) + openTag.replace(/\s*\/>$/, '>') + `<Controls><Item1 ${attrs} /></Controls></${tag}>` + xml.slice(el.end);
  } else {
    out = xml.slice(0, el.openEnd) + `<Controls><Item1 ${attrs} /></Controls>` + xml.slice(el.openEnd);
  }
  return { xml: out, applied: true, reason: `added ${type} "${name}"` };
}

/**
 * A horizontal line across a band (2026-11-07, agent audit item 22), at `x`,
 * `y` in report units, `width` long: an `XRLine` the height of its weight
 * plus a little, as the designer draws one, `LineWidth` written only when it
 * is not the default 1.
 */
export function addLine(xml: string, bandIndex: number, x: number, y: number, width: number, lineWidth = 1, name?: string): EditResult {
  return insertControl(xml, bandIndex, 'XRLine', 'line', ({ per, scale }) =>
    `LocationFloat="${unit(Math.max(0, x / scale))}, ${unit(Math.max(0, y / scale))}" SizeF="${unit(Math.max(1, width / scale))}, ${unit(Math.max(2, lineWidth + 1) * per)}"` +
      (lineWidth !== 1 ? ` LineWidth="${unit(lineWidth)}"` : ''), name);
}

/**
 * A page number (2026-11-07, agent audit item 22): an `XRPageInfo`, which
 * DevExpress fills in as it prints (parity row 15, `pageInfoText`). `kind` is
 * left unwritten for NumberOfTotal, the serializer's default; `format` is its
 * `TextFormatString`, such as "Page {0} of {1}".
 */
export function addPageInfo(
  xml: string,
  bandIndex: number,
  x: number,
  y: number,
  options: { width?: number; kind?: string; format?: string; align?: 'left' | 'center' | 'right'; name?: string } = {},
): EditResult {
  const H = { left: 'Left', center: 'Center', right: 'Right' } as const;
  return insertControl(xml, bandIndex, 'XRPageInfo', 'pageInfo', ({ dpi, per, scale }) =>
    (options.kind && options.kind !== 'NumberOfTotal' ? `PageInfo="${escapeXmlAttribute(options.kind)}" ` : '') +
      (options.format ? `TextFormatString="${escapeXmlAttribute(options.format)}" ` : '') +
      `TextAlignment="Top${H[options.align ?? 'right']}" ` +
      `LocationFloat="${unit(Math.max(0, x / scale))}, ${unit(Math.max(0, y / scale))}" SizeF="${unit((options.width ?? 200) / scale)}, ${unit(23 * per)}" Padding="2,2,0,0,${dpi}"`, options.name);
}

/**
 * Bind what a control or a table's cell prints to an expression, `[Field]`
 * for a field (2026-11-07, agent audit item 22), as the Data tab binds a
 * column and as the serializer writes one: an `ExpressionBindings` item with
 * no `Ref` (repxBindingPlan.ts says why), its `Text` kept as the fallback.
 * An existing Text binding has its expression replaced.
 */
export function bindText(xml: string, ref: ControlRef, expression: string, row?: number, cell?: number): EditResult {
  const control = locate(xml, ref);
  if (!control) return decline(xml, `no control at band ${ref.band}, control ${ref.control}`);
  let target: Element | null = elementAt(xml, control.openStart);
  if (!target) return decline(xml, 'the control span does not look like an element');
  if (control.type === 'XRTable') {
    if (row === undefined || cell === undefined) return decline(xml, `${control.name} is a table: name the row and the cell`);
    const rows = childrenIn(xml, target.openEnd, target.end).find((c) => c.name === 'Rows');
    const rowEl = rows && childrenIn(xml, rows.openEnd, rows.end).filter((c) => /^Item\d+$/.test(c.name))[row];
    const cells = rowEl && childrenIn(xml, rowEl.openEnd, rowEl.end).find((c) => c.name === 'Cells');
    target = (cells && childrenIn(xml, cells.openEnd, cells.end).filter((c) => /^Item\d+$/.test(c.name))[cell]) ?? null;
    if (!target) return decline(xml, `no cell ${cell + 1} in row ${row + 1} of ${control.name || 'the table'}`);
  }
  const value = escapeXmlAttribute(expression);
  const bindings = target.selfClosing ? undefined : childrenIn(xml, target.openEnd, target.end).find((c) => c.name === 'ExpressionBindings');
  const textItem = bindings && childrenIn(xml, bindings.openEnd, bindings.end).find((c) => /\sPropertyName="Text"/.test(xml.slice(c.start, c.openEnd)));
  const what = `bound ${control.type === 'XRTable' ? `row ${(row ?? 0) + 1}, cell ${(cell ?? 0) + 1} of ` : ''}${control.name || control.type} to ${expression}`;
  if (textItem) {
    const open = xml.slice(textItem.start, textItem.openEnd);
    const rewritten = open.replace(/(\sExpression=")[^"]*(")/, `$1${value}$2`);
    return { xml: xml.slice(0, textItem.start) + rewritten + xml.slice(textItem.openEnd), applied: rewritten !== open, reason: what };
  }
  const item = `<Item1 EventName="BeforePrint" PropertyName="Text" Expression="${value}" />`;
  const tag = /^<([A-Za-z_][\w.:-]*)/.exec(xml.slice(target.start, target.openEnd))![1];
  let out: string;
  if (bindings && !bindings.selfClosing) {
    const count = childrenIn(xml, bindings.openEnd, bindings.end).filter((c) => /^Item\d+$/.test(c.name)).length;
    const closeAt = bindings.end - '</ExpressionBindings>'.length;
    out = xml.slice(0, closeAt) + item.replace('<Item1', `<Item${count + 1}`) + xml.slice(closeAt);
  } else if (target.selfClosing) {
    const open = xml.slice(target.start, target.openEnd);
    out = xml.slice(0, target.start) + open.replace(/\s*\/>$/, '>') + `<ExpressionBindings>${item}</ExpressionBindings></${tag}>` + xml.slice(target.end);
  } else {
    const closeAt = target.end - `</${tag}>`.length;
    out = xml.slice(0, closeAt) + `<ExpressionBindings>${item}</ExpressionBindings>` + xml.slice(closeAt);
  }
  return { xml: out, applied: true, reason: what };
}

/**
 * Set attributes on one cell of a table (2026-11-05, for the chat's edits), by
 * its row and place in the row in file order, worked out from the cell's
 * opening tag as it stands.
 */
export function updateCell(xml: string, ref: ControlRef, row: number, cell: number, attrs: (openTag: string) => Record<string, string>, what: string): EditResult {
  return updateCellElement(xml, ref, row, cell, (openTag) => attrs(openTag), what, '');
}

function updateCellElement(
  xml: string,
  ref: ControlRef,
  row: number,
  cell: number,
  attrs: (openTag: string, bound: boolean) => Record<string, string> | null,
  what: string,
  refusal: string,
): EditResult {
  const control = locate(xml, ref);
  if (!control) return decline(xml, `no control at band ${ref.band}, control ${ref.control}`);
  if (control.type !== 'XRTable') return decline(xml, `${control.name || control.type} is not a table`);
  const table = elementAt(xml, control.openStart);
  if (!table) return decline(xml, 'the table span does not look like an element');
  const rows = childrenIn(xml, table.openEnd, table.end).find((c) => c.name === 'Rows');
  const rowEl = rows && childrenIn(xml, rows.openEnd, rows.end).filter((c) => /^Item\d+$/.test(c.name))[row];
  const cells = rowEl && childrenIn(xml, rowEl.openEnd, rowEl.end).find((c) => c.name === 'Cells');
  const cellEl = cells && childrenIn(xml, cells.openEnd, cells.end).filter((c) => /^Item\d+$/.test(c.name))[cell];
  if (!cellEl) return decline(xml, `no cell ${cell + 1} in row ${row + 1} of ${control.name || 'the table'}`);
  const openTag = xml.slice(cellEl.start, cellEl.openEnd);
  const wanted = attrs(openTag, /PropertyName="Text"/.test(xml.slice(cellEl.start, cellEl.end)));
  if (!wanted) return decline(xml, refusal);
  const name = /\sName="([^"]*)"/.exec(openTag)?.[1];
  return {
    xml: xml.slice(0, cellEl.start) + withAttributes(openTag, wanted) + xml.slice(cellEl.openEnd),
    applied: true,
    reason: `${what} XRTableCell${name ? ` "${name}"` : ''}`,
  };
}
