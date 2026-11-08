// emit-sql -- what does DevExpress 20.1 WRITE for a SQL Server data source?
//
// The SQL Server integration (2026-11-08, batch DA of the owner's database
// checklist) needs the exact serialized form of a SqlDataSource: its
// connection, its queries (a built SelectQuery, custom SQL, a stored
// procedure), the parameters bound to report parameters, a master-detail
// relation, a calculated field and the result schema the designer's Field
// List reads. DevExpress documents the objects, not the file, so this writes
// one and prints it, the way every other emit-* here settled its feature.
//
// The result schema is only written once DevExpress has read it from a real
// database, so this builds one: a made-up database, FormaSample, on the
// current user's LocalDB, created here and dropped at the end. It refuses any
// other server. The SQL Server instance on the machine this was written on
// holds a company's data and must never be touched, so the server name is a
// constant and there is no way to pass another.
//
// Pure ASCII, as every source here.
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using DevExpress.DataAccess;
using DevExpress.DataAccess.ConnectionParameters;
using DevExpress.DataAccess.Sql;
using DevExpress.XtraReports.UI;
using DevExpress.XtraReports.Parameters;

static class SqlProbe {
    // The only server this file ever opens. Not a parameter, on purpose.
    const string Server = @"(localdb)\MSSQLLocalDB";
    const string Database = "FormaSample";

    static string MasterConnection() {
        return "Data Source=" + Server + ";Initial Catalog=master;Integrated Security=True;Connect Timeout=60";
    }

    static void Exec(SqlConnection c, string sql) {
        using (SqlCommand cmd = new SqlCommand(sql, c)) { cmd.CommandTimeout = 120; cmd.ExecuteNonQuery(); }
    }

    static void DropDatabase(SqlConnection c) {
        Exec(c, "IF DB_ID(N'" + Database + "') IS NOT NULL BEGIN ALTER DATABASE [" + Database + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + Database + "]; END");
    }

