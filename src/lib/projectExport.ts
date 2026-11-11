import { safeEntryName, uniqueEntryNames, type ZipEntry } from './zip';

/**
 * Every saved project in one .zip (2026-11-08, site audit items 59 and 66):
 * Settings, under General, "Download everything (.zip)" since 2026-11-11
 * ("Download all my projects" until then). There was no way to
 * take your data with you, and on the free plan the project has no managed
 * backup, so this is also the backup a person keeps for themselves.
 *
 * For each project, its conversation and report as JSON, exactly as Forma
 * holds them (images inline, as they were attached), and its .repx when it
 * has one, so the report opens in the designer straight from the archive.
 * A README says what the files are. Pure: App reads the projects, from the
 * account or this browser, and `buildZip` packs what this returns.
 *
 * Everything the account holds since 2026-11-11 (the full audit's SA-10),
 * and the row became "Download everything": the privacy policy says a person
 * can download what Forma holds about them, and the archive held the
 * projects alone. Now also each project's earlier versions, what Forma
 * learned from use, the reports shared and with whom, and the memory. The
 * names are paths (`revisions/Invoice/...`), so they are made safe and
 * distinct here, one part at a time, and App packs them with `keepPaths`:
 * `buildZip`'s own pass would flatten the folders into the names.
 */
export interface ExportableProject {
  id: string;
  name: string;
  /** ISO 8601. */
  timestamp: string;
  messages: readonly unknown[];
  result: unknown;
}

/** One earlier version of a project, as the account keeps it. */
export interface ExportableRevision {
  label: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /** The version itself: its report and conversation as they stood. */
  snapshot: unknown;
}

/** One report the account shares, and with whom. */
export interface ExportableShare {
  id: string;
  reportId: string;
  name: string;
  access: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /** The addresses it opens for; empty for a link anyone can open. */
  invited: readonly string[];
}

/** What the account holds besides its projects; each part is left out when absent. */
export interface AccountExtras {
  /** By project id. */
  revisions?: Readonly<Record<string, readonly ExportableRevision[]>>;
  /** What Forma learned from use, one event per line. */
  learning?: readonly unknown[];
  shares?: readonly ExportableShare[];
  /** The memory kept in this browser (lib/memory.ts). */
  memory?: unknown;
  /** What could not be read just now, in words, named in the README rather than costing the archive. */
  unread?: readonly string[];
}

function readme(count: number, at: Date, extras: AccountExtras): string {
  const lines = [
    `Your Forma data, downloaded ${at.toISOString().slice(0, 10)}: ${count} ${count === 1 ? 'project' : 'projects'}${extras.learning || extras.shares || extras.memory ? ' and what else Forma keeps for you' : ''}.`,
    '',
    'For each project:',
    '  <name>.json   the project as Forma keeps it: its name, when it was saved,',
    '                the conversation (with any pictures you attached, inline) and',
    '                the report Forma made, including its .repx.',
    '  <name>.repx   the report itself, when there is one: open it in the',
    '                DevExpress report designer.',
  ];
  if (extras.revisions && Object.values(extras.revisions).some((list) => list.length)) {
    lines.push('  revisions/<name>/<when> <label>.json', '                each earlier version of the project, as Revisions lists it.');
  }
  const more: string[] = [];
  if (extras.learning) more.push('  learning.jsonl  what Forma learned from your use, one entry per line (the shape', '                  of a report, never its words, unless you let it learn from whole reports).');
  if (extras.shares) more.push('  shares.json     every report you share, how, and the addresses you invited.');
  if (extras.memory) more.push('  memory.json     what Forma remembers for you, as Settings, Memory shows it.');
  if (more.length) lines.push('', 'Also:', ...more);
  if (extras.unread?.length) {
    lines.push('', 'Not in this archive, because it could not be read just now (download again to try once more):', ...extras.unread.map((part) => `  ${part}`));
  }
  lines.push('', 'https://openforma.web.app', '');
  return lines.join('\n');
}

/** The repx a project's result carries, if any. */
function repxOf(result: unknown): string | null {
  const repx = (result as { repxContent?: unknown } | null)?.repxContent;
  return typeof repx === 'string' && repx.trim() ? repx : null;
}

/** "2026-11-08 10.15": a version's time as a file name may hold it. */
function stampOf(millis: number): string {
  const at = new Date(Number.isFinite(millis) ? millis : 0);
  return at.toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
}

