// render <case-dir> [out-dir] -- what does DevExpress PRINT for a report?
//
// Every other command in this tool answers a serialization question: what the
// file says. This one answers the rendering question the DevExpress parity work
// (2026-10-30) needs answered for every behaviour Forma's Preview imitates:
// given this report and this data, where does each piece of ink land, on which
// page, and what do the exports contain?
//
// A case directory holds:
//
//   report.repx   the layout, loaded with LoadLayoutFromXml exactly as an
//                 application would load it
//   data.json     optional: { "dataMember": "Sales",
//                             "tables": { "Sales": [ {...}, ... ] },
//                             "relations": [ { "name", "parent", "parentColumn",
//                                              "child", "childColumn" } ],
//                             "types": { "Sales.OrderDate": "DateTime" },
//                             "parameters": { "Region": "North" },
//                             "exports": [ "pdf", "xlsx", ... ] }
//
// Column types are inferred from the values (bool, whole number, number, an
// ISO date string, otherwise string) unless "types" names one.
//
// It writes render.json -- page sizes, every brick with its rectangle, the
// control that produced it and its resolved style -- plus one file per export.
// The culture is pinned to en-US so a currency or date format reads the same on
// any machine; this one's own culture would otherwise print rupees.
//
// Nothing here opens a window, so it is safe from an agent shell like the rest
// of RepxProbe.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using DevExpress.XtraPrinting;
using DevExpress.XtraReports.UI;

static class Render {
    const string DxBin = @"C:\Program Files (x86)\DevExpress 20.1\Components\Bin\Framework";

    static readonly string[] AllExports = { "pdf", "xlsx", "xlsx-data", "csv", "docx", "rtf", "png", "html" };

