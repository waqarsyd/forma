---
name: devexpress-repx
description: Write, repair or check a DevExpress report layout file (.repx, XtraReportsLayoutSerializer XML) so it opens and prints in DevExpress 20.1 and later. Use when generating or editing REPX by hand or by program, when a report opens empty or prints at the wrong size, or before handing a .repx to someone else.
---

# DevExpress REPX, as measured

A `.repx` is the XML DevExpress's serializer writes. The class reference describes the object
model, not the file, and several rules below are the opposite of what the reference suggests.
Every rule here was measured against the installed DevExpress 20.1 assemblies with
`tools/RepxProbe` (a console tool that asks the serializer what it writes and the loader what it
kept), or by printing; the linked headings hold the measurement.

## Check and repair from the command line

```powershell
npx tsx scripts/repx.ts audit  report.repx            # findings, one a line; exit 1 on an error
npx tsx scripts/repx.ts repair report.repx out.repx   # every repair Forma makes, then the audit
npx tsx scripts/repx.ts pdf    report.repx out.pdf    # the pages as Forma lays them out, a draft
```

Run `repair` on anything written by hand or by a model before it is opened in a designer: it is
the same chain the web app runs on every generated report, in the same order.

## The rules

1. **Every `Ref` is unique in the file.** A repeated `Ref` makes the loader drop content with no
   error: the report opens with controls missing. `ItemN` is a position in its collection and must
   count 1, 2, 3 in order; `Ref` is an identity. See [gemini.md](../../notes/gemini.md) — *must be unique, and a duplicate deletes content*
   and [gemini.md](../../notes/gemini.md) — *is an identity, and confusing them empties the report*.
2. **An item inside a collection carries no `ControlType`** unless it is a band or a control:
   series, group fields, parameters, styles and formatting rules are written without one.
   See [gemini.md](../../notes/gemini.md) — *Charts and cross-tabs, and the pattern that finally became a rule*.
3. **`Dpi` is read per element, 100 when absent, whatever `ReportUnit` says.** A millimetre report
   with no `Dpi` prints 2.54 times too large. Write `Dpi="254"` (TenthsOfAMillimeter) or `Dpi="96"`
   (Pixels) on the report, every band and every control. See [gemini.md](../../notes/gemini.md) — *A control is read at its own Dpi*.
4. **The page is `PaperKind`, Letter when absent**, turned by `Landscape="true"`. `PageWidth` and
   `PageHeight` are printed only for `PaperKind="Custom"`. An A4 report without `PaperKind="A4"`
   prints on Letter. See [gemini.md](../../notes/gemini.md) — *The paper is PaperKind, not the size written*.
5. **Declare the margins; do not draw them.** `Margins="left, right, top, bottom"` in whole numbers;
   DevExpress 20.1 drops a fractional one. Controls pushed inward to imitate a margin make a report
   nobody can re-margin. See [gemini.md](../../notes/gemini.md) — *The margin is drawn, not declared*.
6. **A total needs a running scope.** `sumSum([Amount])` with no `<Summary Running="Group"/>` (or
   `Report`, `Page`) prints an empty cell in every band. See [gemini.md](../../notes/gemini.md) — *A total with no running scope prints blank*.
7. **Nested groups follow `Level`, not file order.** Level 0 is the innermost group; a grouping
   written outer-first without `Level` prints inside out. See [gemini.md](../../notes/gemini.md) — *Grouping, measured the same way*.
8. **A parameter's type is its `ObjectStorage` entry.** An inline `Type=` is accepted and ignored.
   See [gemini.md](../../notes/gemini.md) — *Parameters, and the first measurement that was a negative result*.
9. **A SQL connection is written by name only.** With a login or password, DevExpress writes them
   in plain text inside the file. Use the connection's name from the application's config. See
   [gemini.md](../../notes/gemini.md) — *The SQL data source, measured*.
10. **`SerializerVersion` is a label, not a gate.** An older designer opens a newer file; a report
    that opens wrong has something wrong in it, which `audit` names. See
    [gemini.md](../../notes/gemini.md) — *SerializerVersion is a label, not a gate*.
11. **A second language is `LocalizationItems`, and the first must be there too** (measured
    2026-11-11 with `RepxProbe emit-localize`). Each item is
    `<ItemN Ref="..." Component="#Ref-<control's Ref>" Culture="de" Path="Text" Data="Rechnung" />`
    after `</Bands>`. Once a file has any `LocalizationItems`, **every** control loses its own `Text`
    and `Font` on loading, an item or not (its place, size and table weights stay), unless an
    item with `Culture="Default"` holds them: write a `Default` `Text` and `Font` item for every
    control that has one, then the second language's `Text`. The designer itself saves `Font`,
    `LocationFloat`, `SizeF` and `Text` as `Default` items. A neutral culture (`de`) serves `de-DE`
    and `de-AT`; `de-DE` does not serve `de`.

## What a repair will not do

The repairs change only what DevExpress would read differently from what was meant. They do not
move controls apart (except for a report designed from words), invent data fields, or restyle a
report. `audit` reports what is still wrong after them; an error there is a repair that declined,
and the finding says why in words meant for the person who will open the file.