export function projectExportEntries(projects: readonly ExportableProject[], at: Date = new Date(), extras: AccountExtras = {}): ZipEntry[] {
  const entries: ZipEntry[] = [{ name: 'README.txt', content: readme(projects.length, at, extras) }];
  // One name per project, safe and distinct, shared by its .json, its .repx and its folder of versions.
  // Made distinct with an extension on, so "v1.2 notes" twice becomes "v1.2 notes (2)" and not "v1 (2).2 notes",
  // and from the archive's own files, so a project called "shares" does not overwrite shares.json.
  const reserved = ['shares.json', 'memory.json'];
  const bases = uniqueEntryNames([...reserved, ...projects.map((p) => `${safeEntryName((p.name || '').trim() || 'Untitled report', 'Untitled report')}.json`)])
    .slice(reserved.length)
    .map((n) => n.slice(0, -'.json'.length));
  projects.forEach((p, i) => {
    const base = bases[i];
    entries.push({
      name: `${base}.json`,
      content: JSON.stringify({ id: p.id, name: p.name, savedAt: p.timestamp, messages: p.messages, result: p.result }, null, 2),
    });
    const repx = repxOf(p.result);
    if (repx) entries.push({ name: `${base}.repx`, content: repx });
    const versions = extras.revisions?.[p.id] ?? [];
    const files = uniqueEntryNames(versions.map((v) => `${safeEntryName(`${stampOf(v.timestamp)} ${v.label || 'Version'}`, 'Version')}.json`));
    versions.forEach((v, j) => {
      entries.push({
        name: `revisions/${base}/${files[j]}`,
        content: JSON.stringify({ label: v.label, savedAt: new Date(Number.isFinite(v.timestamp) ? v.timestamp : 0).toISOString(), version: v.snapshot }, null, 2),
      });
    });
  });
  if (extras.learning) entries.push({ name: 'learning.jsonl', content: extras.learning.map((event) => JSON.stringify(event)).join('\n') + (extras.learning.length ? '\n' : '') });
  if (extras.shares) {
    entries.push({
      name: 'shares.json',
      content: JSON.stringify(
        extras.shares.map((s) => ({
          id: s.id,
          project: s.reportId,
          name: s.name,
          access: s.access,
          sharedAt: new Date(Number.isFinite(s.timestamp) ? s.timestamp : 0).toISOString(),
          link: `https://openforma.web.app/s/${s.id}`,
          invited: s.invited,
        })),
        null,
        2,
      ),
    });
  }
  if (extras.memory) entries.push({ name: 'memory.json', content: JSON.stringify(extras.memory, null, 2) });
  return entries;
}

/** The Firestore calls `readAccountExtras` makes, as lib/firebaseClient's client carries them. */
export interface AccountReader {
  sdk: Pick<typeof import('firebase/firestore'), 'getDocs' | 'query' | 'orderBy'>;
  paths: Pick<typeof import('./accountData'), 'versionsCollectionRef' | 'learningCollectionRef' | 'ownedShares' | 'readShareEmails'>;
  db: import('firebase/firestore').Firestore;
}

/**
 * What the account holds besides its projects, read for the archive: each
 * project's versions, newest first, the learning events, and the shares with
 * whom each opens for. Here rather than in App so it loads with the archive,
 * not with the workspace (the App chunk's budget, 2026-11-11). A share whose
 * invitees cannot be read is listed with none.
 *
 * Each part is read on its own and a failed one is left out, named in
 * `unread` for the README (2026-11-11, the SA-10 review): read in one piece,
 * one refused read of a project's versions threw the whole download, and the
 * person who had always got their projects got nothing.
 */
