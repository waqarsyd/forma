# RepxProbe

Ask DevExpress what a `.repx` really contains, instead of guessing from the API
documentation.

```powershell
RepxProbe emit <out.repx>        # what does the serializer WRITE for a feature?
RepxProbe emit-group <out.repx>  # the same, for a GROUPED report
RepxProbe emit-params <out.repx> # the same, for a PARAMETERISED report
RepxProbe emit-chart <out.repx>  # the same, for a CHART and a CROSS-TAB
RepxProbe emit-grow <out.repx>   # the same, for AUTO-SIZING (CanGrow/CanShrink/WordWrap)
RepxProbe emit-marks <out.repx>  # the same, for CHECKBOXES and CROSS-BAND controls
RepxProbe emit-container <out.repx> # the same, for XRPanel and XRSubreport
RepxProbe emit-styles <out.repx> # the same, for a STYLE SHEET
RepxProbe emit-rich <out.repx>   # the same, for XRRichText and XRShape
RepxProbe emit-rules <out.repx>  # the same, for CONDITIONAL FORMATTING
RepxProbe emit-calc <out.repx>   # the same, for CALCULATED FIELDS
RepxProbe emit-sort <out.repx>   # the same, for SORTING the detail rows
RepxProbe emit-mark <out.repx>   # the same, for a WATERMARK (text and image)
RepxProbe emit-cols <out.repx>   # the same, for MULTI-COLUMN detail flow
RepxProbe emit-book <out.repx>   # the same, for BOOKMARKS / the document map
RepxProbe emit-gauge <out.repx>  # the same, for XRGauge and XRSparkline
RepxProbe emit-toc <out.repx>    # the same, for a TABLE OF CONTENTS
RepxProbe emit-comb <out.repx>   # the same, for a CHARACTER COMB
RepxProbe render-cols            # what does DevExpress DRAW? bricks from CreateDocument()
RepxProbe inspect <in.repx>      # what does the loader SEE in a file we produced?
```

## Why this exists

Forma emits `XtraReportsLayoutSerializer` XML. The DevExpress documentation
describes the **object model** — `ExpressionBinding` is a constructor taking
`EventName`, `PropertyName` and `Expression` — and nowhere states what the
serializer writes into the file. Those are not the same thing, and the file is
what this app produces.

Until 2026-09-04 the only way to settle a question about the file was *open the
designer and look*. That is a manual step requiring the owner's own desktop: a
GUI process started from an agent shell paints on a desktop nobody can see, and
reports success anyway. Four questions were queued behind it, some for weeks.

**None of them needed the designer.** `SaveLayoutToXml` and `LoadLayoutFromXml`
are library calls on an installed assembly, with no window anywhere near them.
This tool is that realisation made permanent. It runs anywhere the DevExpress
20.1 assemblies are installed, takes about a minute, and turns "we think the XML
looks like this" into a measurement.

**Reach for it before writing REPX syntax from a class reference.**

## Build

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe" `
    tools\RepxProbe\RepxProbe.csproj /p:Configuration=Release
```

Output lands in `tools\RepxProbe\bin\Release\RepxProbe.exe`, which is gitignored
along with `obj/` by the `tools/**/bin/` rules in `.gitignore`.

Unlike `RepxDesigner`, this is a **console** app and never opens a window — so
unlike that one, it is fine to run from an agent shell. It references five
DevExpress assemblies by full path against the installed 20.1, the version the
target ERP is built against and therefore the one whose serializer output is
worth measuring.

## `inspect` is the one you will use most

It reads the raw XML, loads it, and **compares**:

```
raw text : 2 tables, 6 cells, 10 distinct Ref values
           DUPLICATE Refs: 5x2, 6x2, 21x2, 22x2, 23x2
loaded   : 2 tables, 3 cells, 0 bindings

CONTENT LOST: the file declares 6 cells and the loader built 3.
Duplicate Ref values make DevExpress treat two elements as one object and discard the second.
```

That comparison is the point. A `.repx` can lose content **silently** on load —
no exception, no warning, and it opens in the designer looking fine with
controls missing. Counting what the file declares against what the loader
actually built is the only way to see it. `inspect` exits **1** when content was
lost, so it works as a check and not only as a report.

On a healthy file it lists the bindings and formats DevExpress resolved:

```
loaded   : 3 tables, 9 cells, 4 bindings
             Detail.cell1: Text = [Description]
             Detail.cell2: Text = [UnitPrice]   format {0:c2}
             ReportFooter.cell3: Text = sumSum([Amount])
           nothing lost: every declared cell survived the load.
