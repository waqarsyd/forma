using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using DevExpress.XtraReports.UI;

namespace RepxDesigner
{
    /// <summary>
    /// Opens a .repx file in the DevExpress end-user report designer.
    ///
    /// This is the "edit after export" half of Forma. Forma generates the report
    /// and the model's job ends there: the layout JSON and repxContent are
    /// terminal outputs of one request, never edited afterwards, so they cannot
    /// drift apart. Adjustments -- moving a field, resizing a box, fixing a
    /// caption -- happen here in the real designer, where they cost no tokens and
    /// change nothing you did not touch.
    ///
    /// Three ways in:
    ///
    ///   RepxDesigner.exe                 pick a file (starts in Downloads)
    ///   RepxDesigner.exe report.repx     open that file
    ///   RepxDesigner.exe --serve         listen on 127.0.0.1:7317 for Forma
    ///   RepxDesigner.exe --register      register the forma-repx:// protocol
    ///   RepxDesigner.exe --unregister    remove it again
    ///   RepxDesigner.exe --install       install for this user (also offered on a double-click, Installer.cs)
    ///   RepxDesigner.exe --uninstall     remove that install
    ///   RepxDesigner.exe --check         what DevExpress it finds, as JSON (DevExpressLocator.cs)
    ///
    /// --serve is what puts an "Open in designer" button in Forma's workspace:
    /// the page POSTs the XML here and the designer opens on it directly, with no
    /// download and no file dialog. A browser cannot start a program itself, which
    /// is why this side has to exist at all.
    ///
    /// --register is the answer to the obvious complaint about that: the button is
    /// dead until someone remembers to start a tray app, which is a poor deal for
    /// a one-click feature. It writes a URL-protocol handler under HKCU (no admin,
    /// nothing machine-wide) so the page can navigate to `forma-repx://serve` and
    /// have Windows start this program in server mode. That is the one route by
    /// which a web page may cause a local program to run, and it is deliberately
    /// gated: the browser asks the user to confirm the first time.
    ///
    /// NOTE the registered command line is `"exe" --serve "%1"`, so the protocol
    /// launch lands in the SAME server branch below with no extra parsing -- the
    /// URL simply arrives as a trailing argument nobody reads.
    /// </summary>
    internal static class Program
    {
        private const int DefaultPort = 7317;

        /// <summary>Scheme registered by --register. Must match designerBridge.ts.</summary>
        private const string Scheme = "forma-repx";

        /// <summary>
        /// Required on POST /open. Any header outside the CORS safelist forces the
        /// browser to send a preflight, which is what gives OPTIONS a chance to
        /// reject an origin. Without it a random page could fire a no-preflight
        /// POST at this port and pop a designer window on the user's screen.
        /// </summary>
        private const string ClientHeader = "x-forma-client";

        private static Form _pump;

        /// <summary>
        /// The DevExpress this run uses, or null when none it can run on is installed
        /// (2026-11-09). Set by Entry.Main before Run; every path that would load a
        /// DevExpress assembly checks it first and says what is missing instead.
        /// </summary>
        internal static DevExpressInstall Installed;

        /// <summary>Every installation found, newest first, for saying what is there.</summary>
        internal static List<DevExpressInstall> Found = new List<DevExpressInstall>();

