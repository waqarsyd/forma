// text-lines -- which characters does DevExpress lay out in a turned box?
//
// Added 2026-11-04 for parity row 54: turned text (Angle 90 or 270) longer
// than its box wraps along the box and prints only the lines that fit across,
// sometimes ending inside a word, and no rule tried from the outside matched
// more than nine of fourteen cases (s35c to s35e). This asks DevExpress's own
// text formatter and measurer for the lines, instead of guessing from the PDF.
//
// What it found: asked once, at the box's length, the formatter lays out more
// than prints (17 of 40 matched). Printing lays the text out TWICE. First the
// whole text is measured wrapped at the box's length with no line limit, and
// that width -- its widest wrapped line -- is rounded up to a whole 96-dpi
// pixel. Then the text is laid out again at that narrower width, keeping only
// the lines that fit across, the last continued character by character
// (Trimming.Character), which is why it can end inside a word. The second
// pass matched every turned label in s35b to s35e and in the s65 holdout
// (Arial, Tahoma, 90 and 270 degrees, 1 and 2 lines): 150 of 150.
//
//   text-lines <case-dir>
//       Lays out report.repx (no data) and, for every label brick with an
//       Angle, prints its box, padding and text, the one-pass lines
//       TextFormatter.FormatMultilineText returns for the box's content area
//       with its length and breadth swapped, the measured and rounded width,
//       and the two-pass lines, all in the brick's own StringFormat.
//
//   text-lines <spec-file> <out.tsv>
//       The same question for many boxes at once, for sweeps. Each spec line
//       is font|pt|length|across|text, in hundredths of an inch, asked with
//       the StringFormat of a default XRLabel turned 90 degrees. Writes one
//       row per box: the inputs, the one-pass line count and lines (joined by
//       " / "), the rounded width, and the two-pass count and lines.
//
// All sizes in the output are hundredths of an inch. Nothing opens a window.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using DevExpress.XtraPrinting;
using DevExpress.XtraPrinting.Native;
using DevExpress.XtraReports.UI;

static class TextLines {
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static int Run(string[] args) {
        if (args.Length >= 3) return Sweep(args[1], args[2]);
        return Case(args[1]);
    }

    static TextFormatter Formatter() {
        return TextFormatter.CreateInstance(GraphicsUnit.Document, Measurement.Measurer);
    }

    // ------------------------------------------------------------------ case

    static int Case(string caseDir) {
        var report = new XtraReport();
        report.LoadLayoutFromXml(Path.Combine(caseDir, "report.repx"));
        report.RequestParameters = false;
        report.CreateDocument(false);
        TextFormatter formatter = Formatter();
        int found = 0;
        for (int p = 0; p < report.Pages.Count; p++) {
            foreach (Brick brick in report.Pages[p].InnerBricks) found += Walk(brick, p + 1, formatter);
        }
        if (found == 0) Console.WriteLine("no turned label bricks");
        return 0;
    }

    static int Walk(Brick brick, int page, TextFormatter formatter) {
        int found = 0;
        var label = brick as LabelBrick;
        if (label != null && label.Angle != 0) {
            Describe(label, page, formatter);
            found++;
        }
        var composite = brick as CompositeBrick;
        if (composite != null) foreach (Brick child in composite.InnerBricks) found += Walk(child, page, formatter);
        foreach (Brick child in brick.Bricks) found += Walk(child, page, formatter);
        return found;
    }

    static void Describe(LabelBrick label, int page, TextFormatter formatter) {
        RectangleF r = label.Rect; // 1/300 inch
        PaddingInfo pad = label.Padding;
        float k = 300f / pad.Dpi;
        float left = pad.Left * k, right = pad.Right * k, top = pad.Top * k, bottom = pad.Bottom * k;
        float across = r.Width - left - right, length = r.Height - top - bottom;
        Font font = label.Style.Font;
        StringFormat sf = label.StringFormat.Value;
        var owner = label.BrickOwner as XRControl;
        Console.WriteLine("page " + page + " " + (owner != null ? owner.Name : "?") + ": angle " + Num(label.Angle)
            + ", box " + Num(r.Width / 3) + " across by " + Num(r.Height / 3) + " long, padding " + Num(left / 3) + "," + Num(right / 3)
            + "," + Num(top / 3) + "," + Num(bottom / 3) + ", " + font.Name + " " + Num(font.SizeInPoints) + "pt, flags " + sf.FormatFlags
            + ", trimming " + sf.Trimming);
        Console.WriteLine("  text   " + Quote(label.Text));
        if (Math.Abs(label.Angle % 180) == 90) {
            Print("  lines  ", formatter.FormatMultilineText(label.Text, font, length, across, sf));
            float wrapped = WrappedWidth(label.Text, font, length, sf);
            float rounded = CeilPixel(wrapped);
            Console.WriteLine("  measured width of the text wrapped at the box's length: " + Num(wrapped / 3)
                + ", rounded up to a whole pixel: " + Num(rounded / 3));
            Print("  lines at that width ", formatter.FormatMultilineText(label.Text, font, rounded, across, sf));
        } else {
            Console.WriteLine("  (angle not 90 or 270: lines not asked)");
        }
    }

