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