        /// <summary>
        /// What Main was until 2026-11-09: Entry.Main now runs first, finds DevExpress
        /// and says where it is, and calls this. Never inlined into Entry.Main, whose
        /// body must name no DevExpress type (Entry.cs says why).
        /// </summary>
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        internal static void Run(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // The SQL Server connections (2026-11-09, Sql.cs). --store moves where they
            // are kept, so a test never writes into the profile.
            int store = Array.IndexOf(args, "--store");
            if (store >= 0 && store + 1 < args.Length) SqlCompanion.StorePath = Path.GetFullPath(args[store + 1]);

            // Installing for this user (2026-11-09, Installer.cs). --sandbox <dir> keeps a
            // test out of the account's real Start menu, startup and registry.
            if (Array.IndexOf(args, "--installed") >= 0)
            {
                Console.Out.WriteLine(Installer.Report(InstallTarget.For(args)));
                return;
            }
            if (Array.IndexOf(args, "--install") >= 0)
            {
                RunInstall(InstallTarget.For(args), Array.IndexOf(args, "--no-startup") < 0, Array.IndexOf(args, "--no-open-with") < 0,
                    Array.IndexOf(args, "--no-start") < 0, Array.IndexOf(args, "--quiet") >= 0);
                return;
            }
            if (Array.IndexOf(args, "--uninstall") >= 0)
            {
                RunUninstall(InstallTarget.For(args), Array.IndexOf(args, "--quiet") >= 0, Array.IndexOf(args, "--remove-connections") >= 0);
                return;
            }

            int add = Array.IndexOf(args, "--sql-add");
            if (add >= 0 && add + 1 < args.Length)
            {
                // Windows authentication only: a login's password is typed in the window, never on a command line.
                int server = Array.IndexOf(args, "--server"), database = Array.IndexOf(args, "--database");
                if (SqlCompanion.IsName(args[add + 1]) && server > 0 && database > 0 && server + 1 < args.Length && database + 1 < args.Length)
                {
                    SqlCompanion.Put(new StoredConnection { Name = args[add + 1], Mode = "windows", Server = args[server + 1], Database = args[database + 1] });
                }
                return;
            }

            int remove = Array.IndexOf(args, "--sql-remove");
            if (remove >= 0 && remove + 1 < args.Length)
            {
                SqlCompanion.Remove(args[remove + 1]);
                return;
            }

            if (Array.IndexOf(args, "--sql-connections") >= 0)
            {
                Application.Run(new ConnectionsForm());
                return;
            }

            if (Array.IndexOf(args, "--register") >= 0)
            {
                RegisterProtocol();
                return;
            }

            if (Array.IndexOf(args, "--unregister") >= 0)
            {
                UnregisterProtocol();
                return;
            }

            if (Array.IndexOf(args, "--serve") >= 0)
            {
                // Launched by the browser through forma-repx:// rather than by a
                // person. That changes one thing: if the port is already taken,
                // something is already serving, which is success from the page's
                // point of view -- so exit quietly instead of popping a warning
                // box the user did not ask for and cannot act on.
                bool fromProtocol = Array.Exists(
                    args, a => a != null && a.StartsWith(Scheme + ":", StringComparison.OrdinalIgnoreCase));
                RunServer(PortFrom(args), fromProtocol);
                return;
            }

            // The downloaded exe, double-clicked from wherever it was saved: offer to
            // install it, as an installer would (2026-11-09). The installed copy, and
            // "Run once", go on as before.
            if (args.Length == 0)
            {
                InstallTarget target = InstallTarget.For(args);
                if (!Installer.IsRunningInstalled(target))
                {
                    bool startup, openWith;
                    Installer.Choice choice = Installer.Offer(target, out startup, out openWith);
                    if (choice == Installer.Choice.Cancel) return;
                    if (choice == Installer.Choice.Install)
                    {
                        RunInstall(target, startup, openWith, true, false);
                        return;
                    }
                }
            }

            // A person started it to open a report, and there is nothing to open it in:
            // say so before asking them to pick a file (2026-11-09).
            if (Installed == null)
            {
                MissingDevExpress.ShowWindow(Found);
                return;
            }

            string path = args.Length > 0 ? args[0] : PickFile();
            if (string.IsNullOrEmpty(path))
            {
                return; // cancelled the picker
            }

            OpenDesigner(path);
        }

        // ----------------------------------------------------------------- //
        // Opening
        // ----------------------------------------------------------------- //