    // Made-up rows only: three customers, three orders, five lines.
    static readonly string[] Schema = {
        "CREATE TABLE dbo.Customers (CustomerID int IDENTITY(1,1) PRIMARY KEY, CompanyName nvarchar(80) NOT NULL, City nvarchar(40) NULL, Region nvarchar(20) NULL)",
        "CREATE TABLE dbo.Orders (OrderID int PRIMARY KEY, CustomerID int NOT NULL REFERENCES dbo.Customers(CustomerID), OrderDate datetime NOT NULL, Freight decimal(10,2) NOT NULL)",
        "CREATE TABLE dbo.OrderLines (OrderID int NOT NULL REFERENCES dbo.Orders(OrderID), LineNumber int NOT NULL, Product nvarchar(60) NOT NULL, Qty int NOT NULL, UnitPrice decimal(10,2) NOT NULL, PRIMARY KEY (OrderID, LineNumber))",
        "INSERT dbo.Customers (CompanyName, City, Region) VALUES (N'Example Traders', N'Leeds', N'North'), (N'Sample Goods', N'Bristol', N'South'), (N'Demo Supplies', N'York', N'North')",
        "INSERT dbo.Orders VALUES (1001, 1, '2026-01-05', 12.50), (1002, 2, '2026-01-09', 8.00), (1003, 3, '2026-02-01', 20.25)",
        "INSERT dbo.OrderLines VALUES (1001, 1, N'Widget', 4, 3.25), (1001, 2, N'Gadget', 1, 19.99), (1002, 1, N'Widget', 10, 3.10), (1003, 1, N'Sprocket', 2, 7.50), (1003, 2, N'Gadget', 3, 18.75)",
        "CREATE PROCEDURE dbo.usp_SalesByRegion @Region nvarchar(20) = NULL, @From date = '2026-01-01', @To date AS " +
            "SELECT c.Region, SUM(l.Qty * l.UnitPrice) AS Total FROM dbo.Customers c JOIN dbo.Orders o ON o.CustomerID = c.CustomerID " +
            "JOIN dbo.OrderLines l ON l.OrderID = o.OrderID WHERE (@Region IS NULL OR c.Region = @Region) AND o.OrderDate BETWEEN @From AND @To GROUP BY c.Region",
        "CREATE PROCEDURE dbo.usp_TwoSets AS SELECT CustomerID, CompanyName FROM dbo.Customers; SELECT OrderID, Freight FROM dbo.Orders;",
        "CREATE PROCEDURE dbo.usp_WithOut @Region nvarchar(20), @Count int OUTPUT AS SELECT CompanyName FROM dbo.Customers WHERE Region = @Region; SET @Count = @@ROWCOUNT;",
        "CREATE PROCEDURE dbo.usp_TempTable AS CREATE TABLE #t (Name nvarchar(80)); INSERT #t SELECT CompanyName FROM dbo.Customers; SELECT Name FROM #t;",
        "CREATE PROCEDURE dbo.usp_Dynamic AS EXEC sp_executesql N'SELECT CompanyName FROM dbo.Customers';",
        "CREATE VIEW dbo.vOrderTotals AS SELECT o.OrderID, c.CompanyName, SUM(l.Qty * l.UnitPrice) AS Total FROM dbo.Orders o " +
            "JOIN dbo.Customers c ON c.CustomerID = o.CustomerID JOIN dbo.OrderLines l ON l.OrderID = o.OrderID GROUP BY o.OrderID, c.CompanyName",
        // One column of every common type, for the result schema's type names (batch DD).
        "CREATE TABLE dbo.Types (cInt int, cBigint bigint, cSmallint smallint, cTinyint tinyint, cBit bit, cDecimal decimal(12,4), cNumeric numeric(9,2), " +
            "cMoney money, cFloat float, cReal real, cDate date, cDateTime datetime, cDateTime2 datetime2, cSmallDateTime smalldatetime, cTime time, " +
            "cDto datetimeoffset, cChar char(3), cVarchar varchar(20), cNvarchar nvarchar(20), cNvarcharMax nvarchar(max), cText text, cXml xml, " +
            "cGuid uniqueidentifier, cBinary binary(4), cVarbinary varbinary(50), cImage image)",
        // One value of each, so sql-fill can show how DevExpress prints each type (batch DF).
        "INSERT dbo.Types (cInt, cBigint, cSmallint, cTinyint, cBit, cDecimal, cNumeric, cMoney, cFloat, cReal, cDate, cDateTime, cDateTime2, cSmallDateTime, cTime, cDto, cChar, cVarchar, cNvarchar, cGuid) " +
            "VALUES (12, 1234567890123, 7, 3, 1, 12.5, 12.5, 12.5, 12.5, 0.1, '2026-01-05', '2026-01-05 13:45:00', '2026-01-05 13:45:00.1234567', '2026-01-05 13:45', '13:45:30', '2026-01-05 13:45:00 +05:30', 'AB', '00123', N'Zoe', '6F9619FF-8B86-D011-B42D-00C04FC964FF')",
        "CREATE PROCEDURE dbo.usp_ByRegions @Regions nvarchar(400) AS SELECT CompanyName, Region FROM dbo.Customers WHERE Region IN (SELECT value FROM STRING_SPLIT(@Regions, ','))",
    };

