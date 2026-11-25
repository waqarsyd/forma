/**
 * The chat's edit language: each edit an open report can take in place, by
 * its "op", and the fields each reads, in the words the model is told
 * (2026-11-24, moved out of geminiService.ts's REPORT_CHAT_INSTRUCTIONS and
 * agentEdit.ts unchanged, the words byte for byte). Two readers share it, so
 * they cannot drift: the chat's prompt and `applyEdits` (agentEdit.ts, which
 * exports `EDIT_OPS` as it always did), and repx_edit, the MCP server's edit
 * tool, which makes the same edits through `applyEdits` and reads the list
 * and the words here without loading agentEdit.ts when the server starts.
 *
 * `GROUP_EDIT` is told to the chat only beside a shared database
 * (DATABASE_CHAT_RULES), where the instructions above would otherwise send a
 * group to a redesign; the MCP tool tells it always, since a group band needs
 * no database. The `data` edit is the database's alone: `DATA_EDIT`, told to
 * the chat beside a shared database and, since the CLI and Forma Designer
 * work's wave 7, by repx_edit, which makes it with a database layout given.
 *
 * Pure ASCII, as everything the MCP server sends.
 */
import { SUPPORTED_PAGE_SIZES } from './reportGeometry';

/**
 * What the model can ask for. Anything else is a redesign. The last seven
 * came on 2026-11-07 (agent audit item 22, the owner's four groups): each
 * was a full redesign, some 20,000 tokens, for what is one splice here.
 * A table's row or column is styled by `font`, `color`, `align`, `border`
 * and `format` naming the row or the cell alone.
 */
export const EDIT_OPS = [
  'text', 'move', 'resize', 'font', 'color', 'align', 'delete', 'add', 'paper', 'margins', 'visible',
  'duplicate', 'bandHeight', 'border', 'line', 'format', 'bind', 'pageNumber',
  // A sentence about what a control is for (2026-11-10, the third gap of
  // docs/proposals/ai-designers.md): written to AccessibleDescription, which
  // the accessibility checks want on a picture too, and shown in the outline.
  'describe',
  // The database's two (2026-11-09, the SQL Server programme, item 24): what
  // the report reads, written by Forma from the shared layout through the
  // `data` hook of `applyEdits`, and a group band on a field.
  'data', 'group',
] as const;
export type EditOp = (typeof EDIT_OPS)[number];

export const EDIT_LANGUAGE = `The edits, by "op", and the fields each reads:
- text: control, text. For a table's cell also row and cell, numbered as in the outline. A control or cell printing a [Field] cannot be retyped.
- move: control, x, y. resize: control, width, height.
- font: control (and row, cell for a table's cell), any of family, size, bold, italic, underline.
- color: control (row, cell), foreColor and/or backColor.
- align: control (row, cell), align: left, center or right.
- delete: control. visible: control, visible.
- add: a new label: band (its name or kind), text, x, y, and optionally width, height, family, size, bold, italic. Match the report's own font unless asked otherwise.
- paper: paper (${SUPPORTED_PAGE_SIZES.join(', ')}), landscape; landscape alone turns the paper the report has. margins: any of left, right, top, bottom.
- duplicate: control, and optionally x, y for the copy. bandHeight: band, height. describe: control, text, a sentence saying what the control is for (125 characters at most), when the user describes a control; the outline shows it as described as.
- border: control (row, cell), any of borders (All, None, or sides such as "Top, Bottom"), borderColor, borderWidth.
- line: a horizontal line: band, x, y, and optionally width (the printable width when absent), borderWidth (its weight), name.
- format: control (row, cell), format: a .NET format with {0}, such as {0:N2}, {0:C2}, {0:P0} or {0:dd/MM/yyyy}.
- bind: control (row, cell), field: what it prints from the data. Use a field from FIELDS PRINTED or one the user names.
- pageNumber: band (the page footer when absent), x, y, and optionally width, align, format ("Page {0} of {1}" when absent), pageInfo (NumberOfTotal, Number, Total or DateTime).
On a table, font, color, align, border and format name a cell by row and cell, a whole row by row alone (a header row), a column by cell alone, and every cell with neither.`;

export const GROUP_EDIT = `- group: field, and optionally total (a field to sum in the group's footer): a group band on that field, outside any group the report has.`;

/**
 * The `data` edit, as the chat is told it beside a shared database
 * (geminiService.ts DATABASE_CHAT_RULES) and, since the CLI and Forma
 * Designer work's wave 7 (2026-11-25), repx_edit with a database layout
 * (D1-11): moved here from the chat's rules byte for byte, so the two read
 * one copy.
 */
export const DATA_EDIT = `- data: query, what the report reads, as JSON: {"table":"dbo.Orders","joins":[{"table":"dbo.Customers","type":"LeftOuter","on":[{"from":"CustomerID","to":"CustomerID"}]}],"filter":"[Customers.Region] = ?Region","sort":[{"column":"dbo.Orders.OrderDate","descending":true}],"details":[{"table":"dbo.OrderLines","on":[{"from":"OrderID","to":"OrderID"}]}]}, or {"procedure":"dbo.usp_Name"}, or {"name":"Q","sql":"SELECT ..."}. Write the WHOLE query, starting from what the report reads now and changing what was asked. A join's "from" is the main table's column and "to" the joined one's; a filter's ?Name becomes a report parameter Forma adds. Then bind, or add and bind, the controls that print new fields.`;
