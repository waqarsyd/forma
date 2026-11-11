/**
 * A group on a field nothing has, made into the calculated field its header
 * already prints (2026-11-11, the full audit's CC-04).
 *
 * ## The defect
 *
 * Asked to group FastReport's product list by the first letter of each name,
 * the AI wrote `<GroupFields><Item1 FieldName="GroupLetter" /></GroupFields>`
 * and declared `GroupLetter` nowhere. DevExpress does not object: every record
 * has the same empty value for a field it cannot find, so it printed one
 * group of all twenty products. The header beside it printed the letter the
 * way the request asked, with an expression over a field the data does have.
 *
 * DevExpress's own way to group on something derived is a calculated field,
 * declared in `<CalculatedFields>` before the bands and grouped on by its
 * name (`RepxProbe emit-calc` and `emit-group`): what the reference report the
 * auditor wrote by hand did, and printed thirteen letter groups.
 *
 * ## What it does
 *
 * For each group field that is not a column of the data, a calculated field
 * or a parameter, and that nothing else in the report prints, it looks in
 * that group's own header for a `Text` binding that reads, parses and names
 * only fields the data has, and declares that expression as a calculated
 * field of the group field's name. The group then breaks where the header's
 * value changes, which is what the header was written to show.
 *
 * It declines rather than guesses: an expression the parser cannot read
 * (`[ProductName].Substring(0, 1)` is a .NET call DevExpress prints blank), a
 * total, a bare `[Field]` (which would group on that field, not derive one),
 * or a field the data is not known to have; and, with no schema to say the
 * group field is not a column, anything but one function over one field. The
 * declared field carries the report's `DataMember`, as the serializer writes
 * it. The audit's `field-unknown` names what is left.
 */
import { parseCriteria } from './criteria';
import { fieldsIn } from './expressions';
import { isAggregate } from './repxSummaries';
import { readRepxDataSources } from './repxSqlDataSource';
import { unescapeXml as decodeEntities } from './xmlEscape';
import { parseParameters } from './repxParameters';

export interface CalculatedFieldRepair {
  xml: string;
  applied: boolean;
  reason: string;
  /** The calculated fields declared, by name. */
  declared: string[];
}

/** A band's opening tag and its content, up to the next band or the end of the bands. */
const BAND = /<Item\d+\b[^>]*\sControlType="(\w+Band)"[^>]*>([\s\S]*?)(?=<Item\d+\b[^>]*\sControlType="\w+Band"|<\/Bands>)/g;

/** Every `Text` binding's expression in a piece of a report, decoded, with its raw attribute value. */
function textBindings(xml: string): { expression: string; raw: string }[] {
  return [...xml.matchAll(/<Item\d+\b(?=[^>]*\sPropertyName="Text")[^>]*\sExpression="([^"]*)"/g)].map((m) => ({ raw: m[1], expression: decodeEntities(m[1]).trim() }));
}

