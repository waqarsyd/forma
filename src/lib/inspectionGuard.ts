/**
 * What may be handed to DevExpress on the person's own PC without a click
 * (2026-11-11, the re-audit's R5-03). Since CC-10, once Forma Designer has
 * answered in a page, every report Forma makes there is posted to its
 * /inspect, and to /render when the page has records, where DevExpress 20.1
 * loads it and prints it. The report is the AI's answer, shaped by a picture
 * or a PDF someone else may have made, so two things in it matter on that PC:
 *
 * - **Types named in the file.** DevExpress's serializer makes an object of
 *   each type a `ControlType`, an `ObjectType` or a parameter's `Type` names,
 *   and a data source in `ComponentStorage` carries more types inside its
 *   Base64. A report needs DevExpress's own report types, the plain .NET
 *   value types and the SQL data source Forma writes; anything else is
 *   refused.
 * - **Files outside the report.** A picture's `ImageUrl`, a `StyleSheetPath`,
 *   an `XmlDataPath` or a subreport's `ReportSourceUrl` naming another
 *   computer (`\\server\share`, `//server`, `file:`) or a path on this one is
 *   opened when the report prints, and asking another computer for a file
 *   sends it the Windows sign-in to answer.
 *
 * Read here, before anything is posted, so an older Forma Designer without
 * the same check (tools/RepxDesigner/Probe.cs, `ReportGuard`) is never sent
 * such a report either; Probe.cs refuses the same things itself. Pure and
 * small, so designerBridge.ts can ask without loading the REPX audit, which
 * names the outside files as a finding (`reference-outside-report`).
 */
import { unescapeXml } from './xmlEscape';

/** The .NET value types a parameter or a query parameter is written as. */
const VALUE_TYPES = new Set(
  ['String', 'Boolean', 'Byte', 'SByte', 'Char', 'Int16', 'Int32', 'Int64', 'UInt16', 'UInt32', 'UInt64', 'Single', 'Double', 'Decimal', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'Guid', 'DBNull'].map((t) => `System.${t}`),
);

/** The attributes that name a file the report reads when it prints. */
export const PATH_ATTRIBUTES = ['ImageUrl', 'StyleSheetPath', 'XmlDataPath', 'ReportSourceUrl'] as const;

/** A type name without its assembly: "DevExpress.X.Y, DevExpress.Z" is "DevExpress.X.Y". */
const typeOf = (written: string) => written.split(',')[0].trim();

/** A name with no namespace, which .NET resolves to no type of its own choosing: "XRLabel", "String". */
const bare = (name: string) => /^[A-Za-z_]\w*$/.test(name);

/** Whether a `Type` or `Content` names a type a report may: a reference, a bare name, a value type, or DevExpress's expression. */
const valueType = (name: string) => name.startsWith('#Ref-') || bare(name) || VALUE_TYPES.has(name) || name === 'DevExpress.DataAccess.Expression';

/**
 * Whether a file named in a report is outside it and somewhere a print would
 * reach for it: another computer (`\\server`, `//server`), a `file:` address
 * or a drive (`C:\`). A web address, or a picture written into the report
 * (`data:`), is not.
 */
export function reachesOutside(value: string): boolean {
  const v = value.trim();
  return /^[\\/]{2}/.test(v) || /^file:/i.test(v) || /^[a-z]:[\\/]/i.test(v);
}

/**
 * Each start tag's name and attributes, values decoded, in file order. A
 * name is anything up to a space, `=`, a quote or a bracket: XML allows
 * letters past ASCII in one, and a tag with such an attribute (`Ñame="x"`)
 * was skipped whole, its `ControlType` and `ImageUrl` never asked about
 * (2026-11-12, the review of R5-03).
 */
function* tags(xml: string): Generator<{ name: string; attrs: Map<string, string> }> {
  for (const tag of xml.matchAll(/<([^\s<>/!?="']+)((?:\s+[^\s=<>"'/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g)) {
    const attrs = new Map<string, string>();
    for (const a of tag[2].matchAll(/([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.set(a[1], unescapeXml(a[2] ?? a[3] ?? ''));
    yield { name: tag[1], attrs };
  }
}

/** The text of a data source's Base64, or null when it is not Base64 text. */
function fromBase64(value: string): string | null {
  try {
    return typeof atob === 'function' ? atob(value.replace(/\s+/g, '')) : null;
  } catch {
    return null;
  }
}

/**
 * Why a report must not be handed to DevExpress on this PC, in a sentence
 * for the console, or null when it may be. `nested` is a data source's own
 * XML, read from its Base64, where only types and files are asked about.
 */
export function inspectionRefusal(xml: string, nested = false): string | null {
  for (const { name, attrs } of tags(xml)) {
    const control = attrs.get('ControlType');
    if (control !== undefined && !nested && !bare(typeOf(control)) && !typeOf(control).startsWith('DevExpress.XtraReports.')) {
      return `it names the type "${typeOf(control)}"`;
    }
    const object = attrs.get('ObjectType');
    if (object !== undefined) {
      const type = typeOf(object);
      if (!type.startsWith('DevExpress.XtraReports.') && type !== 'DevExpress.DataAccess.Sql.SqlDataSource') return `it holds a "${type}"`;
      const base64 = attrs.get('Base64');
      if (type === 'DevExpress.DataAccess.Sql.SqlDataSource' && base64) {
        const inner = fromBase64(base64);
        if (inner === null) return 'its data source cannot be read';
        const why = inspectionRefusal(inner, true);
        if (why) return `its data source: ${why}`;
      }
    }
    const type = attrs.get('Type');
    if (type !== undefined) {
      if (typeOf(type) === 'System.Type') {
        const content = typeOf(attrs.get('Content') ?? '');
        if (!valueType(content)) return `it names the type "${content}"`;
      } else if (!valueType(typeOf(type))) return `it names the type "${typeOf(type)}"`;
    }
    for (const path of PATH_ATTRIBUTES) {
      const value = attrs.get(path);
      if (value !== undefined && reachesOutside(value)) return `${name} reads "${value}" from outside the report`;
    }
  }
  return null;
}

/** Each control that reads a file from outside the report: its name, and the file. */
export function outsideReferences(xml: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const { attrs } of tags(xml)) {
    for (const path of PATH_ATTRIBUTES) {
      const value = attrs.get(path);
      if (value !== undefined && reachesOutside(value)) out.push({ name: attrs.get('Name') ?? 'the report', value });
    }
  }
  return out;
}