    // ----------------------------------------------------------------- sweep

    static int Sweep(string specFile, string outFile) {
        StringFormat sf = DefaultTurnedFormat();
        TextFormatter formatter = Formatter();
        var rows = new List<string> { "font\tpt\tlength\tacross\ttext\tcount\tlines\twrapped\tcount2\tlines2" };
        var fonts = new Dictionary<string, Font>();
        foreach (string raw in File.ReadAllLines(specFile)) {
            string line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            string[] f = line.Split(new[] { '|' }, 5);
            float pt = float.Parse(f[1], Inv), length = float.Parse(f[2], Inv), across = float.Parse(f[3], Inv);
            string key = f[0] + "|" + f[1];
            Font font;
            if (!fonts.TryGetValue(key, out font)) { font = new Font(f[0], pt); fonts[key] = font; }
            string[] lines = formatter.FormatMultilineText(f[4], font, length * 3, across * 3, sf);
            float wrapped = CeilPixel(WrappedWidth(f[4], font, length * 3, sf));
            string[] lines2 = formatter.FormatMultilineText(f[4], font, wrapped, across * 3, sf);
            rows.Add(f[0] + "\t" + f[1] + "\t" + f[2] + "\t" + f[3] + "\t" + f[4] + "\t" + lines.Length + "\t" + string.Join(" / ", lines)
                + "\t" + Num(wrapped / 3) + "\t" + lines2.Length + "\t" + string.Join(" / ", lines2));
        }
        File.WriteAllText(outFile, string.Join("\n", rows) + "\n", new UTF8Encoding(false));
        Console.WriteLine("wrote " + (rows.Count - 1) + " boxes to " + outFile);
        return 0;
    }

    // DevExpress's own measure of the whole text wrapped at a width, every line
    // counted (no line limit), in 1/300 inch: the widest wrapped line.
    static float WrappedWidth(string text, Font font, float width, StringFormat sf) {
        using (var open = (StringFormat)sf.Clone()) {
            open.FormatFlags &= ~StringFormatFlags.LineLimit;
            return Measurement.Measurer.MeasureString(text, font, width, open, GraphicsUnit.Document).Width;
        }
    }

    // A width in 1/300 inch rounded up to a whole pixel at 96 dpi. Without it
    // 137 of the 150 labels matched: in the 13 misses the unrounded width laid
    // out a little less than printed, a character short or a word pushed to
    // the next line, because it could not hold its own widest line again.
    static float CeilPixel(float doc) {
        return (float)Math.Ceiling(doc * 96f / 300f) * 300f / 96f;
    }

    // The StringFormat a default XRLabel turned 90 degrees is drawn with, read
    // from its brick rather than assembled by hand.
    static StringFormat DefaultTurnedFormat() {
        var report = new XtraReport();
        var detail = new DetailBand { HeightF = 200 };
        var label = new XRLabel { Name = "probe", Text = "probe text", Angle = 90 };
        label.LocationF = new PointF(0, 0);
        label.SizeF = new SizeF(20, 150);
        detail.Controls.Add(label);
        report.Bands.Add(detail);
        report.CreateDocument(false);
        foreach (Brick top in report.Pages[0].InnerBricks) {
            LabelBrick found = Find(top);
            if (found != null) return (StringFormat)found.StringFormat.Value.Clone();
        }
        throw new InvalidOperationException("no label brick for the probe label");
    }

    static LabelBrick Find(Brick brick) {
        var label = brick as LabelBrick;
        if (label != null) return label;
        var composite = brick as CompositeBrick;
        if (composite != null) foreach (Brick child in composite.InnerBricks) { LabelBrick l = Find(child); if (l != null) return l; }
        foreach (Brick child in brick.Bricks) { LabelBrick l = Find(child); if (l != null) return l; }
        return null;
    }

    static void Print(string prefix, string[] lines) {
        Console.WriteLine(prefix + lines.Length + " line(s)");
        foreach (string l in lines) Console.WriteLine("         " + Quote(l));
    }

    static string Quote(string s) {
        return "\"" + (s ?? "").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
    }

    static string Num(double v) {
        return v.ToString("0.###", Inv);
    }
}
