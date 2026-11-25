/**
 * The Forma Designer download (2026-11-09, the owner's download programme,
 * batch WD): what the download page shows and links, what Open in designer
 * compares the running copy against, and what `scripts/deploy.mjs` uploads.
 *
 * The block between the markers is written by `scripts/package-designer.ts`
 * and nothing else: it builds the companion, packs the exe with its readme,
 * notice and licence, and records the zip's version, name, size and SHA-256
 * here. The zip itself is not committed (it is built in the gitignored
 * `tools/RepxDesigner/bin/package/`); it is attached to the GitHub release
 * named by `tag`, where GitHub serves it free with no bandwidth limit.
 *
 * The build is deterministic (`<Deterministic>` in the project, and every zip
 * entry dated 2026-01-01), so the same commit packs to the same SHA-256: the
 * check a person can make on a download that is not code-signed.
 *
 * **No DevExpress file is ever in it** (`packageProblems`): DevExpress is a
 * commercial product of Developer Express Inc. that only a licensed developer
 * may redistribute, and Forma Designer uses whatever the user installed.
 */

export interface DesignerRelease {
  /** Forma Designer's own version, its AssemblyVersion: not Forma's. */
  version: string;
  /** The zip's name on the release. */
  file: string;
  /** The zip's size in bytes. */
  bytes: number;
  /** Lower-case hex SHA-256 of the zip. */
  sha256: string;
  /** When it was packed, yyyy-mm-dd. */
  date: string;
  /** The Forma release (git tag) the zip is attached to. */
  tag: string;
}

// BEGIN designer release (scripts/package-designer.ts writes this block)
export const DESIGNER_RELEASE: DesignerRelease = {
  version: '1.2.0',
  file: 'FormaDesigner-1.2.0-windows.zip',
  bytes: 142781,
  sha256: 'e6e34b66f3325cc2592f32206eea8b36f2433c9b8eb9bf4ee79663e5dd05c07f',
  date: '2026-11-25',
  tag: 'v1.7.0',
};
// END designer release

const DESIGNER_REPO = 'waqarsyd/forma';

/**
 * DevExpress's own trial page: 30 days, no registration, the current version
 * only (devexpress.com, read 2026-11-09). The one link for DevExpress anywhere
 * in Forma, the dialog's and the download page's; the companion's `TrialUrl`
 * is held equal to it by a test.
 */
export const DEVEXPRESS_TRIAL_URL = 'https://www.devexpress.com/products/try/';

/**
 * What Forma Designer needs, as the download page states it. Each is held to
 * where it is decided by publicClaims.test.ts: the .NET version to the
 * project's TargetFrameworkVersion, the oldest DevExpress to
 * DevExpressLocator.Oldest, the port to DESIGNER_ORIGIN.
 */
export const DESIGNER_REQUIREMENTS = { windows: 'Windows 10 or 11', dotnet: '4.7.2', devexpressOldest: '20.1', port: 7317 } as const;

/** The zip's size as a person reads it: "98 KB". */
export function designerSize(bytes: number = DESIGNER_RELEASE.bytes): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A yyyy-mm-dd date as the site writes dates: "9 November 2026", the same on the server and in the browser. */
export function designerDate(iso: string = DESIGNER_RELEASE.date): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The zip's address on its GitHub release. */
export function designerDownloadUrl(release: DesignerRelease = DESIGNER_RELEASE): string {
  return `https://github.com/${DESIGNER_REPO}/releases/download/${release.tag}/${release.file}`;
}

/** The release the zip belongs to, for its notes and for older versions. */
export function designerReleasePage(release: DesignerRelease = DESIGNER_RELEASE): string {
  return `https://github.com/${DESIGNER_REPO}/releases/tag/${release.tag}`;
}

/** The zip's name for a version: one place, so the script and the test agree. */
export function designerZipName(version: string): string {
  return `FormaDesigner-${version}-windows.zip`;
}

/**
 * The files a package may hold, and nothing else: the program and the three
 * texts. Anything else is a problem, and a DevExpress file is named as such,
 * because shipping one would redistribute a commercial product.
 */
export const DESIGNER_PACKAGE_FILES = ['RepxDesigner.exe', 'README.txt', 'NOTICE.txt', 'LICENSE.txt'] as const;

export function packageProblems(names: readonly string[]): string[] {
  const problems: string[] = [];
  for (const name of names) {
    if (/devexpress/i.test(name)) problems.push(`${name} is a DevExpress file, which Forma may not redistribute`);
    else if (!(DESIGNER_PACKAGE_FILES as readonly string[]).includes(name)) problems.push(`${name} is not one of ${DESIGNER_PACKAGE_FILES.join(', ')}`);
  }
  for (const needed of DESIGNER_PACKAGE_FILES) {
    if (!names.includes(needed)) problems.push(`${needed} is missing`);
  }
  return problems;
}

/**
 * The first Forma Designer with the command-line verbs Forma's command line
 * starts to read a database (`sql-list`, `sql-schema`, `sql-sample`; the CLI
 * and Forma Designer work's wave 6, 2026-11-25, finding D2-8 of its design
 * audit). They are in its source since then, and come with this version,
 * which the owner raises and packs (scripts/package-designer.ts): until that
 * commit `AssemblyInfo.cs` still says 1.1.0, as the download does. The bump
 * raises both of its versions, `AssemblyVersion` (this record, /health) and
 * `AssemblyFileVersion` (the file's VS_FIXEDFILEINFO, which is what is read
 * below): one raised alone would pack a 1.2.0 the command line reads as
 * 1.1.0 and never starts, so designerRelease.test.ts holds the two equal and
 * package-designer.ts refuses to pack them apart (the wave's review, N6-1).
 * Before src/mcp/designerVerbs.ts starts the per-user install, it reads the
 * exe's own file version and starts nothing older than this, since 1.1.0
 * given a verb it does not know would open it as a report path (it answers
 * the sentinel the verbs end with by printing `--check`'s JSON, and a build
 * older than 2026-11-09 has no `--check` at all). A copy built from source,
 * named by FORMA_DESIGNER, is not held to it, since its file said 1.1.0.0
 * until the owner's bump (2026-11-25), as one from an older checkout still
 * does, but it is held to 1.0.0, the first with a file
 * version and with `--check` (designerVerbs.ts `DESIGNER_CHECK_SINCE`).
 * designerRelease.test.ts holds it newer than 1.1.0, the last release
 * without the verbs, and not newer than the source's own version once the
 * bump has landed.
 */
export const DESIGNER_VERBS_SINCE = '1.2.0';

/** Whether the version a running copy reports is older than the download (a.b.c, numeric). */
export function designerIsOlder(running: string | null | undefined, latest: string = DESIGNER_RELEASE.version): boolean {
  if (!running || !/^\d+\.\d+\.\d+$/.test(running) || !/^\d+\.\d+\.\d+$/.test(latest)) return false;
  const a = running.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
