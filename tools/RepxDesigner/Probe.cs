using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Xml;
using DevExpress.XtraReports.UI;

namespace RepxDesigner
{
    /// <summary>
    /// The installed DevExpress asked what it makes of a report (2026-11-11, the full
    /// audit's CC-10): POST /inspect and POST /render, read-only, opening no window.
    ///
    /// Every rule Forma checks a report by was learned by putting files through
    /// tools/RepxProbe, and the last one (Margins must be four whole numbers, or
    /// DevExpress 20.1 drops them and prints with sides of 100) was found by chance,
    /// nine probes deep. A person with Forma Designer running has the real loader on
    /// their PC, so Forma asks it after a generation instead of guessing: what the
    /// file declares and the loader did not build, the report attributes it did not
    /// keep as written, and how many pages it prints with the page's own records.
    ///
    /// Nothing is written to disk, no data source is filled (the records come from
    /// the request, and the report's own SQL data source is replaced by them before
    /// anything runs), report scripts stay off as for every report this process
    /// loads, and the answer is a few numbers and names. The same origin, client
    /// header, Host and same-user guards as /open apply (Program.Handle). Since the
    /// re-audit's R5-03, a report naming a type outside DevExpress's own report types,
    /// the plain value types and the SQL data source, or a file outside the report on
    /// another computer or a drive, is refused before it is loaded (ReportGuard, below).
    ///
    /// Every method here names a DevExpress type, so each is NoInlining and called
    /// only once Program.Installed is known (Entry.cs says why).
    /// </summary>
    internal static class ReportProbe
    {
        /// <summary>The report attributes whose loss changes the printed page, compared as written and as loaded.</summary>
        private static readonly string[] RootAttributes = { "Margins", "PaperKind", "PageWidth", "PageHeight", "Landscape", "ReportUnit" };

        /// <summary>
        /// POST /inspect, the body a .repx: the controls the file declares against those
        /// DevExpress built, by Name; and each report attribute that changed between the
        /// file and DevExpress's own re-save of it.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public static string Inspect(string repx)
        {
            XtraReport report = Load(repx);
            var declared = DeclaredControls(repx);
            var loaded = new HashSet<string>(report.AllControls<XRControl>().Select(c => c.Name ?? ""));
            foreach (Band band in report.AllControls<Band>()) loaded.Add(band.Name ?? "");
            var lost = declared.Where(n => !loaded.Contains(n)).Distinct().ToList();

            // Each as written against the loaded report's own property, not its re-save,
            // which leaves out a value equal to the default ("HundredthsOfAnInch").
            var before = RootOf(repx);
            var after = new Dictionary<string, string>
            {
                { "Margins", report.Margins.Left + ", " + report.Margins.Right + ", " + report.Margins.Top + ", " + report.Margins.Bottom },
                { "PaperKind", report.PaperKind.ToString() },
                { "PageWidth", report.PageWidth.ToString(CultureInfo.InvariantCulture) },
                { "PageHeight", report.PageHeight.ToString(CultureInfo.InvariantCulture) },
                { "Landscape", report.Landscape.ToString() },
                { "ReportUnit", report.ReportUnit.ToString() },
            };
            var dropped = new List<string>();
            foreach (string name in RootAttributes)
            {
                string was, now;
                before.TryGetValue(name, out was);
                after.TryGetValue(name, out now);
                if (was == null || Same(was, now)) continue;
                dropped.Add("{\"attribute\":" + SqlCompanion.Json(name) + ",\"declared\":" + SqlCompanion.Json(was) + ",\"loaded\":" + SqlCompanion.Json(now) + "}");
            }

            var b = new StringBuilder("{");
            b.Append("\"declared\":").Append(declared.Count);
            b.Append(",\"loaded\":").Append(declared.Count - lost.Count);
            b.Append(",\"lost\":[").Append(string.Join(",", lost.Take(40).Select(SqlCompanion.Json))).Append("]");
            b.Append(",\"dropped\":[").Append(string.Join(",", dropped)).Append("]");
            b.Append(",\"margins\":").Append(Margins(report));
            return b.Append("}").ToString();
        }

