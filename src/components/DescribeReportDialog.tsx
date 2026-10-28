/**
 * Prompt-to-Report: the wizard that collects a written description.
 *
 * Modelled on the *AI Prompt-to-Report* page of DevExpress's Report Wizard,
 * whose pages were read out of its Web Report Designer's own strings on
 * 2026-10-28 (docs/notes/gemini.md, *Prompt-to-Report*): a data source option,
 * a description with predefined prompts and the data source structure beside
 * it, and a Submit for the follow-up questions the model may ask. Forma has no
 * live connection, so "Add Data Source" is the Data tab's paste box: a JSON
 * row, a CSV export, a CREATE TABLE or a list of names, read by
 * `dataSource.ts` into the fields the model may bind to.
 *
 * The dialog has two phases and owns neither decision. In the `describe` phase
 * it collects a request and hands it up; in the `questions` phase it shows the
 * questions the clarification call returned and hands the answers up. What
 * happens between — the clarification call, the generation, the repair loop —
 * is `App.tsx`'s, so this component can be rendered and tested with no key.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconClose } from './landing/icons';
import { useFocusTrap } from './useFocusTrap';
import {
  PREDEFINED_PROMPTS,
  isDescribable,
  requestDataSource,
  type ClarificationAnswer,
  type ClarificationQuestion,
  type ReportDescriptionRequest,
} from '../lib/promptToReport';

export type DescribePhase =
  | { kind: 'describe' }
  | { kind: 'questions'; request: ReportDescriptionRequest; questions: ClarificationQuestion[] };

export interface DescribeReportDialogProps {
  phase: DescribePhase;
  /** The page size the report configuration is set to, shown so the user knows. */
  pageSize: string;
  onSubmit: (request: ReportDescriptionRequest) => void;
  onAnswer: (answers: ClarificationAnswer[]) => void;
  onClose: () => void;
}

const SCHEMA_PLACEHOLDER = `Optional. Paste what the report will run against, so the model binds to real field names:

CustomerId, Company, Contact, City, Country, Balance

or a JSON row, a CSV export, or a CREATE TABLE statement.`;

export default function DescribeReportDialog({ phase, pageSize, onSubmit, onAnswer, onClose }: DescribeReportDialogProps) {
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [dataSchema, setDataSchema] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  // Seed the answers with the model's suggestions, so Submit with nothing
  // typed accepts them -- the common case, and DevExpress's wizard works the
  // same way.
  useEffect(() => {
    if (phase.kind === 'questions') {
      setAnswers(Object.fromEntries(phase.questions.map((q) => [q.id, q.suggestion ?? ''])));
    }
  }, [phase]);

  const source = useMemo(() => requestDataSource({ description, dataSchema }), [dataSchema, description]);
  const request: ReportDescriptionRequest = {
    description,
    title: title.trim() || undefined,
    dataSchema: dataSchema.trim() || undefined,
  };
  const canSubmit = isDescribable(request);

  const pick = (id: string) => {
    const prompt = PREDEFINED_PROMPTS.find((p) => p.id === id);
    if (!prompt) return;
    setSelectedPrompt(id);
    setDescription(prompt.text);
    if (!title) setTitle(prompt.title);
  };

  const submitAnswers = () => {
    if (phase.kind !== 'questions') return;
    onAnswer(phase.questions.map((q) => ({ id: q.id, question: q.question, answer: (answers[q.id] ?? '').trim() })));
  };

  return (
    <div className="wb-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="wb-modal wb-reg-marks"
        role="dialog"
        aria-modal="true"
        aria-labelledby="describe-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="wb-modal-head">
          <h2 id="describe-title">{phase.kind === 'describe' ? 'Describe a report' : 'A few questions first'}</h2>
          <button className="wb-pill wb-pill--round" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>

        {phase.kind === 'describe' ? (
          <div className="wb-modal-body">
            <div className="wb-modal-col">
              <div className="wb-fset">
                <div className="wb-eyebrow"><b>x 001</b>Predefined prompts<span className="wb-fade" /></div>
                <div className="wb-chips" role="group" aria-label="Predefined prompts">
                  {PREDEFINED_PROMPTS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`wb-pill ${selectedPrompt === p.id ? 'wb-pill--accent' : 'wb-pill--outline'}`}
                      aria-pressed={selectedPrompt === p.id}
                      onClick={() => pick(p.id)}
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wb-fset">
                <div className="wb-eyebrow"><b>x 002</b>Enter report description<span className="wb-fade" /></div>
                <label className="wb-lbl" htmlFor="describe-text">Type in a detailed report description</label>
                <textarea
                  id="describe-text"
                  className="wb-ctl wb-area"
                  rows={7}
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); setSelectedPrompt(null); }}
                  placeholder="The columns, the grouping, the totals, the chart type. The more you say, the less the model assumes."
                />
                <label className="wb-lbl" htmlFor="describe-title-field">Title (optional)</label>
                <input
                  id="describe-title-field"
                  className="wb-ctl"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Read from the description when blank"
                />
              </div>
            </div>

            <div className="wb-modal-col">
              <div className="wb-fset">
                <div className="wb-eyebrow"><b>x 003</b>Data source structure<span className="wb-fade" /></div>
                <label className="wb-lbl" htmlFor="describe-schema">Add a data source (optional)</label>
                <textarea
                  id="describe-schema"
                  className="wb-ctl wb-area"
                  rows={7}
                  value={dataSchema}
                  onChange={(e) => setDataSchema(e.target.value)}
                  placeholder={SCHEMA_PLACEHOLDER}
                />
                <p className="wb-hint" aria-live="polite">
                  {source
                    ? `${source.fields.length} field(s) found: ${source.fields.map((f) => f.name).join(', ')}. The report will bind only to these.`
                    : 'No data source. The Detail band will carry one representative row with placeholder values.'}
                </p>
                <p className="wb-hint">Page size: {pageSize}, from Report configuration.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="wb-modal-body">
            <div className="wb-modal-col">
              <p className="wb-hint">The description leaves these open. Each has a suggested answer you can keep or change.</p>
              {phase.questions.map((q) => (
                <div className="wb-fset" key={q.id}>
                  <label className="wb-lbl" htmlFor={`describe-q-${q.id}`}>{q.question}</label>
                  <input
                    id={`describe-q-${q.id}`}
                    className="wb-ctl"
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    placeholder={q.suggestion ?? ''}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="wb-modal-foot">
          <button className="wb-pill" type="button" onClick={onClose}>Cancel</button>
          {phase.kind === 'describe' ? (
            <button
              className="wb-pill wb-pill--accent"
              type="button"
              disabled={!canSubmit}
              onClick={() => onSubmit(request)}
              title={canSubmit ? undefined : 'Describe the report in at least a sentence'}
            >
              Build the report
            </button>
          ) : (
            <button className="wb-pill wb-pill--accent" type="button" onClick={submitAnswers}>
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
