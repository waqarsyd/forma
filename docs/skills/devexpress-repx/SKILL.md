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

## Forma's command line

```powershell
node <clone>/src/mcp/cli.mjs audit  report.repx                 # findings, one a line; exit 1 on an error
node <clone>/src/mcp/cli.mjs repair report.repx --out out.repx  # every repair Forma makes, then the audit; exit 1 on an error
node <clone>/src/mcp/cli.mjs pdf    report.repx --out out.pdf   # the pages as Forma lays them out, a draft
```

That is Forma's command line, run with plain node from any folder after a full `npm ci` in a clone
of Forma (since 2026-11-24), `<clone>` being that clone's full path; a relative name is read from
the folder the command runs in, and `--help` lists every command and option. Every command:

| Command | What it does |
|---|---|
| `audit` | Checks a `.repx` or `.vsrepx`, or every report directly in a folder, and lists what is still wrong; writes nothing |
| `outline` | The report as Forma's chat sees it: paper, bands, every control by the name `edit` takes, the fields, its data sources by connection name |
| `repair` | Every repair Forma makes on a generated report, in the same order, then the audit; writes `<name>.repaired.repx` |
| `pdf` | A draft PDF laid out by Forma's Preview engine with no data; writes `<name>.pdf` |
| `edit` | The edits Forma's chat makes, by control name, given with `--edits` as JSON; writes `<name>.edited.repx` |
| `convert` | An SSRS `.rdl` or `.rdlc` or a FastReport `.frx` made into a repaired `.repx` with no AI; writes `<name>.converted.repx` |
| `bind` | A report's SQL data source written for a table, view or stored procedure of a database's layout (`--database`), the connection by name only, with no AI; writes `<name>.bound.repx` |
| `generate` | Needs an AI. A report made as Forma's workspace makes one, from pictures, PDFs, a report or template and/or `--description`; writes `<first file>.generated.repx` |
| `revise` | Needs an AI. A report changed as `--words` asks, as Forma's chat does, by control name where it can; writes `<name>.revised.repx` |
| `batch` | Needs an AI for some files. Every report source in a folder, one file at a time, each routed by its kind, under `--out` |
| `sql-script` | Prints Forma's read-only script for a SQL Server database's layout, whose saved answer `--database` reads |
| `connections` | Windows, with Forma Designer: the SQL Server connections it keeps for the user, by name. It and `--connection` need the next release of Forma Designer, which adds the command-line verbs they start; until then they say so |

The commands that need an AI read the one set up in the environment the command runs in
(`FORMA_GEMINI_KEY`, or the other `FORMA_*` names in
[README.md](../../../README.md), *Forma from the command line*),
and exit 3 without one; the others never look. It never replaces a file
unless `--force` is given: a file already at the output with other content is left as it is, and
the command exits 4, as it does when the file system refuses the write (a read-only folder, a full
disk). Even with `--force` it never writes over a report whose stored login it took out. A usage
error exits 2 and an internal error 70, so a gate can tell a bad report from a broken tool.

Run `repair` on anything written by hand or by a model before it is opened in a designer: it is
the same chain the web app runs on every generated report, in the same order. It keeps code the
report already had (its scripts), and the audit names that code as the error
`report-has-scripts`, so `repair` exits 1 for a report with scripts of its own (since 2026-11-24;
it removed them and exited 0 before).

## From Forma's MCP server

With Forma's MCP server connected to your assistant ([README.md](../../../README.md), *Forma from an AI assistant*),
the same three are tools, with more: `repx_audit`, `repx_repair` and `repx_pdf`, and
`repx_outline` (the report as Forma's chat sees it, every control by the name `repx_edit` takes),
`repx_edit` (the chat's edits, by control name), `repx_convert` (an SSRS or FastReport report made
into a repaired `.repx`) and `database_connections` (the Forma Designer connections the user listed
for the server). None of those calls an AI. Two more do, with
the AI the user set up in the server's entry (README.md, *Your AI, and where its key is kept*):
`generate_report` makes a report from a description and files as Forma's workspace makes one,
and `revise_report` changes a report as a request in words asks, as Forma's chat does; each
writes a new `.repx` and never replaces one. A database's layout (`database`, the answer of the
script the server serves as `forma://sql/layout-script`, saved as a file; or `connection`, a
listed Forma Designer connection) binds a report: `repx_edit`'s `data` edit and `repx_convert`
with no AI, the two AI tools with the AI choosing what the report reads unless `procedure`,
`object` or `query` pins it (README.md, *Your database's layout*). `connection` and
`database_connections` need Windows and the next release of Forma Designer, which adds the
command-line verbs they start; until then they say so, and a layout file works everywhere. Every path is a full path,
never a relative name, `~` or a Git Bash `/g/...` path, which the tools refuse:

```json
{ "path": "G:\\Reports\\invoice.repx" }
{ "path": "/home/me/reports/invoice.repx", "output": "/home/me/reports/invoice.fixed.repx" }
```

`repx_repair`, `repx_edit`, `repx_pdf` and `repx_convert` each write a new file (`repx_repair` beside
the input as `<name>.repaired.repx` unless `output` says where), never replace one unless
`repx_edit` is asked to, and name the file written in their result; `repx_audit`, `repx_outline`
and `database_connections` write nothing. A
stored database login is removed before any of them reads the report, and text read from the
report comes back under `fromFile`, as data. A file that is not well-formed XML is refused, with
the line where it breaks. `forma_status` lists the folders the tools may use.

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