        /// <summary>
        /// POST /render, the body {"repx": "...", "rows": [{"Field": "text"}, ...]}: the
        /// report printed with those records, as DevExpress prints it, and how many pages
        /// and which margins came out. The records stand in for the report's own data
        /// source, which is never filled here.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public static string Render(string body, out int status)
        {
            var json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
            var root = json.DeserializeObject(body) as Dictionary<string, object>;
            object repxValue;
            if (root == null || !root.TryGetValue("repx", out repxValue) || !(repxValue is string))
            {
                status = 400;
                return "{\"error\":\"no report\"}";
            }
            object rowsValue;
            root.TryGetValue("rows", out rowsValue);

            CultureInfo culture = Thread.CurrentThread.CurrentCulture;
            Thread.CurrentThread.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
            try
            {
                XtraReport report = Load((string)repxValue);
                // The page's records, every value as text, in place of whatever the report
                // names: its own SQL data source is never filled from here.
                DataTable table = Table(rowsValue as object[] ?? new object[0]);
                report.DataSource = table;
                report.DataMember = "";
                foreach (DetailReportBand detail in report.AllControls<DetailReportBand>())
                {
                    detail.DataSource = null;
                    detail.DataMember = "";
                }
                foreach (XRChart chart in report.AllControls<XRChart>()) { chart.DataSource = table; chart.DataMember = ""; }
                foreach (XRCrossTab crossTab in report.AllControls<XRCrossTab>()) { crossTab.DataSource = table; crossTab.DataMember = ""; }
                // A subreport carries a report of its own, whose data source this does not
                // replace; it is not printed here rather than filled.
                if (report.AllControls<XRSubreport>().Any())
                {
                    status = 422;
                    return "{\"error\":\"the report holds a subreport\"}";
                }
                report.RequestParameters = false;
                report.CreateDocument(false);
                status = 200;
                return "{\"pages\":" + report.Pages.Count + ",\"records\":" + table.Rows.Count + ",\"margins\":" + Margins(report) + "}";
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = culture;
            }
        }

