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

            return byVersion.Values.OrderByDescending(i => i.Number).ToList();
        }

        /// <summary>The folder holding the .NET Framework assemblies under an install's root.</summary>
        private static string BinOf(string componentsRoot)
        {
            if (string.IsNullOrEmpty(componentsRoot)) return null;
            string bin = Path.Combine(componentsRoot, @"Bin\Framework");
            return Directory.Exists(bin) ? bin : null;
        }

        /// <summary>The newest installation this program can run on, or null.</summary>
        public static DevExpressInstall Usable(List<DevExpressInstall> found)
        {
            return found.FirstOrDefault(i => i.Number >= Oldest);
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

        private static Assembly Resolve(object sender, ResolveEventArgs e)
        {
            if (_target == null) return null;
            AssemblyName wanted;
            try { wanted = new AssemblyName(e.Name); }
            catch (Exception) { return null; }
            // A culture's satellite is optional; asking for another version's would only fail louder.
            if (wanted.Name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase)) return null;
            string renamed = Rename(wanted.Name, _target.Version);
            if (renamed == null || string.Equals(renamed, wanted.Name, StringComparison.OrdinalIgnoreCase)) return null;

            if (_target.Bin != null)
            {
                string path = Path.Combine(_target.Bin, renamed + ".dll");
                if (File.Exists(path)) return Assembly.LoadFrom(path);
            }
            if (_target.Build != null)
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
                ",\"sources\":[" + string.Join(",", i.Sources.Select(Str)) + "]}")));
            json.Append("],\"using\":").Append(usable == null ? "null" : Str(usable.Version));

            if (usable != null && Array.IndexOf(args, "--no-load") < 0)
            {
                DevExpressLocator.Use(usable);
                json.Append(",\"load\":").Append(Load("DevExpress.XtraReports.v" + DevExpressLocator.Compiled + ", Version=" + DevExpressLocator.Compiled + ".3.0, Culture=neutral, PublicKeyToken=" + DevExpressLocator.Token));
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
