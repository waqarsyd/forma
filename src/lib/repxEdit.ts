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

/** Attribute values go inside double quotes, so those five must not appear raw. */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

/** Retype a control's text. Escaped on the way in; `&` in a label is ordinary. */
export function setControlText(xml: string, ref: ControlRef, text: string): EditResult {
  return applyAttributes(xml, ref, { Text: text }, 'retyped');
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
  return control.y + control.height > bandHeight + 0.5;
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
export function addLabel(xml: string, bandIndex: number, x: number, y: number, text = 'New label'): EditResult {
  const band = parseReportStructure(xml).bands[bandIndex];
  if (!band) return decline(xml, `no band at ${bandIndex}`);
  if (band.sub) return decline(xml, 'a detail report holds bands, not controls');
  const el = bandElement(xml, band.name);
  if (!el) return decline(xml, `band "${band.name}" was not found in the file`);
  const openTag = xml.slice(el.start, el.openEnd);
  const dpi = Number(/\sDpi="([\d.]+)"/.exec(openTag)?.[1] ?? 100);
  const per = dpi / 100;
  const scale = band.dpiScale ?? 1;
  const ref = Math.max(0, ...[...xml.matchAll(/\sRef="(\d+)"/g)].map((r) => Number(r[1]))) + 1;
  const n = Math.max(0, ...[...xml.matchAll(/\sName="label(\d+)"/g)].map((r) => Number(r[1]))) + 1;
  const name = `label${n}`;
  const attrs =
    `Ref="${ref}" ControlType="XRLabel" Name="${name}" Text="${escapeXmlAttribute(text)}" TextAlignment="TopLeft"` +
    ` LocationFloat="${unit(Math.max(0, x / scale))}, ${unit(Math.max(0, y / scale))}" SizeF="${unit(100 * per)}, ${unit(23 * per)}"` +
    ` Padding="2,2,0,0,${dpi}"${/\sDpi="/.test(openTag) ? ` Dpi="${dpi}"` : ''}`;

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
  return { xml: out, applied: true, reason: `added XRLabel "${name}"` };
}

/**
 * Retype one cell of a table, by its row and its place in the row, in file
 * order. A cell whose text is bound to a field is declined: the binding wins
 * when it prints, so typed text would never be seen.
 */
export function setCellText(xml: string, ref: ControlRef, row: number, cell: number, text: string): EditResult {
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
  if (/PropertyName="Text"/.test(xml.slice(cellEl.start, cellEl.end))) return decline(xml, 'the cell prints a field, not typed text: bind another in the Data tab');
  const openTag = xml.slice(cellEl.start, cellEl.openEnd);
  const name = /\sName="([^"]*)"/.exec(openTag)?.[1];
  return {
    xml: xml.slice(0, cellEl.start) + withAttributes(openTag, { Text: text }) + xml.slice(cellEl.openEnd),
    applied: true,
    reason: `retyped XRTableCell${name ? ` "${name}"` : ''}`,
  };
}
