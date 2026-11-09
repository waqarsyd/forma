// scripts -- what DevExpress 20.1 does with a report's script when scripts are
// denied (2026-11-09, the owner's download programme, batch WE).
//
// A .repx can carry C# that runs when the report is previewed or printed
// (ScriptsSource, and a control's Scripts.OnBeforePrint naming a method in it).
// Once the website can hand a report to Forma Designer, a report shared by
// someone else is one click from the user's designer, so the companion denies
// scripts for a report that came from a page. This measures what Deny does:
// the same report printed with each ExecutionMode, and the label's text read
// back from the printed document. Opens no window.
using System;
using System.IO;
using System.Text;
using DevExpress.XtraPrinting;
using DevExpress.XtraReports.Security;
using DevExpress.XtraReports.UI;

static class ScriptsProbe {
    const string Layout =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
        "<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"ScriptProbe\" " +
        "ScriptsSource=\"private void label1_BeforePrint(object sender, System.Drawing.Printing.PrintEventArgs e) {&#xD;&#xA;  ((DevExpress.XtraReports.UI.XRLabel)sender).Text = &quot;SCRIPT RAN&quot;;&#xD;&#xA;}&#xD;&#xA;\" " +
        "PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\">" +
        "<Bands><Item1 Ref=\"2\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"40\"><Controls>" +
        "<Item1 Ref=\"3\" ControlType=\"XRLabel\" Name=\"label1\" Text=\"as written\" SizeF=\"300,25\" LocationFloat=\"0,0\">" +
        "<Scripts Ref=\"4\" OnBeforePrint=\"label1_BeforePrint\" /></Item1>" +
        "</Controls></Item1></Bands></XtraReportsLayoutSerializer>";

    public static int Run() {
        foreach (ExecutionMode mode in new[] { ExecutionMode.Deny, ExecutionMode.Unrestricted }) {
            ScriptPermissionManager.GlobalInstance = new ScriptPermissionManager(mode);
            string printed;
            try {
                var report = new XtraReport();
                using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(Layout))) report.LoadLayoutFromXml(ms);
                report.CreateDocument();
                using (var text = new MemoryStream()) {
                    report.ExportToText(text, new TextExportOptions());
                    printed = Encoding.UTF8.GetString(text.ToArray()).Trim();
                }
                report.Dispose();
            } catch (Exception ex) {
                printed = "threw " + ex.GetType().Name + ": " + ex.Message;
            }
            Console.WriteLine("{0,-13} printed: {1}", mode, printed);
        }
        ScriptPermissionManager.GlobalInstance = new ScriptPermissionManager(ExecutionMode.Unrestricted);
        return 0;
    }
}
