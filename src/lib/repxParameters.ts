/**
 * Report parameters, and the indirection that makes a typed one actually work.
 *
 * ## The measurement this file exists for
 *
 * `RepxProbe emit-params` against the installed DevExpress 20.1 on 2026-09-05
 * settled how a parameter serializes, and the answer is not what anyone would
 * write from the class reference:
 *
 * ```xml
 * <Parameters>
 *   <Item1 Ref="2" Description="From date" ValueInfo="2026-01-01" Name="DateFrom" Type="#Ref-1" />
 *   <Item2 Ref="4" Description="Region" ValueInfo="North" Name="Region" />
 * </Parameters>
 * …
 * <ObjectStorage>
 *   <Item1 ObjectType="DevExpress.XtraReports.Serialization.ObjectStorageInfo, DevExpress.XtraReports.v20.1"
 *          Ref="1" Content="System.DateTime" Type="System.Type" />
 * </ObjectStorage>
 * ```
 *
 * Four things follow:
 *
 * - The default value is **`ValueInfo`**, not `Value`.
 * - A **string** parameter carries **no `Type` at all** — string is the default
 *   and the serializer omits it.
 * - Any other type is a **`#Ref-N` pointer into an `<ObjectStorage>` block at
 *   the end of the document**, whose `ObjectType` is assembly-qualified and
 *   therefore version-specific.
 * - **Writing the type inline is accepted and silently ignored.** Measured: a
 *   file declaring `Type="System.DateTime"` loads a parameter of type
 *   `System.String` holding the text "2026-01-01", with no error and no
 *   warning. A date filter then compares strings. This is the exact failure
 *   the "measure, do not infer" rule exists to prevent, and it is why this
 *   module is a repair pass rather than a prompt instruction.
 *
 * ## So the model writes the readable form and code fixes it
 *
 * Asking the model for `<ObjectStorage>` would mean asking it to allocate
 * unique `Ref` values across a section it never sees the rest of — and `Ref`
 * collisions are already the defect `repxRefs.ts` exists to repair. Instead the
 * prompt asks for the obvious `Type="System.DateTime"`, and `liftParameterTypes`
 * turns that into the form DevExpress actually reads. Same shape as
 * `repxMargins.ts`: arithmetic applied to the model's output rather than a
 * request for the model to do it.
 */

/** The four types a generated report has any business declaring. */
const KNOWN_TYPES = [
  'System.String',
  'System.DateTime',
  'System.Int32',
  'System.Decimal',
  'System.Double',
  'System.Boolean',
  'System.Guid',
] as const;

export interface ReportParameter {
  name: string;
  /** As written in the file. `System.String` when absent, which is the default. */
  type: string;
  description: string;
  multiValue: boolean;
  visible: boolean;
  /** The `ValueInfo` attribute, verbatim. Empty when absent. */
  value: string;
  /** True when `Type` is already a `#Ref-N` pointer, i.e. already lifted. */
  lifted: boolean;
}

const attrOf = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

/** The `<Parameters>…</Parameters>` block, or null. Not nested, so a plain match. */
function parametersBlock(xml: string): { text: string; start: number; end: number } | null {
  const match = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(xml);
  if (!match) return null;
  return { text: match[1], start: match.index, end: match.index + match[0].length };
}

const ITEM = /<(Item\d+)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*\/?>/g;

export function parseParameters(xml: string | undefined | null): ReportParameter[] {
  const block = parametersBlock(xml ?? '');
  if (!block) return [];
  const out: ReportParameter[] = [];
  ITEM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM.exec(block.text)) !== null) {
    const attrs = m[2];
    const name = attrOf(attrs, 'Name');
    if (!name) continue;
    const type = attrOf(attrs, 'Type');
    out.push({
      name,
      type: type ?? 'System.String',
      description: attrOf(attrs, 'Description') ?? '',
      multiValue: attrOf(attrs, 'MultiValue') === 'true',
      visible: attrOf(attrs, 'Visible') !== 'false',
      value: attrOf(attrs, 'ValueInfo') ?? '',
      lifted: (type ?? '').startsWith('#Ref-'),
    });
  }
  return out;
}

/**
 * Every parameter name the report refers to, from both places it can.
 *
 * `?Name` is the filter-string form and `[Parameters.Name]` the expression
 * form; a report normally uses both, for the same parameter, and a name that
 * appears in either without being declared is a report that fails at run time.
 */
