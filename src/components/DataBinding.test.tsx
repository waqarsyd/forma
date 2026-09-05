// @vitest-environment jsdom
/**
 * The first component test in this repository.
 *
 * ## Why this component first
 *
 * `DataBinding` is the one with real state logic rather than markup: three
 * mutually exclusive screens, a suggested mapping the user can override, and an
 * apply that must not fire twice. And the bug it shipped with was in exactly
 * that logic — after a SUCCESSFUL bind it rendered "This report cannot be bound
 * yet", because `planDetailBinding` correctly declines once cells are bound and
 * the decline was being read as the failure state. Nothing but a render could
 * have caught that: every unit underneath it was behaving correctly.
 *
 * ## What a component test here is and is not for
 *
 * It asserts what the user is shown and what their actions do. It does not
 * assert styling — the unstyled `wb-pill--solid` button found the same day was
 * a real defect and a screenshot's job, not this file's, because a class name
 * assertion would pass whether or not the CSS defines it.
 *
 * jsdom is opted into on line 1, per `vitest.config.ts`, which keeps the other
 * 38 files in the fast `node` environment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DataBinding from './DataBinding';

afterEach(cleanup);

/** A report the binding planner accepts: heading row and detail row agree. */
const bindable = `<?xml version="1.0"?>
<XtraReportsLayoutSerializer Ref="0" Name="R" PageWidth="850" PageHeight="1100">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="PageHeaderBand" Name="PageHeader" HeightF="20"><Controls>
      <Item1 Ref="3" ControlType="XRTable" Name="th"><Rows><Item1 Ref="4" ControlType="XRTableRow" Name="tr"><Cells>
        <Item1 Ref="5" ControlType="XRTableCell" Name="h1" Text="Description" Weight="3" />
        <Item2 Ref="6" ControlType="XRTableCell" Name="h2" Text="Amount" Weight="1" />
      </Cells></Item1></Rows></Item1>
    </Controls></Item2>
    <Item3 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>
      <Item1 Ref="8" ControlType="XRTable" Name="td"><Rows><Item1 Ref="9" ControlType="XRTableRow" Name="dr"><Cells>
        <Item1 Ref="10" ControlType="XRTableCell" Name="c1" Text="Widget" Weight="3" />
        <Item2 Ref="11" ControlType="XRTableCell" Name="c2" Text="1.00" Weight="1" />
      </Cells></Item1></Rows></Item1>
    </Controls></Item3>
    <Item4 Ref="12" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

/** No PageHeader table, so the planner cannot prove the correspondence. */
const unbindable = bindable.replace(/<Item2 Ref="2"[\s\S]*?<\/Item2>/, '');

const paste = (text: string) => {
  fireEvent.change(screen.getByLabelText('Paste a data sample or schema'), { target: { value: text } });
};

describe('when the report cannot be bound', () => {
  it('explains why, using the planner\'s own reason', () => {
    render(<DataBinding repxContent={unbindable} onApply={() => {}} />);
    expect(screen.getByText(/cannot be bound yet/i)).toBeTruthy();
    // The decline is the content of the pane, not a footnote: it is usually a
    // real finding about the report.
    expect(document.body.textContent).toMatch(/PageHeader|heading|table/i);
  });

  it('offers no paste box, because there is nothing to map onto', () => {
    render(<DataBinding repxContent={unbindable} onApply={() => {}} />);
    expect(screen.queryByLabelText('Paste a data sample or schema')).toBeNull();
  });
});

describe('when the report is already bound', () => {
  const bound = bindable.replace(
    '<Item1 Ref="10" ControlType="XRTableCell" Name="c1" Text="Widget" Weight="3" />',
    '<Item1 Ref="10" ControlType="XRTableCell" Name="c1" Text="Widget" Weight="3">' +
    '<ExpressionBindings><Item1 EventName="BeforePrint" PropertyName="Text" Expression="[DESCR]" /></ExpressionBindings>' +
    '</Item1>',
  );

  it('says it is bound rather than that it cannot be', () => {
    // The shipped bug: planDetailBinding declines once cells are bound, and
    // reading that decline as failure put "cannot be bound yet" on screen
    // immediately after a successful bind.
    render(<DataBinding repxContent={bound} onApply={() => {}} />);
    expect(screen.getByText(/Bound to 1 field\./)).toBeTruthy();
    expect(screen.queryByText(/cannot be bound yet/i)).toBeNull();
  });

  it('names the fields it is bound to', () => {
    render(<DataBinding repxContent={bound} onApply={() => {}} />);
    expect(screen.getByText('DESCR')).toBeTruthy();
  });
});

describe('mapping columns to fields', () => {
  it('lists the report\'s columns with the sample the report shows', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
    expect(screen.getByText('Widget')).toBeTruthy();
  });

  it('reads a pasted schema and suggests a mapping', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    paste('CREATE TABLE T (DESCR NVARCHAR(200), NET_AMOUNT DECIMAL(10,2))');
    expect(screen.getByText(/Read 2 fields from CREATE TABLE/)).toBeTruthy();
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // Loose matching: "Description" contains "descr", "Amount" is inside
    // "NET_AMOUNT".
    expect(selects.map((s) => s.value)).toEqual(['DESCR', 'NET_AMOUNT']);
  });

  it('counts what is mapped', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    paste('DESCR, NET_AMOUNT');
    expect(screen.getByText('2 of 2 columns mapped')).toBeTruthy();
  });

  it('lets the user override a suggestion', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    paste('[{"DESCR":"x","NET_AMOUNT":1,"LineId":2}]');
    const first = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(first, { target: { value: 'LineId' } });
    expect(first.value).toBe('LineId');
  });

  it('offers each field once, so two columns cannot take the same one', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    paste('DESCR, NET_AMOUNT');
    const [first, second] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const options = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);
    // The field the OTHER select holds is absent from this one's list.
    expect(options(first)).not.toContain(second.value);
  });

  it('re-suggests when the pasted source changes, discarding stale edits', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    paste('DESCR, NET_AMOUNT');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '' } });
    paste('Description, Amount');
    // The columns those edits were made against are gone.
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('Description');
  });
});

describe('applying', () => {
  it('cannot apply before anything is mapped', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    expect((screen.getByText('Apply to the .repx') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands back a REPX carrying the chosen field names', () => {
    const onApply = vi.fn();
    render(<DataBinding repxContent={bindable} onApply={onApply} />);
    paste('DESCR, NET_AMOUNT');
    fireEvent.click(screen.getByText('Apply to the .repx'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [xml, summary] = onApply.mock.calls[0];
    expect(xml).toContain('Expression="[DESCR]"');
    expect(xml).toContain('Expression="[NET_AMOUNT]"');
    expect(summary).toMatch(/^bound 2 columns/);
  });

  it('leaves an unmapped column out of the result', () => {
    const onApply = vi.fn();
    render(<DataBinding repxContent={bindable} onApply={onApply} />);
    paste('DESCR, NET_AMOUNT');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '' } });
    fireEvent.click(screen.getByText('Apply to the .repx'));
    const [xml] = onApply.mock.calls[0];
    expect(xml).toContain('Expression="[NET_AMOUNT]"');
    expect(xml).not.toContain('[DESCR]');
  });
});

describe('reading a source it cannot use', () => {
  it('shows the parser\'s complaint rather than failing silently', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    paste('[{"A": 1},]');
    expect(screen.getByText(/did not parse/)).toBeTruthy();
  });

  it('says nothing is sent anywhere, because that is the question a paste box raises', () => {
    render(<DataBinding repxContent={bindable} onApply={() => {}} />);
    expect(screen.getByText(/Read in the browser, never sent anywhere/)).toBeTruthy();
  });
});
