using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
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
    /// This is the "open it in the real designer" half of Forma. Forma writes the
    /// report and edits it in place (the chat and the Preview change the REPX
    /// itself); this program opens that same file in DevExpress's own WinForms
    /// designer, for the work only the designer does, and saving there writes
    /// back to the file it opened. (Until 2026-11-11 this said the REPX was never
    /// edited after the request that wrote it, which stopped being true when the
    /// chat began editing reports in place.)
    ///
    /// The ways in:
    ///
    ///   RepxDesigner.exe                 pick a file (starts in Downloads)
    ///   RepxDesigner.exe report.repx     open that file (report scripts denied unless allowed, below)
    ///   RepxDesigner.exe --serve         listen on 127.0.0.1:7317 for Forma
    ///   RepxDesigner.exe --register      register the forma-repx:// protocol
    ///   RepxDesigner.exe --unregister    remove it again
    ///   RepxDesigner.exe --install       install for this user (also offered on a double-click, Installer.cs)
    ///   RepxDesigner.exe --uninstall     remove that install
    ///   RepxDesigner.exe --check         what DevExpress it finds, as JSON (DevExpressLocator.cs)
    ///
    /// --serve is what Forma's Open in designer dialog talks to (designerStep in
    /// src/lib/designerBridge.ts): when it is clicked the page asks /health, then
    /// POSTs the XML to /open, and the designer opens on it directly, with no
    /// download and no file dialog. Nothing is asked before the click. A browser
    /// cannot start a program itself, which is why this side has to exist at all.
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
                for (int i = 0; i + 1 < args.Length; i++)
                {
                    int pagePort;
                    if (args[i] == "--page-port" && int.TryParse(args[i + 1], out pagePort) && pagePort > 0 && pagePort < 65536) PagePorts.Add(pagePort);
                }
                RunServer(PortFrom(args), fromProtocol);
                return;
            }

            // The downloaded exe, double-clicked from wherever it was saved: offer to
            // install it, as an installer would (2026-11-09). The installed copy, and
            // "Open a report once", go on as before, to the file picker.
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

            // A file opened from Windows (Open with, the picker, the tray's Open a .repx)
            // runs no report script unasked (2026-11-11, the full audit, SE-02c). Until
            // then this path allowed scripts, on the reasoning that a file the person
            // opens is theirs; but Open with Forma Designer is on by default, and a .repx
            // downloaded from a share is one somebody else wrote. So scripts are denied
            // here too, and a report that carries one asks once, naming that it runs
            // code on this PC; Yes starts a process of its own that allows them, because
            // the mode holds for the whole process once set (measured, README).
            if (Array.IndexOf(args, AllowScripts) < 0)
            {
                DenyReportScripts();
                if (HasReportScripts(path) && AskToRunScripts(path))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(Application.ExecutablePath, "\"" + path + "\" " + AllowScripts) { UseShellExecute = false });
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show(
                            "This report could not be opened with its code allowed." + Environment.NewLine + Environment.NewLine + ex.Message,
                            "Forma Designer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                    return;
                }
            }

            OpenDesigner(path, false);
        }

        /// <summary>Passed only by the process the question above starts, never by an installer or a page.</summary>
        private const string AllowScripts = "--allow-scripts";

        /// <summary>
        /// Does the file carry code DevExpress runs? The same test as hasReportScripts
        /// in src/lib/shares.ts: a ScriptsSource with text in it, or a control's
        /// Scripts element naming an event handler. Read as text, before any load.
        /// </summary>
        private static bool HasReportScripts(string path)
        {
            try
            {
                return Regex.IsMatch(File.ReadAllText(path), "\\sScriptsSource=\"[^\"]|<Scripts\\b[^>]*\\sOn\\w+=\"[^\"]");
            }
            catch (Exception)
            {
                return false; // unreadable: the open below says so
            }
        }

        /// <summary>
        /// The one question this program asks about a report: a security question
        /// about the person's own PC, not a step to go on with. No is the default.
        /// </summary>
        private static bool AskToRunScripts(string path)
        {
            return MessageBox.Show(
                "This report contains code that runs on this PC when it is previewed or printed." + Environment.NewLine + Environment.NewLine +
                "File: " + Path.GetFileName(path) + Environment.NewLine + Environment.NewLine +
                "Allow its code to run only if you trust whoever made the report. If you choose No, the report opens " +
                "and you can edit it, but its preview will not run the code.",
                "Forma Designer - allow this report's code?",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }

        // ----------------------------------------------------------------- //
        // Opening
        // ----------------------------------------------------------------- //

        /// <summary>
        /// Opens a report, or says DevExpress is missing. A separate method from
        /// OpenDesignerCore, whose body names DevExpress types and so cannot even be
        /// compiled on a PC without it.
        /// </summary>
        private static void OpenDesigner(string path, bool fromPage)
        {
            if (Installed == null)
            {
                MissingDevExpress.ShowWindow(Found);
                return;
            }
            // OpenDesignerCore's own try cannot catch this: an assembly its body names
            // that will not load fails while the method is compiled, before its first
            // line. That is what a DevExpress without the WinForms designer did, in the
            // tray process, after the page had already been told the report opened
            // (2026-11-11, the full audit, SD-13; Usable now also asks for the designer).
            try
            {
                OpenDesignerCore(path, fromPage);
            }
            catch (Exception ex) when (ex is FileNotFoundException || ex is FileLoadException || ex is TypeLoadException ||
                ex is MissingMethodException || ex is BadImageFormatException)
            {
                MessageBox.Show(
                    "This PC's DevExpress has no WinForms report designer. Install DevExpress Reporting for WinForms." +
                    Environment.NewLine + Environment.NewLine + ex.GetType().Name + ": " + ex.Message,
                    "Forma Designer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "This report could not be opened in the designer." + Environment.NewLine + Environment.NewLine +
                    ex.GetType().Name + ": " + ex.Message,
                    "Forma Designer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static void OpenDesignerCore(string path, bool fromPage)
        {
            if (!File.Exists(path))
            {
                MessageBox.Show(
                    "There is no report at this place any more:" + Environment.NewLine + path,
                    "Forma Designer",
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
                // set so the designer's preview reads it, and saved as its name alone. A
                // report a page sent is not connected where it could change data (SD-15).
                List<string> notConnected;
                SqlCompanion.PrepareForDesigner(report, fromPage, out notConnected);

                using (ReportDesignTool tool = new ReportDesignTool(report))
                {
                    if (notConnected.Count > 0) SayNotConnected(tool, notConnected);
                    // Modal. Saving inside the designer writes back to `path`.
                    tool.ShowDesignerDialog();
                }
            }
            catch (Exception ex)
            {
                // A plain first line, then the details for whoever has to look into it
                // (2026-11-11, SD-24). The two versions are information, not a diagnosis:
                // a file targeting a newer release normally loads here regardless.
                MessageBox.Show(
                    "This report could not be opened in the designer." + Environment.NewLine + Environment.NewLine +
                    "File: " + Path.GetFileName(path) + Environment.NewLine +
                    "Written for DevExpress " + (fileVersion ?? "(not said)") + ", opened with DevExpress " + runtimeVersion + "." +
                    Environment.NewLine + Environment.NewLine +
                    ex.GetType().Name + ": " + ex.Message,
                    "Forma Designer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        /// <summary>
        /// Says, in the designer's own title, which data sources were left unconnected
        /// and why, so a Preview that cannot reach the database is not a mystery. Set
        /// once the window is shown, because the designer titles it as it loads.
        /// </summary>
        private static void SayNotConnected(ReportDesignTool tool, List<string> names)
        {
            Form form = tool.DesignForm as Form;
            if (form == null) return;
            string note = "not connected to your saved databases (" + string.Join(", ", names) +
                "): it came from a web page and runs a stored procedure or SQL that could change data. Open the file with Forma Designer to connect it.";
            form.Shown += (s, e) => { form.Text = form.Text + " - " + note; };
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
                    "Forma Designer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not register the forma-repx:// protocol." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "Forma Designer",
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
                    "Forma Designer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not remove the forma-repx:// protocol." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "Forma Designer",
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
            _port = port;
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

            // A report handed over by a page may be one somebody else shared, and a
            // .repx can carry C# that runs when it is previewed. So this process,
            // which only opens what pages send, denies report scripts (2026-11-09).
            // Measured with RepxProbe scripts: under Deny, DevExpress 20.1 refuses to
            // print a report with a script ("Report scripts were found in the
            // application while script execution is disabled"), and the mode holds
            // for the whole process whatever is set later, so it is set once, here.
            // A file the person opens themselves runs in a process of its own, which
            // denies them too and asks first (SE-02c, Run above).
            if (Installed != null) DenyReportScripts();

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
                    // In a process of its own: this one denies report scripts (below),
                    // and a file the person picks is theirs, as an Open with is.
                    string picked = PickFile();
                    if (!string.IsNullOrEmpty(picked))
                    {
                        try { Process.Start(new ProcessStartInfo(Application.ExecutablePath, "\"" + picked + "\"") { UseShellExecute = false }); }
                        catch (Exception ex) { Debug.WriteLine("Could not open: " + ex.Message); }
                    }
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

        /// <summary>The port this process listens on: the Host a request must name.</summary>
        private static int _port = DefaultPort;

        /// <summary>
        /// The largest request body read: a report with its pictures fits many times
        /// over, and a Content-Length larger is refused before anything is allocated
        /// (2026-11-11, the full audit, SE-06). It used to allocate whatever was asked.
        /// </summary>
        private const int MaxBody = 8 * 1024 * 1024;

        /// <summary>
        /// Each caller is served on the thread pool (2026-11-11, SD-14b): this loop
        /// used to serve one at a time, so a Live rows fill of a large table, or an
        /// idle socket that never finished its headers, left /health and /open waiting
        /// and the page said Forma Designer was not running. A socket now has ten
        /// seconds to send its request.
        /// </summary>
        private static void AcceptLoop(TcpListener listener)
        {
            while (true)
            {
                TcpClient client;
                try
                {
                    client = listener.AcceptTcpClient();
                }
                catch (SocketException)
                {
                    return; // listener stopped on exit
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                ThreadPool.QueueUserWorkItem(_ => Serve(client));
            }
        }

        private static void Serve(TcpClient client)
        {
            try
            {
                using (client)
                {
                    client.ReceiveTimeout = 10000;
                    client.SendTimeout = 10000;
                    using (NetworkStream stream = client.GetStream())
                    {
                        // Only this Windows user's programs (SE-05): see SameUser below.
                        if (!SameUser.IsCaller(client))
                        {
                            Respond(stream, 403, "text/plain", "", null);
                            return;
                        }
                        Handle(stream);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("Request failed: " + ex.Message);
            }
        }

        private static void Handle(NetworkStream stream)
        {
            string requestLine;
            Dictionary<string, string> headers;
            string body;

            int refused = ReadRequest(stream, out requestLine, out headers, out body);
            if (refused == -1)
            {
                return;
            }
            if (refused != 0)
            {
                Respond(stream, refused, "text/plain", "", null);
                return;
            }

            // The Host must be this listener's own name for itself (SE-06). A page that
            // rebinds its own domain to 127.0.0.1 is same-origin to the browser and sends
            // no preflight, but it cannot change the Host its requests carry.
            string host;
            headers.TryGetValue("host", out host);
            if (!IsOwnHost(host))
            {
                Respond(stream, 400, "text/plain", "Wrong Host", null);
                return;
            }

            string[] parts = requestLine.Split(' ');
            string method = parts.Length > 0 ? parts[0] : "";
            string target = parts.Length > 1 ? parts[1] : "";

            string origin;
            headers.TryGetValue("origin", out origin);
            string route = target.Split('?')[0];
            string allowed = AllowedFor(origin, route);

            if (method == "OPTIONS")
            {
                // Preflight. An origin we do not recognise, or the website asking for
                // a route it may not use, gets no Access-Control-Allow-Origin, so the
                // browser blocks the real request before it is ever sent. A browser
                // still sending the private-network preflight header is answered.
                string privateNetwork;
                headers.TryGetValue("access-control-request-private-network", out privateNetwork);
                Respond(stream, allowed == null ? 403 : 204, "text/plain", "", allowed,
                    allowed != null && string.Equals(privateNetwork, "true", StringComparison.OrdinalIgnoreCase));
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
                // The origin is checked on the request itself, not only on its preflight
                // (SE-06): a client that skips the preflight, or sends no Origin at all,
                // used to reach the designer with the header alone.
                if (allowed == null)
                {
                    Respond(stream, 403, "text/plain", "", null);
                    return;
                }
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
                    _pump.BeginInvoke(new Action(() => OpenDesigner(path, true)));
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Could not marshal to the UI thread: " + ex.Message);
                }
                return;
            }

            if (target.StartsWith("/sql/"))
            {
                // A page served from this PC only, whatever AllowedFor said (2026-11-09).
                HandleSql(stream, method, target, headers, body, IsLocalOrigin(origin) ? origin : null);
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
            // Forma's own ports alone (SE-05): any other web app a person runs on this PC
            // is a local origin too, and none of them is meant to read a database.
            if (allowed != null && !IsFormaPagePort(allowed)) allowed = null;
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
        /// A Forma page served from this PC (npm run dev, npm start): every route,
        /// the SQL Server ones included.
        /// </summary>
        private static bool IsLocalOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return false;
            return Regex.IsMatch(origin, @"^http://(localhost|127\.0\.0\.1)(:\d+)?$");
        }

        /// <summary>
        /// The ports a Forma page on this PC is served from: 3000 (npm run dev and npm
        /// start), 3001 (the second, mock server), and any a person adds with
        /// --page-port N when they run Forma elsewhere (2026-11-11, SE-05).
        /// </summary>
        private static readonly HashSet<int> PagePorts = new HashSet<int> { 3000, 3001 };

        private static bool IsFormaPagePort(string origin)
        {
            Match m = Regex.Match(origin ?? "", @":(\d+)$");
            int port;
            return m.Success && int.TryParse(m.Groups[1].Value, out port) && PagePorts.Contains(port);
        }

        /// <summary>The Host header this listener answers to: 127.0.0.1 or localhost, at its own port.</summary>
        private static bool IsOwnHost(string host)
        {
            if (string.IsNullOrEmpty(host)) return false;
            return string.Equals(host, "127.0.0.1:" + _port, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(host, "localhost:" + _port, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Forma's own website (2026-11-09, the owner's decision in the download
        /// programme): /health and /open only, never /sql/. Its page sends the first
        /// request only when the person clicks Open in designer, which is when the
        /// browser asks them, once, whether the site may reach programs on this PC.
        /// Kept equal to DESIGNER_SITE_ORIGINS in src/lib/designerBridge.ts by a test.
        /// </summary>
        private static readonly string[] SiteOrigins = { "https://openforma.web.app", "https://forma-201ba.web.app" };

        private static bool IsSiteOrigin(string origin)
        {
            return !string.IsNullOrEmpty(origin) && Array.IndexOf(SiteOrigins, origin) >= 0;
        }

        /// <summary>The origin to grant for this route, or null: the website reaches /health and /open alone.</summary>
        private static string AllowedFor(string origin, string route)
        {
            if (IsLocalOrigin(origin)) return origin;
            if (IsSiteOrigin(origin) && (route == "/health" || route == "/open")) return origin;
            return null;
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

        /// <summary>
        /// Reads one request: 0 when it was read, -1 when there is nothing to answer
        /// (the socket closed, or no blank line within 32 KB), or the status to refuse
        /// it with: 413 for a body over MaxBody, 400 for a Content-Length that is not
        /// a number, both decided before a byte of the body is allocated.
        /// </summary>
        private static int ReadRequest(
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

            if (headerEnd < 0) return -1;

            string head = Encoding.UTF8.GetString(buffer.GetBuffer(), 0, headerEnd);
            string[] lines = head.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length == 0) return -1;

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
            if (headers.TryGetValue("content-length", out lengthValue))
            {
                long declared;
                if (!long.TryParse(lengthValue, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out declared)) return 400;
                if (declared > MaxBody) return 413;
            }
            int contentLength;
            if (lengthValue != null &&
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

            return 0;
        }

        private static void Respond(NetworkStream stream, int status, string contentType, string content, string allowedOrigin, bool privateNetwork = false)
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
                // Chromium's private network access preflight, superseded by its permission
                // prompt but still sent by some versions: harmless to answer.
                if (privateNetwork) head.Append("Access-Control-Allow-Private-Network: true\r\n");
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
                case 413: return "Payload Too Large";
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

        /// <summary>Report scripts off for this process; names a DevExpress type, so never inlined.</summary>
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static void DenyReportScripts()
        {
            DevExpress.XtraReports.Security.ScriptPermissionManager.GlobalInstance =
                new DevExpress.XtraReports.Security.ScriptPermissionManager(DevExpress.XtraReports.Security.ExecutionMode.Deny);
        }

        /// <summary>The version of the DevExpress assembly actually loaded; names a DevExpress type, so never inlined.</summary>
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static string RuntimeDesignerVersion()
        {
            return typeof(XtraReport).Assembly.GetName().Version.ToString();
        }
    }

    /// <summary>
    /// Only this Windows user's own programs may call the companion (2026-11-11, the
    /// full audit, SE-05).
    ///
    /// 127.0.0.1 is one address for everybody signed in to a PC, and on a Remote
    /// Desktop server (this project's own home is one) that is many people. The
    /// Origin and x-forma-client headers stop a web page, not a program: any user's
    /// curl can send both, and /sql/ then reads the databases with this user's
    /// Windows sign-in or saved login. So each connection is traced to the process
    /// that opened it, through the TCP table Windows keeps (GetExtendedTcpTable, the
    /// one netstat -o reads), and refused unless that process runs as the same user.
    /// Free, with no prompt and no administrator.
    ///
    /// Measured 2026-11-11 on this server: the browser processes that hold this user's
    /// connections (chrome, msedge, node) all read as this user's SID; another user's
    /// chrome, msedge and node could not even be opened (error 5, access denied), and
    /// anything that cannot be read is refused.
    /// </summary>
    internal static class SameUser
    {
        private const int AfInet = 2;
        private const int TcpTableOwnerPidAll = 5;
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private const uint TokenQuery = 0x0008;

        [StructLayout(LayoutKind.Sequential)]
        private struct TcpRow
        {
            public uint State;
            public uint LocalAddr;
            public uint LocalPort;
            public uint RemoteAddr;
            public uint RemotePort;
            public uint OwningPid;
        }

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int ipVersion, int tableClass, uint reserved);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        private static readonly SecurityIdentifier Me = WindowsIdentity.GetCurrent().User;

        /// <summary>True when the program at the other end of this connection runs as this user.</summary>
        public static bool IsCaller(TcpClient client)
        {
            try
            {
                var remote = client.Client.RemoteEndPoint as IPEndPoint;
                var local = client.Client.LocalEndPoint as IPEndPoint;
                if (remote == null || local == null || !IPAddress.IsLoopback(remote.Address)) return false;
                int pid = OwnerOf(remote, local);
                if (pid <= 0) return false;
                if (pid == Process.GetCurrentProcess().Id) return true;
                SecurityIdentifier user = UserOf(pid);
                return user != null && Me != null && user.Equals(Me);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("Could not tell who called: " + ex.Message);
                return false;
            }
        }

        /// <summary>
        /// The process that owns the caller's end: the IPv4 row whose local end is the
        /// caller's address and port and whose remote end is this listener.
        /// </summary>
        private static int OwnerOf(IPEndPoint caller, IPEndPoint listener)
        {
            int size = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref size, false, AfInet, TcpTableOwnerPidAll, 0);
            for (int attempt = 0; attempt < 3; attempt++)
            {
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    uint result = GetExtendedTcpTable(buffer, ref size, false, AfInet, TcpTableOwnerPidAll, 0);
                    if (result == 122) continue; // ERROR_INSUFFICIENT_BUFFER: the table grew; size holds the new need
                    if (result != 0) return -1;
                    int rows = Marshal.ReadInt32(buffer);
                    int rowSize = Marshal.SizeOf(typeof(TcpRow));
                    uint callerAddr = BitConverter.ToUInt32(caller.Address.GetAddressBytes(), 0);
                    for (int i = 0; i < rows; i++)
                    {
                        var row = (TcpRow)Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + 4 + i * rowSize), typeof(TcpRow));
                        if (row.LocalAddr == callerAddr && Port(row.LocalPort) == caller.Port && Port(row.RemotePort) == listener.Port)
                        {
                            return (int)row.OwningPid;
                        }
                    }
                    return -1;
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            return -1;
        }

        /// <summary>A port as the table holds it: network byte order in the low 16 bits.</summary>
        private static int Port(uint value)
        {
            return (int)(((value & 0xFF) << 8) | ((value >> 8) & 0xFF));
        }

        /// <summary>The user a process runs as, or null when it cannot be read (another user's).</summary>
        private static SecurityIdentifier UserOf(int pid)
        {
            IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, pid);
            if (process == IntPtr.Zero) return null;
            try
            {
                IntPtr token;
                if (!OpenProcessToken(process, TokenQuery, out token)) return null;
                try
                {
                    using (var identity = new WindowsIdentity(token)) return identity.User;
                }
                finally
                {
                    CloseHandle(token);
                }
            }
            finally
            {
                CloseHandle(process);
            }
        }
    }
}
