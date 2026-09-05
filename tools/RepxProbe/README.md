# RepxProbe

Ask DevExpress what a `.repx` really contains, instead of guessing from the API
documentation.

```powershell
RepxProbe emit <out.repx>        # what does the serializer WRITE for a feature?
RepxProbe emit-group <out.repx>  # the same, for a GROUPED report
RepxProbe emit-params <out.repx> # the same, for a PARAMETERISED report
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

## Related

- [`tools/RepxDesigner/README.md`](../RepxDesigner/README.md) — the GUI
  companion that opens a `.repx` in the real designer. Start that one from your
  own desktop; this one has no such constraint.
- [`docs/notes/gemini.md`](../../docs/notes/gemini.md) — the reasoning.
- `src/lib/repxRefs.ts`, `repxBindings.ts`, `repxBindingPlan.ts` — the code
  these measurements produced.
