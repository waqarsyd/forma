using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace RepxDesigner
{
    /// <summary>
    /// One DevExpress installation found on this PC.
    /// </summary>
    internal sealed class DevExpressInstall
    {
        /// <summary>Major and minor, as DevExpress names its assemblies: "20.1".</summary>
        public string Version;
        /// <summary>The full build when something said it ("20.1.3"), else null.</summary>
        public string Build;
        /// <summary>Components\Bin\Framework, or null when only the GAC holds it.</summary>
        public string Bin;
        /// <summary>Where it was seen: registry, folder, gac.</summary>
        public readonly List<string> Sources = new List<string>();
        /// <summary>
        /// Where its WinForms report designer (DevExpress.XtraReports.vN.N.Extensions)
        /// was found, the Bin file or "gac", or null when this install has none: a
        /// web- or WPF-only DevExpress has the report engine and no designer to open
        /// (2026-11-11, the full audit, SD-13).
        /// </summary>
        public string Extensions;

        public Version Number { get { return System.Version.Parse(Version); } }
    }

    /// <summary>
    /// Finds DevExpress on this PC, and lets this program run on whichever version
    /// is there (2026-11-09, the owner's download programme, batch WA).
    ///
    /// Nothing in this file names a DevExpress type: it runs before anything has
    /// checked that DevExpress exists, and .NET compiles a method, and loads every
    /// assembly its body names, before the first line of it runs.
    ///
    /// Where an installation shows, measured on this machine (DevExpress 20.1.3):
    ///   HKLM\SOFTWARE\WOW6432Node\DevExpress\Components\v20.1  RootDirectory, Build
    ///   C:\Program Files (x86)\DevExpress 20.1\Components\Bin\Framework
    ///   C:\Windows\Microsoft.NET\assembly\GAC_MSIL\DevExpress.XtraReports.v20.1\v4.0_20.1.3.0__b88d1754d700e49a
    ///   the uninstall entry "DevExpress Components 20.1" (20.1.3, no install location)
    /// Newer installers put the folder under Program Files and may leave the GAC
    /// alone, so all three are read, both registry views, and merged by version.
    ///
    /// Why one program can run on another version: every DevExpress assembly has
    /// its version in its name (DevExpress.XtraReports.v20.1), so a PC with only
    /// 25.2 fails to find what this program was built against. The runtime then
    /// asks AssemblyResolve, and Resolve answers with the same assembly of the
    /// version installed, DevExpress.XtraReports.v25.2.dll; types are found by
    /// their full name in whatever assembly comes back. The mechanism is measured
    /// here with 20.1 standing in for a version the program was not built
    /// against (--check --alias 99.9); a real newer version is the owner's to
    /// check, because the trial must never be installed on this server.
    /// </summary>
    internal static class DevExpressLocator
    {
        /// <summary>The version this program is compiled against.</summary>
        public const string Compiled = "20.1";

        /// <summary>The oldest version it is known to run on.</summary>
        public static readonly Version Oldest = new Version(20, 1);

        /// <summary>DevExpress's public key token, the same for every version.</summary>
        public const string Token = "b88d1754d700e49a";

        /// <summary>The trial page, where the program sends someone who has none.</summary>
        public const string TrialUrl = "https://www.devexpress.com/products/try/";

        // For measuring, never for users: --devexpress-root <dir> adds a folder
        // read as an install's root, --no-registry, --no-folders and --no-gac leave
        // a source out, so "no DevExpress" can be simulated on a PC that has it.
        public static string RootOverride;
        public static bool NoRegistry, NoFolders, NoGac;
        public static string GacRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"Microsoft.NET\assembly\GAC_MSIL");

        public static void Configure(string[] args)
        {
            int root = Array.IndexOf(args, "--devexpress-root");
            if (root >= 0 && root + 1 < args.Length) RootOverride = args[root + 1];
            NoRegistry = Array.IndexOf(args, "--no-registry") >= 0;
            NoFolders = Array.IndexOf(args, "--no-folders") >= 0;
            NoGac = Array.IndexOf(args, "--no-gac") >= 0;
        }

        /// <summary>Every installation found, newest first.</summary>
        public static List<DevExpressInstall> Find()
        {
            var byVersion = new Dictionary<string, DevExpressInstall>();
            Action<string, string, string, string> add = (version, build, bin, source) =>
            {
                DevExpressInstall install;
                if (!byVersion.TryGetValue(version, out install))
                {
                    install = new DevExpressInstall { Version = version };
                    byVersion[version] = install;
                }
                if (install.Build == null && build != null) install.Build = build;
                if (install.Bin == null && bin != null) install.Bin = bin;
                if (!install.Sources.Contains(source)) install.Sources.Add(source);
            };

            if (!NoRegistry)
            {
                foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
                {
                    try
                    {
                        using (var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                        using (var components = hklm.OpenSubKey(@"SOFTWARE\DevExpress\Components"))
                        {
                            if (components == null) continue;
                            foreach (string name in components.GetSubKeyNames())
                            {
                                var m = Regex.Match(name, @"^v(\d+\.\d+)$");
                                if (!m.Success) continue;
                                using (var key = components.OpenSubKey(name))
                                {
                                    string rootDir = key == null ? null : key.GetValue("RootDirectory") as string;
                                    object build = key == null ? null : key.GetValue("Build");
                                    string bin = BinOf(rootDir);
                                    add(m.Groups[1].Value, build == null ? null : m.Groups[1].Value + "." + build, bin, "registry");
                                }
                            }
                        }
                    }
                    catch (Exception)
                    {
                        // A registry that cannot be read says nothing; the other sources still can.
                    }
                }
            }

            var roots = new List<string>();
            if (!NoFolders)
            {
                foreach (var folder in new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles })
                {
                    string programs = Environment.GetFolderPath(folder);
                    if (!string.IsNullOrEmpty(programs) && !roots.Contains(programs)) roots.Add(programs);
                }
            }
            if (!string.IsNullOrEmpty(RootOverride)) roots.Add(RootOverride);
            foreach (string programs in roots)
            {
                if (!Directory.Exists(programs)) continue;
                string[] dirs;
                try { dirs = Directory.GetDirectories(programs, "DevExpress *"); }
                catch (Exception) { continue; }
                foreach (string dir in dirs)
                {
                    var m = Regex.Match(Path.GetFileName(dir), @"^DevExpress (\d+\.\d+)$");
                    if (!m.Success) continue;
                    string bin = BinOf(Path.Combine(dir, "Components"));
                    if (bin != null) add(m.Groups[1].Value, null, bin, "folder");
                }
            }

            if (!NoGac && Directory.Exists(GacRoot))
            {
                string[] dirs;
                try { dirs = Directory.GetDirectories(GacRoot, "DevExpress.XtraReports.v*"); }
                catch (Exception) { dirs = new string[0]; }
                foreach (string dir in dirs)
                {
                    var m = Regex.Match(Path.GetFileName(dir), @"^DevExpress\.XtraReports\.v(\d+\.\d+)$");
                    if (!m.Success) continue;
                    foreach (string sub in Directory.GetDirectories(dir))
                    {
                        var v = Regex.Match(Path.GetFileName(sub), @"^v4\.0_(\d+\.\d+\.\d+)\.\d+__" + Token + "$");
                        if (v.Success) add(m.Groups[1].Value, v.Groups[1].Value, null, "gac");
                    }
                }
            }

            foreach (DevExpressInstall install in byVersion.Values) install.Extensions = ExtensionsOf(install);
            return byVersion.Values.OrderByDescending(i => i.Number).ToList();
        }

        /// <summary>The name of the assembly that holds the WinForms report designer, in a version.</summary>
        public static string ExtensionsName(string version)
        {
            return "DevExpress.XtraReports.v" + version + ".Extensions";
        }

        /// <summary>Where an install's designer assembly is: its Bin file, "gac", or null.</summary>
        private static string ExtensionsOf(DevExpressInstall install)
        {
            string name = ExtensionsName(install.Version);
            if (install.Bin != null)
            {
                string file = Path.Combine(install.Bin, name + ".dll");
                if (File.Exists(file)) return file;
            }
            if (!NoGac)
            {
                try
                {
                    string dir = Path.Combine(GacRoot, name);
                    if (Directory.Exists(dir) && Directory.GetDirectories(dir).Length > 0) return "gac";
                }
                catch (Exception)
                {
                    // An unreadable GAC says nothing; the Bin folder already answered if it could.
                }
            }
            return null;
        }

        /// <summary>The folder holding the .NET Framework assemblies under an install's root.</summary>
        private static string BinOf(string componentsRoot)
        {
            if (string.IsNullOrEmpty(componentsRoot)) return null;
            string bin = Path.Combine(componentsRoot, @"Bin\Framework");
            return Directory.Exists(bin) ? bin : null;
        }

        /// <summary>
        /// The newest installation this program can run on, or null. "Can run on"
        /// includes the WinForms designer since 2026-11-11 (SD-13): before, a PC
        /// with DevExpress for the web alone counted as found, the page said
        /// "Opened" and the tray process died loading a designer that was not there.
        /// </summary>
        public static DevExpressInstall Usable(List<DevExpressInstall> found)
        {
            return found.FirstOrDefault(i => i.Number >= Oldest && i.Extensions != null);
        }

        private static DevExpressInstall _target;

        /// <summary>From here on, a DevExpress assembly not found is loaded from <paramref name="target"/>.</summary>
        public static void Use(DevExpressInstall target)
        {
            _target = target;
            AppDomain.CurrentDomain.AssemblyResolve -= Resolve;
            AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        }

        /// <summary>The name a DevExpress assembly has in another version, or null when it is not one.</summary>
        public static string Rename(string assemblyName, string version)
        {
            var m = Regex.Match(assemblyName ?? "", @"^(DevExpress\.[\w.]+?)\.v\d+\.\d+((?:\.[\w]+)*)$");
            return m.Success ? m.Groups[1].Value + ".v" + version + m.Groups[2].Value : null;
        }

        /// <summary>
        /// Set while Resolve is loading, on this thread: the Assembly.Load below asks
        /// the runtime again, and a miss there would land back here.
        /// </summary>
        [ThreadStatic] private static bool _resolving;

        /// <summary>
        /// Answers a DevExpress assembly the runtime could not bind with the same one
        /// from the install found.
        ///
        /// Until 2026-11-11 (the full audit, SD-01) it answered only when the name
        /// differed (another major version), and returned null when the name was the
        /// same. But the name is the same on every 20.1 build, and the reference is
        /// to 20.1.3.0 exactly: DevExpress ships no publisher policy in the GAC, so on
        /// a PC with 20.1.12, or with 20.1.3 in its Bin folder and not the GAC, the
        /// runtime misses, asks here, and was told nothing. The program then died at
        /// its first DevExpress call. Now a same-named request is answered from the
        /// install as well: its Bin file, else the GAC at the build installed.
        /// Measured with --check --simulate-build, below.
        /// </summary>
        private static Assembly Resolve(object sender, ResolveEventArgs e)
        {
            if (_target == null || _resolving) return null;
            AssemblyName wanted;
            try { wanted = new AssemblyName(e.Name); }
            catch (Exception) { return null; }
            // A culture's satellite is optional; asking for another version's would only fail louder.
            if (wanted.Name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase)) return null;
            string renamed = Rename(wanted.Name, _target.Version);
            if (renamed == null) return null;

            _resolving = true;
            try
            {
                if (_target.Bin != null)
                {
                    string path = Path.Combine(_target.Bin, renamed + ".dll");
                    if (File.Exists(path)) return Assembly.LoadFrom(path);
                }
                // The GAC at the build installed. When that is the very version asked
                // for, the runtime has just missed it, and asking again cannot help.
                bool sameName = string.Equals(renamed, wanted.Name, StringComparison.OrdinalIgnoreCase);
                bool sameBuild = wanted.Version != null && _target.Build != null &&
                    string.Equals(wanted.Version.ToString(3), _target.Build, StringComparison.Ordinal);
                if (_target.Build != null && !(sameName && sameBuild))
                {
                    try
                    {
                        return Assembly.Load(renamed + ", Version=" + _target.Build + ".0, Culture=neutral, PublicKeyToken=" + Token);
                    }
                    catch (Exception)
                    {
                        return null;
                    }
                }
                return null;
            }
            finally
            {
                _resolving = false;
            }
        }
    }

    /// <summary>
    /// --check: what this program finds, as JSON on standard output, with no
    /// window, so a script or an agent shell can ask (exit 0 when it can run,
    /// 3 when no usable DevExpress is installed). Only reflection here, for the
    /// reason at the top of DevExpressLocator.
    /// </summary>
    internal static class Check
    {
        public static int Run(string[] args)
        {
            var found = DevExpressLocator.Find();
            var usable = DevExpressLocator.Usable(found);
            var json = new StringBuilder();
            json.Append("{\"app\":\"RepxDesigner\",\"compiled\":\"").Append(DevExpressLocator.Compiled).Append("\",\"found\":[");
            json.Append(string.Join(",", found.Select(i =>
                "{\"version\":" + Str(i.Version) + ",\"build\":" + Str(i.Build) + ",\"bin\":" + Str(i.Bin) +
                ",\"designer\":" + (i.Extensions == null ? "null" : "{\"assembly\":" + Str(DevExpressLocator.ExtensionsName(i.Version)) + ",\"at\":" + Str(i.Extensions) + "}") +
                ",\"sources\":[" + string.Join(",", i.Sources.Select(Str)) + "]}")));
            json.Append("],\"using\":").Append(usable == null ? "null" : Str(usable.Version));

            if (usable != null && Array.IndexOf(args, "--no-load") < 0)
            {
                DevExpressLocator.Use(usable);
                // What the program itself asks for: the version its reference names, read off
                // this assembly (no DevExpress type is named), never a number written here.
                // --simulate-build 20.1.99 asks for a build that is not installed, as the
                // program's 20.1.3 reference is on a PC with another 20.1 build, so the
                // same-named answer in Resolve is measured here (2026-11-11, SD-01).
                string asked = Referenced("DevExpress.XtraReports.v" + DevExpressLocator.Compiled);
                int simulate = Array.IndexOf(args, "--simulate-build");
                if (simulate >= 0 && simulate + 1 < args.Length && Regex.IsMatch(args[simulate + 1], @"^\d+\.\d+\.\d+$"))
                {
                    asked = args[simulate + 1] + ".0";
                    json.Append(",\"simulated\":").Append(Str(asked));
                }
                json.Append(",\"load\":").Append(Load("DevExpress.XtraReports.v" + DevExpressLocator.Compiled + ", Version=" + asked + ", Culture=neutral, PublicKeyToken=" + DevExpressLocator.Token));
                json.Append(",\"designerLoad\":").Append(LoadOnly(DevExpressLocator.ExtensionsName(DevExpressLocator.Compiled) + ", Version=" + asked + ", Culture=neutral, PublicKeyToken=" + DevExpressLocator.Token));
                int alias = Array.IndexOf(args, "--alias");
                if (alias >= 0 && alias + 1 < args.Length)
                {
                    string other = args[alias + 1];
                    json.Append(",\"alias\":").Append(Load("DevExpress.XtraReports.v" + other + ", Version=" + other + ".0.0, Culture=neutral, PublicKeyToken=" + DevExpressLocator.Token));
                }
            }
            json.Append(",\"trial\":").Append(Str(DevExpressLocator.TrialUrl)).Append("}");
            Console.Out.WriteLine(json.ToString());
            Console.Out.Flush();
            return usable == null ? 3 : 0;
        }

        /// <summary>
        /// Loads the report assembly by the name given, makes a report from a
        /// two-band layout and counts its bands: proof that what came back is
        /// usable, not only found.
        /// </summary>
        private static string Load(string fullName)
        {
            try
            {
                Assembly assembly = Assembly.Load(fullName);
                Type reportType = Type.GetType("DevExpress.XtraReports.UI.XtraReport, " + fullName, true);
                object report = Activator.CreateInstance(reportType);
                const string layout =
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                    "<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"1\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"Check\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\">" +
                    "<Bands><Item1 Ref=\"2\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" /><Item2 Ref=\"3\" ControlType=\"DetailBand\" Name=\"Detail\" /></Bands></XtraReportsLayoutSerializer>";
                // LoadLayoutFromXml(Stream, ...) by its first parameter: an overload with
                // optional parameters after it has no exact one-parameter signature.
                MethodInfo load = reportType.GetMethods().First(mi =>
                    mi.Name == "LoadLayoutFromXml" && mi.GetParameters().Length > 0 && mi.GetParameters()[0].ParameterType == typeof(Stream) &&
                    mi.GetParameters().Skip(1).All(p => p.IsOptional));
                using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(layout)))
                {
                    object[] values = load.GetParameters().Select((p, i) => i == 0 ? stream : p.DefaultValue).ToArray();
                    load.Invoke(report, values);
                }
                object bands = reportType.GetProperty("Bands").GetValue(report, null);
                int count = (int)bands.GetType().GetProperty("Count").GetValue(bands, null);
                ((IDisposable)report).Dispose();
                return "{\"asked\":" + Str(fullName.Split(',')[0]) + ",\"got\":" + Str(assembly.FullName) +
                    ",\"location\":" + Str(assembly.Location) + ",\"bands\":" + count + "}";
            }
            catch (Exception ex)
            {
                Exception inner = ex is TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
                return "{\"asked\":" + Str(fullName.Split(',')[0]) + ",\"error\":" + Str(inner.GetType().Name + ": " + inner.Message) + "}";
            }
        }

        /// <summary>The four-part version this program's reference to an assembly names.</summary>
        private static string Referenced(string name)
        {
            AssemblyName reference = typeof(Check).Assembly.GetReferencedAssemblies()
                .FirstOrDefault(r => string.Equals(r.Name, name, StringComparison.OrdinalIgnoreCase));
            return reference != null && reference.Version != null ? reference.Version.ToString() : DevExpressLocator.Oldest.ToString(2) + ".0.0";
        }

        /// <summary>Loads an assembly by name and says what came back, with no report made.</summary>
        private static string LoadOnly(string fullName)
        {
            try
            {
                Assembly assembly = Assembly.Load(fullName);
                return "{\"asked\":" + Str(fullName.Split(',')[0]) + ",\"got\":" + Str(assembly.FullName) + ",\"location\":" + Str(assembly.Location) + "}";
            }
            catch (Exception ex)
            {
                return "{\"asked\":" + Str(fullName.Split(',')[0]) + ",\"error\":" + Str(ex.GetType().Name + ": " + ex.Message) + "}";
            }
        }

        private static string Str(string s)
        {
            if (s == null) return "null";
            var b = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }
    }
}