    public static int Run(string caseDir, string outDir) {
        // An export may reach for an assembly this project does not reference
        // (DOCX and XLSX pull in Office pieces). Load it from the installed
        // DevExpress folder rather than failing the export.
        AppDomain.CurrentDomain.AssemblyResolve += (sender, e) => {
            string file = Path.Combine(DxBin, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(file) ? Assembly.LoadFrom(file) : null;
        };
        Thread.CurrentThread.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
        Thread.CurrentThread.CurrentUICulture = CultureInfo.GetCultureInfo("en-US");

        string repxPath = Path.Combine(caseDir, "report.repx");
        string dataPath = Path.Combine(caseDir, "data.json");
        Directory.CreateDirectory(outDir);

        XtraReport report = new XtraReport();
        report.LoadLayoutFromXml(repxPath);

        var notes = new List<string>();
        var exports = new List<string>(AllExports);
        int rowCount = 0;

        if (File.Exists(dataPath)) {
            var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var root = (Dictionary<string, object>)json.DeserializeObject(File.ReadAllText(dataPath));
            DataSet data = BuildDataSet(root, notes);
            report.DataSource = data;
            object member;
            if (root.TryGetValue("dataMember", out member) && member != null) {
                report.DataMember = (string)member;
                if (data.Tables.Contains((string)member)) rowCount = data.Tables[(string)member].Rows.Count;
            }
            foreach (Band band in report.Bands) AttachDetailReports(band, data);
            AttachDataControls(report, data, notes);

            object parameters;
            if (root.TryGetValue("parameters", out parameters) && parameters is Dictionary<string, object>) {
                foreach (var pair in (Dictionary<string, object>)parameters) {
                    var p = report.Parameters[pair.Key];
                    if (p == null) { notes.Add("no parameter named " + pair.Key); continue; }
                    p.Value = Convert.ChangeType(pair.Value, p.Type, CultureInfo.InvariantCulture);
                }
            }
            object wanted;
            if (root.TryGetValue("exports", out wanted) && wanted is object[]) {
                exports.Clear();
                foreach (object e in (object[])wanted) exports.Add((string)e);
            }
        }
        report.RequestParameters = false;

        var timer = Stopwatch.StartNew();
        report.CreateDocument(false);
        timer.Stop();
        long layoutMs = timer.ElapsedMilliseconds;

        var exportLines = new List<string>();
        foreach (string kind in exports) exportLines.Add(Export(report, kind, outDir));

        var sb = new StringBuilder();
        sb.Append("{\n");
        sb.Append("  \"case\": ").Append(Str(Path.GetFileName(caseDir.TrimEnd('\\', '/')))).Append(",\n");
        sb.Append("  \"rows\": ").Append(rowCount).Append(",\n");
        sb.Append("  \"layoutMs\": ").Append(layoutMs).Append(",\n");
        sb.Append("  \"pageCount\": ").Append(report.Pages.Count).Append(",\n");
        sb.Append("  \"reportUnit\": ").Append(Str(report.ReportUnit.ToString())).Append(",\n");
        sb.Append("  \"margins\": [").Append(report.Margins.Left).Append(", ").Append(report.Margins.Right)
          .Append(", ").Append(report.Margins.Top).Append(", ").Append(report.Margins.Bottom).Append("],\n");
        sb.Append("  \"notes\": [").Append(string.Join(", ", notes.ConvertAll(Str))).Append("],\n");
        sb.Append("  \"charts\": [").Append(string.Join(", ", ChartPoints(report))).Append("],\n");
        sb.Append("  \"exports\": [\n    ").Append(string.Join(",\n    ", exportLines)).Append("\n  ],\n");
        sb.Append("  \"pages\": [\n");

        // Every page of an ordinary case; the head and tail of a large one, which
        // is enough to see the pattern without a 50 MB file.
        int count = report.Pages.Count;
        bool first = true;
        for (int i = 0; i < count; i++) {
            if (count > 40 && i >= 3 && i < count - 2) continue;
            var page = report.Pages[i];
            if (!first) sb.Append(",\n");
            first = false;
            sb.Append("    { \"index\": ").Append(i + 1);
            sb.Append(", \"size\": [").Append(Num(page.PageSize.Width)).Append(", ").Append(Num(page.PageSize.Height)).Append("]");
            sb.Append(", \"bricks\": [\n");
            var bricks = new List<string>();
            foreach (Brick brick in page.InnerBricks) Collect(brick, 0, bricks);
            sb.Append("      ").Append(string.Join(",\n      ", bricks)).Append("\n    ] }");
        }
        sb.Append("\n  ]\n}\n");
        File.WriteAllText(Path.Combine(outDir, "render.json"), sb.ToString(), new UTF8Encoding(false));

        Console.WriteLine("rendered " + Path.GetFileName(caseDir.TrimEnd('\\', '/')) + ": " + count + " page(s), "
            + rowCount + " row(s), layout " + layoutMs + " ms");
        foreach (string line in exportLines) Console.WriteLine("  " + line);
        foreach (string note in notes) Console.WriteLine("  note: " + note);
        return 0;
    }

    /// One export, timed, never fatal: a format this install cannot produce is
    /// itself a finding, so it is recorded rather than thrown.
    static string Export(XtraReport report, string kind, string outDir) {
        string ext = kind == "xlsx-data" ? "data.xlsx" : kind;
        string path = Path.Combine(outDir, "report." + ext);
        var timer = Stopwatch.StartNew();
        try {
            switch (kind) {
                case "pdf": report.ExportToPdf(path); break;
                case "xlsx": report.ExportToXlsx(path); break;
                case "xlsx-data":
                    report.ExportToXlsx(path, new XlsxExportOptionsEx { ExportType = DevExpress.Export.ExportType.DataAware });
                    break;
                case "csv": report.ExportToCsv(path); break;
                case "docx": report.ExportToDocx(path); break;
                case "rtf": report.ExportToRtf(path); break;
                case "html": report.ExportToHtml(path); break;
                case "png":
                    report.ExportToImage(path, new ImageExportOptions(ImageFormat.Png) {
                        ExportMode = ImageExportMode.SingleFilePageByPage,
                        PageRange = "1",
                        Resolution = 96,
                    });
                    break;
                default:
                    return "{ \"kind\": " + Str(kind) + ", \"error\": \"unknown export\" }";
            }
            timer.Stop();
            long size = File.Exists(path) ? new FileInfo(path).Length : -1;
            return "{ \"kind\": " + Str(kind) + ", \"file\": " + Str(Path.GetFileName(path))
                + ", \"bytes\": " + size + ", \"ms\": " + timer.ElapsedMilliseconds + " }";
        } catch (Exception ex) {
            return "{ \"kind\": " + Str(kind) + ", \"error\": " + Str(ex.GetType().Name + ": " + ex.Message) + " }";
        }
    }

    static void AttachDetailReports(Band band, DataSet data) {
        var detailReport = band as DetailReportBand;
        if (detailReport == null) return;
        if (detailReport.DataSource == null) detailReport.DataSource = data;
        foreach (Band inner in detailReport.Bands) AttachDetailReports(inner, data);
    }

    // ------------------------------------------------------------------ data

    static DataSet BuildDataSet(Dictionary<string, object> root, List<string> notes) {
        var set = new DataSet("Data");
        var types = new Dictionary<string, string>();
        object typesNode;
        if (root.TryGetValue("types", out typesNode) && typesNode is Dictionary<string, object>) {
            foreach (var pair in (Dictionary<string, object>)typesNode) types[pair.Key] = (string)pair.Value;
        }

        object tablesNode;
        if (!root.TryGetValue("tables", out tablesNode) || !(tablesNode is Dictionary<string, object>)) return set;
        foreach (var pair in (Dictionary<string, object>)tablesNode) {
            var rows = pair.Value as object[] ?? new object[0];
            var table = new DataTable(pair.Key);
            var columns = new List<string>();
            foreach (object rowObj in rows) {
                var row = rowObj as Dictionary<string, object>;
                if (row == null) continue;
                foreach (string key in row.Keys) if (!columns.Contains(key)) columns.Add(key);
            }
            foreach (string column in columns) {
                string declared;
                Type type = types.TryGetValue(pair.Key + "." + column, out declared)
                    ? Type.GetType("System." + declared)
                    : Infer(rows, column);
                table.Columns.Add(column, type);
            }
            foreach (object rowObj in rows) {
                var row = rowObj as Dictionary<string, object>;
                if (row == null) continue;
                DataRow dataRow = table.NewRow();
                foreach (string column in columns) {
                    object value;
                    if (!row.TryGetValue(column, out value) || value == null) { dataRow[column] = DBNull.Value; continue; }
                    Type target = table.Columns[column].DataType;
                    dataRow[column] = target == typeof(DateTime)
                        ? (object)DateTime.Parse((string)value, CultureInfo.InvariantCulture)
                        : Convert.ChangeType(value, target, CultureInfo.InvariantCulture);
                }
                table.Rows.Add(dataRow);
            }
            set.Tables.Add(table);
            notes.Add(pair.Key + ": " + table.Rows.Count + " rows, " + DescribeColumns(table));
        }

        object relationsNode;
        if (root.TryGetValue("relations", out relationsNode) && relationsNode is object[]) {
            foreach (object relObj in (object[])relationsNode) {
                var rel = (Dictionary<string, object>)relObj;
                set.Relations.Add((string)rel["name"],
                    set.Tables[(string)rel["parent"]].Columns[(string)rel["parentColumn"]],
                    set.Tables[(string)rel["child"]].Columns[(string)rel["childColumn"]]);
            }
        }
        return set;
    }

    static string DescribeColumns(DataTable table) {
        var parts = new List<string>();
        foreach (DataColumn c in table.Columns) parts.Add(c.ColumnName + ":" + c.DataType.Name);
        return string.Join(" ", parts);
    }

    static Type Infer(object[] rows, string column) {
        bool sawValue = false, allBool = true, allWhole = true, allNumber = true, allDate = true;
        foreach (object rowObj in rows) {
            var row = rowObj as Dictionary<string, object>;
            object value;
            if (row == null || !row.TryGetValue(column, out value) || value == null) continue;
            sawValue = true;
            if (!(value is bool)) allBool = false;
            if (!(value is int || value is long)) allWhole = false;
            if (!(value is int || value is long || value is decimal || value is double)) allNumber = false;
            var s = value as string;
            DateTime ignored;
            if (s == null || s.Length < 10 || s[4] != '-' ||
                !DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out ignored)) allDate = false;
        }
        if (!sawValue) return typeof(string);
        if (allBool) return typeof(bool);
        if (allWhole) return typeof(int);
        if (allNumber) return typeof(decimal);
        if (allDate) return typeof(DateTime);
        return typeof(string);
    }