export async function readAccountExtras(client: AccountReader, uid: string, projectIds: readonly string[]): Promise<AccountExtras> {
  const { sdk, paths, db } = client;
  const unread: string[] = [];
  const part = async <T>(what: string, read: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await read();
    } catch (err) {
      console.warn(`The archive goes without ${what}:`, err);
      unread.push(what);
      return undefined;
    }
  };
  const revisions: Record<string, ExportableRevision[]> = {};
  let versionsMissed = 0;
  await Promise.all(
    projectIds.map(async (id) => {
      try {
        const versions = await sdk.getDocs(sdk.query(paths.versionsCollectionRef(db, uid, id), sdk.orderBy('timestamp', 'desc')));
        revisions[id] = versions.docs.map((d) => {
          const v = d.data() as { label?: unknown; timestamp?: unknown; snapshot?: unknown };
          let snapshot: unknown = v.snapshot;
          try {
            if (typeof v.snapshot === 'string') snapshot = JSON.parse(v.snapshot);
          } catch {
            /* kept as the text it is */
          }
          return { label: typeof v.label === 'string' ? v.label : 'Version', timestamp: Number(v.timestamp), snapshot };
        });
      } catch (err) {
        console.warn('The archive goes without one project\'s earlier versions:', err);
        versionsMissed++;
      }
    }),
  );
  if (versionsMissed) unread.push(versionsMissed === 1 ? 'the earlier versions of 1 project' : `the earlier versions of ${versionsMissed} projects`);
  const learning = await part('what Forma learned from your use', async () => (await sdk.getDocs(paths.learningCollectionRef(db, uid))).docs.map((d) => d.data()));
  const shares = await part('the reports you share', async () => {
    const owned = (await sdk.getDocs(paths.ownedShares(db, uid))).docs.map(
      (d) => d.data() as { id: string; reportId: string; name: string; access: string; timestamp: number; emails?: string[] },
    );
    return Promise.all(
      owned.map(async (s) => ({
        id: s.id,
        reportId: s.reportId,
        name: s.name,
        access: s.access,
        timestamp: s.timestamp,
        invited: await paths.readShareEmails(db, s).catch((): string[] => []),
      })),
    );
  });
  return {
    revisions,
    ...(learning ? { learning } : {}),
    ...(shares ? { shares } : {}),
    ...(unread.length ? { unread } : {}),
  };
}

/**
 * The projects a person made in this browser before signing in, moved into
 * the account when they ask (2026-11-11, the full audit's SA-04): the other
 * way a person's projects move, and here so it loads when asked rather than
 * with the workspace.
 *
 * Signing in listed the account's projects and nothing else, so someone who
 * worked signed out and then made an account, as the save notice told them
 * to, met an empty list and took the work for lost; it came back only after
 * signing out, and nothing ever copied it. The Projects panel now says how
 * many are kept here (`deviceProjectsLine`, lib/savedReport.ts) and offers to
 * add them. Not on its own: on a shared browser the projects kept here may be
 * someone else's.
 *
 * Each is written through `write` (App's account save: the project and its
 * index entry, inside the cloud budget) and, once written, leaves this
 * browser; one that could not be written stays here. A project the account
 * already holds under the same id is the same project (an id is the moment
 * it was first saved, to the millisecond), saved again in the account since
 * the person signed in: the newer copy stands, and the older is not written.
 * Version histories are not copied because there are none to copy: a
 * signed-out project keeps no history (lib/revisionStore.ts).
 */
export interface DeviceCopyOutcome<P> {
  /** Now in the account, by this copy or already. */
  copied: P[];
  /** Still only in this browser: too large for the account, or the write failed. */
  left: P[];
}

export async function copyProjectsToAccount<P extends { id: string; timestamp: string }>(
  local: readonly P[],
  /** The account's projects by id, with when each was saved (ISO 8601). */
  inAccount: ReadonlyMap<string, string>,
  /** Writes one project to the account; false when it cannot go (too large). */
  write: (report: P) => Promise<boolean>,
): Promise<DeviceCopyOutcome<P>> {
  const copied: P[] = [];
  const left: P[] = [];
  for (const report of local) {
    const held = inAccount.get(report.id);
    if (held !== undefined && new Date(held).getTime() >= new Date(report.timestamp).getTime()) {
      copied.push(report);
      continue;
    }
    try {
      (await write(report) ? copied : left).push(report);
    } catch {
      left.push(report);
    }
  }
  return { copied, left };
}

/** What is said once they have been added. */
export function deviceCopyLine(copied: number, left: number): string {
  const added = copied === 1 ? 'Added 1 project to your account.' : `Added ${copied} projects to your account.`;
  if (!left) return added;
  const stays = left === 1 ? '1 could not be added and stays in this browser.' : `${left} could not be added and stay in this browser.`;
  return copied ? `${added} ${stays}` : stays.charAt(0).toUpperCase() + stays.slice(1);
}

/** The archive's file name: forma-projects-2026-11-08.zip. */
export function exportFileName(at: Date = new Date()): string {
  return `forma-projects-${at.toISOString().slice(0, 10)}.zip`;
}
