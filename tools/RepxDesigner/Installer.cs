using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace RepxDesigner
{
    /// <summary>
    /// Where an install goes. The real one is the current user's own, with no
    /// administrator: the program in %LOCALAPPDATA%\Programs\Forma Designer, as VS
    /// Code's user setup does, and everything else under HKCU. --sandbox &lt;dir&gt;
    /// moves all of it, files under that folder and keys under
    /// HKCU\Software\FormaDesigner-Sandbox, so an install can be tested from a
    /// shell without touching the account's real settings.
    /// </summary>
    internal sealed class InstallTarget
    {
        public string ProgramDir;
        public string StartMenuDir;
        /// <summary>"Software", or the sandbox's key: Classes, Run and Uninstall sit under it.</summary>
        public string RegistryBase;
        public bool Sandbox;

        public string Exe { get { return Path.Combine(ProgramDir, "RepxDesigner.exe"); } }
        public string ClassesKey { get { return RegistryBase + @"\Classes"; } }
        public string RunKey { get { return RegistryBase + @"\Microsoft\Windows\CurrentVersion\Run"; } }
        public string UninstallKey { get { return RegistryBase + @"\Microsoft\Windows\CurrentVersion\Uninstall\FormaDesigner"; } }
        public string StartMenuLink { get { return Path.Combine(StartMenuDir, "Forma Designer.lnk"); } }

        public const string SandboxKey = @"Software\FormaDesigner-Sandbox";

        public static InstallTarget For(string[] args)
        {
            int at = Array.IndexOf(args, "--sandbox");
            if (at >= 0 && at + 1 < args.Length)
            {
                string dir = Path.GetFullPath(args[at + 1]);
                return new InstallTarget
                {
                    ProgramDir = Path.Combine(dir, @"Programs\Forma Designer"),
                    StartMenuDir = Path.Combine(dir, "Start Menu"),
                    RegistryBase = SandboxKey,
                    Sandbox = true,
                };
            }
            return new InstallTarget
            {
                ProgramDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Forma Designer"),
                StartMenuDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                RegistryBase = "Software",
            };
        }
    }

    /// <summary>
    /// Installs and removes Forma Designer for the current user (2026-11-09, the
    /// owner's download programme, batch WC). Everything a person did by hand
    /// before, in one step: the forma-repx:// handler Forma's button starts it
    /// through, a Start menu entry, starting with Windows (a Run value, which
    /// Settings, Apps, Startup can switch off), "Open with Forma Designer" for
    /// .repx files, and an entry in Settings, Apps, Installed apps whose Uninstall
    /// removes all of it. No administrator, nothing machine-wide.
    ///
    /// Names no DevExpress type: it installs on a PC that has none yet.
    /// </summary>
    internal static class Installer
    {
        public const string DisplayName = "Forma Designer";
        public const string RunValue = "Forma Designer";
        public const string ProgId = "FormaDesigner.repx";
        public const string Scheme = "forma-repx";
        public const string DownloadPage = "https://openforma.web.app/download";

        public static string Version { get { return typeof(Installer).Assembly.GetName().Version.ToString(3); } }

        /// <summary>Is this process the installed copy?</summary>
        public static bool IsRunningInstalled(InstallTarget t)
        {
            return string.Equals(Path.GetFullPath(Application.ExecutablePath), Path.GetFullPath(t.Exe), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>The version installed, or null.</summary>
        public static string InstalledVersion(InstallTarget t)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(t.UninstallKey))
            {
                return key == null || !File.Exists(t.Exe) ? null : key.GetValue("DisplayVersion") as string;
            }
        }

        /// <summary>The forma-repx:// handler, as --register has written it since 2026-08.</summary>
        public static void WriteProtocol(string exe, string classesKey)
        {
            using (var root = Registry.CurrentUser.CreateSubKey(classesKey + @"\" + Scheme))
            {
                root.SetValue(string.Empty, "URL:Forma report designer");
                // Presence of this value -- not its content -- is what marks the key as a
                // URL protocol. Omitting it makes the whole thing inert with no error.
                root.SetValue("URL Protocol", string.Empty);
                using (var icon = root.CreateSubKey("DefaultIcon")) icon.SetValue(string.Empty, exe + ",0");
                using (var command = root.CreateSubKey(@"shell\open\command")) command.SetValue(string.Empty, "\"" + exe + "\" --serve \"%1\"");
            }
        }

        public static List<string> Install(InstallTarget t, bool startup, bool openWith)
        {
            var done = new List<string>();
            StopOthers(t.ProgramDir);

            Directory.CreateDirectory(t.ProgramDir);
            string source = Path.GetFullPath(Application.ExecutablePath);
            if (!IsRunningInstalled(t))
            {
                File.Copy(source, t.Exe, true);
                // The readme, licence and notice the download carries, when they are beside it.
                foreach (string extra in Directory.GetFiles(Path.GetDirectoryName(source), "*.txt"))
                {
                    string name = Path.GetFileName(extra);
                    if (name.StartsWith("LICENSE", StringComparison.OrdinalIgnoreCase) || name.StartsWith("NOTICE", StringComparison.OrdinalIgnoreCase) ||
                        name.StartsWith("README", StringComparison.OrdinalIgnoreCase))
                    {
                        File.Copy(extra, Path.Combine(t.ProgramDir, name), true);
                    }
                }
            }
            done.Add("program: " + t.Exe);

            WriteProtocol(t.Exe, t.ClassesKey);
            done.Add("forma-repx:// handler");

            Directory.CreateDirectory(t.StartMenuDir);
            CreateShortcut(t.StartMenuLink, t.Exe, "--serve", "Opens Forma's reports in the DevExpress report designer");
            done.Add("Start menu: " + t.StartMenuLink);

            using (var run = Registry.CurrentUser.CreateSubKey(t.RunKey))
            {
                if (startup) { run.SetValue(RunValue, "\"" + t.Exe + "\" --serve"); done.Add("starts with Windows"); }
                else run.DeleteValue(RunValue, false);
            }

            if (openWith) { WriteOpenWith(t); done.Add("Open with Forma Designer for .repx"); }
            else RemoveOpenWith(t);

            using (var key = Registry.CurrentUser.CreateSubKey(t.UninstallKey))
            {
                key.SetValue("DisplayName", DisplayName);
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", "Forma");
                key.SetValue("DisplayIcon", t.Exe + ",0");
                key.SetValue("InstallLocation", t.ProgramDir);
                key.SetValue("UninstallString", "\"" + t.Exe + "\" --uninstall" + (t.Sandbox ? " --sandbox \"" + SandboxRoot(t) + "\"" : ""));
                key.SetValue("QuietUninstallString", "\"" + t.Exe + "\" --uninstall --quiet" + (t.Sandbox ? " --sandbox \"" + SandboxRoot(t) + "\"" : ""));
                key.SetValue("URLInfoAbout", DownloadPage);
                key.SetValue("HelpLink", "https://openforma.web.app/docs#designer");
                key.SetValue("EstimatedSize", (int)Math.Max(1, new DirectoryInfo(t.ProgramDir).GetFiles().Sum(f => f.Length) / 1024), RegistryValueKind.DWord);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
            done.Add("Settings, Apps: " + DisplayName + " " + Version);
            return done;
        }

        private static string SandboxRoot(InstallTarget t)
        {
            return Path.GetFullPath(Path.Combine(t.ProgramDir, @"..\.."));
        }

        /// <summary>
        /// "Open with Forma Designer" for .repx: an entry in the Open with list
        /// (OpenWithProgids), never the default, so whatever opens .repx files today
        /// still does.
        /// </summary>
        private static void WriteOpenWith(InstallTarget t)
        {
            using (var prog = Registry.CurrentUser.CreateSubKey(t.ClassesKey + @"\" + ProgId))
            {
                prog.SetValue(string.Empty, "DevExpress report layout");
                prog.SetValue("FriendlyTypeName", "DevExpress report layout");
                using (var icon = prog.CreateSubKey("DefaultIcon")) icon.SetValue(string.Empty, t.Exe + ",0");
                using (var command = prog.CreateSubKey(@"shell\open\command")) command.SetValue(string.Empty, "\"" + t.Exe + "\" \"%1\"");
            }
            using (var ext = Registry.CurrentUser.CreateSubKey(t.ClassesKey + @"\.repx\OpenWithProgids"))
            {
                ext.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            }
            using (var app = Registry.CurrentUser.CreateSubKey(t.ClassesKey + @"\Applications\RepxDesigner.exe"))
            {
                app.SetValue("FriendlyAppName", DisplayName);
                using (var types = app.CreateSubKey("SupportedTypes")) types.SetValue(".repx", string.Empty);
                using (var command = app.CreateSubKey(@"shell\open\command")) command.SetValue(string.Empty, "\"" + t.Exe + "\" \"%1\"");
            }
        }

        private static void RemoveOpenWith(InstallTarget t)
        {
            Registry.CurrentUser.DeleteSubKeyTree(t.ClassesKey + @"\" + ProgId, false);
            Registry.CurrentUser.DeleteSubKeyTree(t.ClassesKey + @"\Applications\RepxDesigner.exe", false);
            using (var ext = Registry.CurrentUser.OpenSubKey(t.ClassesKey + @"\.repx\OpenWithProgids", true))
            {
                if (ext != null) ext.DeleteValue(ProgId, false);
            }
        }

        /// <summary>Removes everything Install wrote. The SQL Server connections stay unless asked.</summary>
        public static List<string> Uninstall(InstallTarget t, bool removeConnections, out List<string> kept)
        {
            var done = new List<string>();
            kept = new List<string>();
            StopOthers(t.ProgramDir);

            using (var run = Registry.CurrentUser.OpenSubKey(t.RunKey, true))
            {
                if (run != null && run.GetValue(RunValue) != null) { run.DeleteValue(RunValue, false); done.Add("no longer starts with Windows"); }
            }
            if (File.Exists(t.StartMenuLink)) { File.Delete(t.StartMenuLink); done.Add("Start menu entry"); }

            // The handler only when it starts this install: one registered by a copy
            // built from source, elsewhere, is that copy's.
            using (var command = Registry.CurrentUser.OpenSubKey(t.ClassesKey + @"\" + Scheme + @"\shell\open\command"))
            {
                string value = command == null ? null : command.GetValue(string.Empty) as string;
                if (value != null && value.IndexOf(t.ProgramDir, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    command.Close();
                    Registry.CurrentUser.DeleteSubKeyTree(t.ClassesKey + @"\" + Scheme, false);
                    done.Add("forma-repx:// handler");
                }
                else if (value != null)
                {
                    kept.Add("the forma-repx:// handler, which starts another copy: " + value);
                }
            }

            RemoveOpenWith(t);
            done.Add("Open with Forma Designer");
            Registry.CurrentUser.DeleteSubKeyTree(t.UninstallKey, false);
            done.Add("Settings, Apps entry");

            if (removeConnections)
            {
                if (File.Exists(SqlCompanion.StorePath)) { File.Delete(SqlCompanion.StorePath); done.Add("SQL Server connections"); }
            }
            else if (File.Exists(SqlCompanion.StorePath))
            {
                kept.Add("your SQL Server connections, in " + SqlCompanion.StorePath);
            }

            if (IsRunningInstalled(t))
            {
                // A running program cannot delete itself: a hidden cmd waits for this one
                // to exit, then removes the folder.
                Process.Start(new ProcessStartInfo("cmd.exe",
                    "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + t.ProgramDir + "\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
                done.Add("program folder, once this window closes: " + t.ProgramDir);
            }
            else if (Directory.Exists(t.ProgramDir))
            {
                Directory.Delete(t.ProgramDir, true);
                done.Add("program folder: " + t.ProgramDir);
            }
            return done;
        }

        /// <summary>
        /// Stops another copy of this program running from the install folder, so its
        /// file can be replaced or removed. Only this user's: another user's process
        /// on a shared PC cannot be read, and is left alone.
        /// </summary>
        private static void StopOthers(string programDir)
        {
            int me = Process.GetCurrentProcess().Id;
            foreach (Process p in Process.GetProcessesByName("RepxDesigner"))
            {
                try
                {
                    if (p.Id == me) continue;
                    string file = p.MainModule.FileName;
                    if (file.StartsWith(programDir, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(5000);
                    }
                }
                catch (Exception)
                {
                    // Not ours to read, or already gone.
                }
                finally
                {
                    p.Dispose();
                }
            }
        }

        /// <summary>A .lnk through the shell's own object, by reflection: no reference to add.</summary>
        private static void CreateShortcut(string link, string target, string arguments, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            Type s = shortcut.GetType();
            s.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            s.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
            s.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(target) });
            s.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            s.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { target + ",0" });
            s.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        /// <summary>--installed: what is installed, as JSON, for a script or a test.</summary>
        public static string Report(InstallTarget t)
        {
            string version = InstalledVersion(t);
            string runValue = null, protocol = null;
            bool openWith;
            using (var run = Registry.CurrentUser.OpenSubKey(t.RunKey)) runValue = run == null ? null : run.GetValue(RunValue) as string;
            using (var cmd = Registry.CurrentUser.OpenSubKey(t.ClassesKey + @"\" + Scheme + @"\shell\open\command")) protocol = cmd == null ? null : cmd.GetValue(string.Empty) as string;
            using (var ext = Registry.CurrentUser.OpenSubKey(t.ClassesKey + @"\.repx\OpenWithProgids")) openWith = ext != null && ext.GetValueNames().Contains(ProgId);
            return "{\"installed\":" + (version == null ? "false" : "true") +
                ",\"version\":" + SqlCompanion.Json(version) +
                ",\"program\":" + SqlCompanion.Json(File.Exists(t.Exe) ? t.Exe : null) +
                ",\"startMenu\":" + (File.Exists(t.StartMenuLink) ? "true" : "false") +
                ",\"startup\":" + SqlCompanion.Json(runValue) +
                ",\"protocol\":" + SqlCompanion.Json(protocol) +
                ",\"openWith\":" + (openWith ? "true" : "false") +
                ",\"sandbox\":" + (t.Sandbox ? "true" : "false") + "}";
        }

        // ------------------------------------------------------------ windows

        /// <summary>What a person chose in the offer to install.</summary>
        public enum Choice { Install, RunOnce, Cancel }

        /// <summary>
        /// The offer shown when the downloaded exe is opened from anywhere but its
        /// install folder: install (the default), run it once as it is, or cancel.
        /// </summary>
        public static Choice Offer(InstallTarget t, out bool startup, out bool openWith)
        {
            string installed = InstalledVersion(t);
            using (var form = new Form())
            {
                form.Text = "Forma Designer " + Version;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.ClientSize = new Size(520, 270);
                form.Font = SystemFonts.MessageBoxFont;

                var headline = new Label
                {
                    Text = installed == null ? "Install Forma Designer?" : "Update Forma Designer " + installed + " to " + Version + "?",
                    Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 11f, FontStyle.Bold),
                    Location = new Point(16, 14),
                    Size = new Size(488, 26),
                };
                var body = new Label
                {
                    Text = "Forma Designer opens your reports from Forma in the DevExpress report designer on this PC. " +
                        "It installs for " + Environment.UserName + " only, in " + t.ProgramDir + ", with no administrator, " +
                        "and Settings, Apps removes it.",
                    Location = new Point(16, 46),
                    Size = new Size(488, 64),
                };
                var start = new CheckBox
                {
                    Text = "Start it when I sign in to Windows, so Open in designer works at once",
                    Checked = true,
                    Location = new Point(16, 116),
                    Size = new Size(488, 24),
                };
                var open = new CheckBox
                {
                    Text = "Add \"Open with Forma Designer\" for .repx files",
                    Checked = true,
                    Location = new Point(16, 144),
                    Size = new Size(488, 24),
                };
                var install = new Button { Text = installed == null ? "Install" : "Update", Location = new Point(176, 222), Size = new Size(110, 30), DialogResult = DialogResult.OK };
                var once = new Button { Text = "Run once", Location = new Point(294, 222), Size = new Size(110, 30), DialogResult = DialogResult.Retry };
                var cancel = new Button { Text = "Cancel", Location = new Point(412, 222), Size = new Size(92, 30), DialogResult = DialogResult.Cancel };
                form.Controls.AddRange(new Control[] { headline, body, start, open, install, once, cancel });
                form.AcceptButton = install;
                form.CancelButton = cancel;

                DialogResult result = form.ShowDialog();
                startup = start.Checked;
                openWith = open.Checked;
                return result == DialogResult.OK ? Choice.Install : result == DialogResult.Retry ? Choice.RunOnce : Choice.Cancel;
            }
        }

        /// <summary>Asks before removing, with the choice to remove the SQL Server connections too.</summary>
        public static bool ConfirmUninstall(out bool removeConnections)
        {
            using (var form = new Form())
            {
                form.Text = "Remove Forma Designer";
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.ClientSize = new Size(460, 170);
                form.Font = SystemFonts.MessageBoxFont;
                var body = new Label
                {
                    Text = "Remove Forma Designer from this PC? Forma's Open in designer will ask you to download it again. " +
                        "DevExpress is not touched.",
                    Location = new Point(16, 16),
                    Size = new Size(428, 48),
                };
                var connections = new CheckBox
                {
                    Text = "Also remove my SQL Server connections",
                    Checked = false,
                    Location = new Point(16, 72),
                    Size = new Size(428, 24),
                };
                var remove = new Button { Text = "Remove", Location = new Point(244, 122), Size = new Size(100, 30), DialogResult = DialogResult.OK };
                var cancel = new Button { Text = "Cancel", Location = new Point(352, 122), Size = new Size(92, 30), DialogResult = DialogResult.Cancel };
                form.Controls.AddRange(new Control[] { body, connections, remove, cancel });
                form.AcceptButton = remove;
                form.CancelButton = cancel;
                bool yes = form.ShowDialog() == DialogResult.OK;
                removeConnections = connections.Checked;
                return yes;
            }
        }

        public static string Lines(IEnumerable<string> items)
        {
            var b = new StringBuilder();
            foreach (string item in items) b.Append("  - ").Append(item).Append(Environment.NewLine);
            return b.ToString();
        }

        public static string JsonList(IEnumerable<string> items)
        {
            return "[" + string.Join(",", items.Select(SqlCompanion.Json)) + "]";
        }
    }
}