    /// emit-sql-params <out.repx>: what 20.1 writes for the result schema's
    /// type names, report parameters (multi-value, nullable, hidden, a lookup
    /// list from a query, cascading), a multi-value parameter into a SelectQuery
    /// filter and into a stored procedure, a left outer join, distinct and a
    /// descending sort (2026-11-08, batch DD). Over FormaSample, then dropped.
    public static int EmitParams(string outPath) {
        try {
            CreateDatabase();
            SqlDataSource.DisableCustomQueryValidation = true;
            SqlDataSource ds = new SqlDataSource("FormaSample", LocalParameters());
            ds.Name = "sqlDataSource1";

            ds.Queries.Add(SelectQueryFluentBuilder.AddTable("Types").SelectAllColumns().Build("Types"));

            // The sort is put on the first table, before the join, and descending.
            SelectQuery orders = SelectQueryFluentBuilder
                .AddTable("Orders").SelectColumns("OrderID", "OrderDate", "Freight")
                .SortBy("OrderDate", System.ComponentModel.ListSortDirection.Descending)
                .Join("Customers", DevExpress.Xpo.DB.JoinType.LeftOuter, "CustomerID").SelectColumns("CompanyName", "Region")
                .Filter("[Customers.Region] In (?Regions)")
                .Distinct()
                .Build("Orders");
            orders.Parameters.Add(new QueryParameter("Regions", typeof(Expression), new Expression("?Regions", typeof(string[]))));
            ds.Queries.Add(orders);

            // A procedure taking the same multi-value parameter as one string.
            StoredProcQuery byRegions = new StoredProcQuery("ByRegions", "dbo.usp_ByRegions");
            byRegions.Parameters.Add(new QueryParameter("@Regions", typeof(Expression), new Expression("Join(?Regions, ',')", typeof(string))));
            ds.Queries.Add(byRegions);

            // The lookup list's query.
            ds.Queries.Add(SelectQueryFluentBuilder.AddTable("Customers").SelectColumns("Region", "City").Distinct().Build("RegionList"));

            ds.RebuildResultSchema();
            ds.Connection.StoreConnectionNameOnly = true;

            XtraReport report = new XtraReport { Name = "RepxProbeSqlParams" };
            report.ComponentStorage.Add(ds);
            report.DataSource = ds;
            report.DataMember = "Orders";

            Parameter regions = new Parameter { Name = "Regions", Description = "Regions", Type = typeof(string), MultiValue = true, Visible = true };
            regions.ValueSourceSettings = new DynamicListLookUpSettings { DataSource = ds, DataMember = "RegionList", ValueMember = "Region", DisplayMember = "Region" };
            Parameter city = new Parameter { Name = "City", Description = "City", Type = typeof(string), AllowNull = true };
            // Cascading: the cities offered are those of the regions chosen.
            city.ValueSourceSettings = new DynamicListLookUpSettings { DataSource = ds, DataMember = "RegionList", ValueMember = "City", DisplayMember = "City", FilterString = "[Region] In (?Regions)" };
            report.Parameters.AddRange(new Parameter[] {
                regions,
                city,
                new Parameter { Name = "MinFreight", Description = "Min freight", Type = typeof(decimal), Value = 10.5m },
                new Parameter { Name = "Since", Description = "Since", Type = typeof(DateTime), Value = new DateTime(2026, 1, 1) },
                new Parameter { Name = "Paid", Description = "Paid", Type = typeof(bool), Value = true },
                new Parameter { Name = "Count", Description = "Count", Type = typeof(int), Value = 5, Visible = false },
            });

            DetailBand detail = new DetailBand { Name = "Detail", HeightF = 25 };
            detail.Controls.Add(Label("labelCompany", "[CompanyName]", 0, 0));
            report.Bands.AddRange(new Band[] { new TopMarginBand(), detail, new BottomMarginBand() });

            report.SaveLayoutToXml(outPath);
            string xml = File.ReadAllText(outPath);
            Console.WriteLine("written: " + Path.GetFullPath(outPath));
            Console.WriteLine();
            Console.WriteLine(xml);
            PrintStorage(xml);
            return 0;
        } finally {
            DropDatabase();
            Console.WriteLine();
            Console.WriteLine("dropped " + Database + " on " + Server);
        }
    }

    /// sql-run <script.sql> <out.txt>: runs a script over a fresh FormaSample on
    /// LocalDB and writes the first column of the last row it returns, then
    /// drops the database. How Forma's schema and sample scripts were checked
    /// against a real engine (2026-11-08); the server is the constant above.
    /// sql-keep and sql-drop (batch DP, 2026-11-09): FormaSample created and left up, for the companion
    /// to be tested against, then dropped. Still made up, still created and dropped only by this probe.
    public static int Keep() { CreateDatabase(); Console.WriteLine("kept     : " + Database + " on " + Server); return 0; }
    public static int Drop() { DropDatabase(); Console.WriteLine("dropped " + Database + " on " + Server); return 0; }

    public static int Run(string[] args) {
        if (args.Length < 3) { Console.WriteLine("usage: RepxProbe sql-run <script.sql> <out.txt>"); return 2; }
        string script = File.ReadAllText(args[1]);
        try {
            CreateDatabase();
            string last = null;
            using (SqlConnection c = new SqlConnection("Data Source=" + Server + ";Initial Catalog=" + Database + ";Integrated Security=True;Connect Timeout=60")) {
                c.Open();
                using (SqlCommand cmd = new SqlCommand(script, c)) {
                    cmd.CommandTimeout = 120;
                    using (SqlDataReader r = cmd.ExecuteReader()) {
                        do { while (r.Read()) last = r.IsDBNull(0) ? null : Convert.ToString(r.GetValue(0)); } while (r.NextResult());
                    }
                }
            }
            File.WriteAllText(args[2], last ?? "", new UTF8Encoding(false));
            Console.WriteLine("written: " + Path.GetFullPath(args[2]) + " (" + (last ?? "").Length + " characters)");
            return last == null ? 1 : 0;
        } finally {
            DropDatabase();
            Console.WriteLine("dropped " + Database + " on " + Server);
        }
    }

