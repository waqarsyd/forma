// @vitest-environment jsdom
/**
 * The Describe-a-report dialog, rendered with no key and no network.
 *
 * It owns no decision -- the clarification call and the generation are
 * App.tsx's -- so what is pinned here is the contract it hands up: a request
 * built from the fields, a predefined prompt filling the description, the
 * submit gate on a description too short to design from, the data source
 * readout, and the questions phase seeding its answers with the suggestions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DescribeReportDialog, { type DescribePhase } from './DescribeReportDialog';
import { PREDEFINED_PROMPTS } from '../lib/promptToReport';

afterEach(cleanup);

const draw = (phase: DescribePhase = { kind: 'describe' }, props: Partial<React.ComponentProps<typeof DescribeReportDialog>> = {}) => {
  const onSubmit = vi.fn();
  const onAnswer = vi.fn();
  const onClose = vi.fn();
  render(<DescribeReportDialog phase={phase} pageSize="Letter" onSubmit={onSubmit} onAnswer={onAnswer} onClose={onClose} {...props} />);
  return { onSubmit, onAnswer, onClose };
};

const description = () => screen.getByLabelText('Type in a detailed report description') as HTMLTextAreaElement;
const build = () => screen.getByText('Build the report') as HTMLButtonElement;

describe('the describe phase', () => {
  it('offers every predefined prompt, and picking one fills the description and the title', () => {
    draw();
    for (const p of PREDEFINED_PROMPTS) expect(screen.getByText(p.title)).toBeTruthy();
    fireEvent.click(screen.getByText('Invoice'));
    expect(description().value).toBe(PREDEFINED_PROMPTS[0].text);
    expect((screen.getByLabelText('Title (optional)') as HTMLInputElement).value).toBe('Invoice');
    expect(screen.getByText('Invoice').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps Build disabled until there is a description worth designing from', () => {
    const { onSubmit } = draw();
    expect(build().disabled).toBe(true);
    fireEvent.change(description(), { target: { value: 'invoice' } });
    expect(build().disabled).toBe(true);
    fireEvent.change(description(), { target: { value: 'An invoice with line items and a total' } });
    expect(build().disabled).toBe(false);
    fireEvent.click(build());
    expect(onSubmit).toHaveBeenCalledWith({ description: 'An invoice with line items and a total', title: undefined, dataSchema: undefined });
  });

  it('reads the pasted data source and says which fields the report will bind to', () => {
    const { onSubmit } = draw();
    expect(screen.getByText(/No data source/)).toBeTruthy();
    fireEvent.change(description(), { target: { value: 'A customer list with balances' } });
    fireEvent.change(screen.getByLabelText('Add a data source (optional)'), { target: { value: 'CustomerId, Company, Balance' } });
    expect(screen.getByText(/3 field\(s\) found: CustomerId, Company, Balance/)).toBeTruthy();
    fireEvent.click(build());
    expect(onSubmit.mock.calls[0][0].dataSchema).toBe('CustomerId, Company, Balance');
  });

  it('shows the page size the configuration is set to', () => {
    draw({ kind: 'describe' }, { pageSize: 'A4' });
    expect(screen.getByText(/Page size: A4/)).toBeTruthy();
  });

  it('closes from the button and from Escape', () => {
    const { onClose } = draw();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('the questions phase', () => {
  const phase: DescribePhase = {
    kind: 'questions',
    request: { description: 'A sales report' },
    questions: [
      { id: 'cols', question: 'Which columns?', suggestion: 'Salesperson, Orders, Revenue' },
      { id: 'grp', question: 'Group by?' },
    ],
  };

  it('seeds each answer with the suggestion and submits them with their questions', () => {
    const { onAnswer } = draw(phase);
    expect(screen.getByText('A few questions first')).toBeTruthy();
    const cols = screen.getByLabelText('Which columns?') as HTMLInputElement;
    expect(cols.value).toBe('Salesperson, Orders, Revenue');
    fireEvent.change(screen.getByLabelText('Group by?'), { target: { value: 'Region' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(onAnswer).toHaveBeenCalledWith([
      { id: 'cols', question: 'Which columns?', answer: 'Salesperson, Orders, Revenue' },
      { id: 'grp', question: 'Group by?', answer: 'Region' },
    ]);
  });
});
