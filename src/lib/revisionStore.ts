/**
 * Revisions on the way to Firestore and back.
 *
 * ## Why a subcollection and not a field
 *
 * A saved report is budgeted at `CLOUD_SAVE_BUDGET_BYTES` (900 kB) because the
 * transcript carries base64 uploads inline, and one `result` — markdown, layout
 * and REPX — runs 50–200 kB on its own. Ten revisions inside that document
 * would exceed the budget several times over, and the existing degradation path
 * (drop the images, then refuse) has nothing useful to strip from a REPX.
 *
 * Each revision is therefore its own document under
 * `users/{uid}/reports/{reportId}/versions/{versionId}`, with its own 1 MiB
 * ceiling. The report document is untouched, so its budget and its rules are
 * exactly as they were.
 *
 * ## The consequence that has to be handled rather than noticed later
 *
 * **Deleting a document does not delete the subcollection beneath it.** A
 * report deleted without its versions leaves them addressable by nobody and
 * visible to nobody, including the person who asked to be forgotten — the same
 * stranding `accountData.ts` exists to prevent for the vault. Both the
 * single-report delete and the account delete go through `deleteAccountData`'s
 * neighbours in that module, and `tests/accountDeletion.test.ts` pins it.
 *
 * ## Signed out gets nothing, deliberately
 *
 * `localStorage` holds every saved project in one shared 5–10 MB quota. Ten
 * revisions of one report is a megabyte or two; a few reports of those would
 * evict everything a person had saved. The signed-out path keeps revisions in
 * memory for the session exactly as it did before this existed — unchanged,
 * rather than worse.
 */

import type { Revision, RevisionSnapshot } from './revisions';

/**
 * How many revisions are persisted.
 *
 * Fewer than the twenty kept in memory. Each is a separate document, so a save
 * costs one write per new version — twenty of those on every Save is a lot of
 * round trips for versions nobody scrolls back to. Ten covers the working range
 * the panel is actually used over, and the in-memory list is unaffected.
 */
export const MAX_PERSISTED_REVISIONS = 10;

/**
 * A version too large to store.
 *
 * Well under Firestore's 1 MiB, and generous against a snapshot that is text
 * only — no images reach it, since uploads live on the transcript rather than
 * on `result`. A version over this is skipped and the rest are still written:
 * losing one version is better than failing the save.
 */
export const VERSION_BUDGET_BYTES = 700_000;

/** The flat shape stored in Firestore, mirroring the report document's. */
export interface VersionDocument {
  id: string;
  reportId: string;
  label: string;
  timestamp: number;
  /** `RevisionSnapshot` as JSON, the same string convention the report uses. */
  snapshot: string;
  userId: string;
}

/**
 * A stable document id for a revision.
 *
 * `Revision.id` alone is a per-session counter, so saving, reloading and saving
 * again would collide on 1, 2, 3 and overwrite unrelated versions. Pairing it
 * with the timestamp makes it unique in practice and keeps it sortable.
 *
 * Must satisfy `isValidId` in `firestore.rules` — letters, digits, underscore
 * and hyphen only — which digits and one hyphen do.
 */
export function versionDocId(revision: Revision): string {
  return `${revision.at}-${revision.id}`;
}

export function toVersionDocument(
  revision: Revision,
  reportId: string,
  userId: string,
): VersionDocument {
  return {
    id: versionDocId(revision),
    reportId,
    label: revision.label,
    timestamp: revision.at,
    snapshot: JSON.stringify(revision.snapshot),
    userId,
  };
}

/**
 * Read one stored version back.
 *
 * Returns null rather than throwing on a snapshot that will not parse. A single
 * corrupt version must not stop the rest of a report's history loading — the
 * same reasoning as the report list, which tolerates one bad row.
 *
 * `id` is supplied by the caller rather than taken from the document. The stored
 * id is a document key; the in-memory one is a per-session counter that only has
 * to be unique and increasing. `fromVersionDocuments` is what assigns it, and
 * the note there is the part that matters.
 */
export function fromVersionDocument(doc: VersionDocument, id: number): Revision | null {
  let snapshot: RevisionSnapshot;
  try {
    snapshot = JSON.parse(doc.snapshot) as RevisionSnapshot;
  } catch {
    return null;
  }
  if (!snapshot || typeof snapshot.repxContent !== 'string') return null;
  return {
    id,
    label: typeof doc.label === 'string' ? doc.label : 'Version',
    at: typeof doc.timestamp === 'number' ? doc.timestamp : 0,
    snapshot,
  };
}

/**
 * Read a whole history back, newest first.
 *
 * **The numbering runs downwards, and that is the load-bearing part.**
 * `pushRevision` takes the next id from `list[0]` — the newest — so the newest
 * must hold the *highest* id. Numbering 1, 2, 3 from the top instead puts 1 at
 * the front, the next refinement is handed 2, and there are now two revisions
 * with id 2: React reuses a row for a different version, and restoring from the
 * panel opens the wrong one. Nothing throws, and the list still looks right.
 *
 * Corrupt documents are dropped before numbering, so the ids stay contiguous.
 * Takes the documents in the order they should appear — the caller's query
 * orders by timestamp descending.
 */
export function fromVersionDocuments(docs: readonly VersionDocument[]): Revision[] {
  const kept: Revision[] = [];
  for (const doc of docs) {
    const revision = fromVersionDocument(doc, 0);
    if (revision) kept.push(revision);
  }
  return kept.map((revision, index) => ({ ...revision, id: kept.length - index }));
}

export interface VersionPlan {
  /** Documents to write: the ones not already stored, newest first. */
  toWrite: VersionDocument[];
  /** Stored ids no longer in the list — pruned or from an older cap. */
  toDelete: string[];
  /** Skipped for being over budget, with their ids, so the caller can say so. */
  tooLarge: string[];
}

/**
 * Work out the writes a save needs, given what is already stored.
 *
 * Read-then-write-what-is-missing rather than rewriting everything: a save with
 * one new revision should cost one write, not ten. Idempotent — saving twice
 * with nothing new plans nothing.
 */
export function planVersionWrites(
  revisions: readonly Revision[],
  existingIds: readonly string[],
  reportId: string,
  userId: string,
  max = MAX_PERSISTED_REVISIONS,
): VersionPlan {
  const keep = revisions.slice(0, max);
  const keepIds = new Set(keep.map(versionDocId));

  const toWrite: VersionDocument[] = [];
  const tooLarge: string[] = [];
  for (const revision of keep) {
    const id = versionDocId(revision);
    if (existingIds.includes(id)) continue;
    const document = toVersionDocument(revision, reportId, userId);
    if (document.snapshot.length > VERSION_BUDGET_BYTES) {
      tooLarge.push(id);
      continue;
    }
    toWrite.push(document);
  }

  return {
    toWrite,
    // Anything stored that is no longer among the kept revisions: dropped off
    // the end of the cap, or belonging to a history that has moved on.
    toDelete: existingIds.filter((id) => !keepIds.has(id)),
    tooLarge,
  };
}