    static void CreateDatabase() {
        using (SqlConnection c = new SqlConnection(MasterConnection())) {
            c.Open();
            DropDatabase(c);
            Exec(c, "CREATE DATABASE [" + Database + "]");
        }
        using (SqlConnection c = new SqlConnection("Data Source=" + Server + ";Initial Catalog=" + Database + ";Integrated Security=True;Connect Timeout=60")) {
            c.Open();
            foreach (string sql in Schema) Exec(c, sql);
        }
    }

    static void DropDatabase() {
        using (SqlConnection c = new SqlConnection(MasterConnection())) { c.Open(); DropDatabase(c); }
    }

    static MsSqlConnectionParameters LocalParameters() {
        return new MsSqlConnectionParameters(Server, Database, null, null, MsSqlAuthorizationType.Windows);
    }

    static QueryParameter Bound(string name, Type type, string reportParameter) {
        return new QueryParameter(name, typeof(Expression), new Expression("?" + reportParameter, type));
    }

    static XRLabel Label(string name, string expression, float x, float y) {
        XRLabel l = new XRLabel();
        l.Name = name;
        l.LocationF = new System.Drawing.PointF(x, y);
        l.SizeF = new System.Drawing.SizeF(200, 20);
        if (expression != null) l.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", expression));
        return l;
    }

    /// The base64 inside each ComponentStorage item, decoded.
    static void PrintStorage(string xml) {
        foreach (Match m in Regex.Matches(xml, "Base64=\"([^\"]+)\"")) {
            Console.WriteLine("---- decoded ComponentStorage Base64 ----");
            Console.WriteLine(Encoding.UTF8.GetString(Convert.FromBase64String(m.Groups[1].Value)));
        }
    }

    public static int Emit(string outPath) {
        try {
            CreateDatabase();
            SqlDataSource.DisableCustomQueryValidation = true;
            SqlDataSource ds = new SqlDataSource("FormaSample", LocalParameters());
            ds.Name = "sqlDataSource1";

            // A built query: two tables joined on the foreign key, a filter on a
            // report parameter, a sort and a Top.
            // The fluent builder carries the sort, the Top and the filter in 20.1;
            // SelectQuery.Sorting holds Sorting objects built from expressions.
            SelectQuery orders = SelectQueryFluentBuilder
                .AddTable("Orders").SelectColumns("OrderID", "OrderDate", "Freight")
                .Join("Customers", "CustomerID").SelectColumns("CompanyName", "City", "Region")
                .Filter("[Customers.Region] = ?Region")
                .SortBy("OrderDate")
                .Top(500)
                .Build("Orders");
            orders.Parameters.Add(Bound("Region", typeof(string), "Region"));
            ds.Queries.Add(orders);

            // The detail query, for the master-detail relation.
            SelectQuery lines = SelectQueryFluentBuilder.AddTable("OrderLines").SelectAllColumns().Build("OrderLines");
            ds.Queries.Add(lines);

            // Custom SQL with a parameter of its own (a static value).
            CustomSqlQuery top = new CustomSqlQuery("TopCustomers", "SELECT TOP (@n) CompanyName, City FROM dbo.Customers ORDER BY CompanyName");
            top.Parameters.Add(new QueryParameter("@n", typeof(int), 2));
            ds.Queries.Add(top);

            // A stored procedure: one parameter bound to a report parameter, one
            // static, one bound to a second report parameter.
            StoredProcQuery sales = new StoredProcQuery("SalesByRegion", "dbo.usp_SalesByRegion");
            sales.Parameters.Add(Bound("@Region", typeof(string), "Region"));
            sales.Parameters.Add(new QueryParameter("@From", typeof(DateTime), new DateTime(2026, 1, 1)));
            sales.Parameters.Add(Bound("@To", typeof(DateTime), "To"));
            ds.Queries.Add(sales);

            MasterDetailInfo relation = new MasterDetailInfo("Orders", "OrderLines", "OrderID", "OrderID");
            relation.Name = "OrderLinesOfOrder";
            ds.Relations.Add(relation);

            ds.RebuildResultSchema();
            ds.Connection.StoreConnectionNameOnly = true;

            XtraReport report = new XtraReport();
            report.Name = "RepxProbeSql";
            report.ReportUnit = ReportUnit.HundredthsOfAnInch;
            report.PageWidth = 850;
            report.PageHeight = 1100;
            report.ComponentStorage.Add(ds);
            report.DataSource = ds;
            report.DataMember = "Orders";

            report.Parameters.Add(new Parameter { Name = "Region", Type = typeof(string), Value = "North", Description = "Region" });
            report.Parameters.Add(new Parameter { Name = "To", Type = typeof(DateTime), Value = new DateTime(2026, 12, 31), Description = "To" });

            CalculatedField withTax = new CalculatedField(ds, "Orders");
            withTax.Name = "FreightWithTax";
            withTax.Expression = "[Freight] * 1.2";
            withTax.FieldType = FieldType.Decimal;
            report.CalculatedFields.Add(withTax);

            DetailBand detail = new DetailBand { Name = "Detail", HeightF = 25 };
            detail.Controls.AddRange(new XRControl[] {
                Label("labelCompany", "[CompanyName]", 0, 0),
                Label("labelDate", "[OrderDate]", 210, 0),
                Label("labelFreight", "[FreightWithTax]", 420, 0),
            });
            DetailReportBand linesBand = new DetailReportBand { Name = "DetailReport", DataSource = ds, DataMember = "Orders.OrderLinesOfOrder", Level = 0 };
            DetailBand lineDetail = new DetailBand { Name = "DetailLines", HeightF = 25 };
            lineDetail.Controls.Add(Label("labelProduct", "[Product]", 20, 0));
            linesBand.Bands.Add(lineDetail);
            ReportFooterBand footer = new ReportFooterBand { Name = "ReportFooter", HeightF = 25 };
            footer.Controls.Add(Label("labelTotal", "sumSum([Freight])", 420, 0));
            report.Bands.AddRange(new Band[] { new TopMarginBand(), detail, linesBand, footer, new BottomMarginBand() });

            report.SaveLayoutToXml(outPath);
            string xml = File.ReadAllText(outPath);
            Console.WriteLine("written: " + Path.GetFullPath(outPath));
            Console.WriteLine();
            Console.WriteLine(xml);
            PrintStorage(xml);

            Credentials();
            EdgeProcedures();
            return 0;
        } finally {
            DropDatabase();
            Console.WriteLine();
            Console.WriteLine("dropped " + Database + " on " + Server);
        }
    }