export function parameterReferences(xml: string | undefined | null): string[] {
  // Processing instructions and comments go first, and the declaration is the
  // reason: `<?xml version="1.0"?>` matches the `?Name` form exactly, so every
  // document in existence appeared to reference a parameter called `xml`.
  const text = (xml ?? '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const names = new Set<string>();
  // Filter strings are attribute values, so the `?` form is searched across the
  // whole document rather than only in FilterString -- a sub-band or a data
  // adapter can carry one too.
  for (const m of text.matchAll(/\?([A-Za-z_]\w*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\[Parameters\.([A-Za-z_]\w*)\]/g)) names.add(m[1]);
  return [...names];
}

export interface ParameterLift {
  xml: string;
  applied: boolean;
  reason: string;
  /** Names whose type was moved into ObjectStorage. */
  lifted: string[];
}

/** `20.1` from `20.1`, `24.1` from `24.1` — the assembly suffix DevExpress uses. */
const assemblySuffix = (version: string): string => `v${(version || '20.1').trim()}`;

/**
 * Rewrite inline parameter types into the `#Ref-N` + `<ObjectStorage>` form.
 *
 * Declines rather than guessing when the document has no parameters, when none
 * carries a liftable type, or when a type is not one this module recognises —
 * inventing an `ObjectStorage` entry for a type DevExpress cannot resolve turns
 * a wrong-type parameter into a file that may not load at all, which is worse.
 *
 * `System.String` is REMOVED rather than lifted, because that is what the
 * serializer itself does: string is the default and carries no `Type`.
 *
 * New `Ref` values start above every `Ref` already in the document. Sequence
 * does not matter to DevExpress -- proven on 2026-09-05 with an ObjectStorage
 * using 100 and 101 in a file whose other Refs ran 0..13 -- but uniqueness
 * does, so they are allocated from the top rather than renumbering anything.
 */
export function liftParameterTypes(
  xml: string | undefined | null,
  version = '20.1',
): ParameterLift {
  const text = xml ?? '';
  const block = parametersBlock(text);
  if (!block) return { xml: text, applied: false, reason: 'no <Parameters> in this report', lifted: [] };

  const params = parseParameters(text);
  const needsLift = params.filter((p) => !p.lifted && p.type !== 'System.String');
  const hasStringType = /\sType\s*=\s*"System\.String"/.test(block.text);
  if (!needsLift.length && !hasStringType) {
    return { xml: text, applied: false, reason: 'every parameter type is already in the form DevExpress reads', lifted: [] };
  }

  const unknown = needsLift.filter((p) => !(KNOWN_TYPES as readonly string[]).includes(p.type));
  if (unknown.length) {
    return {
      xml: text,
      applied: false,
      reason: `declined: unrecognised parameter type(s) ${unknown.map((p) => `${p.name}:${p.type}`).join(', ')}`,
      lifted: [],
    };
  }

  // One ObjectStorage entry per distinct type, not per parameter -- two date
  // parameters share one, which is what the serializer produces.
  const distinct = [...new Set(needsLift.map((p) => p.type))];
  let nextRef = Math.max(
    0,
    ...[...text.matchAll(/\sRef\s*=\s*"(\d+)"/g)].map((m) => Number(m[1])),
  ) + 1;
  const refFor = new Map<string, number>();
  for (const type of distinct) refFor.set(type, nextRef++);

  let inner = block.text;
  // String first, so removing it cannot disturb the offsets of the rewrites.
  inner = inner.replace(/\s+Type\s*=\s*"System\.String"/g, '');
  for (const [type, ref] of refFor) {
    inner = inner.replace(
      new RegExp(`(\\sType\\s*=\\s*")${type.replace(/\./g, '\\.')}(")`, 'g'),
      `$1#Ref-${ref}$2`,
    );
  }

  let out = text.slice(0, block.start) + `<Parameters>${inner}</Parameters>` + text.slice(block.end);

  // Only when there is a type to store. Stripping a redundant System.String is
  // a complete edit on its own, and emitting an empty <ObjectStorage> for it
  // would add a section the serializer never writes for a report with only
  // string parameters.
  if (distinct.length) {
    const objectType = `DevExpress.XtraReports.Serialization.ObjectStorageInfo, DevExpress.XtraReports.${assemblySuffix(version)}`;
    const items = distinct
      .map((type, i) => `    <Item${i + 1} ObjectType="${objectType}" Ref="${refFor.get(type)}" Content="${type}" Type="System.Type" />`)
      .join('\n');

    // Merge into an existing ObjectStorage rather than emitting a second one --
    // two blocks is not a shape the serializer ever writes.
    const existing = /<ObjectStorage>([\s\S]*?)<\/ObjectStorage>/.exec(out);
    if (existing) {
      const merged = existing[1].trimEnd() + '\n' + items + '\n  ';
      out = out.slice(0, existing.index) + `<ObjectStorage>${merged}</ObjectStorage>` + out.slice(existing.index + existing[0].length);
    } else {
      const close = out.lastIndexOf('</XtraReportsLayoutSerializer>');
      if (close === -1) {
        return { xml: text, applied: false, reason: 'declined: no closing root element to insert ObjectStorage before', lifted: [] };
      }
      out = out.slice(0, close) + `  <ObjectStorage>\n${items}\n  </ObjectStorage>\n` + out.slice(close);
    }
  }

  return {
    xml: out,
    applied: true,
    reason: needsLift.length
      ? `lifted ${needsLift.length} parameter type(s) into ObjectStorage: ${needsLift.map((p) => `${p.name}:${p.type}`).join(', ')}`
      : 'removed the redundant System.String type(s)',
    lifted: needsLift.map((p) => p.name),
  };
}
