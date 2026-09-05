// RepxProbe -- ask DevExpress what a .repx really contains.
//
// Two subcommands, and they answer opposite questions:
//
//   emit <out.repx>      What does the serializer WRITE for a feature?
//   inspect <in.repx>    What does the loader SEE in a file we produced?
//
// Neither opens a window. SaveLayoutToXml and LoadLayoutFromXml are library
// calls, which is the whole point of this tool: every REPX syntax question in
// this project had been queued behind "open the designer and look", a manual
// step needing the owner's own desktop. None of them needed it.
//
// See README.md for what this has already settled.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text.RegularExpressions;
using DevExpress.XtraReports.UI;
using DevExpress.XtraReports.Expressions;
// Parameter is NOT in the UI namespace, unlike every band and control here.
using DevExpress.XtraReports.Parameters;

static class Program {
    static int Main(string[] args) {
        if (args.Length < 2) {
            Console.WriteLine("usage: RepxProbe emit <out.repx>");
            Console.WriteLine("       RepxProbe emit-group <out.repx>");
            Console.WriteLine("       RepxProbe emit-params <out.repx>");
            Console.WriteLine("       RepxProbe inspect <in.repx>");
            return 2;
        }
        try {
            switch (args[0]) {
                case "emit":       Emit(args[1]);      return 0;
                case "emit-group": EmitGroup(args[1]); return 0;
                case "emit-params": EmitParams(args[1]); return 0;
                case "emit-chart": EmitChart(args[1]); return 0;
            case "emit-grow":  EmitGrow(args[1]);  return 0;
            case "emit-marks": EmitMarks(args[1]); return 0;
            case "emit-container": EmitContainer(args[1]); return 0;
            case "emit-styles": EmitStyles(args[1]); return 0;
            case "emit-rich":  EmitRich(args[1]);  return 0;
            case "emit-rules": EmitRules(args[1]); return 0;
            case "emit-calc":  EmitCalc(args[1]);  return 0;
            case "emit-sort":  EmitSort(args[1]);  return 0;
            case "emit-mark":  EmitWatermark(args[1]); return 0;
            case "emit-cols":  EmitColumns(args[1]); return 0;
                case "inspect":    return Inspect(args[1]);
                default:
                    Console.WriteLine("unknown subcommand: " + args[0]);
                    return 2;
            }
        } catch (Exception ex) {
            Console.WriteLine("FAILED  " + ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }

    // ---------------------------------------------------------------- emit

    static XRTableCell Cell(string name, string text, float weight) {
        XRTableCell c = new XRTableCell();
        c.Name = name; c.Text = text; c.Weight = weight;
        return c;
    }

    static XRTable Table(string name, XRTableCell[] cells) {
        XRTable t = new XRTable();
        t.BeginInit();
        t.Name = name;
        t.LocationF = new PointF(0, 0);
        t.SizeF = new SizeF(750, 20);
        XRTableRow row = new XRTableRow();
        row.Name = name + "Row";
        foreach (XRTableCell c in cells) row.Cells.Add(c);
        t.Rows.Add(row);
        t.EndInit();
        return t;
    }

    static Band Band(Band band, string name, XRTable table) {
        band.Name = name;
        band.HeightF = 20;
        band.Controls.Add(table);
        return band;
    }

    /// Writes a report exercising the features whose serialized form we care
    /// about: an expression binding, a binding plus a format, and a summary.
    /// Add whatever you need to answer a new question -- that is the point.
    static void Emit(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbe";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        XRTable header = Table("tableHeader", new XRTableCell[] {
            Cell("cellHeadDesc", "Description", 3),
            Cell("cellHeadAmount", "Amount", 1)
        });

        XRTableCell desc = Cell("cellDesc", "Widget", 3);
        desc.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "[Description]"));

        XRTableCell amount = Cell("cellAmount", "1240.00", 1);
        amount.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "[Amount]"));
        amount.TextFormatString = "{0:c2}";

        XRTable detail = Table("tableDetail", new XRTableCell[] { desc, amount });

        XRTableCell total = Cell("cellTotal", "", 1);
        total.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "sumSum([Amount])"));
        XRTable footer = Table("tableFooter", new XRTableCell[] { total });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            Band(new PageHeaderBand(), "PageHeader", header),
            Band(new DetailBand(), "Detail", detail),
            Band(new ReportFooterBand(), "ReportFooter", footer),
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes a report exercising AUTO-SIZING, to settle how it is serialized.
    ///
    /// The question: a label holding text longer than its box is clipped by
    /// DevExpress unless CanGrow is on, and Forma has never emitted it. Before
    /// adding it to the prompt we need to know what the serializer actually
    /// writes -- and specifically whether the DEFAULT is written at all, because
    /// the grouping probe already found SortOrder omitted when it is the
    /// default, and emitting a redundant attribute on every control would bloat
    /// every file we produce.
    ///
    /// So this sets each of the three properties BOTH ways on separate cells:
    /// whatever appears in the file is the non-default, and whatever is missing
    /// is what DevExpress assumes. Labels and table cells are both covered
    /// because they inherit from different places and may differ.
    static void EmitGrow(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeGrow";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        // A label left entirely alone, for comparison against the ones below.
        XRLabel plain = new XRLabel();
        plain.Name = "labelPlain";
        plain.Text = "untouched";
        plain.LocationF = new PointF(0, 0);
        plain.SizeF = new SizeF(300, 20);

        XRLabel grows = new XRLabel();
        grows.Name = "labelGrows";
        grows.Text = "a long value that will not fit inside three hundred units of width";
        grows.LocationF = new PointF(0, 25);
        grows.SizeF = new SizeF(300, 20);
        grows.CanGrow = true;
        grows.WordWrap = true;

        XRLabel shrinks = new XRLabel();
        shrinks.Name = "labelShrinks";
        shrinks.Text = "short";
        shrinks.LocationF = new PointF(0, 50);
        shrinks.SizeF = new SizeF(300, 20);
        shrinks.CanShrink = true;

        // The other way round, to find out which value is the default: whichever
        // of true/false is ABSENT from the file is what DevExpress assumes.
        XRLabel noGrow = new XRLabel();
        noGrow.Name = "labelNoGrow";
        noGrow.Text = "explicitly not growing";
        noGrow.LocationF = new PointF(0, 75);
        noGrow.SizeF = new SizeF(300, 20);
        noGrow.CanGrow = false;
        noGrow.WordWrap = false;

        XRTableCell growCell = Cell("cellGrows", "a cell holding rather more text than its column is wide", 3);
        growCell.CanGrow = true;
        XRTableCell plainCell = Cell("cellPlain", "untouched", 1);
        XRTable table = Table("tableDetail", new XRTableCell[] { growCell, plainCell });
        table.LocationF = new PointF(0, 100);

        // A band can grow too, and whether that is required for a control's
        // growth to have any visible effect is the second half of the question.
        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 130;
        detail.CanGrow = true;
        detail.Controls.AddRange(new XRControl[] { plain, grows, shrinks, noGrow, table });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            detail,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes CHECKBOXES and CROSS-BAND controls, the two things an ordinary
    /// invoice or form contains that Forma currently cannot represent at all.
    ///
    /// Open questions, none of which the class reference answers about the FILE:
    ///
    ///   XRCheckBox     -- is the state an enum or a bool? Which value is the
    ///                     default and therefore omitted? Does the caption live
    ///                     in Text like every other control?
    ///   XRCrossBandLine/Box
    ///                  -- these do NOT live in a band's Controls. They hang off
    ///                     the REPORT and name a start and end band, so the
    ///                     question is how a band REFERENCE is serialized:
    ///                     by name, by Ref pointer, or by index. That matters
    ///                     more than the geometry, because a wrong reference is
    ///                     the kind of thing that loads without complaint.
    static void EmitMarks(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeMarks";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        // Three checkboxes: default state, explicitly checked, and indeterminate
        // -- so whichever value is missing from the file is the default.
        XRCheckBox untouched = new XRCheckBox();
        untouched.Name = "checkUntouched";
        untouched.Text = "Untouched";
        untouched.LocationF = new PointF(0, 0);
        untouched.SizeF = new SizeF(200, 20);

        XRCheckBox ticked = new XRCheckBox();
        ticked.Name = "checkTicked";
        ticked.Text = "Paid in full";
        ticked.LocationF = new PointF(0, 25);
        ticked.SizeF = new SizeF(200, 20);
        ticked.Checked = true;

        XRCheckBox unticked = new XRCheckBox();
        unticked.Name = "checkUnticked";
        unticked.Text = "Explicitly unchecked";
        unticked.LocationF = new PointF(0, 50);
        unticked.SizeF = new SizeF(200, 20);
        unticked.Checked = false;

        XRCheckBox bound = new XRCheckBox();
        bound.Name = "checkBound";
        bound.Text = "Bound";
        bound.LocationF = new PointF(0, 75);
        bound.SizeF = new SizeF(200, 20);
        // Does a checkbox bind on CheckState rather than on Text? Ask.
        bound.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "CheckState", "[IsPaid]"));

        PageHeaderBand pageHeader = new PageHeaderBand();
        pageHeader.Name = "PageHeader";
        pageHeader.HeightF = 40;

        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 110;
        detail.Controls.AddRange(new XRControl[] { untouched, ticked, unticked, bound });

        ReportFooterBand reportFooter = new ReportFooterBand();
        reportFooter.Name = "ReportFooter";
        reportFooter.HeightF = 30;

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            pageHeader,
            detail,
            reportFooter,
            new BottomMarginBand()
        });

        // A vertical rule from the page header down through the detail band --
        // the column separator every legacy table-heavy report has.
        XRCrossBandLine line = new XRCrossBandLine();
        line.Name = "columnRule";
        line.StartBand = pageHeader;
        line.EndBand = detail;
        line.StartPointFloat = new DevExpress.Utils.PointFloat(300, 0);
        line.EndPointFloat = new DevExpress.Utils.PointFloat(300, 110);
        line.WidthF = 1;

        // And a box around the same span, which is the other half of the shape.
        XRCrossBandBox box = new XRCrossBandBox();
        box.Name = "detailBox";
        box.StartBand = pageHeader;
        box.EndBand = reportFooter;
        box.StartPointFloat = new DevExpress.Utils.PointFloat(0, 0);
        box.EndPointFloat = new DevExpress.Utils.PointFloat(750, 30);
        box.WidthF = 1;

        report.CrossBandControls.AddRange(new XRCrossBandControl[] { line, box });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes an XRPanel and an XRSubreport -- the two remaining controls an
    /// ordinary form or statement uses that Forma cannot represent.
    ///
    /// Two questions, and the second may well be a NEGATIVE result:
    ///
    ///   XRPanel     -- a container. Are its children nested in its own
    ///                  <Controls>, and if so are their coordinates relative to
    ///                  the panel or still to the band? Getting that backwards
    ///                  puts every child in the wrong place while the file
    ///                  still loads, which is the units-audit failure again.
    ///
    ///   XRSubreport -- points at ANOTHER report. Forma produces exactly one
    ///                  .repx from one source document, so if the only way to
    ///                  name that other report is a file path, a generated
    ///                  subreport points at something that does not exist on
    ///                  the user's machine and the control is unusable here.
    ///                  Both forms are set below to find out whether the report
    ///                  source can be embedded rather than referenced.
    static void EmitContainer(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeContainer";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        // Two children at coordinates that are obviously band-absolute, so the
        // written values say which system the serializer used.
        XRLabel inner1 = new XRLabel();
        inner1.Name = "panelLabelA";
        inner1.Text = "inside the panel, first";
        inner1.LocationF = new PointF(10, 10);
        inner1.SizeF = new SizeF(200, 20);

        XRLabel inner2 = new XRLabel();
        inner2.Name = "panelLabelB";
        inner2.Text = "inside the panel, second";
        inner2.LocationF = new PointF(10, 40);
        inner2.SizeF = new SizeF(200, 20);

        XRPanel panel = new XRPanel();
        panel.Name = "panelBox";
        panel.LocationF = new PointF(100, 100);
        panel.SizeF = new SizeF(400, 80);
        panel.Borders = DevExpress.XtraPrinting.BorderSide.All;
        panel.Controls.AddRange(new XRControl[] { inner1, inner2 });

        // A control OUTSIDE the panel at the same nominal coordinates, so the
        // two can be compared directly in the output.
        XRLabel outside = new XRLabel();
        outside.Name = "labelOutside";
        outside.Text = "outside the panel";
        outside.LocationF = new PointF(10, 10);
        outside.SizeF = new SizeF(200, 20);

        // Form 1: a subreport naming another report by URL.
        XRSubreport byUrl = new XRSubreport();
        byUrl.Name = "subByUrl";
        byUrl.LocationF = new PointF(0, 200);
        byUrl.SizeF = new SizeF(400, 20);
        byUrl.ReportSourceUrl = "AnotherReport.repx";

        // Form 2: a subreport holding an actual report object. If THIS
        // serializes the inner report inline, a self-contained subreport is
        // possible and the control is usable here. If it writes a type name or
        // nothing, it is not.
        XtraReport inner = new XtraReport();
        inner.Name = "InnerReport";
        DetailBand innerDetail = new DetailBand();
        innerDetail.Name = "InnerDetail";
        innerDetail.HeightF = 20;
        XRLabel innerLabel = new XRLabel();
        innerLabel.Name = "innerLabel";
        innerLabel.Text = "from the inner report";
        innerLabel.LocationF = new PointF(0, 0);
        innerLabel.SizeF = new SizeF(300, 20);
        innerDetail.Controls.Add(innerLabel);
        inner.Bands.Add(innerDetail);

        XRSubreport byObject = new XRSubreport();
        byObject.Name = "subByObject";
        byObject.LocationF = new PointF(0, 230);
        byObject.SizeF = new SizeF(400, 20);
        byObject.ReportSource = inner;

        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 260;
        detail.Controls.AddRange(new XRControl[] { outside, panel, byUrl, byObject });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            detail,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes a report using a STYLE SHEET, the highest-value thing Forma still
    /// cannot express: every control currently carries its own font and colour,
    /// so restyling a migrated report means touching all of them.
    ///
    /// The questions, in the order they matter:
    ///
    ///   1. Where does the sheet live -- a root-level collection, and under what
    ///      element name?
    ///   2. **How does a control REFER to a style?** By name, or by a "#Ref-N"
    ///      pointer? If it is a pointer, this is the third such attribute and
    ///      repxRefs.ts has to know about it, because renumbering a duplicate
    ///      would silently repoint every control using that style.
    ///   3. Does an explicit property on the control still override the style,
    ///      and is it still written when it matches the style's value? That
    ///      decides whether Forma can emit a sheet AND keep per-control
    ///      overrides, or has to choose.
    ///   4. Do tables have separate odd/even row style hooks?
    static void EmitStyles(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeStyles";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        XRControlStyle heading = new XRControlStyle();
        heading.Name = "HeadingStyle";
        heading.Font = new Font("Arial", 12, FontStyle.Bold);
        heading.ForeColor = Color.FromArgb(0x1A, 0x2B, 0x3C);
        heading.BackColor = Color.FromArgb(0xEE, 0xEE, 0xEE);
        heading.TextAlignment = DevExpress.XtraPrinting.TextAlignment.MiddleLeft;
        heading.Borders = DevExpress.XtraPrinting.BorderSide.Bottom;

        XRControlStyle body = new XRControlStyle();
        body.Name = "BodyStyle";
        body.Font = new Font("Arial", 9);
        body.Padding = new DevExpress.XtraPrinting.PaddingInfo(2, 2, 0, 0, 100F);

        report.StyleSheet.AddRange(new XRControlStyle[] { heading, body });

        // A control taking the style and nothing else.
        XRLabel styled = new XRLabel();
        styled.Name = "labelStyled";
        styled.Text = "styled only";
        styled.LocationF = new PointF(0, 0);
        styled.SizeF = new SizeF(300, 20);
        styled.StyleName = "HeadingStyle";

        // A control taking the style AND overriding one property, to find out
        // whether the override survives into the file.
        XRLabel overridden = new XRLabel();
        overridden.Name = "labelOverridden";
        overridden.Text = "styled, red text";
        overridden.LocationF = new PointF(0, 25);
        overridden.SizeF = new SizeF(300, 20);
        overridden.StyleName = "HeadingStyle";
        overridden.ForeColor = Color.Red;

        // A second control on the OTHER style, to confirm both survive.
        XRLabel byObject = new XRLabel();
        byObject.Name = "labelByObject";
        byObject.Text = "style by object";
        byObject.LocationF = new PointF(0, 50);
        byObject.SizeF = new SizeF(300, 20);
        byObject.StyleName = "BodyStyle";

        // A table, for the odd/even row hooks.
        XRTableCell cellA = Cell("cellA", "A", 1);
        XRTableCell cellB = Cell("cellB", "B", 1);
        XRTable table = Table("tableStyled", new XRTableCell[] { cellA, cellB });
        table.LocationF = new PointF(0, 80);
        table.OddStyleName = "BodyStyle";
        table.EvenStyleName = "HeadingStyle";

        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 120;
        detail.Controls.AddRange(new XRControl[] { styled, overridden, byObject, table });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            detail,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes an XRRichText and several XRShapes, the last two controls from the
    /// DevExpress comparison that turn up in ordinary documents.
    ///
    /// The questions:
    ///
    ///   XRRichText -- **is the content usable, or is it a blob?** A terms-and-
    ///                 conditions paragraph is the obvious use, but if the only
    ///                 serialized form is base64 RTF then a language model cannot
    ///                 author one and this is a negative result. Html, Rtf and
    ///                 plain Text are all set below, on separate controls, to see
    ///                 which survive and in what shape.
    ///
    ///   XRShape    -- how is the shape TYPE written? A child element, an
    ///                 attribute, an assembly-qualified name? And do the shapes
    ///                 with parameters (a star's point count) carry them?
    static void EmitRich(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeRich";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        XRRichText plain = new XRRichText();
        plain.Name = "richPlain";
        plain.LocationF = new PointF(0, 0);
        plain.SizeF = new SizeF(600, 60);
        plain.Text = "Plain text set through Text.";

        XRRichText html = new XRRichText();
        html.Name = "richHtml";
        html.LocationF = new PointF(0, 70);
        html.SizeF = new SizeF(600, 60);
        html.Html = "<p>Terms: payment due <b>30 days</b> from invoice date.</p>";

        XRShape rectangle = new XRShape();
        rectangle.Name = "shapeRectangle";
        rectangle.LocationF = new PointF(0, 140);
        rectangle.SizeF = new SizeF(200, 80);
        rectangle.Shape = new DevExpress.XtraPrinting.Shape.ShapeRectangle();

        XRShape ellipse = new XRShape();
        ellipse.Name = "shapeEllipse";
        ellipse.LocationF = new PointF(220, 140);
        ellipse.SizeF = new SizeF(200, 80);
        ellipse.Shape = new DevExpress.XtraPrinting.Shape.ShapeEllipse();

        XRShape line = new XRShape();
        line.Name = "shapeLine";
        line.LocationF = new PointF(440, 140);
        line.SizeF = new SizeF(200, 80);
        line.Shape = new DevExpress.XtraPrinting.Shape.ShapeLine();

        // A shape with its own parameter, to see whether it is carried.
        DevExpress.XtraPrinting.Shape.ShapeStar star = new DevExpress.XtraPrinting.Shape.ShapeStar();
        star.StarPointCount = 6;
        XRShape starred = new XRShape();
        starred.Name = "shapeStar";
        starred.LocationF = new PointF(0, 240);
        starred.SizeF = new SizeF(120, 120);
        starred.Shape = star;

        // A shape left entirely alone, so the default shape type is visible.
        XRShape untouched = new XRShape();
        untouched.Name = "shapeUntouched";
        untouched.LocationF = new PointF(140, 240);
        untouched.SizeF = new SizeF(120, 120);

        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 380;
        detail.Controls.AddRange(new XRControl[] {
            plain, html, rectangle, ellipse, line, starred, untouched
        });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            detail,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes CONDITIONAL FORMATTING, the highest-value report-level feature
    /// still missing: "print overdue amounts in red" is a thing every statement
    /// and aged-debt report does, and Forma cannot express it at all.
    ///
    /// The question that decides how much work this is:
    ///
    ///   **How does a control refer to a rule?** If by name, like a style, this
    ///   is straightforward. If by a "#Ref-N" pointer, it is the THIRD pointer
    ///   attribute in this format and repxRefs.ts has to learn about it, because
    ///   renumbering a duplicate would silently repoint every control using that
    ///   rule -- and the symptom would be a report that formats the wrong rows.
    ///
    /// Also open: whether the sheet is root-level like StyleSheet, what a
    /// condition looks like as text, and whether a rule's appearance is a nested
    /// element or flat attributes.
    static void EmitRules(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeRules";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        FormattingRule overdue = new FormattingRule();
        overdue.Name = "OverdueRule";
        overdue.Condition = "[DaysOverdue] > 30";
        overdue.Formatting.ForeColor = Color.Red;
        overdue.Formatting.Font = new Font("Arial", 9, FontStyle.Bold);

        FormattingRule credit = new FormattingRule();
        credit.Name = "CreditRule";
        credit.Condition = "[Amount] < 0";
        credit.Formatting.BackColor = Color.FromArgb(0xFF, 0xEE, 0xEE);

        report.FormattingRuleSheet.AddRange(new FormattingRule[] { overdue, credit });

        XRLabel amount = new XRLabel();
        amount.Name = "labelAmount";
        amount.Text = "1,250.00";
        amount.LocationF = new PointF(0, 0);
        amount.SizeF = new SizeF(200, 20);
        amount.FormattingRules.Add(overdue);

        // Two rules on one control, to see whether order is expressed and how.
        XRLabel both = new XRLabel();
        both.Name = "labelBoth";
        both.Text = "-40.00";
        both.LocationF = new PointF(0, 25);
        both.SizeF = new SizeF(200, 20);
        both.FormattingRules.Add(overdue);
        both.FormattingRules.Add(credit);

        // A rule on a BAND rather than a control -- the usual way a whole row is
        // highlighted, and worth knowing whether it serializes the same way.
        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 60;
        detail.Controls.AddRange(new XRControl[] { amount, both });
        detail.FormattingRules.Add(credit);

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            detail,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes CALCULATED FIELDS -- a named expression over the data that behaves
    /// like a field, so a line-total column can be [Quantity] * [UnitPrice]
    /// instead of a number the report cannot recompute.
    ///
    /// The question that decides whether this is usable here at all:
    ///
    ///   **Does a calculated field need a bound data source?** It has DataSource
    ///   and DataMember properties. Forma never connects to a database -- that is
    ///   an explicit boundary, not a gap -- so if either is required, a generated
    ///   calculated field would reference a connection that does not exist and
    ///   this is a negative result like XRRichText.
    ///
    /// So one field is written with NOTHING but a name, an expression and a
    /// type, and a second with a DataMember, to see what the serializer insists
    /// on. Also open: whether the collection is root-level, and whether a
    /// control refers to the field the same way it refers to a real one.
    static void EmitCalc(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeCalc";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        // Nothing but the three things a model could plausibly author.
        CalculatedField lineTotal = new CalculatedField();
        lineTotal.Name = "LineTotal";
        lineTotal.Expression = "[Quantity] * [UnitPrice]";
        lineTotal.FieldType = FieldType.Decimal;

        // The same, plus a DataMember, to see whether it is written and whether
        // its absence above produced anything different.
        CalculatedField withMember = new CalculatedField();
        withMember.Name = "Margin";
        withMember.Expression = "[Price] - [Cost]";
        withMember.FieldType = FieldType.Decimal;
        withMember.DataMember = "Orders";

        // A string one, to find out whether FieldType is written for every type
        // or omitted for a default the way so much else here is.
        CalculatedField label = new CalculatedField();
        label.Name = "FullName";
        label.Expression = "[FirstName] + ' ' + [LastName]";
        label.FieldType = FieldType.String;

        report.CalculatedFields.AddRange(new CalculatedField[] { lineTotal, withMember, label });

        // A cell bound to the calculated field, to see whether the reference
        // looks any different from a reference to a real field.
        XRTableCell total = Cell("cellTotal", "0.00", 1);
        total.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "[LineTotal]"));
        XRTable table = Table("tableDetail", new XRTableCell[] { total });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            Band(new DetailBand(), "Detail", table),
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes SORTING on the detail rows, the last data-shaping feature missing.
    ///
    /// Open questions:
    ///
    ///   - Where does it live? Sorting the DATA is a property of the DetailBand
    ///     in DevExpress, not of the report, which is not what the phrase "sort
    ///     fields" suggests and is worth confirming rather than assuming.
    ///   - `emit-group` already showed SortOrder is omitted for the ascending
    ///     default. So the only case that writes anything is DESCENDING, and if
    ///     that is true the ascending instruction is "write nothing at all",
    ///     which the prompt has to say plainly or the model will write it.
    ///   - Does the element name collide with a GroupHeaderBand's <GroupFields>?
    ///     If both are `GroupField` objects serialized under different element
    ///     names, a parser keying on the item shape cannot tell them apart.
    static void EmitSort(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeSort";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        XRTableCell cell = Cell("cellName", "Widget", 1);
        XRTable table = Table("tableDetail", new XRTableCell[] { cell });

        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 20;
        detail.Controls.Add(table);
        // Ascending first, then descending, so the pair shows which is written.
        detail.SortFields.Add(new GroupField("CustomerName", XRColumnSortOrder.Ascending));
        detail.SortFields.Add(new GroupField("OrderDate", XRColumnSortOrder.Descending));

        // A group band too, so the two collections can be compared side by side.
        GroupHeaderBand group = new GroupHeaderBand();
        group.Name = "GroupHeader";
        group.HeightF = 20;
        group.GroupFields.Add(new GroupField("Region", XRColumnSortOrder.Descending));

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            group,
            detail,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes a WATERMARK -- "DRAFT" across the page, which is the one thing on
    /// the remaining list a reader notices immediately when it is missing.
    ///
    /// The question, and it is the rich-text question again: **is the content
    /// authorable?** A TEXT watermark should be a handful of attributes. An
    /// IMAGE watermark almost certainly carries the picture, and if that is a
    /// base64 blob then half of this feature is unwritable by a model and the
    /// prompt has to say which half.
    ///
    /// Also open: whether a watermark left at its defaults writes anything at
    /// all, since so much here is omitted when default.
    static void EmitWatermark(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeWatermark";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        report.Watermark.Text = "DRAFT";
        report.Watermark.Font = new Font("Arial", 72, FontStyle.Bold);
        report.Watermark.ForeColor = Color.FromArgb(0xC0, 0xC0, 0xC0);
        report.Watermark.TextTransparency = 150;
        report.Watermark.TextDirection = DevExpress.XtraPrinting.Drawing.DirectionMode.BackwardDiagonal;
        report.Watermark.ShowBehind = true;

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            Band(new DetailBand(), "Detail", Table("tableDetail", new XRTableCell[] { Cell("cellA", "A", 1) })),
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("=== TEXT watermark ===");
        Console.WriteLine(File.ReadAllText(outPath));

        // Now the image half, into a second file, so the two can be compared.
        XtraReport withImage = new XtraReport();
        withImage.Name = "RepxProbeWatermarkImage";
        withImage.PageWidth = 850;
        withImage.PageHeight = 1100;
        Bitmap bitmap = new Bitmap(4, 4);
        using (Graphics g = Graphics.FromImage(bitmap)) g.Clear(Color.Gray);
        withImage.Watermark.Image = bitmap;
        withImage.Bands.Add(new DetailBand());

        string imagePath = outPath + ".image.repx";
        withImage.SaveLayoutToXml(imagePath);
        string imageXml = File.ReadAllText(imagePath);
        Console.WriteLine();
        Console.WriteLine("=== IMAGE watermark: " + imageXml.Length + " chars total ===");
        // Print it with any long attribute value elided, so a base64 blob is
        // visible as a blob rather than filling the terminal.
        Console.WriteLine(Regex.Replace(imageXml, "\"([^\"]{80,})\"", m =>
            "\"<" + (m.Groups[1].Value.Length) + " chars elided>\""));
    }

    /// Writes a MULTI-COLUMN detail band -- a label sheet, a phone list, a
    /// two-up catalogue: records flowing down one column and then into the next
    /// rather than one per full-width row.
    ///
    /// Open questions:
    ///
    ///   - Is it a child element of the band or a set of attributes on it?
    ///   - Which of the several properties are written, and which are omitted as
    ///     defaults? ColumnCount and ColumnWidth are alternative ways to say the
    ///     same thing, selected by a Mode, and if the mode is omitted when
    ///     default then writing the wrong one of the pair silently does nothing.
    ///   - Does a band left alone write an empty element or nothing at all?
    ///     That decides whether a parser can treat absence as "one column".
    static void EmitColumns(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeColumns";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        DetailBand columns = new DetailBand();
        columns.Name = "Detail";
        columns.HeightF = 40;
        columns.Controls.Add(Table("tableDetail", new XRTableCell[] { Cell("cellA", "A", 1) }));
        columns.MultiColumn.ColumnCount = 3;
        columns.MultiColumn.ColumnSpacing = 20;
        columns.MultiColumn.Mode = MultiColumnMode.UseColumnCount;
        columns.MultiColumn.Direction = ColumnDirection.AcrossThenDown;

        // A second detail band left completely alone, so the difference between
        // "one column" and "not configured" is visible in one file.
        DetailReportBand nested = new DetailReportBand();
        nested.Name = "DetailReport";
        DetailBand plain = new DetailBand();
        plain.Name = "PlainDetail";
        plain.HeightF = 20;
        nested.Bands.Add(plain);

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            columns,
            nested,
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes a GROUPED report, to settle how grouping is serialized.
    ///
    /// The open questions this answers, none of which the class reference
    /// states: what a GroupHeaderBand's grouping field looks like in the file,
    /// whether the collection is named GroupFields, whether the sort order is
    /// written when it is the default, where RepeatEveryPage lands, and how a
    /// group-scoped summary differs from a report-scoped one.
    static void EmitGroup(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeGroup";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        XRTable pageHead = Table("tableHeader", new XRTableCell[] {
            Cell("cellHeadDesc", "Description", 3),
            Cell("cellHeadAmount", "Amount", 1)
        });

        // The group header: a caption bound to the very field being grouped on,
        // which is the ordinary shape and exercises both at once.
        XRTableCell groupCaption = Cell("cellGroupCaption", "Category", 4);
        groupCaption.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "[Category]"));
        XRTable groupHead = Table("tableGroupHeader", new XRTableCell[] { groupCaption });

        XRTableCell desc = Cell("cellDesc", "Widget", 3);
        desc.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "[Description]"));
        XRTableCell amount = Cell("cellAmount", "1240.00", 1);
        amount.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "[Amount]"));
        XRTable detail = Table("tableDetail", new XRTableCell[] { desc, amount });

        // A group-scoped total, to see how it differs from the report-scoped
        // one in Emit(). Two ways exist -- an XRSummary with Running=Group, and
        // a sumSum() expression -- so both go in and the file says which the
        // serializer records.
        XRTableCell groupTotal = Cell("cellGroupTotal", "", 1);
        groupTotal.Summary.Running = SummaryRunning.Group;
        groupTotal.Summary.Func = SummaryFunc.Sum;
        groupTotal.Summary.FormatString = "{0:c2}";
        groupTotal.ExpressionBindings.Add(new ExpressionBinding("BeforePrint", "Text", "sumSum([Amount])"));
        XRTable groupFoot = Table("tableGroupFooter", new XRTableCell[] { groupTotal });

        GroupHeaderBand gh = new GroupHeaderBand();
        gh.GroupFields.Add(new GroupField("Category", XRColumnSortOrder.Ascending));
        gh.RepeatEveryPage = true;

        GroupFooterBand gf = new GroupFooterBand();

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            Band(new PageHeaderBand(), "PageHeader", pageHead),
            Band(gh, "GroupHeader", groupHead),
            Band(new DetailBand(), "Detail", detail),
            Band(gf, "GroupFooter", groupFoot),
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes a PARAMETERISED report, to settle how parameters serialize.
    ///
    /// Open questions, none of which the class reference answers: where the
    /// Parameters collection sits relative to Bands, how a CLR type is spelled
    /// in the file, whether a default Value is written, what a multi-value
    /// parameter adds, how FilterString escapes its comparison, and how a
    /// parameter is referenced from a control's expression.
    static void EmitParams(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeParams";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        Parameter from = new Parameter();
        from.Name = "DateFrom";
        from.Type = typeof(DateTime);
        from.Description = "From date";
        from.Value = new DateTime(2026, 1, 1);
        report.Parameters.Add(from);

        Parameter region = new Parameter();
        region.Name = "Region";
        region.Type = typeof(string);
        region.Description = "Region";
        region.Value = "North";
        report.Parameters.Add(region);

        // Multi-value and hidden, to see what each adds to the element.
        Parameter categories = new Parameter();
        categories.Name = "Categories";
        categories.Type = typeof(string);
        categories.Description = "Categories";
        categories.MultiValue = true;
        report.Parameters.Add(categories);

        Parameter internalOnly = new Parameter();
        internalOnly.Name = "RunBy";
        internalOnly.Type = typeof(string);
        internalOnly.Visible = false;
        report.Parameters.Add(internalOnly);

        // The two ways a parameter is used: filtering the data, and printing.
        report.FilterString = "[OrderDate] >= ?DateFrom And [Region] = ?Region";

        XRLabel caption = new XRLabel();
        caption.Name = "labelCaption";
        caption.LocationF = new PointF(0, 0);
        caption.SizeF = new SizeF(600, 20);
        caption.Text = "Region";
        caption.ExpressionBindings.Add(
            new ExpressionBinding("BeforePrint", "Text", "'Region: ' + [Parameters.Region]"));

        ReportHeaderBand head = new ReportHeaderBand();
        head.Name = "ReportHeader";
        head.HeightF = 20;
        head.Controls.Add(caption);

        XRTable detail = Table("tableDetail", new XRTableCell[] {
            Cell("cellItem", "Widget", 3), Cell("cellAmount", "1240.00", 1)
        });

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(),
            head,
            Band(new DetailBand(), "Detail", detail),
            new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    /// Writes a report with an XRChart and an XRCrossTab.
    ///
    /// The two remaining fidelity gaps, and the two whose serialized form is
    /// least guessable: a chart carries a Series collection and a Diagram, and
    /// a cross-tab carries three separate field collections. Both are drawn as
    /// flat labels today.
    static void EmitChart(string outPath) {
        XtraReport report = new XtraReport();
        report.Name = "RepxProbeChart";
        report.ReportUnit = ReportUnit.HundredthsOfAnInch;
        report.PageWidth = 850;
        report.PageHeight = 1100;

        XRChart chart = new XRChart();
        chart.Name = "chartSales";
        chart.LocationF = new PointF(0, 0);
        chart.SizeF = new SizeF(600, 300);
        // A chart with no series serializes almost empty, which would measure
        // nothing. One bar series bound to two data members is the ordinary
        // shape a generated report would want.
        DevExpress.XtraCharts.Series series = new DevExpress.XtraCharts.Series(
            "Sales", DevExpress.XtraCharts.ViewType.Bar);
        series.ArgumentDataMember = "Region";
        series.ValueDataMembers.AddRange(new string[] { "Amount" });
        chart.Series.Add(series);

        // A second series with a NON-default view type, because the Bar above
        // wrote no view type at all and the question is whether that is Bar
        // being the default or the view type never being written.
        DevExpress.XtraCharts.Series line = new DevExpress.XtraCharts.Series(
            "Trend", DevExpress.XtraCharts.ViewType.Line);
        line.ArgumentDataMember = "Region";
        line.ValueDataMembers.AddRange(new string[] { "Target" });
        chart.Series.Add(line);

        // And a pie, whose diagram is a different type entirely.
        XRChart pie = new XRChart();
        pie.Name = "chartMix";
        pie.LocationF = new PointF(0, 540);
        pie.SizeF = new SizeF(400, 250);
        DevExpress.XtraCharts.Series slice = new DevExpress.XtraCharts.Series(
            "Mix", DevExpress.XtraCharts.ViewType.Pie);
        slice.ArgumentDataMember = "Category";
        slice.ValueDataMembers.AddRange(new string[] { "Amount" });
        pie.Series.Add(slice);

        XRCrossTab cross = new XRCrossTab();
        cross.Name = "crossSales";
        cross.LocationF = new PointF(0, 320);
        cross.SizeF = new SizeF(600, 200);
        cross.RowFields.Add(new DevExpress.XtraReports.UI.CrossTab.CrossTabRowField {
            FieldName = "Region",
        });
        cross.ColumnFields.Add(new DevExpress.XtraReports.UI.CrossTab.CrossTabColumnField {
            FieldName = "Quarter",
        });
        cross.DataFields.Add(new DevExpress.XtraReports.UI.CrossTab.CrossTabDataField {
            FieldName = "Amount",
        });

        DetailBand detail = new DetailBand();
        detail.Name = "Detail";
        detail.HeightF = 800;
        detail.Controls.Add(chart);
        detail.Controls.Add(cross);
        detail.Controls.Add(pie);

        report.Bands.AddRange(new Band[] {
            new TopMarginBand(), detail, new BottomMarginBand()
        });

        report.SaveLayoutToXml(outPath);
        Console.WriteLine("written: " + Path.GetFullPath(outPath));
        Console.WriteLine();
        Console.WriteLine(File.ReadAllText(outPath));
    }

    // ------------------------------------------------------------- inspect

    /// Loads a file and reports what DevExpress actually sees in it.
    ///
    /// The headline is the cell comparison. Elements are counted in the raw
    /// text and again in the loaded object graph, and a shortfall means the
    /// loader DISCARDED something -- which is what a duplicate Ref does, with
    /// no exception and no warning. Exit code 1 when that happens, so this is
    /// usable as a check rather than only as a report.
    static int Inspect(string path) {
        string xml = File.ReadAllText(path);

        int rawCells = Regex.Matches(xml, "ControlType=\"XRTableCell\"").Count;
        int rawTables = Regex.Matches(xml, "ControlType=\"XRTable\"").Count;

        var refs = new Dictionary<string, int>();
        foreach (Match m in Regex.Matches(xml, "\\sRef=\"([^\"]*)\"")) {
            string v = m.Groups[1].Value;
            refs[v] = refs.ContainsKey(v) ? refs[v] + 1 : 1;
        }
        var dupes = new List<string>();
        foreach (var kv in refs) if (kv.Value > 1) dupes.Add(kv.Key + "x" + kv.Value);

        Console.WriteLine("raw text : " + rawTables + " tables, " + rawCells + " cells, "
                          + refs.Count + " distinct Ref values");
        if (dupes.Count > 0)
            Console.WriteLine("           DUPLICATE Refs: " + string.Join(", ", dupes.ToArray()));

        XtraReport r = new XtraReport();
        r.LoadLayoutFromXml(path);

        int cells = 0, bindings = 0, tables = 0;
        var lines = new List<string>();
        foreach (Band b in r.Bands)
            foreach (XRControl c in b.Controls)
                if (c is XRTable) {
                    tables++;
                    foreach (XRTableRow row in ((XRTable)c).Rows)
                        foreach (XRTableCell cell in row.Cells) {
                            cells++;
                            bindings += cell.ExpressionBindings.Count;
                            foreach (ExpressionBinding eb in cell.ExpressionBindings)
                                lines.Add("             " + b.Name + "." + cell.Name + ": "
                                          + eb.PropertyName + " = " + eb.Expression
                                          + (string.IsNullOrEmpty(cell.TextFormatString)
                                             ? "" : "   format " + cell.TextFormatString));
                        }
                }

        Console.WriteLine("loaded   : " + tables + " tables, " + cells + " cells, "
                          + bindings + " bindings");
        foreach (string line in lines) Console.WriteLine(line);

        // Charts and cross-tabs, counted in the raw text and again in the
        // loaded graph. A chart whose series the loader did not build is an
        // empty frame on the page, and it looks exactly like a chart that has
        // no data yet.
        int rawSeries = Regex.Matches(xml, "ArgumentDataMember=\"").Count;
        int rawCrossFields = Regex.Matches(xml, "<(Row|Column|Data)Fields>").Count;
        int series = 0, crossFields = 0, charts = 0, crosstabs = 0;
        foreach (Band b in r.Bands)
            foreach (XRControl c in b.Controls) {
                if (c is XRChart) {
                    charts++;
                    series += ((XRChart)c).Series.Count;
                    foreach (DevExpress.XtraCharts.Series s in ((XRChart)c).Series)
                        Console.WriteLine("             " + b.Name + "." + c.Name + ": series \""
                                          + s.Name + "\" " + s.View.GetType().Name
                                          + "  [" + s.ArgumentDataMember + "]");
                }
                if (c is XRCrossTab) {
                    crosstabs++;
                    XRCrossTab x = (XRCrossTab)c;
                    crossFields += x.RowFields.Count + x.ColumnFields.Count + x.DataFields.Count;
                    Console.WriteLine("             " + b.Name + "." + c.Name + ": cross-tab "
                                      + x.RowFields.Count + " row / " + x.ColumnFields.Count
                                      + " column / " + x.DataFields.Count + " data field(s)");
                }
            }
        if (charts + crosstabs > 0) {
            Console.WriteLine("charts   : " + charts + " chart(s) with " + series + " series, "
                              + crosstabs + " cross-tab(s) with " + crossFields + " field(s)");
            if (series < rawSeries)
                Console.WriteLine("           SERIES LOST: the file declares " + rawSeries
                                  + " and the loader built " + series + ".");
            if (crossFields == 0 && rawCrossFields > 0)
                Console.WriteLine("           CROSS-TAB FIELDS LOST: the file declares "
                                  + rawCrossFields + " collection(s) and the loader built none.");
        }

        // Parameters, because the file can DECLARE a type the loader silently
        // refuses. A parameter that comes back as System.String when the file
        // said System.DateTime is a report whose date filter compares text.
        int rawParams = Regex.Matches(xml, "<Parameters>").Count == 0
            ? 0 : Regex.Matches(Regex.Match(xml, "<Parameters>[\\s\\S]*?</Parameters>").Value, "\\sName=\"").Count;
        Console.WriteLine("params   : " + rawParams + " declared, " + r.Parameters.Count + " loaded");
        foreach (Parameter p in r.Parameters)
            Console.WriteLine("             " + p.Name + " : " + p.Type.FullName
                              + (p.MultiValue ? " multi" : "")
                              + (p.Visible ? "" : " hidden")
                              + (p.Value == null ? "" : "  = " + p.Value));
        if (!string.IsNullOrEmpty(r.FilterString))
            Console.WriteLine("filter   : " + r.FilterString);
        if (rawParams != r.Parameters.Count)
            Console.WriteLine("           PARAMETERS LOST: declared " + rawParams
                              + ", loaded " + r.Parameters.Count + ".");

        r.SaveLayoutToXml(path + ".resaved");
        Console.WriteLine("           re-saved OK -> " + Path.GetFileName(path) + ".resaved");

        if (cells < rawCells) {
            Console.WriteLine();
            Console.WriteLine("CONTENT LOST: the file declares " + rawCells + " cells and the loader"
                              + " built " + cells + ".");
            Console.WriteLine("Duplicate Ref values make DevExpress treat two elements as one object"
                              + " and discard the second.");
            return 1;
        }

        Console.WriteLine("           nothing lost: every declared cell survived the load.");
        return 0;
    }
}
