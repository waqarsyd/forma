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
