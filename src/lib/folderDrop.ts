/**
 * Files and folders given to the batch panel, as a flat list of files
 * (2026-11-04, the PRD's "not yet": dropping a folder onto the panel).
 *
 * A drop hands over entries, not files: a folder is a directory entry whose
 * reader answers in batches (a hundred at a time in Chrome) until it answers
 * none, so a reader read once loses everything past the first hundred. And
 * the entries must be taken before the first `await`, because the browser
 * empties the drop's `DataTransfer` as soon as the handler returns.
 *
 * Kept free of React so a test can hand it fake entries.
 */

/** A file with where it came from: its path inside the folder dropped or chosen, or its name. */
export interface GivenFile {
  file: File;
  path: string;
}

/** More than this many files from one drop is a mistake, not a batch: the run would take days on a free key. */
export const MAX_BATCH_FILES = 500;
/** Folders deeper than this are not opened. */
const MAX_DEPTH = 8;

/**
 * The sources the batch takes: images, PDFs, .repx files and, since
 * 2026-11-11 (the full audit's CP-01a), SSRS report definitions (.rdl,
 * .rdlc), which are read as text the way a .repx is. By type or, where the
 * browser gave none, by name.
 */
export function acceptsForBatch(name: string, type: string): boolean {
  const base = name.split('/').pop() ?? name;
  if (base.startsWith('.')) return false;
  return type.startsWith('image/') || type === 'application/pdf' || /\.(repx|rdlc?|pdf|png|jpe?g|gif|webp|bmp|tiff?)$/i.test(base);
}

/** Whether a file is a Crystal Reports file, which only Crystal Reports reads: its PDF is the way in. */
export function isCrystalReport(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  return !base.startsWith('.') && /\.rpt$/i.test(base);
}

/** What the batch says of the Crystal Reports files it was given, as the chat box says of one. */
export function crystalNote(count: number): string {
  return count === 1
    ? '1 Crystal Reports file: export it from Crystal Reports as a PDF (File > Export) and add the PDF.'
    : `${count} Crystal Reports files: export each from Crystal Reports as a PDF (File > Export) and add the PDFs.`;
}

/**
 * What a drop or a picker holds that the batch can take, in path order, with
 * a count of what it left (`skipped`) and, of those, how many are Crystal
 * Reports files (`crystal`), which are reports the batch is for and have a
 * way in (`crystalNote`). `crystal` is a part of `skipped`, not apart from
 * it (2026-11-11, the full audit's PIPE1 review): the batch panel says
 * `skipped` and not yet `crystal`, and a .rpt taken out of the one count
 * before the other was said would have been left out with nothing said.
 */
export function forBatch(given: readonly GivenFile[]): { files: GivenFile[]; skipped: number; crystal: number; truncated: boolean } {
  const accepted = given.filter((g) => acceptsForBatch(g.path, g.file.type)).sort((a, b) => a.path.localeCompare(b.path));
  const crystal = given.filter((g) => isCrystalReport(g.path)).length;
  return {
    files: accepted.slice(0, MAX_BATCH_FILES),
    skipped: given.length - accepted.length,
    crystal,
    truncated: accepted.length > MAX_BATCH_FILES,
  };
}

/** A picker's files, with the path a folder picker gives each (`webkitRelativePath`). */
export function filesFromPicker(list: ArrayLike<File>): GivenFile[] {
  return Array.from(list, (file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}

/** One item of a drop's `DataTransfer.items`, as much of it as this reads. */
export interface DropItem {
  kind: string;
  webkitGetAsEntry?: () => FileSystemEntry | null;
  getAsFile: () => File | null;
}

/** Every file in a drop, folders opened, up to one more than `MAX_BATCH_FILES` so a caller can tell it stopped. */
export async function filesFromDrop(items: ArrayLike<DropItem>): Promise<GivenFile[]> {
  const roots: FileSystemEntry[] = [];
  const out: GivenFile[] = [];
  // Synchronously, before any await: see the module comment.
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry) roots.push(entry);
    else {
      const file = item.getAsFile();
      if (file) out.push({ file, path: file.name });
    }
  }
  for (const entry of roots) await walk(entry, out, 0);
  return out;
}

async function walk(entry: FileSystemEntry, out: GivenFile[], depth: number): Promise<void> {
  if (out.length > MAX_BATCH_FILES) return;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\/+/, '') || file.name });
    return;
  }
  if (!entry.isDirectory || depth >= MAX_DEPTH) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return;
    for (const child of batch) await walk(child, out, depth + 1);
    if (out.length > MAX_BATCH_FILES) return;
  }
}
