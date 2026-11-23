/**
 * The report files a .NET solution holds, told apart by name (2026-11-24,
 * findings GAP1-1 and GAP1-3 of the MCP design audit).
 *
 * In a DevExpress repository the usual report is not a .repx: Visual
 * Studio's report designer keeps a report as a class, `Report1.cs` with its
 * layout written as code in `Report1.Designer.cs` (`InitializeComponent`), or
 * in a legacy .NET project as `Report1.vsrepx`, the same serializer XML a
 * .repx is, which `Report1.Designer.cs` loads through a `ReportInitializer`.
 * A .repx appears where an application stores what an end-user or web
 * designer saved. So:
 *
 * - `.repx` and `.vsrepx` are layouts Forma reads (`reportFileKind`).
 * - A `.cs` or `.vb` file is code Forma cannot read a layout from. It is
 *   refused by its name, without being opened, in words that say how to get a
 *   .repx out of it (`codeReportMessage`); when a `.vsrepx` of the same name
 *   sits beside it (the project makes the class depend on it), the words name
 *   that file instead. The `ReportInitializer`'s argument is never read for
 *   this: it is a resource name, not a path.
 * - A `.vsrepx` written back in place is read by its class's Designer file,
 *   which binds each field to a control, parameter or style by its Name
 *   (`GetControl<XRLabel>("label1")`). Measured on DevExpress 20.1.3: a name
 *   the layout no longer has gives null, with no exception, so the field is
 *   null at run time. `designerLookups` reads those names, and
 *   `namesDropped` says which of them a new layout lost, so a writer can
 *   refuse.
 *
 * Plain string work, so it runs in the browser and in Node alike; the
 * callers read the files.
 */

/** What a file is to Forma, by its name alone. */
export type ReportFileKind = 'repx' | 'vsrepx' | 'code' | 'other';

/** The last part of a path, whichever separator it uses. */
const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name;

export function reportFileKind(name: string): ReportFileKind {
  const ext = /\.[^.\\/]*$/.exec(baseName(name))?.[0].toLowerCase() ?? '';
  if (ext === '.repx') return 'repx';
  if (ext === '.vsrepx') return 'vsrepx';
  if (ext === '.cs' || ext === '.vb') return 'code';
  return 'other';
}

/** A report class's name from its source file: `Report1` from `Report1.cs` or `Report1.Designer.vb`. */
export function codeReportClass(name: string): string {
  return baseName(name)
    .replace(/\.(cs|vb)$/i, '')
    .replace(/\.Designer$/i, '');
}

/**
 * Why a C# or VB file is refused, and what to send instead. `shown` is the
 * file as the message should name it; `layout` is a `.vsrepx` of the same
 * report found beside it, or null; `repx` is where a saved .repx would go.
 */
export function codeReportMessage(shown: string, layout: string | null, repx: string): string {
  const cls = codeReportClass(shown);
  const vb = /\.vb$/i.test(shown);
  if (layout) return `${JSON.stringify(shown)} is code. Its report keeps its layout in ${JSON.stringify(layout)}, beside it, which Forma reads: send that path instead.`;
  const save = vb ? `New ${cls}().SaveLayoutToXml("${repx}")` : `new ${cls}().SaveLayoutToXml(@"${repx}")`;
  return (
    `${JSON.stringify(shown)} is code: a report written as a C# or VB class keeps its layout as code in its Designer file, which Forma cannot read. ` +
    `Send a .repx of it instead. In Visual Studio, the report's smart tag saves its layout as a .repx (Save), and brings one back in (Open/Import); ` +
    `or, in the application, ${save} writes one.`
  );
}

/**
 * Every name a Designer file looks up through a `ReportInitializer`
 * (`GetControl`, `GetParameter`, `GetStyle` and the other `Get` lookups), in
 * C# or VB, in the order written, each once.
 */
export function designerLookups(source: string): string[] {
  const holders = new Set<string>();
  // C#: `ReportInitializer reportInitializer = new DevExpress.XtraReports.ReportInitializer(this, "...")`.
  for (const m of source.matchAll(/\b(\w+)\s*=\s*new\s+(?:[\w.]+\.)?ReportInitializer\s*\(/g)) holders.add(m[1].toLowerCase());
  // VB: `Dim r As ReportInitializer = New ...ReportInitializer(Me, "...")` or `Dim r As New ...ReportInitializer(Me, "...")`.
  for (const m of source.matchAll(/\bDim\s+(\w+)\s+As\s+(?:New\s+)?(?:[\w.]+\.)?ReportInitializer\b/gi)) holders.add(m[1].toLowerCase());
  for (const m of source.matchAll(/\b(\w+)\s*=\s*New\s+(?:[\w.]+\.)?ReportInitializer\s*\(/gi)) holders.add(m[1].toLowerCase());
  const names: string[] = [];
  // `x.GetControl<T>("name")`, `x.GetControl(Of T)("name")`, `x.GetParameter("name")`.
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*Get\w*\s*(?:<[^<>()"]*(?:<[^<>()"]*>[^<>()"]*)*>|\(\s*Of\s[^()"]*\))?\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/gi)) {
    if (holders.has(m[1].toLowerCase()) && !names.includes(m[2])) names.push(m[2]);
  }
  return names;
}

/** Every `Name` a layout writes, on any element: controls, bands, parameters, styles, data sources. */
export function layoutNames(xml: string): Set<string> {
  return new Set([...xml.matchAll(/\sName\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]));
}

/** The names a Designer file looks up that `before` had and `after` no longer has. */
export function namesDropped(before: string, after: string, lookups: readonly string[]): string[] {
  const had = layoutNames(before);
  const has = layoutNames(after);
  return lookups.filter((name) => had.has(name) && !has.has(name));
}
