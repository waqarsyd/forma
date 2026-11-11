// Forma's SQL Server companion (2026-11-09, the SQL Server programme, Phase 2,
// checklist items 35 to 38). Pure ASCII, as everything under tools/ is.
//
// The owner's rule (2026-11-08): a database credential is held on the user's
// own PC and nowhere else. So this side keeps the connections, the browser
// only ever names one, and nothing here accepts SQL from the browser:
//
//   - The connections live in %LOCALAPPDATA%\Forma\connections.tsv, entered
//     at this program (its tray menu, or --sql-add for Windows authentication),
//     never sent by a page. A SQL login's name and password are encrypted with
//     DPAPI for the current Windows user; Windows authentication stores none.
//   - /sql/schema runs SqlScripts.Schema, Forma's own read-only layout script,
//     the same text a person runs in SSMS (scripts/companion-scripts.ts writes
//     it, and src/lib/sqlCompanion.test.ts holds the two together).
//   - /sql/sample builds its own SELECT TOP (n) per table or view, each name
//     checked against the catalog and quoted by SQL Server.
//   - /sql/fill fills a report's own data source as DevExpress does, with the
//     connection the report names. A stored procedure runs only when the page
//     says the person pressed the button that asks for it (procedures=1), and
//     custom SQL must be one SELECT. Measured: DevExpress filled Forma's
//     reports over FormaSample with the connection set this way.
//   - The designer gets the connection set and marked StoreConnectionNameOnly,
//     so the designer's own preview works and saving still writes only the
//     name (measured 2026-11-09, RepxProbe sql-fill --name-only: filled, and
//     the saved layout read <Connection Name="FormaSample" FromAppConfig="true" />).
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DevExpress.DataAccess.ConnectionParameters;
using DevExpress.DataAccess.Sql;
using DevExpress.DataAccess.Sql.DataApi;
using DevExpress.XtraReports.Parameters;
using DevExpress.XtraReports.UI;

namespace RepxDesigner
{
    internal sealed class StoredConnection
    {
        public string Name;
        /// <summary>"windows" or "login".</summary>
        public string Mode;
        public string Server;
        public string Database;
        /// <summary>For a login: DPAPI(login + NUL + password), base64. Empty for Windows authentication.</summary>
        public string Secret = "";
    }

    internal static class SqlCompanion
    {
        /// <summary>Where the connections are kept; --store moves it, for a test that must not touch the profile.</summary>
        public static string StorePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Forma", "connections.tsv");

        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Forma.RepxDesigner.connections");

        /// <summary>Rows a fill returns per query at most: enough to preview, not a dump of the table.</summary>
        public const int MaxRows = 500;

        // ------------------------------------------------------------ the store

        public static List<StoredConnection> Load()
        {
            var list = new List<StoredConnection>();
            if (!File.Exists(StorePath)) return list;
            foreach (string line in File.ReadAllLines(StorePath, Encoding.UTF8))
            {
                string[] f = line.Split('\t');
                if (f.Length < 4 || string.IsNullOrEmpty(f[0])) continue;
                list.Add(new StoredConnection { Name = f[0], Mode = f[1], Server = f[2], Database = f[3], Secret = f.Length > 4 ? f[4] : "" });
            }
            return list;
        }

