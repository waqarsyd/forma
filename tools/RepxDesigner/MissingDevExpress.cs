using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace RepxDesigner
{
    /// <summary>
    /// What the program says when no DevExpress it can run on is installed
    /// (2026-11-09, the owner's download programme, batch WB): a window for a
    /// person who started it, a line in the tray, and an answer for Forma, which
    /// shows the same choice in the browser.
    ///
    /// Like Entry and DevExpressLocator, nothing here names a DevExpress type:
    /// this is the code that runs precisely when there is none.
    ///
    /// DevExpress is a commercial product of Developer Express Inc. and nothing of
    /// it ships with Forma Designer, so the only link is to devexpress.com, whose
    /// trial (30 days, no registration, the current version only) is what a person
    /// without a licence can install.
    /// </summary>
    internal static class MissingDevExpress
    {
        /// <summary>One line naming what is wrong: none at all, or only versions too old.</summary>
        public static string Headline(List<DevExpressInstall> found)
        {
            var old = found.Where(i => i.Number < DevExpressLocator.Oldest).Select(i => i.Version).ToList();
            if (old.Count > 0)
            {
                return "This PC has DevExpress " + string.Join(", ", old) + ", and Forma Designer needs " +
                    DevExpressLocator.Oldest.ToString(2) + " or later.";
            }
            return "DevExpress Reporting is not installed on this PC.";
        }

        public const string Body =
            "Forma Designer opens your reports in DevExpress's own report designer, so it needs DevExpress " +
            "Reporting for WinForms on this PC. DevExpress is a separate commercial product of Developer " +
            "Express Inc.; its free 30-day trial needs no registration. Install it, then open the report again. " +
            "Until then, Export in Forma saves the .repx, and that needs nothing installed.";

        /// <summary>The answer /health, /open and /sql/fill give Forma when there is nothing to run on.</summary>
        public static string Json(List<DevExpressInstall> found)
        {
            return "{\"devexpress\":null,\"found\":[" + string.Join(",", found.Select(i => SqlCompanion.Json(i.Version))) +
                "],\"oldest\":" + SqlCompanion.Json(DevExpressLocator.Oldest.ToString(2)) +
                ",\"trial\":" + SqlCompanion.Json(DevExpressLocator.TrialUrl) + "}";
        }

        public static void OpenTrial()
        {
            try
            {
                Process.Start(new ProcessStartInfo(DevExpressLocator.TrialUrl) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Debug.WriteLine("Could not open the browser: " + ex.Message);
            }
        }

        /// <summary>
        /// The window. Shown only to a person who started the program or chose
        /// "Open a .repx" from its tray; a launch from the browser gets the tray's
        /// balloon instead, because the page is already saying the same thing.
        /// </summary>
        public static void ShowWindow(List<DevExpressInstall> found)
        {
            using (var form = new Form())
            {
                form.Text = "Forma Designer";
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.ClientSize = new Size(500, 210);
                form.Font = SystemFonts.MessageBoxFont;

                var headline = new Label
                {
                    Text = Headline(found),
                    Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 11f, FontStyle.Bold),
                    Location = new Point(16, 14),
                    Size = new Size(468, 26),
                };
                var body = new Label { Text = Body, Location = new Point(16, 46), Size = new Size(468, 100) };
                var trial = new Button { Text = "Get the DevExpress trial", Location = new Point(196, 162), Size = new Size(180, 30) };
                var close = new Button { Text = "Close", Location = new Point(384, 162), Size = new Size(100, 30), DialogResult = DialogResult.Cancel };
                trial.Click += (s, e) => { OpenTrial(); form.Close(); };

                form.Controls.AddRange(new Control[] { headline, body, trial, close });
                form.AcceptButton = trial;
                form.CancelButton = close;
                form.ShowDialog();
            }
        }
    }
}