/** Whether an expression reads: the Preview's own parser, for syntax. */
function reads(expression: string): boolean {
  try {
    parseCriteria(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Declare an unknown group field as the calculated field its header prints.
 * `fields` are the data's columns when the caller knows them (the Data tab's
 * schema); without them, the fields the report prints elsewhere are the data's.
 */
export function repairCalculatedFields(xml: string | undefined | null, options: { fields?: readonly string[] } = {}): CalculatedFieldRepair {
  const text = xml ?? '';
  const none = (reason: string): CalculatedFieldRepair => ({ xml: text, applied: false, reason, declared: [] });
  if (!/<GroupFields>/.test(text)) return none('no group fields');

  const block = /<CalculatedFields>([\s\S]*?)<\/CalculatedFields>/.exec(text);
  const calculated = new Set([...(block?.[1] ?? '').matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  const parameters = new Set(parseParameters(text).map((p) => p.name));
  const schema = [...(options.fields ?? []), ...readRepxDataSources(text).flatMap((d) => d.views.flatMap((v) => v.fields.map((f) => f.name)))];

  const bands = [...text.matchAll(BAND)].map((m) => ({ kind: m[1], body: m[2] }));
  // What the report prints outside its group headers: the data's own fields when no schema is known.
  const printedElsewhere = new Set(bands.filter((b) => b.kind !== 'GroupHeaderBand').flatMap((b) => textBindings(b.body).flatMap((t) => fieldsIn(t.expression))));
  const known = new Set(schema.length ? schema : printedElsewhere);
  const isKnown = (field: string) => known.has(field) || known.has(field.split('.').pop()!) || calculated.has(field);
  const boundAnywhere = new Set(textBindings(text).flatMap((t) => fieldsIn(t.expression)));

  /*
   * Without a schema the group field may be a real column the report happens
   * to print nowhere, and a header such as `'Customer: ' + [CompanyName]` over
   * a group on `CustomerID` would declare a calculated field that shadows it.
   * So with no schema only a derivation is taken: one function call over one
   * field, with no caption in it, as `Upper(Substring([ProductName], 0, 1))`
   * is, which no column of the data would be named for (2026-11-11, the
   * review of CC-04).
   */
  const derivation = (expression: string, used: string[]) =>
    schema.length > 0 || (new Set(used).size === 1 && /^[A-Za-z_]\w*\s*\([\s\S]*\)$/.test(expression) && !/'/.test(expression));

  const additions: { name: string; raw: string }[] = [];
  for (const band of bands) {
    if (band.kind !== 'GroupHeaderBand') continue;
    const groupFields = [...(/<GroupFields>([\s\S]*?)<\/GroupFields>/.exec(band.body)?.[1] ?? '').matchAll(/\sFieldName="([^"]*)"/g)].map((m) => decodeEntities(m[1]).trim());
    for (const field of groupFields) {
      if (!/^[A-Za-z_]\w*$/.test(field) || isKnown(field) || parameters.has(field) || boundAnywhere.has(field) || additions.some((a) => a.name === field)) continue;
      const derived = textBindings(band.body).find(({ expression }) => {
        const used = fieldsIn(expression);
        return (
          used.length > 0 &&
          !/^\[[^\]]+\]$/.test(expression) &&
          !isAggregate(expression) &&
          used.every(isKnown) &&
          derivation(expression, used) &&
          reads(expression)
        );
      });
      if (derived) additions.push({ name: field, raw: derived.raw });
    }
  }
  if (!additions.length) return none('no unknown group field has a readable expression in its header');

  /*
   * In the report's own data member. DevExpress lists a calculated field under
   * the member it names, and the serializer writes one on a report bound to a
   * query as `DataMember="Orders"` (gemini.md, *The SQL data source,
   * measured*, the emit-calc measurement); with none it sits at the source's
   * root, where `[GroupLetter]` does not resolve inside the member, so the
   * group would still be one while the audit stopped naming it. `DataSource`
   * is not written: the serializer leaves it out when it is the report's own,
   * which the root's always is (2026-11-11, the review of CC-04).
   */
  const rootTag = /<XtraReportsLayoutSerializer\b[^>]*>/.exec(text)?.[0] ?? '';
  const member = /\sDataMember="([^"]*)"/.exec(rootTag)?.[1];
  const inMember = member ? ` DataMember="${member}"` : '';
  let ref = Math.max(0, ...[...text.matchAll(/\sRef="(\d+)"/g)].map((m) => Number(m[1])));
  const existing = (block?.[1].match(/<Item\d+\b/g) ?? []).length;
  const items = additions.map((a, i) => `<Item${existing + i + 1} Ref="${++ref}" Name="${a.name}" Expression="${a.raw}"${inMember} />`).join('');
  let out: string;
  if (block) {
    const end = block.index + block[0].length - '</CalculatedFields>'.length;
    out = text.slice(0, end) + items + text.slice(end);
  } else {
    // Before the bands, where the serializer writes it (emit-calc).
    const at = text.indexOf('<Bands');
    if (at < 0) return none('no bands');
    out = `${text.slice(0, at)}<CalculatedFields>${items}</CalculatedFields>${text.slice(at)}`;
  }
  const declared = additions.map((a) => a.name);
  return { xml: out, applied: true, reason: `declared ${declared.join(', ')} as the calculated field${declared.length === 1 ? '' : 's'} its group header prints`, declared };
}
