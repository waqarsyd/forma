/**
 * The chat's edits to an open report (2026-11-05): what the model is shown,
 * the edits made from what it answers, and what the reply says changed.
 *
 * As in `repxEdit.test.ts`, much of what matters is negative: an edit that
 * cannot be made is declined with its reason and leaves the file as it was,
 * a font made bold keeps its family and size, and a style the control names
 * does not quietly win over what was set.
 */
import { describe, it, expect } from 'vitest';
import { parseReportStructure } from './reportPreview';
import { applyEdits, changesMarkdown, checksMarkdown, describeChanges, readReportOutcome, reportOutline, repxColor, toolLine, MAX_EDITS, type AgentEdit, type AgentTool } from './agentEdit';

const report = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.8.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" DisplayName="Invoice" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 40, 40" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="40" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="title" Text="INVOICE" LocationFloat="20,20" SizeF="400,40" Font="Arial, 14pt" TextAlignment="MiddleLeft" Padding="2,2,0,0,100" />
        <Item2 Ref="4" ControlType="XRLabel" Name="subtitle" Text="Draft" LocationFloat="20,70" SizeF="300,20" StyleName="Heading" StylePriority.UseFont="false" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="40">
      <Controls>
        <Item1 Ref="6" ControlType="XRTable" Name="lines" LocationFloat="0,0" SizeF="600,25"><Rows><Item1 Ref="10" ControlType="XRTableRow" Name="r1" Weight="1"><Cells><Item1 Ref="11" ControlType="XRTableCell" Name="c1" Text="Item" Weight="1" /><Item2 Ref="12" ControlType="XRTableCell" Name="c2" Weight="1"><ExpressionBindings><Item1 Ref="13" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" /></ExpressionBindings></Item2></Cells></Item1></Rows></Item1>
        <Item2 Ref="7" ControlType="XRLabel" Name="customer" LocationFloat="0,25" SizeF="300,15"><ExpressionBindings><Item1 Ref="14" EventName="BeforePrint" PropertyName="Text" Expression="[CustomerName]" /></ExpressionBindings></Item2>
      </Controls>
    </Item3>
    <Item4 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="40" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const control = (xml: string, name: string) => parseReportStructure(xml).bands.flatMap((b) => b.controls).find((c) => c.name === name)!;
const edit = (...edits: AgentEdit[]) => applyEdits(report, edits);

describe('reportOutline: the report as the model is shown it', () => {
  const outline = reportOutline(report, { findings: ['A total prints blank.'] });

  it('names the report, its unit, paper and margins, and says what the numbers are', () => {
    expect(outline).toContain('REPORT "Invoice"; unit HundredthsOfAnInch; paper Letter portrait, page 850 x 1100; margins left 50, right 50, top 40, bottom 40.');
    expect(outline).toContain("as the file writes them; font sizes are points");
  });

  it('lists every band and control by name, where it is, what it says or prints, and its font and alignment', () => {
    expect(outline).toContain('BAND 1 ReportHeader "ReportHeader", height 200');
    expect(outline).toContain('  title: XRLabel at 20,20 size 400x40, "INVOICE", Arial 14pt, left');
    expect(outline).toContain('  customer: XRLabel at 0,25 size 300x15, [CustomerName]');
    expect(outline).toContain('    row 1: cell 1 "Item" | cell 2 [Amount]');
  });

  it('lists the fields printed and the checks found', () => {
    expect(outline).toContain('FIELDS PRINTED: [Amount], [CustomerName]');
    expect(outline).toContain('CHECKS FOUND: A total prints blank.');
  });

  it('names what is selected on the Preview last, and nothing when nothing is', () => {
    expect(reportOutline(report, { selected: ['title', 'customer'] }).split('\n').pop()).toBe('SELECTED ON THE PREVIEW: title, customer');
    expect(outline).not.toContain('SELECTED');
  });
});

