/**
 * The field a group breaks on, chosen in the Preview (2026-11-04, the PRD's
 * "not yet: choosing the grouping field in the UI").
 *
 * A group header's `<GroupFields>` names the field its records break on, as
 * measured with `tools/RepxProbe emit-group` (gemini.md, *Grouping, measured
 * the same way*). Choosing another field rewrites the first item's
 * `FieldName`, and the header's own bindings of the old field (`[Region]` in
 * the label that prints the group's value) follow it, so the heading shows
 * the value it now groups by. A header that groups by nothing, which the
 * audit reports because it prints once and reads like a heading, is given a
 * `<GroupFields>` with a fresh `Ref`.
 *
 * Splices, as `repxEdit.ts` does: one band's text changes and every other
 * byte is copied through, so attributes Forma does not model survive. The
 * group footer is left alone: its totals sum a value, not the group field.
 */
import { escapeXmlAttribute, type EditResult } from './repxEdit';

/** A group header as the chooser lists it: its name and the field it breaks on, or null. */
export interface GroupHeaderField {
  band: string;
  field: string | null;
}

interface HeaderSpan {
  name: string;
  /** The band's opening tag, start and end (exclusive). */
  openStart: number;
  openEnd: number;
  /** Just past the band's closing tag; the opening tag's end when it closes itself. */
  end: number;
  /** The first `<GroupFields>` item's opening tag, when there is one. */
  firstField: { start: number; end: number; name: string } | null;
  /** Just past `<GroupFields>`'s own opening tag, when the list is there but empty. */
  emptyList: number | null;
  /** A `<GroupFields />` written closed, to be replaced whole. */
  closedList: { start: number; end: number } | null;
}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const attrOf = (attrs: string, name: string): string | null => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every group header in the file, in file order, with where its parts are. */
function headerSpans(xml: string): HeaderSpan[] {
  const out: HeaderSpan[] = [];
  const stack: { name: string; header: HeaderSpan | null; fields: boolean }[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    const [whole, closing, name, attrs, selfClosing] = m;
    if (closing) {
      const frame = stack.pop();
      if (frame?.header && !stack.some((f) => f.header === frame.header)) frame.header.end = m.index + whole.length;
      continue;
    }
    const parent = stack[stack.length - 1];
    let header = parent?.header ?? null;
    let fields = false;
    if (attrOf(attrs, 'ControlType') === 'GroupHeaderBand') {
      header = { name: decode(attrOf(attrs, 'Name') ?? ''), openStart: m.index, openEnd: m.index + whole.length, end: m.index + whole.length, firstField: null, emptyList: null, closedList: null };
      out.push(header);
    } else if (header && name === 'GroupFields' && !header.firstField && header.emptyList === null && !header.closedList) {
      fields = true;
      if (selfClosing) header.closedList = { start: m.index, end: m.index + whole.length };
      else header.emptyList = m.index + whole.length;
    } else if (header && parent?.fields && !header.firstField) {
      header.firstField = { start: m.index, end: m.index + whole.length, name: decode(attrOf(attrs, 'FieldName') ?? '') };
      header.emptyList = null;
    }
    if (!selfClosing) stack.push({ name, header, fields });
  }
  return out;
}

/** The group headers a chooser offers, with the field each breaks on now. */
export function groupHeaderFields(xml: string | null | undefined): GroupHeaderField[] {
  return headerSpans(xml ?? '').map((h) => ({ band: h.name, field: h.firstField?.name || null }));
}

const decline = (xml: string, reason: string): EditResult => ({ xml, applied: false, reason });

/** Set the field the named group header breaks on. */
export function setGroupField(xml: string, band: string, field: string): EditResult {
  const wanted = field.trim();
  if (!wanted) return decline(xml, 'no field chosen');
  if (/[[\]]/.test(wanted)) return decline(xml, `"${wanted}" cannot be a field name: it holds a bracket`);
  const header = headerSpans(xml).find((h) => h.name === band);
  if (!header) return decline(xml, `no group header named "${band}"`);
  const old = header.firstField?.name ?? '';
  if (old === wanted) return decline(xml, `${band} already groups by ${wanted}`);

  let body = xml.slice(header.openStart, header.end);
  const at = (offset: number) => offset - header.openStart;
  if (header.firstField) {
    const tag = body.slice(at(header.firstField.start), at(header.firstField.end));
    // Functions, not replacement strings: a field named with `$&` or `$1` is data, not a pattern (2026-11-11, PX-02b).
    const retagged = /\sFieldName\s*=\s*"[^"]*"/.test(tag)
      ? tag.replace(/(\sFieldName\s*=\s*")[^"]*(")/, (_m, a: string, b: string) => a + escapeXmlAttribute(wanted) + b)
      : tag.replace(/\s*(\/?)>$/, (_m, slash: string) => ` FieldName="${escapeXmlAttribute(wanted)}" ${slash}>`).replace(/ >$/, '>');
    body = body.slice(0, at(header.firstField.start)) + retagged + body.slice(at(header.firstField.end));
  } else {
    const ref = Math.max(0, ...[...xml.matchAll(/\sRef="(\d+)"/g)].map((r) => Number(r[1]))) + 1;
    const item = `<Item1 Ref="${ref}" FieldName="${escapeXmlAttribute(wanted)}" />`;
    body = header.emptyList !== null
      ? body.slice(0, at(header.emptyList)) + item + body.slice(at(header.emptyList))
      : header.closedList
        ? body.slice(0, at(header.closedList.start)) + `<GroupFields>${item}</GroupFields>` + body.slice(at(header.closedList.end))
        : body.slice(0, at(header.openEnd)) + `<GroupFields>${item}</GroupFields>` + body.slice(at(header.openEnd));
  }
  // The header's own bindings of the old field follow it, so its heading shows what it groups by.
  if (old) {
    const escaped = escapeXmlAttribute(old).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`\\[${escaped}\\]`, 'g'), () => `[${escapeXmlAttribute(wanted)}]`);
  }
  return {
    xml: xml.slice(0, header.openStart) + body + xml.slice(header.end),
    applied: true,
    reason: old ? `grouped ${band} by ${wanted} instead of ${old}` : `grouped ${band} by ${wanted}`,
  };
}
