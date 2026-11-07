import type { ZipEntry } from './zip';

/**
 * Every saved project in one .zip (2026-11-08, site audit items 59 and 66):
 * Settings, under General, "Download all my projects". There was no way to
 * take your data with you, and on the free plan the project has no managed
 * backup, so this is also the backup a person keeps for themselves.
 *
 * For each project, its conversation and report as JSON, exactly as Forma
 * holds them (images inline, as they were attached), and its .repx when it
 * has one, so the report opens in the designer straight from the archive.
 * A README says what the files are. Pure: App reads the projects, from the
 * account or this browser, and `buildZip` packs what this returns.
 */
export interface ExportableProject {
  id: string;
  name: string;
  /** ISO 8601. */
  timestamp: string;
  messages: readonly unknown[];
  result: unknown;
}

const README = (count: number, at: Date) => `Your Forma projects, ${count} of them, downloaded ${at.toISOString().slice(0, 10)}.

For each project:
  <name>.json  the project as Forma keeps it: its name, when it was saved,
               the conversation (with any pictures you attached, inline) and
               the report Forma made, including its .repx.
  <name>.repx  the report itself, when there is one: open it in the
               DevExpress report designer.

https://openforma.web.app
`;

/** The repx a project's result carries, if any. */
function repxOf(result: unknown): string | null {
  const repx = (result as { repxContent?: unknown } | null)?.repxContent;
  return typeof repx === 'string' && repx.trim() ? repx : null;
}

export function projectExportEntries(projects: readonly ExportableProject[], at: Date = new Date()): ZipEntry[] {
  const entries: ZipEntry[] = [{ name: 'README.txt', content: README(projects.length, at) }];
  for (const p of projects) {
    const base = (p.name || 'Untitled report').trim() || 'Untitled report';
    entries.push({
      name: `${base}.json`,
      content: JSON.stringify({ id: p.id, name: p.name, savedAt: p.timestamp, messages: p.messages, result: p.result }, null, 2),
    });
    const repx = repxOf(p.result);
    if (repx) entries.push({ name: `${base}.repx`, content: repx });
  }
  return entries;
}

/** The archive's file name: forma-projects-2026-11-08.zip. */
export function exportFileName(at: Date = new Date()): string {
  return `forma-projects-${at.toISOString().slice(0, 10)}.zip`;
}
