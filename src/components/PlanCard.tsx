/**
 * A plan before a heavy job, in a reply (2026-11-10, the AI accuracy
 * programme, batch AG item 22, lib/jobPlan.ts): each file, one report from
 * all of them or a report for each, and the steps. Since the full audit the
 * same day the job starts at once (the owner's rule: a request is carried
 * out, not answered with a Start button), so App posts it answered and the
 * card says what started.
 *
 * Words only since 2026-11-11 (the full audit's WS-38): a plan an older
 * thread left waiting drew boxes to tick, Start and Not now, the last proceed
 * buttons in the thread; it is drawn as what it would make, and a typed yes
 * still starts it. The step that said pages are read with OCR is left out:
 * how Forma reads a page is machinery, not part of the plan.
 */
import { keptFiles, planOutcome, planSteps, type JobPlan } from '../lib/jobPlan';
import './overlays.css';

export interface PlanCardProps {
  plan: JobPlan & { answered?: 'yes' | 'no' };
  /** The AI that would design, by name, for the steps. */
  ai: string;
}

export default function PlanCard({ plan, ai }: PlanCardProps) {
  if (plan.answered) return <span className="wb-note-done">{planOutcome(plan, plan.answered === 'yes')}</span>;
  const kept = new Set(keptFiles(plan).map((f) => f.uploadId));
  /*
   * Nor are the requests a step costs (the review, 2026-11-11: "1 request, 2
   * if the report leaves out text it should keep" is machinery too), nor
   * "Nothing is ticked", with no boxes left to tick.
   */
  const steps = planSteps(plan, ai)
    .filter((step) => !/\bOCR\b|\bticked\b/.test(step))
    .map((step) => step.replace(/:\s*\d+( to \d+)? requests?\b[^.]*\./, '.'));
  return (
    <div className="wb-plan" role="group" aria-label="The plan">
      <ul className="wb-plan-files">
        {plan.files.map((f) => (
          <li key={f.uploadId}>
            <span>{f.file}</span>
            {f.pages > 1 && <span className="wb-plan-pages">{f.pages} pages</span>}
            {!kept.has(f.uploadId) && <span className="wb-plan-pages">left out</span>}
          </li>
        ))}
      </ul>
      {plan.files.length > 1 && <p className="wb-plan-mode">{plan.mode === 'each' ? 'A report for each file, in Batch' : 'One report from all of them'}</p>}
      {steps.length > 0 && (
        <ol className="wb-plan-steps">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
