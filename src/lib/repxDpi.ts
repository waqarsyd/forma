/**
 * `Dpi` on every band and control of a report not in hundredths of an inch.
 *
 * ## The measurement
 *
 * DevExpress reads each band and control at its own `Dpi` attribute, and a
 * missing one is 100 -- hundredths of an inch -- whatever the report's
 * `ReportUnit` says. Printed through DevExpress 20.1 (case s24 of
 * `docs/proposals/devexpress-parity.md`, 2026-10-30), a label meant to sit one
 * inch down and two wide printed:
 *
 *     Dpi nowhere                2.54 inches down, 5.08 wide   (millimetres)
 *                                0.96 inches down, 1.92 wide   (pixels)
 *     Dpi on the root only       the same
 *     Dpi on bands and controls  one inch down, two wide
 *
 * and with no `Dpi` anywhere the margins were read the same way. Forma wrote
 * `Dpi` nowhere, so every report it generated in tenths of a millimetre printed
 * 2.54 times too large, and every pixel report 4% too small, while looking
 * right in its own panes, which read the numbers in the report's unit.
 *
 * ## Where the serializer writes it
 *
 * Read from a report holding every kind of band and control, saved by
 * DevExpress in both units. `Dpi` goes on the root report, on every band
 * (margins, headers, footers, Detail, sub-bands and detail reports) and on
 * every control, table rows and cells and cross-tab cells included. That was
 * 17 control kinds, every one consistent, so the rule is taken to hold for
 * every `XR` control type. It is never written on styles, formatting rules,
 * parameters, calculated fields, field items, definitions or the watermark.
 * An embedded subreport's report keeps its own unit: its elements carried no
 * `Dpi` when it was in hundredths.
 *
 * ## What is repaired
 *
 * Each such element without a `Dpi` gets its report's: 254 in tenths of a
 * millimetre, 96 in pixels. The numbers are left alone, since Forma already
 * writes them in the report's unit -- this only tells DevExpress so. An
 * element that has a `Dpi` keeps it, because its numbers are in that one.
 * `Padding` carries a dpi of its own as its fifth value and is not touched.
 * Hundredths of an inch needs nothing, 100 being the default.
 */

export interface DpiRepair {
  xml: string;
  applied: boolean;
  reason: string;
  /** How many elements were given a `Dpi`. */
  count: number;
}

/** Units per inch for the units that need a `Dpi`; DevExpress 20.1 has no others. */
const DPI_BY_UNIT: Record<string, number> = { TenthsOfAMillimeter: 254, Pixels: 96 };

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

const attrOf = (attrs: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;

/** Whether the serializer writes `Dpi` on an element of this `ControlType`. */
function takesDpi(controlType: string): boolean {
  const type = controlType.replace(/^DevExpress\.XtraReports\.UI\./, '').replace(/,.*$/, '');
  return type === 'XtraReport' || /Band$/.test(type) || /^XR/.test(type);
}

/** A band or control with no `Dpi` in a report whose unit needs one. */
interface Missing {
  /** Where the attribute goes: the end of the element's attributes. */
  at: number;
  dpi: number;
  /** The element's `Name`, or its `ControlType` when it has none. */
  name: string;
}

/** Every band and control that DevExpress will read at 100 though its report is not in hundredths. */
function findMissing(text: string): Missing[] {
  const missing: Missing[] = [];
  /** The units per inch of each report being read: the root, then any report embedded in it. */
  const reports: { depth: number; dpi: number | null }[] = [];
  let depth = 0;

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(text)) !== null) {
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      depth--;
      while (reports.length && reports[reports.length - 1].depth > depth) reports.pop();
      continue;
    }
    const type = attrOf(attrs, 'ControlType');
    if (type) {
      // A report's own unit decides for it and everything inside it: the root,
      // and an embedded subreport's report, which defaults to hundredths.
      if (/(^|\.)XtraReport\b/.test(type)) {
        const unit = attrOf(attrs, 'ReportUnit') ?? 'HundredthsOfAnInch';
        reports.push({ depth: depth + 1, dpi: DPI_BY_UNIT[unit] ?? null });
      }
      const dpi = reports[reports.length - 1]?.dpi ?? null;
      if (dpi !== null && takesDpi(type) && attrOf(attrs, 'Dpi') === null) {
        // At the end of the attributes, where the serializer writes it.
        missing.push({ at: m.index + 1 + name.length + attrs.length, dpi, name: attrOf(attrs, 'Name') ?? type.replace(/,.*$/, '') });
      }
    }
    if (!selfClosing) depth++;
    else while (reports.length && reports[reports.length - 1].depth > depth) reports.pop();
  }
  return missing;
}

export interface DpiProblem {
  /** How many bands and controls DevExpress will read at 100. */
  count: number;
  /** The first few of them, by name. */
  names: string[];
  /** How many times their intended size they print: 2.54 in tenths of a millimetre, 0.96 in pixels. */
  scale: number;
}

/**
 * The bands and controls a report gives no `Dpi` though its unit needs one,
 * or null when there are none. What a report Forma generated in tenths of a
 * millimetre or pixels before `repairDpi` existed looks like, and what an
 * uploaded file can still look like: right in Forma's panes, and printed at
 * `scale` times its size by DevExpress, as s24 measured.
 */
export function findDpiProblem(xml: string | undefined | null): DpiProblem | null {
  const missing = findMissing(xml ?? '');
  if (!missing.length) return null;
  return {
    count: missing.length,
    names: missing.slice(0, 3).map((m) => m.name),
    // A number meant at `dpi` per inch, read at 100.
    scale: Math.max(...missing.map((m) => m.dpi)) / 100,
  };
}

/** Give every band and control the `Dpi` of its report's unit, where it has none. */
export function repairDpi(xml: string | undefined | null): DpiRepair {
  const text = xml ?? '';
  const missing = findMissing(text);

  if (!missing.length) {
    const unit = attrOf(/<XtraReportsLayoutSerializer\b[^>]*>/.exec(text)?.[0] ?? '', 'ReportUnit') ?? 'HundredthsOfAnInch';
    return {
      xml: text,
      applied: false,
      reason: DPI_BY_UNIT[unit] ? 'every band and control already carries a Dpi' : `nothing to do in ${unit}`,
      count: 0,
    };
  }

  let out = text;
  for (let i = missing.length - 1; i >= 0; i--) out = out.slice(0, missing[i].at) + ` Dpi="${missing[i].dpi}"` + out.slice(missing[i].at);
  return {
    xml: out,
    applied: true,
    reason: `wrote Dpi on ${missing.length} band(s) and control(s), so DevExpress reads their numbers in the report's unit`,
    count: missing.length,
  };
}
