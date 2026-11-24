// Forma Designer's command-line verbs (2026-11-25, the CLI and Forma Designer work's wave 6:
// findings D2-1, D2-2, D2-3, D2-4, D2-5, D2-7, D2-9 and SEC-2 of its design audit, the owner's
// OC1, in DevFiles/forma-audit/cli-designer-2026-11-24-findings.md). Forma's command line, and
// later its MCP server, start this program with one of them and read the one line it prints:
// no network, no Origin to check, and the caller this Windows user by construction. They come
// with Forma Designer 1.2.0, which the owner packs (README, *Verbs for Forma's command line*).
// Pure ASCII, as everything under tools/ is.
//
//   RepxDesigner.exe sql-list   [--store PATH] --check --no-load
//   RepxDesigner.exe sql-schema --connection NAME [--seconds N] [--store PATH] --check --no-load
//   RepxDesigner.exe sql-sample --connection NAME --objects dbo.A,dbo.B [--rows N] [--seconds N]
//                               [--store PATH] --check --no-load
//
// The rules, each a finding:
//   - The verb is the first argument, and only the first (SEC-2, D2-3). Entry.Main asks Is before
//     anything reads its arguments, so DevExpressLocator.Configure never sees a --devexpress-root
//     and no other switch is matched anywhere in them, as Program.Run matches its own. Each option
//     takes the one argument after it, verbatim, never searched for another switch, and an
//     argument no verb takes is refused, not skipped.
//   - Every call ends with --check --no-load, and one without them is refused (D2-1). Forma
//     Designer 1.1.0 and 1.0.0 have no verbs: given the same arguments, they reach --check, which
//     prints its JSON and exits with no window and no DevExpress loaded, where a verb alone would
//     be opened as a report path, a message box on the person's desktop that nobody closes.
//     Refusing the call without them makes a caller that forgets them fail here, in testing,
//     instead of on an older Forma Designer.
//   - One line of JSON on standard output, in ASCII (D2-2). A WinExe's Console.Out writes the ANSI
//     code page into a pipe, so a non-Latin name came out as '?', and setting
//     Console.OutputEncoding throws there ("The handle is invalid"). So standard output is a
//     UTF-8 writer of its own, and SqlCompanion.Json writes every character above 126 as \uXXXX.
//   - Exit codes through Main (D2-4): Done 0, Usage 2, NotKept 4 (no connection of that name kept
//     here), SqlFailed 5 (SQL Server refused or failed), DeadlinePassed 6. 3 stays --check's. On
//     any code but 0 the line still says what happened, under "problem" and "error".
//   - SQL Server's words without the saved sign-in or the server (D2-7, SqlCompanion.Explain),
//     and its own first line (problem sql or failed) without what it quotes, which can be a
//     row's value (Unquoted, the wave's review, N6-3).
//   - sql-sample leaves out an object SQL Server cannot read and names it under "unread" with
//     SQL Server's number (SqlCompanion.Samples, the review's R6-2), where one such object
//     failed the whole call.
//   - --seconds bounds the whole call (D2-6, Budget in Sql.cs), and a watchdog ends the process a
//     few seconds after it, whatever SQL Server is doing, so a call whose caller has gone ends.
//   - No DevExpress (D2-9). This class names no DevExpress type and reaches only the members of
//     SqlCompanion that name none: the store (StorePath, Find), IsName, ConnectionList, Schema,
//     Samples and Explain. Never Parameters, Connect, Fill or PrepareForDesigner, whose bodies
//     name DevExpress types and load its assemblies when compiled. src/lib/sqlCompanion.test.ts
//     holds this file to it; the README has the measurement.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;

namespace RepxDesigner
{
    internal static class Verbs
    {
        public const int Done = 0;
        public const int Usage = 2;
        public const int NotKept = 4;
        public const int SqlFailed = 5;
        public const int DeadlinePassed = 6;

        /// <summary>The verbs, each the first argument of a call or nothing.</summary>
        public static readonly string[] Names = { "sql-list", "sql-schema", "sql-sample" };

        /// <summary>What every call ends with (D2-1): an older Forma Designer answers them with --check.</summary>
        public static readonly string[] Sentinel = { "--check", "--no-load" };

        /// <summary>
        /// A call's seconds when --seconds is not given: the layout's own CommandTimeout before
        /// this, and within the four minutes a host such as Claude Desktop gives a tool call.
        /// </summary>
        public const int DefaultSeconds = 120;
        public const int MaxSeconds = 3600;
        /// <summary>The sample rows a table gives when --rows is not given, as the sample script's SAMPLE_SCRIPT_ROWS.</summary>
        public const int DefaultRows = 5;
        public const int MaxRows = 50;
        public const int MaxObjects = 20;
        /// <summary>Seconds after its deadline at which a call ends itself, if SQL Server has not let it go.</summary>
        private const int Grace = 5;