    // ------------------------------------------------------- data controls

    /// A cross-tab or a chart reads its own DataSource, not the report's, so a
    /// case's data reaches neither unless it is handed over -- which is what an
    /// application binding a report does too. Given the report's data and data
    /// member when it has none of its own (parity row 28, 2026-10-30).
    static void AttachDataControls(XtraReport report, DataSet data, List<string> notes) {
        foreach (XRControl control in report.AllControls<XRControl>()) {
            var crossTab = control as DevExpress.XtraReports.UI.XRCrossTab;
            if (crossTab != null && crossTab.DataSource == null) {
                crossTab.DataSource = data;
                if (string.IsNullOrEmpty(crossTab.DataMember)) crossTab.DataMember = report.DataMember;
                notes.Add("cross-tab " + crossTab.Name + " given the report's data");
            }
            var chart = control as XRChart;
            if (chart != null && chart.DataSource == null) {
                chart.DataSource = data;
                if (string.IsNullOrEmpty(chart.DataMember)) chart.DataMember = report.DataMember;
                notes.Add("chart " + chart.Name + " given the report's data");
            }
        }
    }

    /// Every chart's series as plotted, after layout: the points DevExpress drew,
    /// argument then values, read from the chart rather than from its image.
    static List<string> ChartPoints(XtraReport report) {
        var charts = new List<string>();
        foreach (XRChart chart in report.AllControls<XRChart>()) {
            var series = new List<string>();
            foreach (DevExpress.XtraCharts.Series s in chart.Series) {
                var points = new List<string>();
                foreach (DevExpress.XtraCharts.SeriesPoint p in s.Points) {
                    var values = new List<string>();
                    foreach (double v in p.Values) values.Add(Num((float)v));
                    points.Add("[" + Str(Convert.ToString(p.Argument, CultureInfo.InvariantCulture)) + ", " + string.Join(", ", values) + "]");
                }
                series.Add("{ \"name\": " + Str(s.Name) + ", \"points\": [" + string.Join(", ", points) + "] }");
            }
            charts.Add("{ \"name\": " + Str(chart.Name) + ", \"series\": [" + string.Join(", ", series) + "] }");
        }
        return charts;
    }

