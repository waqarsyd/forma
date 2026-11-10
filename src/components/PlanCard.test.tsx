// @vitest-environment jsdom
/**
 * A plan before a heavy job, in a reply (2026-11-10, the AI accuracy
 * programme, batch AG item 22). jsdom; this must stay line 1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PlanCard from './PlanCard';

afterEach(cleanup);

const plan = {
  files: [
    { uploadId: '1', file: 'invoice.pdf', pages: 4 },
    { uploadId: '2', file: 'statement.png', pages: 1 },
    { uploadId: '3', file: 'notes.png', pages: 1 },
  ],
  mode: 'one' as const,
  skip: [] as string[],
};

describe('the plan card', () => {
  it('lists each file to tick, and starts what is ticked', () => {
    const onPlan = vi.fn();
    render(<PlanCard id="p" plan={plan} ai="Gemini" disabled={false} onPlan={onPlan} />);
    expect(screen.getByText('4 pages')).toBeTruthy();
    expect(screen.getByText(/Read 6 pages with OCR/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/notes\.png/));
    expect(screen.getByText(/Read 5 pages with OCR/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('A report for each file, in Batch'));
    expect(screen.getByText(/Open Batch with the 2 files/)).toBeTruthy();
    fireEvent.click(screen.getByText('Start'));
    expect(onPlan).toHaveBeenCalledWith('p', { files: plan.files, mode: 'each', skip: ['3'] }, true);
  });

  it('cannot start with nothing ticked, and is left with Not now', () => {
    const onPlan = vi.fn();
    render(<PlanCard id="p" plan={{ ...plan, skip: ['1', '2', '3'] }} ai="Gemini" disabled={false} onPlan={onPlan} />);
    expect((screen.getByText('Start') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Not now'));
    expect(onPlan).toHaveBeenCalledWith('p', expect.objectContaining({ skip: ['1', '2', '3'] }), false);
  });

  it('says what was started once answered, with nothing left to press', () => {
    render(<PlanCard id="p" plan={{ ...plan, mode: 'each', answered: 'yes' }} ai="Gemini" disabled={false} onPlan={vi.fn()} />);
    expect(screen.getByText('Started: 3 reports in Batch.')).toBeTruthy();
    expect(screen.queryByText('Start')).toBeNull();
  });
});