        private static readonly object Gate = new object();
        private static bool _said;
        /// <summary>The exit code of the line printed, once one is (Say).</summary>
        private static int _code;

        /// <summary>Whether the first argument is a verb, which Entry.Main asks before anything else.</summary>
        public static bool Is(string[] args)
        {
            return args != null && args.Length > 0 && Array.IndexOf(Names, args[0]) >= 0;
        }

        /// <summary>Runs the verb at args[0] and returns the process's exit code. Never inlined into Entry.Main.</summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public static int Run(string[] args)
        {
            try
            {
                var utf8 = new UTF8Encoding(false);
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
                Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
            }
            catch (Exception)
            {
                // Standard output as it was: the line below is ASCII either way.
            }

            string verb = args[0];
            var call = new Call();
            string usage;
            try
            {
                usage = Parse(args, call);
            }
            catch (Exception ex)
            {
                usage = "The arguments could not be read: " + ex.Message;
            }
            if (usage != null) return Say(verb, Usage, Problem("usage", usage, 0));
            if (call.Store != null) SqlCompanion.StorePath = call.Store;

            StoredConnection c = null;
            Budget budget = null;
            Timer watchdog = null;
            try
            {
                if (verb == "sql-list") return Say(verb, Done, ",\"connections\":" + SqlCompanion.ConnectionList());

                c = SqlCompanion.Find(call.Connection);
                if (c == null)
                {
                    return Say(verb, NotKept, Problem("not-kept",
                        "Forma Designer keeps no connection named " + call.Connection + " on this PC. Add it from its tray menu, SQL Server connections.", 0));
                }
                budget = new Budget(call.Seconds);
                string late = Problem("deadline", SqlCompanion.Explain(new BudgetSpent(), c, budget).Words, 0);
                watchdog = new Timer(Watch, new[] { verb, late }, (call.Seconds + Grace) * 1000L, Timeout.Infinite);

                string named = ",\"connection\":" + SqlCompanion.Json(c.Name);
                if (verb == "sql-schema") return Say(verb, Done, named + ",\"layout\":" + SqlCompanion.Json(SqlCompanion.Schema(c, budget)));
                var unread = new List<KeyValuePair<string, int>>();
                string samples = SqlCompanion.Samples(c, call.Objects, call.Rows, budget, unread);
                return Say(verb, Done, named + ",\"samples\":" + SqlCompanion.Json(samples) + ",\"unread\":[" +
                    string.Join(",", unread.Select(u => "{\"object\":" + SqlCompanion.Json(u.Key) + ",\"number\":" + u.Value.ToString(CultureInfo.InvariantCulture) + "}")) + "]");
            }
            catch (Exception ex)
            {
                SqlCompanion.Failure f = SqlCompanion.Explain(ex, c, budget);
                string words = f.Problem == "sql" || f.Problem == "failed" ? Unquoted(f.Words) : f.Words;
                return Say(verb, f.Problem == "deadline" ? DeadlinePassed : SqlFailed, Problem(f.Problem, words, f.Number));
            }
            finally
            {
                if (watchdog != null) watchdog.Dispose();
            }
        }

        private sealed class Call
        {
            public string Connection;
            public string Store;
            public List<string> Objects;
            public int Rows = DefaultRows;
            public int Seconds = DefaultSeconds;
        }

        /// <summary>The usage error in words, or null when the arguments are a call this verb takes.</summary>
        private static string Parse(string[] args, Call call)
        {
            string verb = args[0];
            int n = args.Length;
            if (n < 3 || args[n - 2] != Sentinel[0] || args[n - 1] != Sentinel[1])
            {
                return "Every call ends with --check --no-load, so that a Forma Designer without verbs (1.1.0 and older) answers with its check instead of opening a window.";
            }
            string[] takes = verb == "sql-list" ? new[] { "--store" }
                : verb == "sql-schema" ? new[] { "--connection", "--seconds", "--store" }
                : new[] { "--connection", "--objects", "--rows", "--seconds", "--store" };
            var seen = new HashSet<string>();
            for (int i = 1; i < n - 2; i += 2)
            {
                string option = args[i];
                if (Array.IndexOf(takes, option) < 0)
                {
                    return verb + " takes " + string.Join(", ", takes) + " before --check --no-load, and argument " + i + " (" + Clip(option) + ") is none of them.";
                }
                if (!seen.Add(option)) return option + " is given twice.";
                if (i + 1 >= n - 2) return option + " needs a value before --check --no-load.";
                string problem = Take(call, option, args[i + 1]);
                if (problem != null) return problem;
            }
            if (verb != "sql-list" && call.Connection == null) return verb + " needs --connection NAME.";
            if (verb == "sql-sample" && call.Objects == null) return "sql-sample needs --objects, its tables or views as schema.name joined by commas.";
            return null;
        }

