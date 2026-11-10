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
import { applyEdits, changedControls, distinctTools, followUpMessage, splitTools, formatEdits, changesMarkdown, checksMarkdown, describeChanges, parsesSoFar, readAlign, readReportOutcome, reportOutline, repxColor, sideNamed, toolLine, MAX_EDITS, type AgentEdit, type AgentTool } from './agentEdit';

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

// Agent audit item 90: a turn read the same file three or four times over; each version is parsed once now.
describe('one parse per version of the file', () => {
  it('parses the report once for the outline, once more per edit made, and not again for the Changed list', () => {
    const unique = report.replace('<?xml version="1.0" encoding="utf-8"?>', '<?xml version="1.0" encoding="utf-8"?><!-- item 90 -->');
    const before = parsesSoFar();
    reportOutline(unique);
    const out = applyEdits(unique, [
      { op: 'font', control: 'title', bold: true },
      { op: 'align', control: 'subtitle', align: 'center' },
    ]);
    expect(out.applied).toHaveLength(2);
    describeChanges(unique, out.xml);
    changedControls(unique, out.xml);
    // The original, the version after the first edit, and the final one.
    expect(parsesSoFar() - before).toBeLessThanOrEqual(3);
    // And what is shared is the same answer as a fresh parse gives.
    expect(reportOutline(unique)).toBe(reportOutline(`${unique} `));
  });
});

// The selection toolbar's Format menu (2026-11-05), made with the chat's own edits.
describe('formatEdits', () => {
  it('toggles bold over the selection, steps the size by two points, and aligns', () => {
    expect(formatEdits(report, ['title', 'subtitle'], 'bold')).toEqual([
      { op: 'font', control: 'title', bold: true },
      { op: 'font', control: 'subtitle', bold: true },
    ]);
    const bold = applyEdits(report, formatEdits(report, ['title'], 'bold')).xml;
    expect(formatEdits(bold, ['title'], 'bold')).toEqual([{ op: 'font', control: 'title', bold: false }]);
    expect(formatEdits(report, ['title'], 'larger')).toEqual([{ op: 'font', control: 'title', size: 16 }]);
    expect(control(applyEdits(report, formatEdits(report, ['title'], 'smaller')).xml, 'title').fontSize).toBe(12);
    expect(formatEdits(report, ['title', 'nothing'], 'right')).toEqual([{ op: 'align', control: 'title', align: 'right' }]);
  });
});

// What a request changed, outlined on Preview when it is picked in the log (2026-11-05).
describe('changedControls', () => {
  it('names the controls an edit added or changed, and nothing for no change or a removal', () => {
    expect(changedControls(report, report)).toEqual([]);
    expect(changedControls(report, edit({ op: 'align', control: 'title', align: 'right' }).xml)).toEqual(['title']);
    const after = edit({ op: 'font', control: 'subtitle', bold: true }, { op: 'add', band: 'Detail', text: 'Thank you' }).xml;
    const named = changedControls(report, after);
    expect(named).toContain('subtitle');
    expect(named.filter((n) => n !== 'subtitle')).toHaveLength(1);
    expect(named).not.toContain('title');
    expect(changedControls(report, edit({ op: 'delete', control: 'customer' }).xml)).toEqual([]);
  });
});

