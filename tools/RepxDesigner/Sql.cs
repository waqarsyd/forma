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
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Security.Principal;
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

        /// <summary>
        /// A connection's name as a report names it: letters, digits and _ . - only, so it can
        /// never be a connection string. Since 2026-11-25 (the CLI and Forma Designer work's
        /// wave 6, SEC-2) it may not begin with - or ., so a name handed on a command line can
        /// never read as a switch (--install, --devexpress-root) to this program or another.
        /// src/lib/databaseAi.ts DESIGNER_NAME is the same expression, held by its test.
        /// </summary>
        public static bool IsName(string name)
        {
            return !string.IsNullOrEmpty(name) && Regex.IsMatch(name, @"^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}$");
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

        /// <summary>
        /// What SQL Server's words must never carry out of this program (D2-7): a login's name
        /// and password, which the store encrypts together, as the credential they are. Empty
        /// for Windows authentication, and when the secret cannot be read on this account.
        /// </summary>
        internal static string[] SecretsOf(StoredConnection c)
        {
            if (c == null || c.Mode != "login" || string.IsNullOrEmpty(c.Secret)) return new string[0];
            try
            {
                string login, password;
                Unprotect(c.Secret, out login, out password);
                return new[] { login, password };
            }
            catch (Exception)
            {
                return new string[0];
            }
        }

        /// <summary>
        /// For ADO.NET (the layout and the samples), never written anywhere. Connecting waits
        /// at most <paramref name="connectSeconds"/>, which was a fixed 15 until 2026-11-25.
        /// </summary>
        public static string ConnectionString(StoredConnection c, int connectSeconds)
        {
            var b = new SqlConnectionStringBuilder { DataSource = c.Server, InitialCatalog = c.Database, ConnectTimeout = connectSeconds, ApplicationName = "Forma companion" };
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
            return "{\"connections\":" + ConnectionList() + "}";
        }

        /// <summary>The connections as a JSON array, for /sql/connections and the sql-list verb (Verbs.cs) alike: never a server, never a secret.</summary>
        public static string ConnectionList()
        {
            return "[" + string.Join(",", Load().Select(c =>
                "{\"name\":" + Json(c.Name) + ",\"mode\":" + Json(c.Mode) + ",\"database\":" + Json(c.Database) + "}")) + "]";
        }

        /// <summary>
        /// GET /sql/schema?connection=NAME: Forma's layout script's one value, as SSMS would show
        /// it, within the <paramref name="budget"/>'s seconds in all (the verbs' --seconds).
        /// </summary>
        public static string Schema(StoredConnection c, Budget budget)
        {
            string last = null;
            using (var conn = new SqlConnection(ConnectionString(c, budget.ConnectSeconds)))
            {
                conn.Open();
                using (var cmd = new SqlCommand(SqlScripts.Schema, conn) { CommandTimeout = budget.Left })
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
        ///
        /// Since 2026-11-25 (the CLI and Forma Designer work's wave 6, D2-5) each object is read
        /// by SqlScripts.Sample, SAMPLE_OBJECT_SCRIPT in src/lib/sqlSchemaScript.ts: binary,
        /// image, rowversion, xml, sql_variant and spatial columns left out and text (and SQL
        /// Server 2025's json) cut at one character over what Forma keeps, on the server. Until
        /// then it was SELECT TOP (n) *, which FOR JSON answers with a photo column in base64.
        /// And all of it within the <paramref name="budget"/>, where each object had 60 seconds
        /// of its own.
        ///
        /// An object SQL Server cannot read (a view over a table since dropped, a computed column
        /// that divides by zero, a table this sign-in may not SELECT) is left out, as one the
        /// catalog lacks is, and named in <paramref name="unread"/> with SQL Server's number,
        /// never its words, which can quote a row's value (the same wave's review, R6-2): until
        /// then one such object failed the whole call and the others' rows were lost. A failure
        /// of the connection itself (severity 20 or more, or the connection no longer open) and
        /// the call's time running out still end the call.
        /// </summary>
        public static string Samples(StoredConnection c, IEnumerable<string> objects, int rows, Budget budget, List<KeyValuePair<string, int>> unread = null)
        {
            rows = Math.Max(1, Math.Min(50, rows));
            var parts = new List<string>();
            string database;
            using (var conn = new SqlConnection(ConnectionString(c, budget.ConnectSeconds)))
            {
                conn.Open();
                using (var cmd = new SqlCommand("SELECT DB_NAME()", conn) { CommandTimeout = budget.Left }) database = Convert.ToString(cmd.ExecuteScalar());
                foreach (string obj in objects.Take(20))
                {
                    string[] names = obj.Split('.');
                    string schema = names.Length > 1 ? names[names.Length - 2] : "dbo";
                    string name = names[names.Length - 1];
                    var json = new StringBuilder();
                    bool found = false;
                    try
                    {
                        using (var cmd = new SqlCommand(SqlScripts.Sample, conn) { CommandTimeout = budget.Left })
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
                    }
                    catch (SqlException ex) when (ObjectOnly(ex, conn))
                    {
                        if (unread != null) unread.Add(new KeyValuePair<string, int>(schema + "." + name, ex.Number));
                        continue;
                    }
                    if (found) parts.Add("{\"object\":" + Json(schema + "." + name) + ",\"rows\":" + (json.Length > 0 ? json.ToString() : "[]") + "}");
                }
            }
            string body = "{\"format\":\"forma-sql-sample\",\"version\":1,\"database\":" + Json(database) + ",\"samples\":[" + string.Join(",", parts) + "]}";
            return "<?forma " + body.Replace("?>", "?\\u003e") + "?>";
        }

        /// <summary>
        /// Whether a failure reading one sampled object leaves the connection usable for the
        /// next (Samples): an error of the statement, below severity 20, not a timeout (each
        /// command runs for what is left of the call, so a timeout is the call's time up), on a
        /// connection still open.
        /// </summary>
        private static bool ObjectOnly(SqlException ex, SqlConnection conn)
        {
            var errors = ex.Errors.Cast<SqlError>().ToList();
            if (errors.Any(e => e.Class >= 20 || e.Number == -2 || e.Number == 258)) return false;
            return conn.State == System.Data.ConnectionState.Open;
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

        // ------------------------------------------------------------ SQL Server's words

        /// <summary>
        /// A failure in a word a caller can act on, and the words to say (2026-11-25, the CLI and
        /// Forma Designer work's wave 6, D2-7). SQL Server's own words can carry the saved login,
        /// which the store encrypts as half of the credential ("Login failed for user 'x'."), and
        /// a verb's words reach a command line and, through Forma's MCP server, a host's AI. So the
        /// failures people meet are said in plain sentences that name nothing, and anything else
        /// is SQL Server's first line with the login, the password, this Windows account and the
        /// server taken out (Scrub). Never a connection string, never the server's name.
        /// </summary>
        internal sealed class Failure
        {
            /// <summary>deadline, sign-in, database, unreachable, sql or failed.</summary>
            public string Problem;
            public string Words;
            /// <summary>SQL Server's error number, 0 when SQL Server did not raise it.</summary>
            public int Number;
        }

        /// <summary>A sign-in SQL Server refused: failed, untrusted domain, disabled, locked, or its password expired.</summary>
        private static readonly int[] SignInRefused = { 18456, 18452, 18470, 18486, 18487, 18488 };

        /// <summary>
        /// No server answered at that name: named pipes' "not found" (2, 53, 40), an instance not
        /// found (26, -1), TCP's timed out, refused and unknown host (10060, 10061, 11001). Measured
        /// here on 2026-11-25: a refused TCP port (tcp:127.0.0.1,1) is 1225, and a LocalDB instance
        /// that does not exist -1983577849 (0x89C50107).
        /// </summary>
        private static readonly int[] Unreachable = { 2, 53, 40, 26, -1, 1225, 10060, 10061, 11001, -1983577849 };

        internal static Failure Explain(Exception ex, StoredConnection c, Budget budget)
        {
            if (ex is BudgetSpent) return new Failure { Problem = "deadline", Words = Within(budget) };
            var sql = ex as SqlException;
            if (sql != null)
            {
                var numbers = sql.Errors.Cast<SqlError>().Select(e => e.Number).ToList();
                int first = numbers.Count > 0 ? numbers[0] : sql.Number;
                // -2 is a timeout, and so is 258 (WAIT_TIMEOUT), which the TCP provider reports for a
                // port that refuses until the connection's time is up (measured on 2026-11-25): the
                // call's own when its seconds are spent (each command is given what is left), else
                // connecting, which waits at most 15 of them.
                int timeout = numbers.FirstOrDefault(n => n == -2 || n == 258);
                if (timeout != 0 && (budget == null || budget.Spent)) return new Failure { Problem = "deadline", Words = Within(budget), Number = timeout };
                if (timeout != 0) return new Failure { Problem = "unreachable", Words = "SQL Server did not answer when Forma Designer connected to it. The server the connection names is not running, or this PC cannot reach it.", Number = timeout };
                if (numbers.Contains(4060)) return new Failure { Problem = "database", Words = "SQL Server would not open the connection's database with the saved sign-in. It is not there, or the sign-in may not open it.", Number = 4060 };
                int refused = numbers.FirstOrDefault(n => SignInRefused.Contains(n));
                if (refused != 0) return new Failure { Problem = "sign-in", Words = "SQL Server refused the saved sign-in.", Number = refused };
                if (Unreachable.Contains(first)) return new Failure { Problem = "unreachable", Words = "SQL Server could not be reached. The server the connection names is not running, or this PC cannot reach it.", Number = first };
                return new Failure { Problem = "sql", Words = Scrub(FirstLine(sql.Message), c), Number = first };
            }
            if (ex is CryptographicException)
            {
                return new Failure { Problem = "sign-in", Words = "The saved sign-in cannot be read by this Windows account. Add the connection again, from Forma Designer's SQL Server connections." };
            }
            return new Failure { Problem = "failed", Words = Scrub(ex.GetType().Name + ": " + FirstLine(ex.Message), c) };
        }

        private static string Within(Budget budget)
        {
            int seconds = budget == null ? 0 : budget.Seconds;
            return "SQL Server did not answer within " + seconds + (seconds == 1 ? " second." : " seconds.");
        }

        private static string FirstLine(string text)
        {
            return (text ?? "").Split('\n')[0].TrimEnd('\r').Trim();
        }

        /// <summary>
        /// The text with the connection's login and password, this Windows account (DOMAIN\user
        /// and user, which SQL Server names when Windows authentication fails) and the server it
        /// names put in words, each matched whole and in any case.
        /// </summary>
        internal static string Scrub(string text, StoredConnection c)
        {
            if (string.IsNullOrEmpty(text)) return text ?? "";
            const string signIn = "the saved sign-in", server = "the server";
            var names = new List<KeyValuePair<string, string>>();
            // The login and password whatever their length; an account or a server of one
            // character (".") is left, as it would match ordinary words and names nothing.
            foreach (string secret in SecretsOf(c)) if (!string.IsNullOrEmpty(secret)) names.Add(new KeyValuePair<string, string>(secret, signIn));
            string account = null;
            try { account = WindowsIdentity.GetCurrent().Name; } catch (Exception) { }
            var others = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>(account, signIn),
                new KeyValuePair<string, string>(Environment.UserName, signIn),
            };
            if (c != null)
            {
                others.Add(new KeyValuePair<string, string>(c.Server, server));
                others.Add(new KeyValuePair<string, string>(HostOf(c.Server), server));
            }
            names.AddRange(others.Where(n => n.Key != null && n.Key.Trim().Length > 1));
            // The longest first, so DOMAIN\user is replaced before user alone.
            foreach (var n in names.OrderByDescending(n => n.Key.Length))
            {
                text = Regex.Replace(text, @"(?<![A-Za-z0-9_])" + Regex.Escape(n.Key) + @"(?![A-Za-z0-9_])", n.Value.Replace("$", "$$"), RegexOptions.IgnoreCase);
            }
            return text;
        }

        /// <summary>A server's host alone: tcp:db01.corp\SQL2019,1433 is db01.corp.</summary>
        private static string HostOf(string server)
        {
            string s = (server ?? "").Trim();
            int colon = s.IndexOf(':');
            if (colon > 0 && colon < 6) s = s.Substring(colon + 1);
            int cut = s.IndexOfAny(new[] { '\\', ',' });
            return cut >= 0 ? s.Substring(0, cut) : s;
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

    /// <summary>
    /// A call's seconds in all (2026-11-25, the CLI and Forma Designer work's wave 6, D2-6):
    /// connecting waits what is left of them and never more than 15, as before, and each command
    /// runs for what is left, so the last one ends when the call's time does and a call whose
    /// caller has gone ends by itself. The verbs take it from --seconds; the HTTP routes keep
    /// about the time they had (Program.cs HandleSql).
    /// </summary>
    internal sealed class Budget
    {
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        public readonly int Seconds;

        public Budget(int seconds)
        {
            Seconds = Math.Max(1, seconds);
        }

        /// <summary>Whether the call's time is up, give or take the half second a timeout may be early.</summary>
        public bool Spent
        {
            get { return _clock.Elapsed.TotalSeconds >= Seconds - 0.5; }
        }

        /// <summary>Whole seconds left, at least one (a CommandTimeout of 0 waits for ever); BudgetSpent when none are.</summary>
        public int Left
        {
            get
            {
                double left = Seconds - _clock.Elapsed.TotalSeconds;
                if (left <= 0) throw new BudgetSpent();
                return (int)Math.Ceiling(left);
            }
        }

        public int ConnectSeconds
        {
            get { return Math.Min(15, Left); }
        }
    }

    internal sealed class BudgetSpent : Exception
    {
        public BudgetSpent() : base("The time allowed has passed.") { }
    }
}
