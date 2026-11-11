/**
 * The projects made in this browser before signing in, added to the account
 * when the person asks (2026-11-11, the full audit's SA-04; the rules of what
 * is copied are `copyProjectsToAccount` in lib/projectExport.ts).
 *
 * Out of App.tsx on 2026-11-11 (the full audit's batch BW2), with the device's
 * projects moving to IndexedDB (lib/projectStore.ts): it runs only when the
 * Projects panel's "Add them to your account" is pressed, so it is loaded
 * then, and the App chunk, at 99.8% of its budget, pays for what BW2 added.
 */
import { loadFirebase } from './firebaseClient';
import { copyProjectsToAccount, deviceCopyLine } from './projectExport';
import { deleteProjects, loadProjects } from './projectStore';
import { toIndexDocument, type SavedReportLike, type StoredReportDocument } from './savedReport';

/**
 * Copies each project kept here into the account `uid`, then deletes from
 * this browser the ones copied. `fit` is the account document for a project,
 * or null when it is too large to go; `inAccount` the account's projects by
 * id with when each was saved. Null when the person signed out meanwhile,
 * which leaves this browser's projects as they were; else what to say and how
 * many stay here.
 */
export async function addDeviceProjectsToAccount<M, R>(o: {
  uid: string;
  inAccount: ReadonlyMap<string, string>;
  fit: (report: SavedReportLike<M, R>, uid: string) => { payload: StoredReportDocument } | null;
  stillSignedIn: () => boolean;
}): Promise<{ line: string; left: number } | null> {
  const { uid, inAccount } = o;
  const local = await loadProjects<M, R>();
  const { sdk, paths, db } = await loadFirebase();
  const { copied, left } = await copyProjectsToAccount(local, inAccount, async (report) => {
    const fitted = o.fit(report, uid);
    if (!fitted) return false;
    await paths.writeReport(db, uid, report.id, fitted.payload, !inAccount.has(report.id));
    // Its entry in the index, as a save writes it; tolerated as there, since the weekly check writes a missing one.
    await sdk.setDoc(paths.reportIndexDocRef(db, uid, report.id), toIndexDocument(report, uid)).catch(() => undefined);
    return true;
  });
  if (!o.stillSignedIn()) return null;
  await deleteProjects(local.filter((r) => !left.some((l) => l.id === r.id)).map((r) => r.id));
  return { line: deviceCopyLine(copied.length, left.length), left: left.length };
}