/* The agent audit's batch C (2026-11-07): what the agent sees, and edits that reach what it meant. */
describe('what the agent sees, and edits that reach the control meant', () => {
  const ROOT = 'SerializerVersion="20.1.8.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100" Version="20.1"';
  const doc = (rootExtra: string, controls: string) =>
    `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer ${ROOT} ${rootExtra}><Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>${controls}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
  const table = '<Item1 Ref="2" ControlType="XRTable" Name="grid" LocationFloat="0,0" SizeF="600,25"><Rows><Item1 Ref="3" ControlType="XRTableRow" Name="r1" Weight="1"><Cells><Item1 Ref="4" ControlType="XRTableCell" Name="first" Text="First" Weight="1" TextAlignment="MiddleLeft" /><Item2 Ref="5" ControlType="XRTableCell" Name="second" Text="Second" Weight="1" /></Cells></Item1></Rows></Item1>';
  const label = (ref: number, name: string, x: number, extra = '') => `<Item${ref} Ref="${ref + 10}" ControlType="XRLabel" Name="${name}" Text="${name}" LocationFloat="${x},50" SizeF="100,20" ${extra} />`;

  // Item 6: a right-to-left report is outlined and edited as its file writes it.
  it('outlines a right-to-left report with cells in file order and alignments as they print, and writes an alignment so it prints as asked', () => {
    const rtl = doc('RightToLeft="Yes" RightToLeftLayout="Yes"', table + label(2, 'note', 10, 'TextAlignment="MiddleLeft"'));
    const outline = reportOutline(rtl);
    expect(outline).toContain('RIGHT TO LEFT');
    expect(outline).toContain('cell 1 "First" | cell 2 "Second"');
    expect(outline).toContain('note: XRLabel at 10,50 size 100x20, "note", Times New Roman 9.75pt, right');
    const out = applyEdits(rtl, [{ op: 'text', control: 'grid', row: 1, cell: 1, text: 'Erste' }, { op: 'align', control: 'note', align: 'left' }]);
    expect(out.xml).toContain('Name="first" Text="Erste"');
    expect(out.xml).toMatch(/Name="note"[^>]*TextAlignment="MiddleRight"/);
  });

  // Item 41: a control in a panel is placed within it.
  it('says a control inside a panel is placed within it', () => {
    const panel = '<Item1 Ref="2" ControlType="XRPanel" Name="box" LocationFloat="100,40" SizeF="300,100"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="inner" Text="Hi" LocationFloat="10,5" SizeF="80,20" /></Controls></Item1>';
    expect(reportOutline(doc('', panel))).toContain('inner: XRLabel in panel box at 10,5 within it size 80x20');
  });

  // Item 42: two controls of one name are told apart, and an edit reaches the one meant.
  it('names a second control of one name name#2, edits it by that name, and lists its change under it', () => {
    const twins = doc('', label(1, 'total', 10) + label(2, 'total', 300));
    const outline = reportOutline(twins);
    expect(outline).toContain('total#2: XRLabel at 300,50');
    expect(outline).toContain('Some controls share a name');
    const out = applyEdits(twins, [{ op: 'move', control: 'total#2', x: 400 }]);
    expect(out.xml).toMatch(/LocationFloat="10,50"[\s\S]*LocationFloat="400,50"/);
    expect(describeChanges(twins, out.xml)).toEqual(['moved **total#2** to 400, 50']);
    expect(changedControls(twins, out.xml)).toEqual(['total']);
  });

  // Item 43: a long static table does not flood the prompt.
  it('lists at most ten rows of a table and counts the rest', () => {
    const rows = Array.from({ length: 14 }, (_, i) => `<Item${i + 1} Ref="${100 + i}" ControlType="XRTableRow" Name="r${i}" Weight="1"><Cells><Item1 Ref="${200 + i}" ControlType="XRTableCell" Name="c${i}" Text="Row ${i}" Weight="1" /></Cells></Item${i + 1}>`).join('');
    const outline = reportOutline(doc('', `<Item1 Ref="2" ControlType="XRTable" Name="long" LocationFloat="0,0" SizeF="600,350"><Rows>${rows}</Rows></Item1>`));
    expect(outline).toContain('    row 10: cell 1 "Row 9"');
    expect(outline).not.toContain('row 11:');
    expect(outline).toContain('(4 more rows are not listed)');
  });

  // Items 10 and 48: the colours, borders, format, total and expression, and no text typed over an expression.
  it('shows colours, borders, a format, a total and an expression, and refuses to retype what an expression prints', () => {
    const rich =
      label(1, 'flag', 10, 'ForeColor="Red" BackColor="255, 255, 224" Borders="Bottom" TextFormatString="{0:N2}"') +
      '<Item2 Ref="20" ControlType="XRLabel" Name="pageNo" LocationFloat="10,100" SizeF="100,20"><ExpressionBindings><Item1 Ref="21" EventName="BeforePrint" PropertyName="Text" Expression="\'Page \' + ?Page" /></ExpressionBindings></Item2>' +
      '<Item3 Ref="22" ControlType="XRLabel" Name="sum" LocationFloat="10,130" SizeF="100,20"><Summary Ref="23" Running="Group" /><ExpressionBindings><Item1 Ref="24" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([Amount])" /></ExpressionBindings></Item3>';
    const outline = reportOutline(doc('', rich));
    expect(outline).toMatch(/flag: .*colour Red, fill 255, 255, 224, borders Bottom/);
    expect(outline).toContain('format "{0:N2}"');
    expect(outline).toContain(`pageNo: XRLabel at 10,100 size 100x20, = 'Page ' + ?Page`);
    expect(outline).toMatch(/sum: .*\[Amount\].*a total over each group/);
    expect(applyEdits(doc('', rich), [{ op: 'text', control: 'pageNo', text: 'Page 1' }]).declined[0]).toMatch(/prints the expression/);
  });

  // Item 12: landscape on a Custom paper turns it rather than resetting it to Letter.
  it('turns a Custom paper landscape by swapping its own sides', () => {
    const custom = doc('PaperKind="Custom"', label(1, 'a', 10)).replace('PageWidth="850" PageHeight="1100"', 'PageWidth="900" PageHeight="1300"');
    const out = applyEdits(custom, [{ op: 'paper', landscape: true }]);
    expect(out.xml).toContain('PageWidth="1300" PageHeight="900"');
    expect(out.xml).toContain('PaperKind="Custom"');
    expect(out.xml).toContain('Landscape="true"');
    expect(applyEdits(custom, [{ op: 'paper' }]).declined[0]).toMatch(/the paper is Custom/);
  });

  // Item 81: no margins written is 100 a side, as DevExpress printed (parity row 65).
  it('reads absent margins as DevExpress prints them before changing one side', () => {
    expect(applyEdits(doc('', label(1, 'a', 10)), [{ op: 'margins', left: 30 }]).xml).toContain('Margins="30, 100, 100, 100"');
  });

  // Item 82: a tool asked for without what it needs is defaulted or said, never dropped.
  it('opens the Preview for a show with no pane, and says why an export with no format was not made', () => {
    const out = readReportOutcome({ reply: 'Here.', action: 'answer', tools: [{ name: 'show' }, { name: 'export' }, { name: 'export', format: 'odt' }] });
    expect(out.tools).toEqual([{ name: 'show', pane: 'preview' }]);
    expect(out.toolsDeclined).toHaveLength(2);
    expect(out.toolsDeclined![0]).toMatch(/no format was named/);
    expect(out.toolsDeclined![1]).toMatch(/does not export ODT/);
  });
});

/* The agent audit's batch D (2026-11-07): the new edits, and edits that do what they say. */
describe('the new edits, and edits that do what they say', () => {
  const ROOT = 'SerializerVersion="20.1.8.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" Margins="50, 50, 40, 40" PageWidth="850" PageHeight="1100" Version="20.1"';
  const doc = (detail: string, footer = '') =>
    `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer ${ROOT}><Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100"><Controls>${detail}</Controls></Item1>${footer}</Bands></XtraReportsLayoutSerializer>`;
  const lbl = (ref: number, name: string, extra = '') => `<Item${ref} Ref="${ref + 10}" ControlType="XRLabel" Name="${name}" Text="${name}" LocationFloat="10,${ref * 25}" SizeF="100,20" ${extra} />`;
  const grid = '<Item1 Ref="2" ControlType="XRTable" Name="grid" LocationFloat="0,0" SizeF="600,50"><Rows>' +
    [1, 2].map((r) => `<Item${r} Ref="${r + 2}" ControlType="XRTableRow" Name="r${r}" Weight="1"><Cells><Item1 Ref="${r + 5}" ControlType="XRTableCell" Name="a${r}" Text="A${r}" Weight="1" Font="Arial, 9pt" /><Item2 Ref="${r + 8}" ControlType="XRTableCell" Name="b${r}" Text="B${r}" Weight="1" Font="Arial, 9pt" /></Cells></Item${r}>`).join('') +
    '</Rows></Item1>';
  const cellsOf = (xml: string) => parseReportStructure(xml).bands[0].controls[0].rows.map((r) => r.cells);

  it('duplicates a control and puts the copy where it was asked', () => {
    const out = applyEdits(doc(lbl(1, 'total')), [{ op: 'duplicate', control: 'total', x: 300, y: 25 }]);
    expect(out.applied[0]).toMatch(/duplicated XRLabel "total" as "total1"/);
    expect(control(out.xml, 'total1')).toMatchObject({ x: 300, y: 25 });
    expect(control(out.xml, 'total')).toMatchObject({ x: 10, y: 25 });
  });

  it("sets a band's height, and refuses one that would cut through what it holds", () => {
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'bandHeight', band: 'Detail', height: 60 }]).xml).toContain('HeightF="60"');
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'bandHeight', band: 'Detail', height: 30 }]).declined[0]).toMatch(/holds a control reaching 45/);
    expect(describeChanges(doc(lbl(1, 'a')), applyEdits(doc(lbl(1, 'a')), [{ op: 'bandHeight', band: 'Detail', height: 60 }]).xml)).toContain('set the height of Detail to 60');
  });

  it('writes borders as BorderSide writes them, and refuses sides it does not know', () => {
    const out = applyEdits(doc(lbl(1, 'a')), [{ op: 'border', control: 'a', borders: 'bottom and top', borderColor: 'navy', borderWidth: 2 }]);
    expect(out.xml).toMatch(/Borders="Top, Bottom"/);
    expect(out.xml).toMatch(/BorderColor="Navy"/);
    expect(out.xml).toMatch(/BorderWidth="2"/);
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'border', control: 'a', borders: 'left, right, top, bottom' }]).xml).toMatch(/Borders="All"/);
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'border', control: 'a', borders: 'diagonal' }]).declined[0]).toMatch(/not a set of sides/);
  });

  it('adds a line the printable width, and a page number in the page footer with its default words', () => {
    const footer = '<Item2 Ref="50" ControlType="PageFooterBand" Name="PageFooter" HeightF="30" />';
    const out = applyEdits(doc(lbl(1, 'a'), footer), [{ op: 'line', band: 'Detail', x: 0, y: 70 }, { op: 'pageNumber', x: 550 }]);
    expect(out.xml).toMatch(/ControlType="XRLine" Name="line1" LocationFloat="0, 70" SizeF="750, 2"/);
    expect(out.xml).toMatch(/<PageFooterBand|Name="PageFooter" HeightF="30"><Controls><Item1 Ref="\d+" ControlType="XRPageInfo" Name="pageInfo1" TextFormatString="Page \{0\} of \{1\}" TextAlignment="TopRight"/);
    expect(out.xml).not.toMatch(/PageInfo="NumberOfTotal"/);
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'pageNumber', pageInfo: 'Roman' }]).declined[0]).toMatch(/not a page number/);
  });

  it('formats a control, refusing a format with no {0}', () => {
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'format', control: 'a', format: '{0:N2}' }]).xml).toContain('TextFormatString="{0:N2}"');
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'format', control: 'a', format: 'N2' }]).declined[0]).toMatch(/not a format/);
  });

  it('binds a label and a cell to a field, and rebinds one already bound', () => {
    const bound = applyEdits(doc(lbl(1, 'a')), [{ op: 'bind', control: 'a', field: 'Customer' }]);
    expect(bound.xml).toContain('<ExpressionBindings><Item1 EventName="BeforePrint" PropertyName="Text" Expression="[Customer]" /></ExpressionBindings></Item1>');
    expect(control(bound.xml, 'a').field).toBe('Customer');
    const again = applyEdits(bound.xml, [{ op: 'bind', control: 'a', field: '[Client]' }]);
    expect(control(again.xml, 'a').field).toBe('Client');
    expect(again.xml.match(/ExpressionBindings>/g)).toHaveLength(2);
    expect(cellsOf(applyEdits(doc(grid), [{ op: 'bind', control: 'grid', row: 2, cell: 2, field: 'Amount' }]).xml)[1][1].field).toBe('Amount');
    expect(applyEdits(doc(grid), [{ op: 'bind', control: 'grid', field: 'Amount' }]).declined[0]).toMatch(/name the row and the cell/);
  });

  // The third gap of docs/proposals/ai-designers.md (2026-11-10): a sentence about what a control is for.
  it('describes a control for the AI, and the outline shows it', () => {
    const done = applyEdits(doc(lbl(1, 'a')), [{ op: 'describe', control: 'a', text: '  The tax line,   under the subtotal.  ' }]);
    expect(done.applied).toEqual(['described XRLabel "a"']);
    expect(done.xml).toContain('AccessibleDescription="The tax line, under the subtotal."');
    expect(reportOutline(done.xml)).toMatch(/a: XRLabel .* described as "The tax line, under the subtotal\."/);
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'describe', control: 'a' }]).declined[0]).toMatch(/no description was given/);
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'describe', control: 'a', text: 'x'.repeat(200) }]).xml).toContain(`AccessibleDescription="${'x'.repeat(125)}"`);
  });

  // Batch AG, item 24 (2026-11-10): never a field the data lacks, when the data is known.
  it('binds and groups only to a field the report’s data has, as the data spells it', () => {
    const fields = () => ['CustomerName', 'Amount'];
    const bound = applyEdits(doc(lbl(1, 'a')), [{ op: 'bind', control: 'a', field: 'customername' }], { fields });
    expect(control(bound.xml, 'a').field).toBe('CustomerName');
    const invented = applyEdits(doc(lbl(1, 'a')), [{ op: 'bind', control: 'a', field: 'Discount' }], { fields });
    expect(invented.changed).toBe(false);
    expect(invented.declined[0]).toBe("bind a: the report's data has no field [Discount]; it has [CustomerName], [Amount]");
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'group', field: 'Region' }], { fields }).declined[0]).toMatch(/no field \[Region\]/);
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'group', field: 'CustomerName', total: 'Freight' }], { fields }).declined[0]).toMatch(/no field \[Freight\]/);
    // With nothing known about the data, any field may be one the person means to add.
    expect(applyEdits(doc(lbl(1, 'a')), [{ op: 'bind', control: 'a', field: 'Discount' }], { fields: () => null }).changed).toBe(true);
  });

  // Items 22 and 40: a header row, a column, and the whole table.
  it('styles a table row by its row, a column by its cell, and every cell with neither', () => {
    const row = cellsOf(applyEdits(doc(grid), [{ op: 'font', control: 'grid', row: 1, bold: true }]).xml);
    expect(row[0].map((c) => c.bold)).toEqual([true, true]);
    expect(row[1].map((c) => c.bold)).toEqual([false, false]);
    const column = cellsOf(applyEdits(doc(grid), [{ op: 'color', control: 'grid', cell: 2, backColor: '#eeeeee' }]).xml);
    expect(column.map((r) => r[1].appearance.BackColor)).toEqual(['238, 238, 238', '238, 238, 238']);
    expect(column.map((r) => r[0].appearance.BackColor ?? null)).toEqual([null, null]);
    const all = applyEdits(doc(grid), [{ op: 'font', control: 'grid', bold: true }]);
    expect(cellsOf(all.xml).flat().every((c) => c.bold)).toBe(true);
    expect(all.applied).toEqual(['restyled every cell of grid']);
  });

  it('accepts only colours .NET knows by name, spelled as it spells them', () => {
    expect(repxColor('red')).toBe('Red');
    expect(repxColor('light grey')).toBe('LightGray');
    expect(repxColor('Text')).toBeNull();
    expect(repxColor('Bluish')).toBeNull();
  });

  it("keeps a font's charSet when it is made bold", () => {
    const arabic = applyEdits(doc(lbl(1, 'a', 'Font="Tahoma, 10pt, charSet=178"')), [{ op: 'font', control: 'a', bold: true }]);
    expect(arabic.xml).toContain('Font="Tahoma, 10pt, style=Bold, charSet=178"');
  });

  it('gives an added label its band’s font, and the name asked for when it is free', () => {
    const out = applyEdits(doc(lbl(1, 'a', 'Font="Tahoma, 9pt"') + lbl(2, 'b', 'Font="Tahoma, 9pt"')), [{ op: 'add', band: 'Detail', text: 'Note', x: 10, y: 75, name: 'labelNote' }]);
    expect(control(out.xml, 'labelNote')).toMatchObject({ fontFamily: 'Tahoma', fontSize: 9, text: 'Note' });
  });

  // Item 50: a colour is a recolour, not a restyle.
  it('says a colour changed as a recolour, a cell’s colour too, and a format and a binding in their own words', () => {
    const before = doc(lbl(1, 'title', 'Font="Arial, 18pt"') + grid.replace('Ref="2"', 'Ref="90"').replace('Name="grid"', 'Name="grid2"').replace(/Ref="(\d)"/g, 'Ref="9$1"'));
    const after = applyEdits(before, [
      { op: 'color', control: 'title', foreColor: 'Red' },
      { op: 'color', control: 'grid2', row: 1, cell: 1, backColor: 'Yellow' },
      { op: 'format', control: 'title', format: '{0:N0}' },
    ]).xml;
    const lines = describeChanges(before, after);
    expect(lines).toContain('recoloured **title** (text Red)');
    expect(lines).toContain('formatted **title** as "{0:N0}"');
    expect(lines).toContain('recoloured row 1, cell 1 of **grid2** (fill Yellow)');
    expect(lines.some((l) => l.startsWith('restyled'))).toBe(false);
  });

  // Agent audit item 16: a model with no schema writes "false" in quotes, and "false" is true.
  it('reads an edit’s quoted booleans and numbers as what they say', () => {
    const out = readReportOutcome({ reply: 'Done.', action: 'edit', edits: [{ op: 'font', control: 'a', bold: 'false', size: '12' }, { op: 'visible', control: 'b', visible: 'false' }] });
    expect(out.edits[0]).toMatchObject({ bold: false, size: 12 });
    expect(out.edits[1]).toMatchObject({ visible: false });
    expect(applyEdits(doc(lbl(1, 'a', 'Font="Arial, 9pt, style=Bold"')), out.edits.slice(0, 1)).xml).toContain('Font="Arial, 12pt"');
  });

  // Agent audit item 47, the owner's choice: what takes something out of the page waits for a press.
  it('offers an export and the designer as buttons, and runs a pane, sample rows and undo at once', () => {
    const { now, ask } = splitTools([{ name: 'show', pane: 'preview' }, { name: 'export', format: 'pdf' }, { name: 'testData' }, { name: 'designer' }, { name: 'undo' }, { name: 'translate', language: 'German' }]);
    expect(now.map((t) => t.name)).toEqual(['show', 'testData', 'undo']);
    // A translation rewrites every caption, so it waits too (2026-11-10).
    expect(ask).toEqual([{ name: 'export', format: 'pdf' }, { name: 'designer' }, { name: 'translate', language: 'German' }]);
  });

  // Items 23 and 38.
  it('runs each tool once, and tells the second pass what was not made and what the edits broke', () => {
    expect(distinctTools([{ name: 'export', format: 'pdf' }, { name: 'export', format: 'pdf' }, { name: 'show', pane: 'repx' }, { name: 'show', pane: 'preview' }, { name: 'export', format: 'csv' }])).toEqual([
      { name: 'export', format: 'pdf' },
      { name: 'show', pane: 'preview' },
      { name: 'export', format: 'csv' },
    ]);
    const message = followUpMessage(['font x: no control is named "x"'], ['A total prints blank.']);
    expect(message).toContain('- font x: no control is named "x"');
    expect(message).toContain('- A total prints blank.');
    expect(message).toContain('answer with "edit" and only those edits');
    expect(readReportOutcome({ reply: 'Undone.', action: 'answer', tools: [{ name: 'undo' }] }).tools).toEqual([{ name: 'undo' }]);
  });
});

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

  // Found by the first real-key run (2026-11-05): "centre the footer note" was refused.
  it('reads an alignment however the model spells it, and still refuses none', () => {
    expect(['center', 'Centre', 'centred', 'MiddleCenter', 'middle'].map(readAlign)).toEqual(['center', 'center', 'center', 'center', 'center']);
    expect([readAlign('Right'), readAlign('TopLeft'), readAlign('end'), readAlign('justify'), readAlign(undefined)]).toEqual(['right', 'left', 'right', null, null]);
    expect(edit({ op: 'align', control: 'title', align: 'centre' as 'center' }).xml).toContain('TextAlignment="MiddleCenter"');
    expect(edit({ op: 'align', control: 'title', ...({ alignment: 'right' } as object) } as AgentEdit).xml).toContain('TextAlignment="MiddleRight"');
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

  // Agent audit item 13: an added label takes the font asked for, or the remembered one App passes.
  it('gives an added label the font it is asked for', () => {
    const out = edit({ op: 'add', band: 'Detail', text: 'Thank you', x: 10, y: 5, family: 'Tahoma', size: 11, bold: true });
    const added = parseReportStructure(out.xml).bands.find((b) => b.kind === 'Detail')!.controls.find((c) => c.text === 'Thank you')!;
    expect(added).toMatchObject({ fontFamily: 'Tahoma', fontSize: 11, bold: true });
    expect(out.applied).toHaveLength(1);
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

  // In the present since 2026-11-07 (agent audit item 38): the reply is written before a tool runs.
  it('says what each tool is starting, under Started', () => {
    expect([{ name: 'show', pane: 'repx' }, { name: 'testData' }, { name: 'export', format: 'xlsx' }, { name: 'designer' }, { name: 'undo' }, { name: 'translate', language: 'French' }].map((t) => toolLine(t as AgentTool))).toEqual([
      'opening the REPX',
      'filling the Preview with sample rows',
      'exporting it as XLSX',
      'asking the DevExpress designer on this computer to open it',
      'taking back the last change',
      'translating its texts into French',
    ]);
    expect(changesMarkdown([], [], ['opening the Preview'])).toBe('**Started**\n- opening the Preview');
  });

  it('reads a redesign as wanting a report, and an edit with nothing to make as a redesign', () => {
    expect(readReportOutcome({ reply: 'Forma will add a chart.', action: 'rebuild' })).toMatchObject({ wantsReport: true, action: 'rebuild', edits: [] });
    expect(readReportOutcome({ reply: 'Adding a group.', action: 'edit', edits: [] })).toMatchObject({ wantsReport: true, action: 'rebuild' });
  });

  // Agent audit items 19 and 20: the whole request for a design, and a different report in a project of its own.
  it('keeps the brief for a redesign or a new report only, and runs no edit or tool with a new report', () => {
    expect(readReportOutcome({ reply: 'Redesigning.', action: 'rebuild', brief: ' Orders grouped by region, with a total per region ' }).brief).toBe('Orders grouped by region, with a total per region');
    expect(readReportOutcome({ reply: 'Made it bold.', action: 'edit', edits: [{ op: 'font', control: 'a', bold: true }], brief: 'x' })).not.toHaveProperty('brief');
    const fresh = readReportOutcome({ reply: 'A new one.', action: 'new', brief: 'A payslip', edits: [{ op: 'delete', control: 'a' }], tools: [{ name: 'testData' }] });
    expect(fresh).toEqual({ reply: 'A new one.', wantsReport: false, action: 'new', edits: [], tools: [], brief: 'A payslip' });
  });

  it('reads an unknown action from what came with it, and never edits on an answer', () => {
    expect(readReportOutcome({ reply: 'Moved it.', action: 'do', edits: [{ op: 'move', control: 'a', x: 1 }] }).action).toBe('edit');
    expect(readReportOutcome({ reply: 'It has two bands.' }).action).toBe('answer');
    expect(readReportOutcome({ reply: 'Two bands.', action: 'answer', edits: [{ op: 'delete', control: 'a' }] }).edits).toEqual([]);
  });

  // The second real-key run (2026-11-06): "Centre the footer note." came back as an align with no side.
  it('gives an alignment sent with no side the one the request names, and only that one', () => {
    const sideless = { reply: 'Centred it.', action: 'edit', edits: [{ op: 'align', control: 'labelFooter' }] };
    expect(readReportOutcome(sideless, 'Centre the footer note.').edits).toEqual([{ op: 'align', control: 'labelFooter', align: 'center' }]);
    expect(readReportOutcome(sideless, 'Put the page number on the right.').edits[0]).toMatchObject({ align: 'right' });
    // Two sides, or none, name nothing; and a side the model gave is kept.
    expect(readReportOutcome(sideless, 'Move it from the left to the right.').edits[0]).not.toHaveProperty('align');
    expect(readReportOutcome(sideless).edits[0]).not.toHaveProperty('align');
    expect(readReportOutcome({ ...sideless, edits: [{ op: 'align', control: 'a', align: 'left' }] }, 'centre it').edits[0]).toMatchObject({ align: 'left' });
    expect(sideNamed('Make it centred')).toBe('center');
    expect(sideNamed('Copyright notice')).toBeNull();
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