    /// The credentials question (checklist item 2): is a password written?
    /// Made-up values, never a real login; nothing connects with them.
    static void Credentials() {
        string fakeUser = "probe_user", fakePassword = "probe_secret_value";
        foreach (bool nameOnly in new[] { false, true }) {
            SqlDataSource ds = new SqlDataSource("WithLogin", new MsSqlConnectionParameters("example-server", "ExampleDb", fakeUser, fakePassword, MsSqlAuthorizationType.SqlServer));
            ds.Name = "sqlDataSourceLogin";
            ds.Queries.Add(new CustomSqlQuery("Q", "SELECT 1 AS One"));
            ds.Connection.StoreConnectionNameOnly = nameOnly;
            XtraReport r = new XtraReport { Name = "Creds" };
            r.ComponentStorage.Add(ds);
            r.DataSource = ds;
            string path = Path.Combine(Path.GetTempPath(), "repxprobe-creds.repx");
            r.SaveLayoutToXml(path);
            string xml = File.ReadAllText(path);
            string decoded = string.Join("\n", Regex.Matches(xml, "Base64=\"([^\"]+)\"").Cast<Match>().Select(m => Encoding.UTF8.GetString(Convert.FromBase64String(m.Groups[1].Value))));
            Console.WriteLine();
            Console.WriteLine("---- credentials, StoreConnectionNameOnly=" + nameOnly + " ----");
            Console.WriteLine("password in the file: " + (xml.Contains(fakePassword) || decoded.Contains(fakePassword)));
            Console.WriteLine("user in the file:     " + (xml.Contains(fakeUser) || decoded.Contains(fakeUser)));
            Console.WriteLine(decoded);
            File.Delete(path);
        }
    }