        public static void Save(List<StoredConnection> list)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StorePath));
            File.WriteAllLines(StorePath, list.Select(c => string.Join("\t", Clean(c.Name), c.Mode, Clean(c.Server), Clean(c.Database), c.Secret)), new UTF8Encoding(false));
        }

        private static string Clean(string s) { return (s ?? "").Replace("\t", " ").Replace("\r", "").Replace("\n", ""); }

        public static StoredConnection Find(string name)
        {
            return Load().FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>A connection's name as a report names it: letters, digits and _ . - only, so it can never be a connection string.</summary>
        public static bool IsName(string name)
        {
            return !string.IsNullOrEmpty(name) && Regex.IsMatch(name, @"^[A-Za-z0-9_.\-]{1,128}$");
        }

        public static void Put(StoredConnection c)
        {
            var list = Load().Where(x => !string.Equals(x.Name, c.Name, StringComparison.OrdinalIgnoreCase)).ToList();
            list.Add(c);
            Save(list);
        }

        public static bool Remove(string name)
        {
            var list = Load();
            int before = list.Count;
            list = list.Where(x => !string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();
            Save(list);
            return list.Count < before;
        }

        public static string Protect(string login, string password)
        {
            byte[] plain = Encoding.UTF8.GetBytes(login + "\0" + password);
            return Convert.ToBase64String(ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser));
        }

        private static void Unprotect(string secret, out string login, out string password)
        {
            string plain = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(secret), Entropy, DataProtectionScope.CurrentUser));
            int nul = plain.IndexOf('\0');
            login = nul < 0 ? plain : plain.Substring(0, nul);
            password = nul < 0 ? "" : plain.Substring(nul + 1);
        }

        /// <summary>For ADO.NET (the layout and the samples), never written anywhere.</summary>
        public static string ConnectionString(StoredConnection c)
        {
            var b = new SqlConnectionStringBuilder { DataSource = c.Server, InitialCatalog = c.Database, ConnectTimeout = 15, ApplicationName = "Forma companion" };
            if (c.Mode == "login")
            {
                string login, password;
                Unprotect(c.Secret, out login, out password);
                b.UserID = login;
                b.Password = password;
            }
            else
            {
                b.IntegratedSecurity = true;
            }
            return b.ConnectionString;
        }

        /// <summary>For DevExpress (a fill, the designer).</summary>
        public static DataConnectionParametersBase Parameters(StoredConnection c)
        {
            if (c.Mode == "login")
            {
                string login, password;
                Unprotect(c.Secret, out login, out password);
                return new MsSqlConnectionParameters(c.Server, c.Database, login, password, MsSqlAuthorizationType.SqlServer);
            }
            return new MsSqlConnectionParameters(c.Server, c.Database, null, null, MsSqlAuthorizationType.Windows);
        }

        // ------------------------------------------------------------ endpoints

        /// <summary>GET /sql/connections: names, how each signs in, and its database. Never a server's secret.</summary>
        public static string Connections()
        {
            return "{\"connections\":[" + string.Join(",", Load().Select(c =>
                "{\"name\":" + Json(c.Name) + ",\"mode\":" + Json(c.Mode) + ",\"database\":" + Json(c.Database) + "}")) + "]}";
        }

        /// <summary>GET /sql/schema?connection=NAME: Forma's layout script's one value, as SSMS would show it.</summary>
        public static string Schema(StoredConnection c)
        {
            string last = null;
            using (var conn = new SqlConnection(ConnectionString(c)))
            {
                conn.Open();
                using (var cmd = new SqlCommand(SqlScripts.Schema, conn) { CommandTimeout = 120 })
                using (var r = cmd.ExecuteReader())
                {
                    do { while (r.Read()) last = r.IsDBNull(0) ? null : Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture); } while (r.NextResult());
                }
            }
            return last ?? "";
        }

        /// <summary>
        /// GET /sql/sample?connection=NAME&amp;objects=dbo.A,dbo.B&amp;rows=N: the sample script's
        /// own format, built here. Each object must be a table or view the
        /// catalog has; its name is quoted by QUOTENAME; N is 1 to 50.
        /// </summary>
        public static string Samples(StoredConnection c, IEnumerable<string> objects, int rows)
        {
            rows = Math.Max(1, Math.Min(50, rows));
            var parts = new List<string>();
            string database;
            using (var conn = new SqlConnection(ConnectionString(c)))
            {
                conn.Open();
                using (var cmd = new SqlCommand("SELECT DB_NAME()", conn)) database = Convert.ToString(cmd.ExecuteScalar());
                foreach (string obj in objects.Take(20))
                {
                    string[] names = obj.Split('.');
                    string schema = names.Length > 1 ? names[names.Length - 2] : "dbo";
                    string name = names[names.Length - 1];
                    const string sql =
                        "IF EXISTS (SELECT 1 FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = @s AND o.name = @n AND o.type IN ('U','V')) " +
                        "BEGIN DECLARE @q nvarchar(max) = N'SELECT TOP (' + CONVERT(nvarchar(10), @rows) + N') * FROM ' + QUOTENAME(@s) + N'.' + QUOTENAME(@n) + N' FOR JSON PATH, INCLUDE_NULL_VALUES'; EXEC sp_executesql @q; END";
                    var json = new StringBuilder();
                    bool found = false;
                    using (var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 })
                    {
                        cmd.Parameters.AddWithValue("@s", schema);
                        cmd.Parameters.AddWithValue("@n", name);
                        cmd.Parameters.AddWithValue("@rows", rows);
                        using (var r = cmd.ExecuteReader())
                        {
                            // No result set at all: the catalog has no such table or view, so it is left out.
                            found = r.FieldCount > 0;
                            // FOR JSON comes back in pieces across rows; they join into one array.
                            while (r.Read()) if (!r.IsDBNull(0)) json.Append(r.GetString(0));
                        }
                    }
                    if (found) parts.Add("{\"object\":" + Json(schema + "." + name) + ",\"rows\":" + (json.Length > 0 ? json.ToString() : "[]") + "}");
                }
            }
            string body = "{\"format\":\"forma-sql-sample\",\"version\":1,\"database\":" + Json(database) + ",\"samples\":[" + string.Join(",", parts) + "]}";
            return "<?forma " + body.Replace("?>", "?\\u003e") + "?>";
        }

        // OPENQUERY, KILL, WAITFOR, WRITETEXT, UPDATETEXT and RECONFIGURE joined the list on
        // 2026-11-11 (the full audit, SE-12): OPENQUERY passes text to a linked server,
        // which can write, and the others act on the server rather than read from it.
        private static readonly Regex Writes = new Regex(@"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|DENY|REVOKE|BACKUP|RESTORE|SHUTDOWN|DBCC|OPENROWSET|OPENDATASOURCE|OPENQUERY|KILL|WAITFOR|WRITETEXT|UPDATETEXT|RECONFIGURE|xp_\w+|sp_\w+)\b|\bINTO\b", RegexOptions.IgnoreCase);

        /// <summary>
        /// Is this custom SQL one SELECT (or WITH ... SELECT) and nothing else?
        ///
        /// Since 2026-11-11 (SE-12) the text is read left to right first, with string
        /// literals emptied, comments dropped and bracketed or quoted names replaced, so
        /// that a quote inside a comment cannot hide a statement from the check (the
        /// literal-stripping regex before it could be walked past that way), and a
        /// second statement is refused: a semicolon is allowed only at the very end.
        /// A parser (ScriptDom) would be exact, but it would be a second DLL in a
        /// download that is one exe; and wrapping the query in a transaction does not
        /// help, because DevExpress opens its own connection to run it.
        /// </summary>
        public static bool IsOneSelect(string sql)
        {
            string plain = Plain(sql ?? "").Trim();
            if (plain.EndsWith(";")) plain = plain.Substring(0, plain.Length - 1).TrimEnd();
            if (plain.IndexOf(';') >= 0) return false;
            return Regex.IsMatch(plain, @"^(\(\s*)*(SELECT|WITH)\b", RegexOptions.IgnoreCase) && !Writes.IsMatch(plain);
        }

        /// <summary>The SQL with '' for each literal, a space for each comment and [x] for each quoted name.</summary>
        private static string Plain(string sql)
        {
            var b = new StringBuilder(sql.Length);
            int i = 0;
            while (i < sql.Length)
            {
                char c = sql[i];
                char next = i + 1 < sql.Length ? sql[i + 1] : '\0';
                if (c == '-' && next == '-')
                {
                    while (i < sql.Length && sql[i] != '\n') i++;
                    b.Append(' ');
                }
                else if (c == '/' && next == '*')
                {
                    // T-SQL block comments nest.
                    int depth = 0;
                    while (i < sql.Length)
                    {
                        if (sql[i] == '/' && i + 1 < sql.Length && sql[i + 1] == '*') { depth++; i += 2; }
                        else if (sql[i] == '*' && i + 1 < sql.Length && sql[i + 1] == '/') { depth--; i += 2; if (depth == 0) break; }
                        else i++;
                    }
                    b.Append(' ');
                }
                else if (c == '\'' || ((c == 'N' || c == 'n') && next == '\'' && (i == 0 || !(char.IsLetterOrDigit(sql[i - 1]) || sql[i - 1] == '_'))))
                {
                    i += c == '\'' ? 1 : 2;
                    while (i < sql.Length)
                    {
                        if (sql[i] == '\'' && i + 1 < sql.Length && sql[i + 1] == '\'') i += 2;
                        else if (sql[i] == '\'') { i++; break; }
                        else i++;
                    }
                    b.Append("''");
                }
                else if (c == '[' || c == '"')
                {
                    char close = c == '[' ? ']' : '"';
                    i++;
                    while (i < sql.Length)
                    {
                        if (sql[i] == close && i + 1 < sql.Length && sql[i + 1] == close) i += 2;
                        else if (sql[i] == close) { i++; break; }
                        else i++;
                    }
                    b.Append("[x]");
                }
                else
                {
                    b.Append(c);
                    i++;
                }
            }
            return b.ToString();
        }

        /// <summary>
        /// A data source that could change data when it runs: a stored procedure (which
        /// may write whatever its name says) or custom SQL that is not one SELECT.
        /// </summary>
        private static bool CouldWrite(SqlDataSource ds)
        {
            return ds.Queries.OfType<StoredProcQuery>().Any() || ds.Queries.OfType<CustomSqlQuery>().Any(q => !IsOneSelect(q.Sql));
        }

        /// <summary>
        /// The report's data sources set to the connections they name, or the names this
        /// PC does not have. With <paramref name="fromPage"/>, a source that could write
        /// is left unconnected and named in <paramref name="held"/>.
        /// </summary>
        private static List<string> Connect(XtraReport report, bool fromPage, out List<SqlDataSource> sources, out List<string> held)
        {
            sources = report.ComponentStorage.OfType<SqlDataSource>().ToList();
            var missing = new List<string>();
            held = new List<string>();
            foreach (SqlDataSource ds in sources)
            {
                StoredConnection c = IsName(ds.ConnectionName) ? Find(ds.ConnectionName) : null;
                if (c == null) { missing.Add(ds.ConnectionName ?? ""); continue; }
                if (fromPage && CouldWrite(ds)) { held.Add(ds.ConnectionName); continue; }
                ds.ConnectionParameters = Parameters(c);
                ds.Connection.StoreConnectionNameOnly = true;
            }
            return missing;
        }

        /// <summary>
        /// POST /sql/fill?procedures=0|1&amp;p.NAME=value: the report's own data
        /// source filled as DevExpress fills it, each query's first rows.
        /// </summary>
        public static string Fill(string repx, IDictionary<string, string> values, bool procedures, out int status)
        {
            var report = new XtraReport();
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(repx))) report.LoadLayoutFromXml(ms);
            List<SqlDataSource> sources;
            List<string> held;
            List<string> missing = Connect(report, false, out sources, out held);
            if (sources.Count == 0) { status = 400; return "{\"error\":\"the report has no SQL data source\"}"; }
            if (missing.Count > 0) { status = 404; return "{\"missing\":[" + string.Join(",", missing.Select(Json)) + "]}"; }
            var procs = sources.SelectMany(ds => ds.Queries.OfType<StoredProcQuery>()).Select(q => q.Name).ToList();
            if (procs.Count > 0 && !procedures) { status = 409; return "{\"procedures\":[" + string.Join(",", procs.Select(Json)) + "]}"; }
            foreach (var q in sources.SelectMany(ds => ds.Queries.OfType<CustomSqlQuery>()))
            {
                if (!IsOneSelect(q.Sql))
                {
                    status = 400;
                    return "{\"error\":" + Json("the custom SQL of " + q.Name + " is not one SELECT") + "}";
                }
            }
            // At most MaxRows from SQL Server itself (2026-11-11, the full audit, SD-14a):
            // until then the whole table was read and the first MaxRows kept, so Live rows
            // on a large table ran for minutes and held every row in memory. A query that
            // asks for fewer keeps its own Top. Custom SQL and procedures are the report's
            // own text, and the Take below still bounds what is sent.
            foreach (SelectQuery q in sources.SelectMany(ds => ds.Queries.OfType<SelectQuery>()))
            {
                if (q.Top == 0 || q.Top > MaxRows) q.Top = MaxRows;
            }
            foreach (KeyValuePair<string, string> v in values)
            {
                Parameter p = report.Parameters[v.Key];
                if (p == null) continue;
                p.Value = p.MultiValue ? (object)v.Value.Split(',').Select(x => Convert.ChangeType(x.Trim(), p.Type, CultureInfo.InvariantCulture)).ToArray()
                    : Convert.ChangeType(v.Value, p.Type, CultureInfo.InvariantCulture);
            }
            var queries = new List<string>();
            foreach (SqlDataSource ds in sources)
            {
                ds.Fill(report.Parameters.Cast<DevExpress.Data.IParameter>());
                foreach (SqlQuery q in ds.Queries)
                {
                    ITable table = ds.Result[q.Name];
                    if (table == null) continue;
                    var columns = table.Columns.ToList();
                    var rows = new List<string>();
                    foreach (IRow row in table.Take(MaxRows))
                    {
                        rows.Add("[" + string.Join(",", columns.Select(col => Value(row[col.Name]))) + "]");
                    }
                    queries.Add("{\"name\":" + Json(q.Name) + ",\"columns\":[" + string.Join(",", columns.Select(col => "{\"name\":" + Json(col.Name) + ",\"type\":" + Json(col.Type.Name) + "}")) + "],\"rows\":[" + string.Join(",", rows) + "]}");
                }
            }
            status = 200;
            return "{\"queries\":[" + string.Join(",", queries) + "]}";
        }

        /// <summary>
        /// Item 38: the designer reads the connections this PC has, and saves only their
        /// names. Returns how many were connected; <paramref name="held"/> names those
        /// left unconnected.
        ///
        /// A report a page sent (fromPage, POST /open) is not connected where it could
        /// change data (2026-11-11, the full audit, SD-15 and SE-07): /sql/fill runs a
        /// procedure only when the person asked for it and custom SQL only when it is
        /// one SELECT, but the designer's own Preview runs whatever the data source
        /// holds, so a shared report naming a connection this PC keeps and a purge
        /// procedure would run it with this user's credentials on a Preview. A file the
        /// person opens from Windows is connected as before.
        /// </summary>
        public static int PrepareForDesigner(XtraReport report, bool fromPage, out List<string> held)
        {
            List<SqlDataSource> sources;
            List<string> missing = Connect(report, fromPage, out sources, out held);
            return sources.Count - missing.Count - held.Count;
        }

        // ------------------------------------------------------------ JSON

        public static string Json(string s)
        {
            if (s == null) return "null";
            var b = new StringBuilder("\"");
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '"': b.Append("\\\""); break;
                    case '\\': b.Append("\\\\"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default:
                        if (ch < 32 || ch > 126) b.Append("\\u").Append(((int)ch).ToString("x4"));
                        else b.Append(ch);
                        break;
                }
            }
            return b.Append('"').ToString();
        }

        /// <summary>A value as the Preview reads it: a decimal keeps its scale, a date is ISO, a Guid lower case.</summary>
        private static string Value(object v)
        {
            if (v == null || v is DBNull) return "null";
            if (v is bool) return (bool)v ? "true" : "false";
            if (v is DateTime) return Json(((DateTime)v).ToString("yyyy-MM-ddTHH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture));
            if (v is DateTimeOffset) return Json(((DateTimeOffset)v).ToString("yyyy-MM-ddTHH:mm:ss.FFFFFFFzzz", CultureInfo.InvariantCulture));
            if (v is Guid) return Json(((Guid)v).ToString("D"));
            if (v is TimeSpan) return Json(((TimeSpan)v).ToString("c", CultureInfo.InvariantCulture));
            if (v is byte[]) return "null";
            if (v is IFormattable) return Json(((IFormattable)v).ToString(null, CultureInfo.InvariantCulture));
            return Json(v.ToString());
        }
    }
}