describe('applyEdits: what the model asked for, made by splices', () => {
  it('retypes, moves and resizes a control by name, leaving every other byte', () => {
    const out = edit({ op: 'text', control: 'title', text: 'TAX INVOICE' }, { op: 'move', control: 'title', x: 100 }, { op: 'resize', control: 'title', height: 50 });
    expect(out.applied).toHaveLength(3);
    expect(control(out.xml, 'title')).toMatchObject({ text: 'TAX INVOICE', x: 100, y: 20, width: 400, height: 50 });
    expect(out.xml.replace(/Name="title"[^>]*/, '')).toBe(report.replace(/Name="title"[^>]*/, ''));
  });

  it('makes a font bold and keeps its family and size', () => {
    const out = edit({ op: 'font', control: 'title', bold: true });
    expect(out.xml).toContain('Font="Arial, 14pt, style=Bold"');
    expect(control(out.xml, 'title')).toMatchObject({ bold: true, fontSize: 14, fontFamily: 'Arial' });
  });

  it('sets a style priority back to true, or the named style would still win', () => {
    const out = edit({ op: 'font', control: 'subtitle', size: 12 });
    expect(out.xml).toMatch(/Name="subtitle"[^>]*StylePriority\.UseFont="true"/);
  });

  it('writes a colour as the serializer writes one, and aligns keeping the vertical half', () => {
    const out = edit({ op: 'color', control: 'title', foreColor: '#1F4E79' }, { op: 'align', control: 'title', align: 'right' });
    expect(out.xml).toContain('ForeColor="31, 78, 121"');
    expect(out.xml).toContain('TextAlignment="MiddleRight"');
    expect(repxColor('Navy')).toBe('Navy');
    expect(repxColor('rgb(1,2,3)')).toBeNull();
  });

  it("retypes and restyles a table's cell by row and cell, and declines a cell that prints a field", () => {
    const out = edit({ op: 'text', control: 'lines', row: 1, cell: 1, text: 'Product' }, { op: 'font', control: 'lines', row: 1, cell: 1, bold: true }, { op: 'text', control: 'lines', row: 1, cell: 2, text: 'x' });
    expect(control(out.xml, 'lines').rows[0].cells[0]).toMatchObject({ text: 'Product', bold: true });
    expect(out.declined).toEqual(['text lines: the cell prints a field, not typed text: bind another in the Data tab']);
  });

  it('declines typing over a field, an unknown name and a table with no cell named, changing nothing', () => {
    const out = edit({ op: 'text', control: 'customer', text: 'Acme' }, { op: 'delete', control: 'nope' }, { op: 'text', control: 'lines', text: 'x' });
    expect(out.changed).toBe(false);
    expect(out.xml).toBe(report);
    expect(out.declined).toEqual([
      'text customer: customer prints the field [CustomerName], so typed text would never show',
      'delete nope: no control is named "nope"',
      'text lines: lines is a table: name the row and the cell',
    ]);
  });

  it('deletes, adds a label to a band named by its kind, and hides', () => {
    const out = edit({ op: 'delete', control: 'subtitle' }, { op: 'add', band: 'Detail', text: 'Thank you', x: 300, y: 25, width: 200 }, { op: 'visible', control: 'title', visible: false });
    expect(control(out.xml, 'subtitle')).toBeUndefined();
    const added = parseReportStructure(out.xml).bands.find((b) => b.kind === 'Detail')!.controls.find((c) => c.text === 'Thank you')!;
    expect(added).toMatchObject({ x: 300, y: 25, width: 200 });
    expect(control(out.xml, 'title').visible).toBe(false);
  });

  it('sets the paper as the serializer names it, and the margins', () => {
    const out = edit({ op: 'paper', paper: 'a4', landscape: true }, { op: 'margins', left: 30, right: 30 });
    expect(out.xml).toMatch(/PaperKind="A4"/);
    expect(out.xml).toMatch(/Landscape="true"/);
    expect(out.xml).toContain('PageWidth="1169" PageHeight="827"');
    expect(out.xml).toContain('Margins="30, 30, 40, 40"');
    expect(edit({ op: 'paper', paper: 'Folio' }).declined[0]).toMatch(/not a paper Forma knows/);
  });

  it(`stops at ${MAX_EDITS} edits, which is a redesign`, () => {
    const many = Array.from({ length: MAX_EDITS + 2 }, () => ({ op: 'move', control: 'title', x: 10 }) as AgentEdit);
    const out = edit(...many);
    expect(out.applied).toHaveLength(MAX_EDITS);
    expect(out.declined).toEqual([`2 more edits were not made: more than ${MAX_EDITS} is a redesign`]);
  });
});