    /// sql-fill <in.repx> [Param=a,b ...]: loads a report Forma wrote, points its
    /// SqlDataSource at FormaSample on LocalDB (the connection name resolves
    /// nowhere here, so its parameters are set in code, never stored), runs
    /// CreateDocument, and prints what each query returned and the pages: the
    /// end-to-end check of the writer (2026-11-08, batch DD). Report parameters
    /// can be given values; a comma makes a multi-value one an array.
    public static int Fill(string[] args) {
        string path = args[1];
        // Printed as the parity measurements were, in en-US (Render.cs).
        System.Threading.Thread.CurrentThread.CurrentCulture = System.Globalization.CultureInfo.GetCultureInfo("en-US");
        try {
            CreateDatabase();
            // --before <script.sql>: the made-up database changed first, as a newer layout of it would be
            // (batch DG, 2026-11-09): a column renamed, a type altered. Each GO-separated batch runs on its own.
            for (int i = 2; i + 1 < args.Length; i++) {
                if (args[i] != "--before") continue;
                using (SqlConnection c = new SqlConnection("Data Source=" + Server + ";Initial Catalog=" + Database + ";Integrated Security=True;Connect Timeout=60")) {
                    c.Open();
                    foreach (string batch in System.Text.RegularExpressions.Regex.Split(File.ReadAllText(args[i + 1]), @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline | System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                        if (batch.Trim().Length > 0) Exec(c, batch);
                }
                Console.WriteLine("changed  : " + args[i + 1]);
            }
            XtraReport report = new XtraReport();
            report.LoadLayoutFromXml(path);
            int problems = Inspect(report);
            for (int i = 2; i < args.Length; i++) {
                if (args[i] == "--before") { i++; continue; }
                if (args[i] == "--event" || args[i] == "--name-only") continue;
                int eq = args[i].IndexOf('=');
                if (eq < 0) continue;
                Parameter p = report.Parameters[args[i].Substring(0, eq)];
                if (p == null) { Console.WriteLine("no parameter " + args[i].Substring(0, eq)); continue; }
                string value = args[i].Substring(eq + 1);
                p.Value = p.MultiValue ? (object)value.Split(',') : Convert.ChangeType(value, p.Type, System.Globalization.CultureInfo.InvariantCulture);
            }
            var sources = new List<SqlDataSource>();
            foreach (object o in report.ComponentStorage) if (o is SqlDataSource) sources.Add((SqlDataSource)o);
            // --event (batch DP, 2026-11-09): the connection supplied when DevExpress asks for it, by name,
            // as the companion does, rather than set on the source, which the layout would then save.
            // Measured: --event alone fails for a connection stored by name, before the event is raised
            // ("Cannot find the following connection in the config file"). --name-only sets the connection
            // and marks it StoreConnectionNameOnly, which is what the companion's designer needs.
            bool byEvent = Array.IndexOf(args, "--event") >= 0;
            bool nameOnly = Array.IndexOf(args, "--name-only") >= 0;
            int asked = 0;
            foreach (SqlDataSource ds in sources) {
                if (byEvent) ds.ConfigureDataConnection += (s, e) => { asked++; Console.WriteLine("asked    : connection \"" + e.ConnectionName + "\""); e.ConnectionParameters = LocalParameters(); };
                else ds.ConnectionParameters = LocalParameters();
                if (nameOnly) ds.Connection.StoreConnectionNameOnly = true;
            }
            byEvent = byEvent || nameOnly;
            // Every query, lookups included, which CreateDocument fills only when asked for.
            foreach (SqlDataSource ds in sources) ds.Fill(report.Parameters.Cast<DevExpress.Data.IParameter>());
            report.RequestParameters = false;
            report.CreateDocument();
            foreach (SqlDataSource ds in sources) {
                Console.WriteLine("filled   : " + ds.Name + " on \"" + ds.ConnectionName + "\"");
                foreach (SqlQuery q in ds.Queries) {
                    var table = ds.Result[q.Name];
                    Console.WriteLine("             " + q.Name + ": " + (table == null ? "no result" : table.Count() + " row(s), columns " + string.Join(", ", table.Columns.Select(c => c.Name + ":" + c.Type.Name))));
                }
            }
            Console.WriteLine("printed  : " + report.Pages.Count + " page(s)");
            if (byEvent) {
                // What the layout saves after a fill by event: the connection must still be a name.
                using (var saved = new MemoryStream()) {
                    report.SaveLayoutToXml(saved);
                    string xml = Encoding.UTF8.GetString(saved.ToArray());
                    var decoded = Regex.Matches(xml, "Base64=\"([^\"]+)\"").Cast<Match>().Select(m => Encoding.UTF8.GetString(Convert.FromBase64String(m.Groups[1].Value))).Where(s => s.Contains("<SqlDataSource")).ToList();
                    Console.WriteLine("saved    : asked " + asked + " time(s); connection as saved: " + string.Join(" | ", decoded.Select(s => Regex.Match(s, "<Connection[^>]*>").Value)));
                    Console.WriteLine("saved    : server or credential in the saved file: " + decoded.Any(s => s.IndexOf("localdb", StringComparison.OrdinalIgnoreCase) >= 0 || s.IndexOf("password", StringComparison.OrdinalIgnoreCase) >= 0 || s.IndexOf("Data Source", StringComparison.OrdinalIgnoreCase) >= 0));
                }
            }
            // What printed, as DevExpress's own text export lays it out (2026-11-09):
            // a group's header and its total are only proved by reading them here.
            using (var ms = new System.IO.MemoryStream()) {
                report.ExportToText(ms, new DevExpress.XtraPrinting.TextExportOptions { Separator = " | ", Encoding = System.Text.Encoding.UTF8 });
                string text = System.Text.Encoding.UTF8.GetString(ms.ToArray());
                var lines = text.Split('\n').Select(l => l.TrimEnd('\r').Trim()).Where(l => l.Trim('|', ' ').Length > 0).Take(60).ToList();
                Console.WriteLine("text     : " + lines.Count + " line(s)");
                foreach (string line in lines) Console.WriteLine("             " + line);
            }
            return problems > 0 ? 1 : 0;
        } finally {
            DropDatabase();
            Console.WriteLine("dropped " + Database + " on " + Server);
        }
    }

    // ------------------------------------------------------------ inspect

    // A nested band is skipped: a DetailReportBand lists its own bands among its
    // controls, and those are walked on their own, under their own data member.
    static IEnumerable<XRControl> AllControls(XRControlCollection controls) {
        foreach (XRControl c in controls) {
            if (c is Band) continue;
            yield return c;
            foreach (XRControl inner in AllControls(c.Controls)) yield return inner;
        }
    }

    static void WalkBands(Band band, string member, List<Tuple<Band, string>> into) {
        into.Add(Tuple.Create(band, member));
        DetailReportBand detail = band as DetailReportBand;
        if (detail != null) {
            string inner = string.IsNullOrEmpty(detail.DataMember) ? member : detail.DataMember;
            foreach (Band b in detail.Bands) WalkBands(b, inner, into);
        }
        foreach (SubBand sub in band.SubBands) into.Add(Tuple.Create((Band)sub, member));
    }

    /// The data sources a loaded report carries, and every binding checked
    /// against the fields of its band's query (checklist item 3). Returns the
    /// number of problems: a stored login or password, or a binding to a field
    /// the result schema does not have. A report with no result schema is only
    /// reported, since the designer reads one by connecting.
    public static int Inspect(XtraReport r) {
        var sources = new List<SqlDataSource>();
        foreach (object o in r.ComponentStorage) if (o is SqlDataSource && !sources.Contains((SqlDataSource)o)) sources.Add((SqlDataSource)o);
        if (r.DataSource is SqlDataSource && !sources.Contains((SqlDataSource)r.DataSource)) sources.Add((SqlDataSource)r.DataSource);
        if (sources.Count == 0) return 0;

        int problems = 0;
        // view name -> fields, and relation name -> (master, detail), from every source's result schema.
        var views = new Dictionary<string, HashSet<string>>();
        var relations = new Dictionary<string, string>();
        bool anySchema = false;
        foreach (SqlDataSource ds in sources) {
            string saved = ds.SaveToXml().ToString();
            Match conn = Regex.Match(saved, "<Connection [^>]*?(/>|>[\\s\\S]*?</Connection>)");
            bool fromConfig = conn.Value.Contains("FromAppConfig=\"true\"");
            bool password = Regex.IsMatch(conn.Value, "Name=\"password\"", RegexOptions.IgnoreCase);
            bool userId = Regex.IsMatch(conn.Value, "Name=\"userid\"", RegexOptions.IgnoreCase);
            Console.WriteLine("sql      : " + ds.Name + " on connection \"" + ds.ConnectionName + "\""
                              + (fromConfig ? " (name only, from the application's config)" : " (parameters stored in the report)"));
            if (password || userId) {
                problems++;
                Console.WriteLine("           CREDENTIALS STORED: the report carries a " + (password ? "password" : "login") + "; write the connection by name only.");
            }
            foreach (SqlQuery q in ds.Queries) {
                var ps = new List<string>();
                foreach (QueryParameter p in q.Parameters) ps.Add(p.Name + "=" + (p.Value is Expression ? ((Expression)p.Value).ExpressionString : Convert.ToString(p.Value)));
                Console.WriteLine("             " + q.GetType().Name + " \"" + q.Name + "\"" + (ps.Count > 0 ? "  (" + string.Join(", ", ps) + ")" : ""));
            }
            foreach (MasterDetailInfo rel in ds.Relations)
                Console.WriteLine("             relation \"" + rel.Name + "\": " + rel.MasterQueryName + " -> " + rel.DetailQueryName);
            Match schema = Regex.Match(saved, "<ResultSchema>[\\s\\S]*?</ResultSchema>");
            if (!schema.Success) {
                Console.WriteLine("           no result schema: the designer's Field List stays empty until it connects.");
                continue;
            }
            anySchema = true;
            foreach (Match v in Regex.Matches(schema.Value, "<View Name=\"([^\"]+)\">([\\s\\S]*?)</View>")) {
                var fields = new HashSet<string>(Regex.Matches(v.Groups[2].Value, "<Field Name=\"([^\"]+)\"").Cast<Match>().Select(m => m.Groups[1].Value));
                views[v.Groups[1].Value] = fields;
                Console.WriteLine("             view " + v.Groups[1].Value + ": " + string.Join(", ", fields));
            }
            foreach (Match rel in Regex.Matches(schema.Value, "<Relation Name=\"([^\"]+)\" Master=\"([^\"]+)\" Detail=\"([^\"]+)\""))
                relations[rel.Groups[1].Value] = rel.Groups[3].Value;
        }
        if (!anySchema) return problems;

        var calculated = new Dictionary<string, string>();
        foreach (CalculatedField cf in r.CalculatedFields) calculated[cf.Name] = cf.DataMember ?? "";

        var bands = new List<Tuple<Band, string>>();
        foreach (Band b in r.Bands) WalkBands(b, r.DataMember ?? "", bands);
        int checkedCount = 0;
        foreach (var pair in bands) {
            // "Orders.OrderLinesOfOrder" is the detail view of that relation.
            string view = null;
            string[] path = pair.Item2.Split('.');
            if (path.Length > 0 && views.ContainsKey(path[0])) {
                view = path[0];
                for (int i = 1; i < path.Length && view != null; i++) view = relations.ContainsKey(path[i]) ? relations[path[i]] : null;
            }
            foreach (XRControl c in AllControls(pair.Item1.Controls))
                foreach (ExpressionBinding eb in c.ExpressionBindings)
                    foreach (Match m in Regex.Matches(eb.Expression ?? "", "\\[([^\\[\\]]+)\\]")) {
                        string field = m.Groups[1].Value;
                        if (field.StartsWith("Parameters.") || field.StartsWith("DataSource.") || field.StartsWith("ReportItems")) continue;
                        checkedCount++;
                        bool known = view != null && views[view].Contains(field);
                        if (!known && calculated.ContainsKey(field)) known = true;
                        if (!known) {
                            problems++;
                            Console.WriteLine("           UNKNOWN FIELD: " + pair.Item1.Name + "." + c.Name + " binds [" + field + "], which "
                                              + (view == null ? "has no query (data member \"" + pair.Item2 + "\")" : "view " + view + " does not have") + ".");
                        }
                    }
        }
        Console.WriteLine("           " + checkedCount + " field reference(s) checked against the result schema.");
        return problems;
    }

    /// Procedures DevExpress may not describe: two result sets, an OUTPUT
    /// parameter, a temp table, dynamic SQL (checklist item 4).
    static void EdgeProcedures() {
        var cases = new List<Tuple<string, QueryParameter[]>> {
            Tuple.Create("dbo.usp_TwoSets", new QueryParameter[0]),
            Tuple.Create("dbo.usp_WithOut", new[] { new QueryParameter("@Region", typeof(string), "North") }),
            Tuple.Create("dbo.usp_WithOut", new[] { new QueryParameter("@Region", typeof(string), "North"), new QueryParameter("@Count", typeof(int), 0) }),
            Tuple.Create("dbo.usp_TempTable", new QueryParameter[0]),
            Tuple.Create("dbo.usp_Dynamic", new QueryParameter[0]),
        };
        foreach (var c in cases) {
            SqlDataSource ds = new SqlDataSource("FormaSample", LocalParameters());
            StoredProcQuery q = new StoredProcQuery("Q", c.Item1);
            foreach (QueryParameter p in c.Item2) q.Parameters.Add(p);
            ds.Queries.Add(q);
            Console.WriteLine();
            Console.WriteLine("---- " + c.Item1 + " with " + c.Item2.Length + " parameter(s) ----");
            try {
                ds.RebuildResultSchema();
                string saved = ds.SaveToXml().ToString();
                Match schema = Regex.Match(saved, "<ResultSchema>[\\s\\S]*?</ResultSchema>");
                Console.WriteLine(schema.Success ? schema.Value : "(no ResultSchema written)");
            } catch (Exception ex) {
                Console.WriteLine("RebuildResultSchema FAILED: " + ex.GetType().Name + ": " + ex.Message);
            }
        }
    }
}
