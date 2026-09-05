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

static class Program {
    static int Main(string[] args) {
        if (args.Length < 2) {
            Console.WriteLine("usage: RepxProbe emit <out.repx>");
            Console.WriteLine("       RepxProbe emit-group <out.repx>");
            Console.WriteLine("       RepxProbe inspect <in.repx>");
            return 2;
        }
        try {
            switch (args[0]) {
                case "emit":       Emit(args[1]);      return 0;
                case "emit-group": EmitGroup(args[1]); return 0;
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
