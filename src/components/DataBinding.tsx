/**
 * Binding the report to real field names.
 *
 * ## What this replaces
 *
 * `repxBindings.ts` can derive a field name from a column heading -- "Item
 * Description" becomes `[ItemDescription]` -- and a `VITE_FORMA_BIND` flag ran
 * that over every generation between 2026-09-04 and 2026-09-05. It was a good
 * guess, and a guess is what it was: the report telling us what it thinks the
 * data is called. Bound against a source whose column is really `DESCR`, the
 * file fails at run time in the one place nobody looks, and the derived name is
 * confident enough that nobody checks it. The flag is gone; this screen is what
 * replaced it, and binding now happens here or not at all.
 *
 * Here the user pastes what they actually have -- a JSON row, a CSV export, a
 * CREATE TABLE, or just a list of column names -- and `dataSource.ts` reads the
 * fields out of it. The mapping is suggested and then editable, because a
 * suggestion is a starting point and never an answer.
 *
 * ## Why the decline is the most useful thing on the screen
 *
 * `planDetailBinding` refuses to bind unless it can prove the correspondence
 * between the heading row and the detail row -- same table, same column count,
 * nothing already bound. When it declines it says why, and that sentence is
 * usually a real finding about the report: "the two tables disagree about how
 * many columns there are" means a merged heading cell, which is a fidelity
 * problem worth knowing about whether or not anyone wanted bindings. So the
 * decline is rendered as the content of the pane rather than as an error state.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseDataSource, suggestMapping, type DataField } from '../lib/dataSource';
import { planDetailBinding, bindDetailRow, bindFooterTotals, readBoundFields } from '../lib/repxBindingPlan';

interface Props {
  repxContent?: string;
  /** Called with the rewritten REPX when the user applies a mapping. */
  onApply: (xml: string, summary: string) => void;
}

const SAMPLE_PLACEHOLDER = `Paste one of:

[{"ItemCode": "W-100", "Description": "Widget", "Qty": 4, "UnitPrice": 12.50}]

ItemCode,Description,Qty,UnitPrice
W-100,Widget,4,12.50

CREATE TABLE InvoiceLine (ItemCode NVARCHAR(20), Qty INT)

ItemCode, Description, Qty, UnitPrice`;

const KIND_LABEL: Record<string, string> = {
  json: 'JSON',
  csv: 'CSV',
  sql: 'CREATE TABLE',
  list: 'field list',
  none: '',
};

