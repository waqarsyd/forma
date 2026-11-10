/**
 * A plan before a heavy job, in a reply (2026-11-10, the AI accuracy
 * programme, batch AG item 22, lib/jobPlan.ts): each file ticked or left out,
 * one report from all of them or a report for each, the steps that would
 * run, and Start. Nothing is read or sent until it is pressed, or a yes is
 * typed. Answered, it says what was started.
 */
import { useState } from 'react';
import { keptFiles, planOutcome, planSteps, toggleFile, type JobPlan, type PlanMode } from '../lib/jobPlan';
import './overlays.css';

export interface PlanCardProps {
  id: string;
  plan: JobPlan & { answered?: 'yes' | 'no' };
  /** The AI that would design, by name, for the steps. */
  ai: string;
  disabled: boolean;
  onPlan: (id: string, plan: JobPlan, start: boolean) => void;
}

export default function PlanCard({ id, plan, ai, disabled, onPlan }: PlanCardProps) {
  const [draft, setDraft] = useState<JobPlan>({ files: plan.files, mode: plan.mode, skip: plan.skip });
  if (plan.answered) return <span className="wb-note-done">{planOutcome(plan, plan.answered === 'yes')}</span>;
  const kept = keptFiles(draft);
  const setMode = (mode: PlanMode) => setDraft((d) => ({ ...d, mode }));
  return (
    <div className="wb-plan" role="group" aria-label="The plan">
      <ul className="wb-plan-files">
        {draft.files.map((f) => (
          <li key={f.uploadId}>
            <label>
              <input type="checkbox" checked={!draft.skip.includes(f.uploadId)} onChange={() => setDraft((d) => toggleFile(d, f.uploadId))} disabled={disabled} />
              <span>{f.file}</span>
              {f.pages > 1 && <span className="wb-plan-pages">{f.pages} pages</span>}
            </label>
          </li>
        ))}
      </ul>
      {draft.files.length > 1 && (
        <div className="wb-plan-mode" role="radiogroup" aria-label="What to make">
          <label>
            <input type="radio" name={`plan-${id}`} checked={draft.mode === 'one'} onChange={() => setMode('one')} disabled={disabled} />
            One report from all of them
          </label>
          <label>
            <input type="radio" name={`plan-${id}`} checked={draft.mode === 'each'} onChange={() => setMode('each')} disabled={disabled} />
            A report for each file, in Batch
          </label>
        </div>
      )}
      <ol className="wb-plan-steps">
        {planSteps(draft, ai).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="wb-note-actions">
        <button type="button" className="wb-pill wb-pill--accent" disabled={disabled || !kept.length} onClick={() => onPlan(id, draft, true)}>
          Start
        </button>
        <button type="button" className="wb-pill wb-pill--outline" disabled={disabled} onClick={() => onPlan(id, draft, false)}>
          Not now
        </button>
      </div>
    </div>
  );
}
