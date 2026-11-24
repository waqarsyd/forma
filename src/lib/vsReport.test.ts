/**
 * The report files a .NET solution holds, told apart by name (2026-11-24,
 * findings GAP1-1 and GAP1-3 of the MCP design audit): a .repx and a .vsrepx
 * read, a C# or VB report refused in words that say what to send instead,
 * and the names a report class's Designer file looks up, which a layout
 * written back into its .vsrepx must keep. The Designer files are
 * hand-written in the shape of DevExpress's own sample, never copied from it.
 */
import { describe, expect, it } from 'vitest';
import { codeReportClass, codeReportMessage, designerLookups, layoutNames, namesDropped, reportFileKind } from './vsReport';

const CS_DESIGNER = `namespace Shop.Reports {
  partial class Invoice {
    private void InitializeComponent() {
      DevExpress.XtraReports.ReportInitializer reportInitializer = new DevExpress.XtraReports.ReportInitializer(this, "Shop.Reports.Invoice.vsrepx");
      this.title = reportInitializer.GetControl<DevExpress.XtraReports.UI.XRLabel>("title");
      this.lines = reportInitializer.GetControl<DevExpress.XtraReports.UI.XRTable>("lines");
      this.Region = reportInitializer.GetParameter("Region");
      this.title = reportInitializer.GetControl<DevExpress.XtraReports.UI.XRLabel>("title");
      this.other = somethingElse.GetControl<DevExpress.XtraReports.UI.XRLabel>("notLookedUp");
    }
  }
}`;

const VB_DESIGNER = `Partial Class Invoice
    Private Sub InitializeComponent()
        Dim reportInitializer As DevExpress.XtraReports.ReportInitializer = New DevExpress.XtraReports.ReportInitializer(Me, "Shop.Reports.Invoice.vsrepx")
        Me.title = reportInitializer.GetControl(Of DevExpress.XtraReports.UI.XRLabel)("title")
        Me.Style1 = reportInitializer.GetStyle("Style1")
    End Sub
End Class`;

describe('a report file, by its name', () => {
  it.each([
    ['G:\\Reports\\Invoice.repx', 'repx'],
    ['/home/me/Invoice.REPX', 'repx'],
    ['G:\\Shop\\Reports\\Invoice.vsrepx', 'vsrepx'],
    ['G:\\Shop\\Reports\\Invoice.cs', 'code'],
    ['G:\\Shop\\Reports\\Invoice.Designer.cs', 'code'],
    ['/src/Invoice.Designer.vb', 'code'],
    ['G:\\Reports\\Invoice.rdl', 'other'],
    ['G:\\Reports.repx\\notes', 'other'],
  ])('%s is %s', (name, kind) => {
    expect(reportFileKind(name)).toBe(kind);
  });

  it("names a report class from its source file, Designer or not", () => {
    expect(codeReportClass('G:\\Shop\\Invoice.cs')).toBe('Invoice');
    expect(codeReportClass('/src/Invoice.Designer.vb')).toBe('Invoice');
  });
});

describe('a C# or VB report, refused', () => {
  it('says how to save a .repx from Visual Studio or from the application, in the language of the file', () => {
    const cs = codeReportMessage('G:\\Shop\\Invoice.Designer.cs', null, 'G:\\Shop\\Invoice.repx');
    expect(cs).toMatch(/^"G:\\\\Shop\\\\Invoice\.Designer\.cs" is code: /);
    expect(cs).toContain("the report's smart tag saves its layout as a .repx (Save)");
    expect(cs).toContain('new Invoice().SaveLayoutToXml(@"G:\\Shop\\Invoice.repx")');
    expect(codeReportMessage('/src/Invoice.vb', null, '/src/Invoice.repx')).toContain('New Invoice().SaveLayoutToXml("/src/Invoice.repx")');
  });

  it('names the .vsrepx beside it instead, when there is one', () => {
    expect(codeReportMessage('G:\\Shop\\Invoice.cs', 'G:\\Shop\\Invoice.vsrepx', 'G:\\Shop\\Invoice.repx')).toBe(
      '"G:\\\\Shop\\\\Invoice.cs" is code. Its report keeps its layout in "G:\\\\Shop\\\\Invoice.vsrepx", beside it, which Forma reads: send that path instead.',
    );
  });

  it("tells a person at Forma's command line to give a file where a host's model is told to send one", () => {
    expect(codeReportMessage('/src/Invoice.cs', '/src/Invoice.vsrepx', '/src/Invoice.repx', 'give')).toMatch(/which Forma reads: give that path instead\.$/);
    const said = codeReportMessage('/src/Invoice.cs', null, '/src/Invoice.repx', 'give');
    expect(said).toContain('Give a .repx of it instead.');
    expect(said).not.toMatch(/\bsend\b/i);
  });
});

describe("the names a report class's Designer file looks up (GAP1-3)", () => {
  it('reads every Get lookup through a ReportInitializer, in C# and in VB, each once, and nothing else', () => {
    expect(designerLookups(CS_DESIGNER)).toEqual(['title', 'lines', 'Region']);
    expect(designerLookups(VB_DESIGNER)).toEqual(['title', 'Style1']);
    expect(designerLookups('this.x = other.GetControl<XRLabel>("x");')).toEqual([]);
  });

  it('says which of them a new layout dropped, never one the old layout lacked', () => {
    const before = '<Item1 Name="title" /><Item2 Name=\'lines\' /><Parameters><Item1 Name="Region" /></Parameters>';
    expect([...layoutNames(before)]).toEqual(['title', 'lines', 'Region']);
    const after = '<Item1 Name="title" /><Parameters><Item1 Name="Region" /></Parameters>';
    expect(namesDropped(before, after, ['title', 'lines', 'Region', 'missingAlready'])).toEqual(['lines']);
    expect(namesDropped(before, before, ['title', 'lines'])).toEqual([]);
  });
});