        private static XtraReport Load(string repx)
        {
            // Read before DevExpress makes a single object of it (2026-11-11, the re-audit's R5-03).
            string refused = ReportGuard.Refusal(repx, false);
            if (refused != null) throw new ReportRefused(refused);
            var report = new XtraReport();
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(repx))) report.LoadLayoutFromXml(ms);
            return report;
        }

        private static string Margins(XtraReport report)
        {
            return "[" + report.Margins.Left + "," + report.Margins.Right + "," + report.Margins.Top + "," + report.Margins.Bottom + "]";
        }

        /// <summary>Every Name a control or band of the file declares, in file order.</summary>
        private static List<string> DeclaredControls(string repx)
        {
            var names = new List<string>();
            foreach (Match m in Regex.Matches(repx, "<Item\\d+\\b(?=[^>]*\\sControlType=\"(?:XR\\w+|\\w+Band)\")[^>]*\\sName=\"([^\"]*)\""))
            {
                names.Add(m.Groups[1].Value);
            }
            return names;
        }

        /// <summary>The report element's attributes, by name.</summary>
        private static Dictionary<string, string> RootOf(string repx)
        {
            var attributes = new Dictionary<string, string>(StringComparer.Ordinal);
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            // DevExpress's own save begins with a byte order mark, which a string reader takes for text.
            using (var reader = XmlReader.Create(new StringReader(repx.TrimStart((char)0xFEFF)), settings))
            {
                if (reader.MoveToContent() != XmlNodeType.Element) return attributes;
                while (reader.MoveToNextAttribute()) attributes[reader.Name] = reader.Value;
            }
            return attributes;
        }

        /// <summary>
        /// Two attribute values that say the same: "50, 50, 50, 50" and "50,50,50,50",
        /// "True" and "true", "850.0" and "850". "39.37" and "39" do not.
        /// </summary>
        private static bool Same(string a, string b)
        {
            if (b == null) return false;
            string[] x = Regex.Replace(a, "\\s+", "").ToLowerInvariant().Split(',');
            string[] y = Regex.Replace(b, "\\s+", "").ToLowerInvariant().Split(',');
            if (x.Length != y.Length) return false;
            for (int i = 0; i < x.Length; i++)
            {
                double p, q;
                bool numbers = double.TryParse(x[i], NumberStyles.Float, CultureInfo.InvariantCulture, out p) && double.TryParse(y[i], NumberStyles.Float, CultureInfo.InvariantCulture, out q);
                if (numbers ? p != double.Parse(y[i], CultureInfo.InvariantCulture) : x[i] != y[i]) return false;
            }
            return true;
        }

        /// <summary>The records as a table of text columns, named by every field any record holds.</summary>
        private static DataTable Table(object[] rows)
        {
            var table = new DataTable("Data");
            var records = rows.OfType<Dictionary<string, object>>().ToList();
            foreach (string column in records.SelectMany(r => r.Keys).Distinct()) table.Columns.Add(column, Typed(records, column));
            foreach (var record in records)
            {
                DataRow row = table.NewRow();
                foreach (DataColumn column in table.Columns)
                {
                    object value;
                    string text = record.TryGetValue(column.ColumnName, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) : null;
                    row[column] = string.IsNullOrEmpty(text) ? DBNull.Value : Parse(text, column.DataType);
                }
                table.Rows.Add(row);
            }
            return table;
        }

        /// <summary>A column's type from its values, as Forma's own print types them: a number, an ISO date, else text.</summary>
        private static Type Typed(List<Dictionary<string, object>> records, string column)
        {
            var values = records.Select(r => { object v; return r.TryGetValue(column, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : ""; }).Where(s => s.Length > 0).ToList();
            if (values.Count == 0) return typeof(string);
            decimal d;
            if (values.All(s => decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out d) && !s.Contains(","))) return typeof(decimal);
            DateTime t;
            if (values.All(s => Regex.IsMatch(s, "^\\d{4}-\\d{2}-\\d{2}") && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out t))) return typeof(DateTime);
            return typeof(string);
        }

        private static object Parse(string text, Type type)
        {
            if (type == typeof(decimal)) return decimal.Parse(text, NumberStyles.Number, CultureInfo.InvariantCulture);
            if (type == typeof(DateTime)) return DateTime.Parse(text, CultureInfo.InvariantCulture);
            return text;
        }
    }

    /// <summary>A report /inspect and /render will not load, with why; answered as a 422 by Program.Handle.</summary>
    internal sealed class ReportRefused : Exception
    {
        public ReportRefused(string why) : base(why) { }
    }

    /// <summary>
    /// What a report posted to /inspect or /render may name before DevExpress loads it
    /// (2026-11-11, the re-audit's R5-03). Every generation is posted once Forma Designer
    /// has answered in a page, with no click, and the report is the AI's answer to a
    /// picture or a PDF someone else may have made. DevExpress's serializer makes an
    /// object of every type a ControlType, an ObjectType or a parameter's Type names, and
    /// a data source in ComponentStorage names more inside its Base64; and a picture's
    /// ImageUrl, a StyleSheetPath, an XmlDataPath or a subreport's ReportSourceUrl is
    /// opened when the report prints, from another computer if it names one, which sends
    /// that computer this Windows sign-in to answer.
    ///
    /// So only DevExpress's own report types, the plain .NET value types and the SQL data
    /// source Forma writes are taken, and no file outside the report. The same rules as
    /// src/lib/inspectionGuard.ts, which asks before posting so an older Forma Designer
    /// is never sent such a report either. Read with XmlReader, no DTD, no resolver.
    /// </summary>
    internal static class ReportGuard
    {
        private static readonly HashSet<string> ValueTypes = new HashSet<string>(
            new[] { "String", "Boolean", "Byte", "SByte", "Char", "Int16", "Int32", "Int64", "UInt16", "UInt32", "UInt64", "Single", "Double", "Decimal", "DateTime", "DateTimeOffset", "TimeSpan", "Guid", "DBNull" }.Select(t => "System." + t),
            StringComparer.Ordinal);

        private static readonly string[] PathAttributes = { "ImageUrl", "StyleSheetPath", "XmlDataPath", "ReportSourceUrl" };

        private const string SqlDataSource = "DevExpress.DataAccess.Sql.SqlDataSource";

        private static string TypeOf(string written) { return written.Split(',')[0].Trim(); }

        private static bool Bare(string name) { return Regex.IsMatch(name, "^[A-Za-z_]\\w*$"); }

        private static bool IsValueTypeName(string name)
        {
            return name.StartsWith("#Ref-", StringComparison.Ordinal) || Bare(name) || ValueTypes.Contains(name) || name == "DevExpress.DataAccess.Expression";
        }

        /// <summary>Another computer (\\server, //server), a file: address or a drive (C:\).</summary>
        private static bool ReachesOutside(string value)
        {
            string v = value.Trim();
            return Regex.IsMatch(v, "^[\\\\/]{2}") || v.StartsWith("file:", StringComparison.OrdinalIgnoreCase) || Regex.IsMatch(v, "^[A-Za-z]:[\\\\/]");
        }

        /// <summary>Why the report must not be loaded, or null. <paramref name="nested"/>: a data source's own XML.</summary>
        public static string Refusal(string xml, bool nested)
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            using (var reader = XmlReader.Create(new StringReader(xml.TrimStart((char)0xFEFF)), settings))
            {
                while (reader.Read())
                {
                    if (reader.NodeType != XmlNodeType.Element) continue;
                    string control = reader.GetAttribute("ControlType");
                    if (control != null && !nested && !Bare(TypeOf(control)) && !TypeOf(control).StartsWith("DevExpress.XtraReports.", StringComparison.Ordinal))
                    {
                        return "it names the type \"" + TypeOf(control) + "\"";
                    }
                    string objectType = reader.GetAttribute("ObjectType");
                    if (objectType != null)
                    {
                        string type = TypeOf(objectType);
                        if (!type.StartsWith("DevExpress.XtraReports.", StringComparison.Ordinal) && type != SqlDataSource) return "it holds a \"" + type + "\"";
                        string base64 = reader.GetAttribute("Base64");
                        if (type == SqlDataSource && !string.IsNullOrEmpty(base64))
                        {
                            string inner;
                            try
                            {
                                inner = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
                            }
                            catch (FormatException)
                            {
                                return "its data source cannot be read";
                            }
                            string why;
                            try
                            {
                                why = Refusal(inner, true);
                            }
                            catch (XmlException)
                            {
                                return "its data source cannot be read";
                            }
                            if (why != null) return "its data source: " + why;
                        }
                    }
                    string written = reader.GetAttribute("Type");
                    if (written != null)
                    {
                        if (TypeOf(written) == "System.Type")
                        {
                            string content = TypeOf(reader.GetAttribute("Content") ?? "");
                            if (!IsValueTypeName(content)) return "it names the type \"" + content + "\"";
                        }
                        else if (!IsValueTypeName(TypeOf(written))) return "it names the type \"" + TypeOf(written) + "\"";
                    }
                    foreach (string path in PathAttributes)
                    {
                        string value = reader.GetAttribute(path);
                        if (value != null && ReachesOutside(value)) return reader.LocalName + " reads \"" + value + "\" from outside the report";
                    }
                }
            }
            return null;
        }
    }
}