describe('readReportOutcome: the answer as Forma acts on it', () => {
  it('keeps an edit and its known edits, dropping an op Forma cannot make', () => {
    const out = readReportOutcome({ reply: 'Done.', action: 'edit', edits: [{ op: 'font', control: 'title', bold: true }, { op: 'chart' }, null] });
    expect(out).toEqual({ reply: 'Done.', wantsReport: false, action: 'edit', edits: [{ op: 'font', control: 'title', bold: true }], tools: [] });
  });

  // Forma's own actions (2026-11-05).
  it('keeps a tool only when its name, pane or format is one Forma has, and runs none with a redesign', () => {
    const out = readReportOutcome({
      reply: 'Here it is.',
      action: 'answer',
      tools: [{ name: 'show', pane: 'preview' }, { name: 'show', pane: 'chart' }, { name: 'export', format: 'pdf' }, { name: 'export', format: 'odt' }, { name: 'print' }, { name: 'testData' }],
    });
    expect(out.tools).toEqual([{ name: 'show', pane: 'preview' }, { name: 'export', format: 'pdf' }, { name: 'testData' }]);
    expect(readReportOutcome({ reply: 'Redesigning.', action: 'rebuild', tools: [{ name: 'designer' }] }).tools).toEqual([]);
  });

  it('reads an edit with no edits but a tool as an answer that acts, not a redesign', () => {
    expect(readReportOutcome({ reply: '', action: 'edit', edits: [], tools: [{ name: 'export', format: 'csv' }] })).toMatchObject({ action: 'answer', wantsReport: false, reply: '' });
  });

  it('says what each tool did, under Done', () => {
    expect([{ name: 'show', pane: 'repx' }, { name: 'testData' }, { name: 'export', format: 'xlsx' }, { name: 'designer' }].map((t) => toolLine(t as AgentTool))).toEqual([
      'opened the REPX',
      'filled the Preview with sample rows',
      'exported it as XLSX',
      'asked the DevExpress designer on this computer to open it',
    ]);
    expect(changesMarkdown([], [], ['opened the Preview'])).toBe('**Done**\n- opened the Preview');
  });

  it('reads a redesign as wanting a report, and an edit with nothing to make as a redesign', () => {
    expect(readReportOutcome({ reply: 'Forma will add a chart.', action: 'rebuild' })).toMatchObject({ wantsReport: true, action: 'rebuild', edits: [] });
    expect(readReportOutcome({ reply: 'Adding a group.', action: 'edit', edits: [] })).toMatchObject({ wantsReport: true, action: 'rebuild' });
  });

  it('reads an unknown action from what came with it, and never edits on an answer', () => {
    expect(readReportOutcome({ reply: 'Moved it.', action: 'do', edits: [{ op: 'move', control: 'a', x: 1 }] }).action).toBe('edit');
    expect(readReportOutcome({ reply: 'It has two bands.' }).action).toBe('answer');
    expect(readReportOutcome({ reply: 'Two bands.', action: 'answer', edits: [{ op: 'delete', control: 'a' }] }).edits).toEqual([]);
  });
});

describe('describeChanges: what the reply says changed', () => {
  it('reads the change off the file, not off what was asked', () => {
    const out = edit({ op: 'text', control: 'title', text: 'TAX INVOICE' }, { op: 'font', control: 'title', bold: true }, { op: 'delete', control: 'subtitle' }, { op: 'paper', paper: 'A4' });
    expect(describeChanges(report, out.xml)).toEqual([
      'removed label **subtitle**',
      'retyped **title** to "TAX INVOICE"',
      'restyled **title** (Arial 14pt bold)',
      'the paper is now A4',
    ]);
  });

  it('says nothing for no change, and counts what is past the limit', () => {
    expect(describeChanges(report, report)).toEqual([]);
    const out = edit({ op: 'move', control: 'title', x: 1 }, { op: 'move', control: 'subtitle', x: 1 }, { op: 'move', control: 'customer', x: 1 });
    expect(describeChanges(report, out.xml, 2)).toEqual(['moved **title** to 1, 20', 'moved **subtitle** to 1, 70', 'and 1 more changes']);
  });

  // The checks said aloud (2026-11-05).
  it('says what the checks found after a redesign, or that they found nothing', () => {
    expect(checksMarkdown([])).toBe('**Checked**: the REPX checks found nothing wrong.');
    const found = Array.from({ length: 6 }, (_, i) => ({ severity: i ? 'warning' : 'error', message: `problem ${i + 1}` }));
    expect(checksMarkdown(found)).toBe(
      '**The checks found 6 problems**\n- error: problem 1\n- problem 2\n- problem 3\n- problem 4\n- and 2 more, listed in the REPX pane',
    );
  });

  it('says only what an edit brought, and nothing when it brought nothing', () => {
    const before = [{ severity: 'warning', message: 'old one' }];
    expect(checksMarkdown(before, before)).toBe('');
    expect(checksMarkdown([...before, { severity: 'error', message: 'A control is outside the page.' }], before)).toBe(
      '**The change brought 1 problem**\n- error: A control is outside the page.',
    );
  });

  it('writes the reply part as a Markdown list, with what was not done', () => {
    expect(changesMarkdown(['moved **title** to 1, 20'], ['delete nope: no control is named "nope"'])).toBe(
      '**Changed**\n- moved **title** to 1, 20\n\n**Not changed**\n- delete nope: no control is named "nope"',
    );
  });
});
