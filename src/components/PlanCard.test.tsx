// @vitest-environment jsdom
/**
 * A plan before a heavy job, in a reply (2026-11-10, the AI accuracy
 * programme, batch AG item 22). jsdom; this must stay line 1. Words only
 * since 2026-11-11 (the full audit's WS-38): nothing to tick or press.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
  it('draws a plan an older thread left waiting as its words, with no button, box or OCR step', () => {
    const { container } = render(<PlanCard plan={{ ...plan, mode: 'each', skip: ['3'] }} ai="Gemini" />);
    expect(screen.getByText('4 pages')).toBeTruthy();
    expect(screen.getByText('left out')).toBeTruthy();
    expect(screen.getByText('A report for each file, in Batch')).toBeTruthy();
    expect(screen.getByText(/Open Batch with the 2 files/)).toBeTruthy();
    expect(container.querySelectorAll('button, input')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/OCR|Start|Not now|request/);
    expect(screen.getByText('Design them one at a time with Gemini. A limit pauses the batch, and it carries on from where it stopped.')).toBeTruthy();
  });

  it('counts no requests in one report, and says nothing of boxes to tick', () => {
    const one = render(<PlanCard plan={plan} ai="Gemini" />);
    expect(screen.getByText('Design one report from 3 files with Gemini.')).toBeTruthy();
    one.unmount();
    const { container } = render(<PlanCard plan={{ ...plan, skip: ['1', '2', '3'] }} ai="Gemini" />);
    expect(container.textContent).not.toMatch(/ticked|request/);
  });

  it('says what was started once answered, with nothing left to press', () => {
    const { container } = render(<PlanCard plan={{ ...plan, mode: 'each', answered: 'yes' }} ai="Gemini" />);
    // The reply above the card says what was made; the card says only that it started (R1-12).
    expect(screen.getByText('Started.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/3 reports|from 3 files/);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
