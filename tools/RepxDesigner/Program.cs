using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using DevExpress.XtraReports.UI;

namespace RepxDesigner
{
    /// <summary>
    /// Opens a .repx file in the DevExpress end-user report designer.
    ///
    /// This is the "edit after export" half of the Forma workflow: Forma generates
    /// the report and the user downloads it, at which point the AI's job is done
    /// and the .repx is the single source of truth. Small adjustments -- moving a
    /// field, resizing a box, fixing a caption -- happen here, in the real
    /// designer, with no model call and no token cost.
    ///
    /// It deliberately needs no database and no ERP. frmReport_DevDesign in
    /// the target ERP opens the same designer, but only after connecting to SQL Server
    /// and running a query, because its purpose is designing against live data.
    /// For editing a finished layout that data is not needed, so this tool skips
    /// it entirely.
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string path = args.Length > 0 ? args[0] : PickFile();
            if (string.IsNullOrEmpty(path))
            {
                return; // cancelled the picker
            }

            if (!File.Exists(path))
            {
                MessageBox.Show(
                    "No file at:" + Environment.NewLine + path,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            // Read the version the file claims BEFORE trying to load it. A .repx
            // written by a newer DevExpress than the one installed here is the
            // most likely failure, and the raw exception does not always say so.
            // Forma currently emits SerializerVersion 23.2.3.0; this machine has
            // v20.1 installed, so this line is the first thing to look at when a
            // load fails.
            string fileVersion = ReadSerializerVersion(path);
            string runtimeVersion = typeof(XtraReport).Assembly.GetName().Version.ToString();

            try
            {
                XtraReport report = XtraReport.FromFile(path, true);

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
                    "If those two versions differ, the file was written by a newer " +
                    "DevExpress than the one installed here. Regenerate it targeting " +
                    "the installed version rather than editing the XML by hand." +
                    Environment.NewLine + Environment.NewLine +
                    ex.GetType().Name + ": " + ex.Message,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        /// <summary>
        /// Ask for a file, starting in the browser's download folder -- which is
        /// where a report exported from Forma lands.
        /// </summary>
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
                // The attribute is on the root element, so the first few hundred
                // bytes are enough -- these files run to megabytes when images
                // are embedded, and there is no reason to read all of that.
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
    }
}