        /// <summary>The rule of a connection's name in words, as the SQL Server connections window says it too.</summary>
        public const string NameRule = "A connection's name begins with a letter, a digit or _, and holds only letters, digits, _, . and -, at most 128.";

        /// <summary>One option's value read into the call, or why it cannot be.</summary>
        private static string Take(Call call, string option, string value)
        {
            int number;
            switch (option)
            {
                case "--connection":
                    if (!SqlCompanion.IsName(value)) return NameRule;
                    call.Connection = value;
                    return null;
                case "--objects":
                    var objects = new List<string>();
                    foreach (string item in value.Split(','))
                    {
                        string[] parts = item.Split('.');
                        if (item.Length == 0 || parts.Length > 2 || parts.Any(p => p.Length == 0 || p.Length > 128 || p[0] == '-' || p.Any(ch => ch < ' ')))
                        {
                            return "--objects takes tables or views as schema.name (or name, in dbo), joined by commas: each part 1 to 128 characters, none beginning with -.";
                        }
                        objects.Add(item);
                    }
                    if (objects.Count > MaxObjects) return "--objects takes at most " + MaxObjects + " tables or views.";
                    call.Objects = objects;
                    return null;
                case "--rows":
                    if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number < 1 || number > MaxRows) return "--rows takes a whole number from 1 to " + MaxRows + ".";
                    call.Rows = number;
                    return null;
                case "--seconds":
                    if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number < 1 || number > MaxSeconds) return "--seconds takes a whole number from 1 to " + MaxSeconds + ".";
                    call.Seconds = number;
                    return null;
                case "--store":
                    try
                    {
                        call.Store = Path.GetFullPath(value);
                    }
                    catch (Exception)
                    {
                        return "--store takes the path of a connections file.";
                    }
                    return null;
            }
            return option + " is not an option.";
        }

        private static string Clip(string text)
        {
            return text.Length > 40 ? text.Substring(0, 40) + "..." : text;
        }

        /// <summary>
        /// SQL Server's words with whatever they quote put as '...' (the same wave's review, N6-3):
        /// a row's value can be quoted there ("Conversion failed when converting the varchar value
        /// '...' to data type int.", 245, and 248 alike), and a verb's words reach a command line's
        /// log and, through Forma's MCP server, a host's AI, where no value goes. From the first
        /// quote to the last, so a value holding a quote of its own is taken whole, and to the end
        /// when no quote closes it, as in words cut short. Explain has already taken out the
        /// sign-in and the server; the routes' words, which stay on this PC in the page, keep what
        /// they quote. src/mcp/designerVerbs.ts `unquoted` does the same on Forma's side.
        /// </summary>
        internal static string Unquoted(string words)
        {
            if (string.IsNullOrEmpty(words)) return words ?? "";
            int first = words.IndexOf('\'');
            if (first < 0) return words;
            int last = words.LastIndexOf('\'');
            return words.Substring(0, first) + "'...'" + (last > first ? words.Substring(last + 1) : "");
        }

        /// <summary>The fields of a line that says what went wrong.</summary>
        private static string Problem(string problem, string words, int number)
        {
            return ",\"problem\":" + SqlCompanion.Json(problem) + ",\"error\":" + SqlCompanion.Json(words) + (number != 0 ? ",\"number\":" + number.ToString(CultureInfo.InvariantCulture) : "");
        }

        /// <summary>
        /// Prints the call's one line, the first time only, and returns the exit code of the line
        /// printed: the code given, or the watchdog's when its deadline line came first (the same
        /// wave's review, R6-4), so the line and the exit code never disagree. Until then it
        /// returned the code given, and a call finishing just after the watchdog spoke could exit
        /// 0 or 5 under an ok:false deadline line, which Node then refused as untrustworthy.
        /// </summary>
        private static int Say(string verb, int code, string fields)
        {
            if (TrySay(verb, code, fields)) return code;
            lock (Gate) return _code;
        }

        private static bool TrySay(string verb, int code, string fields)
        {
            lock (Gate)
            {
                if (_said) return false;
                _said = true;
                _code = code;
                string version = typeof(Verbs).Assembly.GetName().Version.ToString(3);
                try
                {
                    Console.Out.WriteLine("{\"formaDesignerVerb\":1,\"verb\":" + SqlCompanion.Json(verb) + ",\"version\":" + SqlCompanion.Json(version) +
                        ",\"ok\":" + (code == Done ? "true" : "false") + fields + "}");
                    Console.Out.Flush();
                }
                catch (Exception)
                {
                    // A reader that has gone: the exit code still says it.
                }
                return true;
            }
        }

        /// <summary>The watchdog: the deadline said, and the process ended, when SQL Server has not let the call go.</summary>
        private static void Watch(object state)
        {
            var said = (string[])state;
            bool first = false;
            try
            {
                first = TrySay(said[0], DeadlinePassed, said[1]);
            }
            catch (Exception)
            {
            }
            if (first) Environment.Exit(DeadlinePassed);
        }
    }
}