        /// <summary>
        /// Opens a report, or says DevExpress is missing. A separate method from
        /// OpenDesignerCore, whose body names DevExpress types and so cannot even be
        /// compiled on a PC without it.
        /// </summary>
        private static void OpenDesigner(string path)
        {
            if (Installed == null)
            {
                MissingDevExpress.ShowWindow(Found);
                return;
            }
            OpenDesignerCore(path);
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static void OpenDesignerCore(string path)
        {
            if (!File.Exists(path))
            {
                MessageBox.Show(
                    "No file at:" + Environment.NewLine + path,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            // Read the version the file claims BEFORE trying to load it, so a
            // failure message can show both numbers. It is information, not a
            // diagnosis: measured 2026-09-06 with RepxProbe inspect, a 24.1 file
            // loads through these 20.1 assemblies with nothing lost and the loader
            // rewrites the tag on save. Nothing here refuses a file on its version
            // and nothing should -- what can actually break a load is a control or
            // property this assembly never had, which the version only hints at.
            string fileVersion = ReadSerializerVersion(path);
            string runtimeVersion = typeof(XtraReport).Assembly.GetName().Version.ToString();

            try
            {
                XtraReport report = XtraReport.FromFile(path, true);

                // Item 38 (2026-11-09): each connection the report names that this PC keeps,
                // set so the designer's preview reads it, and saved as its name alone.
                SqlCompanion.PrepareForDesigner(report);

                using (ReportDesignTool tool = new ReportDesignTool(report))
                {
                    // Modal. Saving inside the designer writes back to `path`.
                    tool.ShowDesignerDialog();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not open this report." + Environment.NewLine + Environment.NewLine +
                    "File:              " + Path.GetFileName(path) + Environment.NewLine +
                    "SerializerVersion: " + (fileVersion ?? "not declared") + Environment.NewLine +
                    "Designer version:  " + runtimeVersion + Environment.NewLine + Environment.NewLine +
                    "Both versions are shown because they are useful to know, not " +
                    "because a difference between them is the cause -- a file targeting " +
                    "a newer release normally loads here regardless. Look first at the " +
                    "exception below, and at whether the report uses a control this " +
                    "version of DevExpress does not have." +
                    Environment.NewLine + Environment.NewLine +
                    ex.GetType().Name + ": " + ex.Message,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private static string PickFile()
        {
            string downloads = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads");

            using (OpenFileDialog dialog = new OpenFileDialog())
            {
                dialog.Title = "Open a report layout";
                dialog.Filter = "DevExpress report layouts (*.repx)|*.repx|All files (*.*)|*.*";
                dialog.InitialDirectory = Directory.Exists(downloads)
                    ? downloads
                    : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

                return dialog.ShowDialog() == DialogResult.OK ? dialog.FileName : null;
            }
        }

        /// <summary>
        /// Pull SerializerVersion off the root element by text rather than parsing
        /// the document. A file too new to load is also a file we may not be able
        /// to deserialise, and this has to work in exactly that case.
        /// </summary>
        private static string ReadSerializerVersion(string path)
        {
            try
            {
                // The attribute is on the root element, so the first kilobyte is
                // plenty -- these files run to megabytes with images embedded.
                char[] head = new char[1024];
                int read;
                using (StreamReader reader = new StreamReader(path))
                {
                    read = reader.Read(head, 0, head.Length);
                }

                Match match = Regex.Match(new string(head, 0, read), "SerializerVersion=\"([^\"]+)\"");
                return match.Success ? match.Groups[1].Value : null;
            }
            catch (Exception ex)
            {
                Debug.WriteLine("Could not read SerializerVersion: " + ex.Message);
                return null;
            }
        }

        // ----------------------------------------------------------------- //
        // Protocol registration
        // ----------------------------------------------------------------- //

        /// <summary>
        /// Register `forma-repx://` for the current user so a page can ask Windows
        /// to start this program.
        ///
        /// **HKCU, never HKLM.** Per-user needs no elevation, which matters: this
        /// is a personal tool and the machine it was written on is a shared server
        /// where nobody has admin. It also means uninstalling is one key delete and
        /// affects nobody else's profile.
        ///
        /// The command is `"exe" --serve "%1"`. Passing `%1` is not decoration --
        /// Windows appends the URL as an argument, and a handler that does not
        /// declare where it goes gets it appended anyway in some shells. Declaring
        /// it explicitly is what keeps `--serve` in a known position.
        /// </summary>
        /// <summary>
        /// --install, from the offer or a command line. Quiet prints what it did as
        /// JSON and opens no window; otherwise it starts the installed copy in the
        /// tray and says so, and then, when there is no DevExpress, says that too.
        /// </summary>
        private static void RunInstall(InstallTarget target, bool startup, bool openWith, bool start, bool quiet)
        {
            List<string> done;
            try
            {
                done = Installer.Install(target, startup, openWith);
            }
            catch (Exception ex)
            {
                Environment.ExitCode = 1;
                if (quiet) Console.Out.WriteLine("{\"installed\":false,\"error\":" + SqlCompanion.Json(ex.GetType().Name + ": " + ex.Message) + "}");
                else MessageBox.Show("Forma Designer could not be installed." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "Forma Designer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (start)
            {
                try { Process.Start(new ProcessStartInfo(target.Exe, "--serve") { UseShellExecute = false, WorkingDirectory = target.ProgramDir }); }
                catch (Exception ex) { done.Add("not started: " + ex.Message); }
            }

            if (quiet)
            {
                Console.Out.WriteLine("{\"installed\":true,\"version\":" + SqlCompanion.Json(Installer.Version) + ",\"done\":" + Installer.JsonList(done) + "}");
                return;
            }

            MessageBox.Show(
                "Forma Designer " + Installer.Version + " is installed." + Environment.NewLine + Environment.NewLine +
                Installer.Lines(done) + Environment.NewLine +
                (start ? "It is running now; its icon is in the notification area, by the clock. " : "") +
                "In Forma, choose Open in designer.",
                "Forma Designer", MessageBoxButtons.OK, MessageBoxIcon.Information);
            if (Installed == null) MissingDevExpress.ShowWindow(Found);
        }

        /// <summary>--uninstall, from Settings, Apps or a command line.</summary>
        private static void RunUninstall(InstallTarget target, bool quiet, bool removeConnections)
        {
            if (!quiet && !Installer.ConfirmUninstall(out removeConnections)) return;
            List<string> done, kept;
            try
            {
                done = Installer.Uninstall(target, removeConnections, out kept);
            }
            catch (Exception ex)
            {
                Environment.ExitCode = 1;
                if (quiet) Console.Out.WriteLine("{\"removed\":false,\"error\":" + SqlCompanion.Json(ex.GetType().Name + ": " + ex.Message) + "}");
                else MessageBox.Show("Forma Designer could not be removed." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "Forma Designer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (quiet)
            {
                Console.Out.WriteLine("{\"removed\":" + Installer.JsonList(done) + ",\"kept\":" + Installer.JsonList(kept) + "}");
                return;
            }
            MessageBox.Show(
                "Forma Designer is removed." + Environment.NewLine + Environment.NewLine + Installer.Lines(done) +
                (kept.Count > 0 ? Environment.NewLine + "Kept:" + Environment.NewLine + Installer.Lines(kept) : ""),
                "Forma Designer", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private static void RegisterProtocol()
        {
            string exe = Application.ExecutablePath;

            try
            {
                Installer.WriteProtocol(exe, @"Software\Classes");

                MessageBox.Show(
                    "Forma can now start this program on its own." + Environment.NewLine + Environment.NewLine +
                    "The \"Open in designer\" button will launch it when nothing is listening. Your browser will " +
                    "ask for permission the first time -- tick \"Always allow\" and it will not ask again." +
                    Environment.NewLine + Environment.NewLine +
                    "Registered for your user only. Nothing was installed system-wide." + Environment.NewLine +
                    "Handler: " + exe,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not register the forma-repx:// protocol." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        private static void UnregisterProtocol()
        {
            try
            {
                Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + Scheme, false);
                MessageBox.Show(
                    "The forma-repx:// protocol has been removed." + Environment.NewLine +
                    "Forma's button still works while this program is running with --serve.",
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not remove the forma-repx:// protocol." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        // ----------------------------------------------------------------- //
        // Server mode
        // ----------------------------------------------------------------- //

        private static int PortFrom(string[] args)
        {
            int index = Array.IndexOf(args, "--port");
            int port;
            if (index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out port))
            {
                return port;
            }
            return DefaultPort;
        }

        /// <summary>
        /// A raw TcpListener rather than HttpListener: HttpListener needs a URL
        /// reservation (netsh http add urlacl) or an elevated process, and this is
        /// a personal tool that must run by double-clicking it. The HTTP subset
        /// needed here is a request line, headers, a Content-Length body and a
        /// response -- small enough to hand-roll and avoid the admin prompt.
        /// </summary>
        private static void RunServer(int port, bool quietIfTaken = false)
        {
            TcpListener listener;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
            }
            catch (Exception ex)
            {
                if (quietIfTaken)
                {
                    return; // already serving; the page will find it on its next ping
                }

                MessageBox.Show(
                    "Forma Designer is already running: its icon is in the notification area, by the clock." +
                    Environment.NewLine + Environment.NewLine +
                    "(Or another program is using 127.0.0.1:" + port + ": " + ex.Message + ")",
                    "Forma Designer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            // The designer must open on the UI thread; the accept loop cannot run
            // there because ShowDesignerDialog is modal. This hidden form is the
            // marshalling point between the two.
            _pump = new Form
            {
                ShowInTaskbar = false,
                WindowState = FormWindowState.Minimized,
                FormBorderStyle = FormBorderStyle.FixedToolWindow,
                Opacity = 0
            };
            _pump.Load += (s, e) => _pump.Hide();

            using (NotifyIcon tray = new NotifyIcon())
            {
                tray.Icon = System.Drawing.SystemIcons.Application;
                // NotifyIcon.Text takes at most 63 characters.
                tray.Text = Installed == null
                    ? "Forma Designer - DevExpress not found"
                    : "Forma Designer - DevExpress " + Installed.Version + " - 127.0.0.1:" + port;
                tray.Visible = true;

                ContextMenu menu = new ContextMenu();
                if (Installed == null)
                {
                    // Said once, without a window: a launch from the browser is already being
                    // told the same by the page, and a person sees it in the tray (2026-11-09).
                    menu.MenuItems.Add("Get DevExpress (devexpress.com)...", (s, e) => MissingDevExpress.OpenTrial());
                    tray.BalloonTipClicked += (s, e) => MissingDevExpress.OpenTrial();
                    tray.ShowBalloonTip(15000, MissingDevExpress.Headline(Found),
                        "Forma Designer needs DevExpress Reporting to open reports. Click for the free trial on devexpress.com.",
                        ToolTipIcon.Warning);
                }
                menu.MenuItems.Add("Open a .repx...", (s, e) =>
                {
                    string picked = PickFile();
                    if (!string.IsNullOrEmpty(picked)) OpenDesigner(picked);
                });
                menu.MenuItems.Add("SQL Server connections...", (s, e) =>
                {
                    using (var form = new ConnectionsForm()) form.ShowDialog();
                });
                menu.MenuItems.Add("-");
                menu.MenuItems.Add("Quit", (s, e) => Application.Exit());
                tray.ContextMenu = menu;

                Thread accepts = new Thread(() => AcceptLoop(listener)) { IsBackground = true };
                accepts.Start();

                Application.Run(_pump);

                tray.Visible = false;
                listener.Stop();
            }
        }

        private static void AcceptLoop(TcpListener listener)
        {
            while (true)
            {
                try
                {
                    using (TcpClient client = listener.AcceptTcpClient())
                    using (NetworkStream stream = client.GetStream())
                    {
                        Handle(stream);
                    }
                }
                catch (SocketException)
                {
                    return; // listener stopped on exit
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Request failed: " + ex.Message);
                }
            }
        }

        private static void Handle(NetworkStream stream)
        {
            string requestLine;
            Dictionary<string, string> headers;
            string body;

            if (!ReadRequest(stream, out requestLine, out headers, out body))
            {
                return;
            }

            string[] parts = requestLine.Split(' ');
            string method = parts.Length > 0 ? parts[0] : "";
            string target = parts.Length > 1 ? parts[1] : "";

            string origin;
            headers.TryGetValue("origin", out origin);
            string allowed = IsAllowedOrigin(origin) ? origin : null;

            if (method == "OPTIONS")
            {
                // Preflight. An origin we do not recognise gets no
                // Access-Control-Allow-Origin, so the browser blocks the real
                // request before it is ever sent.
                Respond(stream, allowed == null ? 403 : 204, "text/plain", "", allowed);
                return;
            }

            if (method == "GET" && target.StartsWith("/health"))
            {
                // Forma asks this before handing a report over. Since 2026-11-09 it also
                // says which DevExpress this run uses, or null with what was found, so
                // the page can ask for DevExpress rather than for this program. This
                // method names no DevExpress type (Entry.cs says why); the version comes
                // from RuntimeDesignerVersion, called only when there is one.
                Respond(stream, 200, "application/json", HealthJson(), allowed);
                return;
            }

            if (method == "POST" && target.StartsWith("/open"))
            {
                if (!headers.ContainsKey(ClientHeader))
                {
                    Respond(stream, 400, "text/plain", "Missing " + ClientHeader, allowed);
                    return;
                }

                // Nothing to open it in: 424, with what was found and where the trial is.
                if (Installed == null)
                {
                    Respond(stream, 424, "application/json", MissingDevExpress.Json(Found), allowed);
                    return;
                }

                if (string.IsNullOrEmpty(body))
                {
                    Respond(stream, 400, "text/plain", "Empty body", allowed);
                    return;
                }

                string name;
                headers.TryGetValue("x-forma-filename", out name);
                string path = WriteTempCopy(body, name);

                // Answer before opening: ShowDesignerDialog is modal and would
                // otherwise hold the response until the user closes the designer,
                // which reads in the browser as a request that never finishes.
                Respond(stream, 202, "application/json",
                    "{\"opened\":\"" + Path.GetFileName(path).Replace("\"", "") + "\"}", allowed);

                try
                {
                    _pump.BeginInvoke(new Action(() => OpenDesigner(path)));
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Could not marshal to the UI thread: " + ex.Message);
                }
                return;
            }

            if (target.StartsWith("/sql/"))
            {
                HandleSql(stream, method, target, headers, body, allowed);
                return;
            }

            Respond(stream, 404, "text/plain", "Not found", allowed);
        }

        /// <summary>
        /// The SQL Server companion's routes (2026-11-09, Sql.cs). Both guards, on
        /// every one and before any work: a Forma origin, and the x-forma-client
        /// header, which forces the browser's preflight. A page from anywhere else
        /// never reaches a database, not even to be refused by CORS afterwards.
        /// </summary>
        private static void HandleSql(NetworkStream stream, string method, string target, Dictionary<string, string> headers, string body, string allowed)
        {
            if (allowed == null) { Respond(stream, 403, "text/plain", "", null); return; }
            if (!headers.ContainsKey(ClientHeader)) { Respond(stream, 400, "text/plain", "Missing " + ClientHeader, allowed); return; }
            string path = target.Split('?')[0];
            var query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            int q = target.IndexOf('?');
            if (q >= 0)
            {
                foreach (string pair in target.Substring(q + 1).Split('&'))
                {
                    int eq = pair.IndexOf('=');
                    if (eq > 0) query[Uri.UnescapeDataString(pair.Substring(0, eq).Replace('+', ' '))] = Uri.UnescapeDataString(pair.Substring(eq + 1).Replace('+', ' '));
                }
            }
            try
            {
                if (method == "GET" && path == "/sql/connections")
                {
                    Respond(stream, 200, "application/json", SqlCompanion.Connections(), allowed);
                    return;
                }
                string name;
                query.TryGetValue("connection", out name);
                if (method == "GET" && (path == "/sql/schema" || path == "/sql/sample"))
                {
                    StoredConnection c = SqlCompanion.IsName(name) ? SqlCompanion.Find(name) : null;
                    if (c == null) { Respond(stream, 404, "application/json", "{\"missing\":[" + SqlCompanion.Json(name ?? "") + "]}", allowed); return; }
                    if (path == "/sql/schema") { Respond(stream, 200, "text/plain", SqlCompanion.Schema(c), allowed); return; }
                    string objects, rows;
                    query.TryGetValue("objects", out objects);
                    query.TryGetValue("rows", out rows);
                    int n;
                    Respond(stream, 200, "text/plain", SqlCompanion.Samples(c, (objects ?? "").Split(',').Where(o => o.Length > 0), int.TryParse(rows, out n) ? n : 5), allowed);
                    return;
                }
                if (method == "POST" && path == "/sql/fill")
                {
                    if (string.IsNullOrEmpty(body)) { Respond(stream, 400, "text/plain", "Empty body", allowed); return; }
                    // A fill is DevExpress filling the report's own data source; the layout and samples are not.
                    if (Installed == null) { Respond(stream, 424, "application/json", MissingDevExpress.Json(Found), allowed); return; }
                    var values = query.Where(kv => kv.Key.StartsWith("p.")).ToDictionary(kv => kv.Key.Substring(2), kv => kv.Value);
                    string run;
                    query.TryGetValue("procedures", out run);
                    int status;
                    string json = SqlCompanion.Fill(body, values, run == "1", out status);
                    Respond(stream, status, "application/json", json, allowed);
                    return;
                }
                Respond(stream, 404, "text/plain", "Not found", allowed);
            }
            catch (Exception ex)
            {
                // SQL Server's own words, which name what is wrong; never a connection string.
                Respond(stream, 502, "application/json", "{\"error\":" + SqlCompanion.Json(ex.GetType().Name + ": " + ex.Message.Split('\n')[0]) + "}", allowed);
            }
        }

        /// <summary>
        /// Loopback only, and only a localhost origin. This is a local tool, so
        /// there is no legitimate caller on the public internet.
        /// </summary>
        private static bool IsAllowedOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return false;
            return Regex.IsMatch(origin, @"^http://(localhost|127\.0\.0\.1)(:\d+)?$");
        }

        /// <summary>
        /// Never trust a filename off the wire: it decides where we write. Strip
        /// it to a bare name so a caller cannot walk out of the temp folder.
        /// </summary>
        private static string WriteTempCopy(string xml, string suggestedName)
        {
            string safe = "report";
            if (!string.IsNullOrEmpty(suggestedName))
            {
                string candidate = Path.GetFileName(suggestedName);
                candidate = Regex.Replace(candidate, @"[^A-Za-z0-9_\-. ]", "");
                candidate = candidate.Replace(".repx", "").Trim();

                // Windows resolves CON, PRN, AUX, NUL, COM1-9 and LPT1-9 as
                // devices in every directory, with or without an extension, so
                // %TEMP%\Forma\CON.repx addresses the console rather than a
                // file. Path.GetFileName and the regex above both let them
                // through untouched. The browser sanitises this too, but a
                // value from the browser is a value an attacker could send --
                // which is exactly why this side re-sanitises.
                if (Regex.IsMatch(candidate, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$",
                        RegexOptions.IgnoreCase))
                {
                    candidate = "_" + candidate;
                }

                // %TEMP%\Forma\ is ~45 characters here, and firestore.rules
                // permits a 256-character report name, so an untruncated one
                // produced a ~306-character path and a PathTooLongException.
                if (candidate.Length > 60) candidate = candidate.Substring(0, 60);

                if (candidate.Length > 0) safe = candidate;
            }

            string folder = Path.Combine(Path.GetTempPath(), "Forma");
            Directory.CreateDirectory(folder);

            string path = Path.Combine(folder, safe + ".repx");
            File.WriteAllText(path, xml, new UTF8Encoding(false));
            return path;
        }

        private static bool ReadRequest(
            NetworkStream stream,
            out string requestLine,
            out Dictionary<string, string> headers,
            out string body)
        {
            requestLine = null;
            headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            body = null;

            MemoryStream buffer = new MemoryStream();
            byte[] one = new byte[1];
            int headerEnd = -1;

            // Read byte by byte to the blank line. Slow in principle, irrelevant
            // here -- headers are a few hundred bytes and there is one caller.
            while (buffer.Length < 32 * 1024)
            {
                int read = stream.Read(one, 0, 1);
                if (read == 0) break;
                buffer.WriteByte(one[0]);

                byte[] soFar = buffer.GetBuffer();
                int length = (int)buffer.Length;
                if (length >= 4 &&
                    soFar[length - 4] == '\r' && soFar[length - 3] == '\n' &&
                    soFar[length - 2] == '\r' && soFar[length - 1] == '\n')
                {
                    headerEnd = length;
                    break;
                }
            }

            if (headerEnd < 0) return false;

            string head = Encoding.UTF8.GetString(buffer.GetBuffer(), 0, headerEnd);
            string[] lines = head.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length == 0) return false;

            requestLine = lines[0];
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon > 0)
                {
                    headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
                }
            }

            string lengthValue;
            int contentLength;
            if (headers.TryGetValue("content-length", out lengthValue) &&
                int.TryParse(lengthValue, out contentLength) &&
                contentLength > 0)
            {
                byte[] payload = new byte[contentLength];
                int got = 0;
                while (got < contentLength)
                {
                    int read = stream.Read(payload, got, contentLength - got);
                    if (read == 0) break;
                    got += read;
                }
                body = Encoding.UTF8.GetString(payload, 0, got);
            }

            return true;
        }

        private static void Respond(NetworkStream stream, int status, string contentType, string content, string allowedOrigin)
        {
            byte[] payload = Encoding.UTF8.GetBytes(content ?? "");

            StringBuilder head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(status).Append(" ").Append(Reason(status)).Append("\r\n");
            head.Append("Content-Type: ").Append(contentType).Append("; charset=utf-8\r\n");
            head.Append("Content-Length: ").Append(payload.Length).Append("\r\n");
            head.Append("Connection: close\r\n");
            if (allowedOrigin != null)
            {
                head.Append("Access-Control-Allow-Origin: ").Append(allowedOrigin).Append("\r\n");
                head.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
                head.Append("Access-Control-Allow-Headers: content-type, ").Append(ClientHeader).Append(", x-forma-filename\r\n");
                head.Append("Access-Control-Max-Age: 600\r\n");
            }
            head.Append("\r\n");

            byte[] headBytes = Encoding.ASCII.GetBytes(head.ToString());
            stream.Write(headBytes, 0, headBytes.Length);
            if (payload.Length > 0) stream.Write(payload, 0, payload.Length);
            stream.Flush();
        }

        private static string Reason(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 202: return "Accepted";
                case 204: return "No Content";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                case 409: return "Conflict";
                case 424: return "Failed Dependency";
                case 502: return "Bad Gateway";
                default: return "Not Found";
            }
        }

        /// <summary>
        /// GET /health. app and designerVersion as before 2026-11-09, so an older
        /// Forma still reads it; then this program's own version, the DevExpress this
        /// run uses (or null), every version found, and the oldest it runs on.
        /// </summary>
        private static string HealthJson()
        {
            string own = typeof(Program).Assembly.GetName().Version.ToString(3);
            var b = new StringBuilder("{\"app\":\"RepxDesigner\",\"version\":").Append(SqlCompanion.Json(own));
            b.Append(",\"designerVersion\":").Append(Installed == null ? "null" : SqlCompanion.Json(RuntimeDesignerVersion()));
            b.Append(",\"devexpress\":");
            if (Installed == null) b.Append("null");
            else b.Append("{\"version\":").Append(SqlCompanion.Json(Installed.Version)).Append(",\"build\":").Append(SqlCompanion.Json(Installed.Build)).Append("}");
            b.Append(",\"found\":[").Append(string.Join(",", Found.Select(i => SqlCompanion.Json(i.Version)))).Append("]");
            b.Append(",\"oldest\":").Append(SqlCompanion.Json(DevExpressLocator.Oldest.ToString(2)));
            b.Append(",\"compiled\":").Append(SqlCompanion.Json(DevExpressLocator.Compiled));
            return b.Append("}").ToString();
        }

        /// <summary>The version of the DevExpress assembly actually loaded; names a DevExpress type, so never inlined.</summary>
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static string RuntimeDesignerVersion()
        {
            return typeof(XtraReport).Assembly.GetName().Version.ToString();
        }
    }
}