    // ---------------------------------------------------------------- bricks

    /// A brick, its resolved style and the control that produced it, then its
    /// children one level deeper. A composite keeps its children in InnerBricks,
    /// not Bricks -- the trap RenderColumns already documents.
    static void Collect(Brick brick, int depth, List<string> into) {
        var sb = new StringBuilder();
        RectangleF r = brick.Rect;
        sb.Append("{ \"d\": ").Append(depth).Append(", \"t\": ").Append(Str(brick.BrickType));
        sb.Append(", \"r\": [").Append(Num(r.X)).Append(", ").Append(Num(r.Y)).Append(", ")
          .Append(Num(r.Width)).Append(", ").Append(Num(r.Height)).Append("]");

        var visual = brick as VisualBrick;
        if (visual != null) {
            var owner = visual.BrickOwner as XRControl;
            if (owner != null) sb.Append(", \"owner\": ").Append(Str(owner.Name));
            var text = brick as TextBrick;
            if (text != null) sb.Append(", \"text\": ").Append(Str(text.Text));
            BrickStyle style = visual.Style;
            if (style != null) {
                sb.Append(", \"style\": { ");
                if (style.Font != null) {
                    sb.Append("\"font\": ").Append(Str(style.Font.Name))
                      .Append(", \"pt\": ").Append(Num(style.Font.SizeInPoints))
                      .Append(", \"bold\": ").Append(style.Font.Bold ? "true" : "false")
                      .Append(", \"italic\": ").Append(style.Font.Italic ? "true" : "false").Append(", ");
                }
                sb.Append("\"fore\": ").Append(Str(Color(style.ForeColor)))
                  .Append(", \"back\": ").Append(Str(Color(style.BackColor)))
                  .Append(", \"sides\": ").Append(Str(style.Sides.ToString()))
                  .Append(", \"bw\": ").Append(Num(style.BorderWidth))
                  .Append(", \"bc\": ").Append(Str(Color(style.BorderColor)))
                  .Append(", \"pad\": [").Append(style.Padding.Left).Append(", ").Append(style.Padding.Right)
                  .Append(", ").Append(style.Padding.Top).Append(", ").Append(style.Padding.Bottom)
                  .Append(", ").Append(Num(style.Padding.Dpi)).Append("]")
                  .Append(", \"align\": ").Append(Str(style.TextAlignment.ToString()))
                  .Append(" }");
            }
        }
        sb.Append(" }");
        into.Add(sb.ToString());

        var composite = brick as CompositeBrick;
        if (composite != null) foreach (Brick child in composite.InnerBricks) Collect(child, depth + 1, into);
        foreach (Brick child in brick.Bricks) Collect(child, depth + 1, into);
    }

    static string Color(System.Drawing.Color c) {
        if (c.IsEmpty || c.A == 0) return "";
        return "#" + c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
    }

    static string Num(double value) {
        return value.ToString("0.###", CultureInfo.InvariantCulture);
    }

    static string Str(string value) {
        if (value == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char ch in value) {
            switch (ch) {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20 || ch > 0x7e) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                    else sb.Append(ch);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }
}