```

**Point it at a real generation.** Export a `.repx` from the app and inspect it:
that is the cheapest way to find out whether the model's own output has the
`Ref` collisions `src/lib/repxRefs.ts` was written to repair, which is still
inferred rather than observed.

## `emit` answers a new syntax question

Add whatever feature you need to `Emit()` in `Program.cs`, build, run, and read
the XML it prints. The current program covers an expression binding, a binding
with a `TextFormatString`, and a summary, because those were the open questions
on 2026-09-04.

## What it has already settled

All of this is written up in the *DevExpress can be asked directly, and it
answers* section of [`docs/notes/gemini.md`](../../docs/notes/gemini.md); the
short version:

- The element is `ExpressionBindings`, not the legacy `DataBindings`, and the
  binding item carries **no `ControlType`** unlike every other element.
- `Text=` survives alongside a binding.
- A summary is an ordinary expression: `Expression="sumSum([Amount])"`.
- `TextFormatString` is a plain attribute on the cell.
- **`Ref` must be unique.** Sequence does not matter and it may be omitted
  entirely, but a duplicate makes the loader alias two elements onto one object
  and discard the second's content, with no error. Measured on one document
  differing only in its `Ref` values: unique gave 6 cells and 3 bindings,
  duplicated gave 3 cells and 0 bindings.

And from `emit-group` on 2026-09-05, for the grouping work:

- **`<GroupFields>` is a sibling of `<Controls>` and is written before it**, so
  a parser that takes a band's first child collection reads the grouping fields
  as its controls.
- **A group field item carries no `ControlType`** — the second place after an
  `ExpressionBindings` item where that holds.
- **`SortOrder` is not written for the ascending default**, even when set
  explicitly, so Forma emits none.
- **A group subtotal differs from a grand total only by `Running="Group"`** on
  the cell's `<Summary>`; the expression is the same `sumSum([Amount])`, and
  `Func="Sum"` is omitted as the default. Leaving `Running` off does not fail —
  it totals the whole report at every group break.

And from `emit-params` the same day, which produced the first useful **negative**
result:

- A parameter's default is **`ValueInfo`**, not `Value`, and a **string**
  parameter carries **no `Type`**.
- Any other type is a **`#Ref-N` pointer into an `<ObjectStorage>` block** at
  the end of the document, with an assembly-qualified `ObjectType`.
- **Writing the type inline is accepted and silently ignored.**
  `Type="System.DateTime"` loads a `System.String` holding the date as text —
  no exception, no warning, and the report's date filter then compares strings.
  This is the case the tool is *most* worth reaching for: trial and error
  cannot find it, because the trial appears to succeed.

`inspect` reports parameters for this reason, and prints `PARAMETERS LOST` when
the declared and loaded counts disagree.

And from `emit-chart`:

- The collection is **`SeriesSerializable`**, not `Series`, and the plotted
  field is **`ValueDataMembersSerializable`**, not `ValueDataMembers`.
- **A bar series writes no view type at all** — it is the default. Anything
  else adds `<View TypeNameSerializable="LineSeriesView" />` as a child.
- **A pie chart writes no `<Diagram>`.** The XY types write one.
- A cross-tab is `<RowFields>`, `<ColumnFields>` and `<DataFields>` beside an
  empty `<LayoutOptions />` and `<PrintOptions />`.

And from `emit-grow`, which produced the second negative result — **a defect
that was not there**:

- **`CanGrow` defaults to `true`** on `XRLabel`, on `XRTableCell` and on a band,
  and so does `WordWrap`. Setting them to `true` writes nothing at all; only the
  `false` values appear in the file. `CanShrink` is the exception, defaulting to
  `false`.
- So text already grows and wraps, and **Forma emitting none of them is
  correct**. `CanGrow="true"` on every control would be pure bloat — the same
  waste `emit-group` found for `SortOrder`.
- The real risk is the inverse of the one suspected: a `CanGrow="false"` in
  generated output *would* clip, because that is the non-default.

And from `emit-styles` and `emit-rich` the same day:

- **`<StyleSheet>` is a root-level collection after `</Bands>`**, and a control
  refers to a style **by name** — `StyleName="HeadingStyle"` — not by a `#Ref-N`
  pointer. An explicit attribute on the control still overrides it.
- **A control's `Borders` is a style's `Sides`.** Writing `Borders=` inside a
  style is silently ignored: the file loads and the border never appears.
- **`XRShape` puts its figure in a `<Shape ShapeName="…" />` child, and `Ellipse`
  writes no element at all** — so a bare `XRShape` is a circle.
- **`XRRichText` cannot be authored.** Its content is `SerializableRtfString`, a
  base64-encoded UTF-16 RTF document — ~2.5 kB for one sentence, and setting
  `Html` produces RTF too. There is no readable form in the file, so a model
  cannot write one and an approximation loads as an empty box.

And from `emit-rules`:

- **`<FormattingRuleSheet>` is root-level and written BEFORE `<Bands>`** -- the
  opposite side from `<StyleSheet>`, which is written after.
- **A control links a rule by `Value="#Ref-N"`, the fourth pointer attribute**
  in this format. `repxRefs.ts` matched it without being changed, because its
  pattern matches the attribute VALUE rather than any attribute name -- keep
  that property if it is ever edited.

**Three of eight measurements have been negative** (`Type=` inline is silently
ignored; auto-sizing needs nothing; rich text cannot be written), and all three
looked like real gaps beforehand. A grep proving an attribute is absent says
nothing about what the absence means, because this serializer omits every default
— so absence is the normal case. **Reach for this tool before writing the fix,
not only before writing the syntax.**

**The pattern across four measurements:** a collection item carries no
`ControlType` — bindings, group fields, chart series, cross-tab fields. Anything
that finds elements *by* control type is blind to all of them. Assume the next
collection is the same and check.

`inspect` reports charts and cross-tabs too, naming the view type DevExpress
actually built, and prints `SERIES LOST` or `CROSS-TAB FIELDS LOST` when the
loader built fewer than the file declares.

## Related

- [`tools/RepxDesigner/README.md`](../RepxDesigner/README.md) — the GUI
  companion that opens a `.repx` in the real designer. Start that one from your
  own desktop; this one has no such constraint.
- [`docs/notes/gemini.md`](../../docs/notes/gemini.md) — the reasoning.
- `src/lib/repxRefs.ts`, `repxBindings.ts`, `repxBindingPlan.ts` — the code
  these measurements produced.