export default function DataBinding({ repxContent, onApply }: Props) {
  const [pasted, setPasted] = useState('');
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [applied, setApplied] = useState<string | null>(null);

  const source = useMemo(() => parseDataSource(pasted), [pasted]);
  const { plan, reason } = useMemo(() => planDetailBinding(repxContent), [repxContent]);
  const alreadyBound = useMemo(() => readBoundFields(repxContent), [repxContent]);

  const headings = plan?.headings ?? [];

  // Re-suggest whenever either side changes. The user's edits are deliberately
  // discarded here: the columns or the fields they were made against are gone.
  useEffect(() => {
    setMapping(suggestMapping(headings, source.fields));
    setApplied(null);
  }, [headings.join('\u0000'), source.fields.map((f) => f.name).join('\u0000')]);

  const mapped = mapping.filter(Boolean).length;

  const apply = () => {
    const result = bindDetailRow(repxContent, mapping);
    if (!result.applied) {
      setApplied(result.reason);
      return;
    }

    /*
     * Totals second, with THE SAME mapping.
     *
     * This used to run only behind `VITE_FORMA_BIND`, where both passes derived
     * their own names from the headings and therefore happened to agree. Given
     * a real schema they would not: a detail row bound to `NET_AMOUNT` under a
     * footer that derived `Amount` emits `sumSum([Amount])`, a field the source
     * does not have, and the report opens with a total that prints nothing.
     *
     * It declines far more often than it applies — it wants a ReportFooter
     * table whose cells line up with the detail row and hold figures — and that
     * is intended, so a decline is reported rather than treated as a failure.
     */
    const totals = bindFooterTotals(result.xml, mapping);
    const xml = totals.applied ? totals.xml : result.xml;
    const summary = totals.applied ? `${result.reason}; ${totals.reason}` : result.reason;

    onApply(xml, summary);
    setApplied(totals.applied ? summary : `${result.reason}. Totals: ${totals.reason}.`);
  };

  const fieldOptions = (current: string | null): DataField[] => {
    const taken = new Set(mapping.filter((m): m is string => !!m && m !== current));
    return source.fields.filter((f) => !taken.has(f.name));
  };

  return (
    <div className="db-root">
      <style>{`
        .db-root { display: flex; flex-direction: column; gap: 20px; max-width: 900px; }
        .db-h {
          font-family: var(--font-code, monospace); font-size: 11px; letter-spacing: .12em;
          text-transform: uppercase; opacity: .6; margin: 0 0 8px;
        }
        .db-paste {
          width: 100%; min-height: 150px; resize: vertical;
          font-family: var(--font-code, monospace); font-size: 12px; line-height: 1.55;
          padding: 12px 14px; border-radius: 8px;
          border: 1px solid var(--paper-rule, #d7dee7);
          background: var(--surface-container-lowest, #fff); color: inherit;
        }
        .db-paste:focus-visible { outline: 2px solid var(--accent, #e8590c); outline-offset: 1px; }
        .db-note { font-size: 12.5px; line-height: 1.5; opacity: .75; margin: 8px 0 0; }
        .db-warn { border-left: 3px solid var(--warn, #b45309); padding: 10px 14px; font-size: 13px; line-height: 1.55; }
        .db-ok { border-left: 3px solid var(--ok-ink, #1f6f49); padding: 10px 14px; font-size: 13px; }
        .db-fields { display: flex; flex-wrap: wrap; gap: 6px; }
        .db-chip {
          font-family: var(--font-code, monospace); font-size: 11px;
          padding: 3px 8px; border-radius: 3px;
          border: 1px solid var(--paper-rule, #d7dee7);
        }
        .db-chip small { opacity: .55; margin-left: 6px; }
        .db-map { width: 100%; border-collapse: collapse; font-size: 13px; }
        .db-map th {
          text-align: left; font-family: var(--font-code, monospace); font-size: 10px;
          letter-spacing: .1em; text-transform: uppercase; opacity: .6;
          padding-bottom: 8px; border-bottom: 1px solid var(--paper-rule, #d7dee7);
        }
        .db-map td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--paper-rule-soft, #eceff3); vertical-align: middle; }
        .db-map select {
          width: 100%; max-width: 280px; padding: 6px 8px; border-radius: 6px;
          border: 1px solid var(--paper-rule, #d7dee7);
          background: var(--surface-container-lowest, #fff); color: inherit;
          font-family: var(--font-code, monospace); font-size: 12px;
        }
        .db-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .db-count { font-family: var(--font-code, monospace); font-size: 11px; letter-spacing: .06em; opacity: .7; }
      `}</style>

      {/*
        Three states, and the order matters.

        A bound report is checked FIRST because `planDetailBinding` declines once
        any detail cell carries a binding -- correctly, so the pass cannot
        discard someone's work. Reading that decline as "cannot be bound" put
        "This report cannot be bound yet" on screen immediately after a
        successful bind, contradicting the "2 bound" in the status bar and the
        confirmation in the review column. Same fact, opposite meaning, and the
        difference is entirely whether bindings already exist.
      */}
      {alreadyBound.length > 0 ? (
        <div className="db-ok" role="status">
          <strong>Bound to {alreadyBound.length} field{alreadyBound.length === 1 ? '' : 's'}.</strong>
          <p className="db-note" style={{ opacity: 1, marginTop: 6 }}>
            <code>{alreadyBound.join(', ')}</code>
          </p>
          <p className="db-note">
            {/* `{' '}` because JSX drops whitespace that spans a line break
                between an element and the text after it — without it this
                renders as "ExpressionBindingselement". */}
            Every mapped cell in the Detail band now carries an <code>ExpressionBindings</code>{' '}
            element, so the exported <code>.repx</code> takes its values from the data source at
            print time and keeps the text it shows today as a fallback.
          </p>
          <p className="db-note">
            Re-binding is declined rather than repeated: a second pass cannot tell its own work
            from an edit somebody made in the designer. To change the mapping, generate the report
            again and bind the fresh copy.
          </p>
        </div>
      ) : !plan ? (
        <div className="db-warn" role="status">
          <strong>This report cannot be bound yet.</strong>
          <p className="db-note" style={{ opacity: 1, marginTop: 6 }}>{reason}</p>
          <p className="db-note">
            Binding needs a heading row in the PageHeader band and a single data row in Detail,
            with the same number of columns in both. That correspondence is what names the fields,
            and it is not something to guess at — a wrong field name is a file that opens cleanly
            and fails when it runs.
          </p>
        </div>
      ) : (
        <>
          <section>
            <h3 className="db-h">1 · Your data</h3>
            <textarea
              className="db-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={SAMPLE_PLACEHOLDER}
              spellCheck={false}
              aria-label="Paste a data sample or schema"
            />
            <p className="db-note">
              Read in the browser, never sent anywhere. Forma connects to no database — a sample
              gives the field names, the types and a real value to format against, which is
              everything binding needs.
            </p>
            {source.problems.map((p, i) => (
              <p className="db-note" key={i} style={{ color: 'var(--warn, #b45309)' }}>{p}</p>
            ))}
            {source.fields.length > 0 && (
              <>
                <p className="db-note">
                  Read {source.fields.length} field{source.fields.length === 1 ? '' : 's'} from{' '}
                  {KIND_LABEL[source.kind]}
                  {source.rowCount > 0 && `, ${source.rowCount} row${source.rowCount === 1 ? '' : 's'}`}:
                </p>
                <div className="db-fields" style={{ marginTop: 8 }}>
                  {source.fields.map((f) => (
                    <span className="db-chip" key={f.name}>
                      {f.name}<small>{f.type}</small>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section>
            <h3 className="db-h">2 · Map the columns</h3>
            <table className="db-map">
              <thead>
                <tr>
                  <th scope="col">Report column</th>
                  <th scope="col">Sample in the report</th>
                  <th scope="col">Data field</th>
                </tr>
              </thead>
              <tbody>
                {headings.map((heading, i) => (
                  <tr key={i}>
                    <td>{heading || <em style={{ opacity: .6 }}>column {i + 1}</em>}</td>
                    <td style={{ opacity: .65, fontFamily: 'var(--font-code, monospace)', fontSize: 12 }}>
                      {plan.cells[i]?.text || '—'}
                    </td>
                    <td>
                      <select
                        value={mapping[i] ?? ''}
                        aria-label={`Data field for ${heading || `column ${i + 1}`}`}
                        onChange={(e) => {
                          const next = [...mapping];
                          next[i] = e.target.value || null;
                          setMapping(next);
                          setApplied(null);
                        }}
                        disabled={!source.fields.length}
                      >
                        <option value="">— not bound —</option>
                        {fieldOptions(mapping[i] ?? null).map((f) => (
                          <option key={f.name} value={f.name}>{f.name}</option>
                        ))}
                        {/* Keep the current choice selectable even after the
                            source changed underneath it, so the select never
                            silently shows a value it has no option for. */}
                        {mapping[i] && !source.fields.some((f) => f.name === mapping[i]) && (
                          <option value={mapping[i]!}>{mapping[i]}</option>
                        )}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!source.fields.length && (
              <p className="db-note">Paste a sample above and the columns become mappable.</p>
            )}
          </section>

          <section>
            <h3 className="db-h">3 · Write the bindings</h3>
            <div className="db-actions">
              {/* --accent, not a --solid of my invention: the modifiers are
                  --accent, --outline and --round, and an unknown one leaves the
                  primary action of the screen looking like plain text. */}
              <button
                className="wb-pill wb-pill--accent"
                onClick={apply}
                disabled={mapped === 0}
              >
                Apply to the .repx
              </button>
              <span className="db-count">
                {mapped} of {headings.length} column{headings.length === 1 ? '' : 's'} mapped
              </span>
            </div>
            {applied && <p className="db-note" style={{ marginTop: 10 }}>{applied}</p>}
            <p className="db-note">
              Writes an <code>ExpressionBindings</code> element onto each mapped cell, and a
              <code> TextFormatString</code> where the column is plainly money or a date. The
              cell keeps its <code>Text</code> as a fallback. Unmapped columns are left exactly
              as they are. Where the report has a footer row lining up with the detail row, the
              money columns are totalled with <code>sumSum()</code> over the same fields.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
