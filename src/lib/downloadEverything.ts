/**
 * Settings' "Download everything (.zip)": every saved project in one .zip
 * (2026-11-08, site audit items 59 and 66, lib/projectExport.ts), from the
 * account in full when signed in, from this browser otherwise; and since
 * 2026-11-11 (the full audit's SA-10) everything else the account holds:
 * each project's versions, the learning events, the shares with their
 * invitees, and the memory.
 *
 * Out of App.tsx on 2026-11-11 (the full audit's batch BW2), word for word,
 * to pay for what that batch added there: the App chunk stood at 99.8% of its
 * budget, and this runs only when the button is pressed, so it is loaded then.
 */
import { buildZip } from './zip';
import { exportFileName, projectExportEntries, readAccountExtras, type AccountExtras } from './projectExport';
import { readMemory } from './memory';
import { loadFirebase } from './firebaseClient';
import { fromFirestoreDocument, type SavedReportLike } from './savedReport';
import { loadProjects } from './projectStore';
import { saveBlob } from './download';

/** What a download saved: how many projects went in, and whether a file was saved at all. */
export interface DownloadedEverything {
  projects: number;
  saved: boolean;
}

/**
 * Whether there is anything besides projects to put in the archive: what Forma
 * remembers, the learning events, the shares. Versions belong to projects.
 */
export function holdsExtras(extras: AccountExtras): boolean {
  return !!extras.memory || !!extras.learning?.length || !!extras.shares?.length;
}

/**
 * Packs and saves the .zip for the account `uid`, or this browser's projects
 * when null. Saved whenever there is anything to save (2026-11-11, the
 * re-audit's R3-13): an account or a browser with no projects but with
 * memories, learning events or shares got nothing, since an empty project
 * list returned before the archive was built.
 */
export async function downloadEverything(uid: string | null): Promise<DownloadedEverything> {
  let projects: SavedReportLike[];
  let extras: AccountExtras = {};
  if (uid) {
    const client = await loadFirebase();
    const snapshot = await client.sdk.getDocs(client.paths.reportsCollectionRef(client.db, uid));
    projects = snapshot.docs.map((d) => fromFirestoreDocument(d.data()));
    extras = await readAccountExtras(client, uid, projects.map((p) => p.id));
  } else {
    projects = await loadProjects();
  }
  const remembered = readMemory(uid);
  if (remembered.memories.length || remembered.kept.length) extras.memory = remembered;
  if (!projects.length && !holdsExtras(extras)) return { projects: 0, saved: false };
  const now = new Date();
  // `keepPaths`: projectExport makes each part of a name safe and distinct
  // itself, and the versions sit in folders a second pass would flatten.
  const { bytes, reason } = buildZip(projectExportEntries(projects, now, extras), now, { keepPaths: true });
  if (!bytes) throw new Error(`The projects could not be packed: ${reason}.`);
  saveBlob(exportFileName(now), new Blob([bytes.slice()], { type: 'application/zip' }));
  return { projects: projects.length, saved: true };
}
