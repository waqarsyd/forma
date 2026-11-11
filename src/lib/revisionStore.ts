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
 * The ten places a report's versions are kept in (2026-11-11, the full audit's
 * SA-01): `v0` to `v9`, and `firestore.rules` accepts a version written to no
 * other id. Until then each version had an id of its own, `<at>-<id>`, and
 * the cap of ten was this file's alone: a client that skipped the pruning
 * could write versions without end into the free plan everyone shares. A slot
 * is overwritten when the version in it falls off the end, so a history never
 * holds more than ten documents, whatever the client does.
 */
export const VERSION_SLOTS = Array.from({ length: MAX_PERSISTED_REVISIONS }, (_, i) => `v${i}`);

/** Whether a stored id is one of the slots; any other is an older id, cleared at the next save. */
export const isVersionSlot = (id: string): boolean => VERSION_SLOTS.includes(id);

/**
 * Which revision a stored version is, since the slot it sits in says nothing:
 * its time and its label. `Revision.id` is a per-session counter and is not
 * stored, so it cannot be the key.
 */
export function versionKey(revision: Pick<Revision, 'at' | 'label'>): string {
  return `${revision.at}|${revision.label}`;
}

export function toVersionDocument(
  revision: Revision,
  reportId: string,
  userId: string,
  slot: string,
): VersionDocument {
  return {
    id: slot,
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

/**
 * The three operations persisting a history needs, supplied by the caller.
 *
 * **Why an interface and not the Firestore SDK.** `App.tsx` imports this module
 * eagerly, and a value import of `firebase/firestore` here would drag the whole
 * ~619 kB SDK back into the entry chunk — the precise regression
 * `lib/firebaseClient.ts` exists to prevent, and one that shows up in
 * `check:size` as the entry chunk jumping half a megabyte rather than as
 * anything failing. A type-only import would be erased; a value import would
 * not, and the difference is invisible until the build.
 *
 * It also makes the round trip testable against the emulator without a browser
 * or a signed-in user: `tests/revisionRoundTrip.test.ts` supplies the same three
 * operations from the real SDK, so what the test exercises is this code and not
 * a reimplementation of it.
 */
export interface VersionIo {
  /** Stored versions, for planning: each one's id and what it holds. Order does not matter. */
  list: () => Promise<StoredVersion[]>;
  /** Stored documents, newest first — the caller's query does the ordering. */
  read: () => Promise<VersionDocument[]>;
  write: (document: VersionDocument) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** A stored version as the planner needs it: where it is, and which revision it holds. */
export interface StoredVersion {
  id: string;
  timestamp: number;
  label: string;
}

/** A stored document as `StoredVersion`, whatever fields it has. */
export function storedVersion(id: string, data: Partial<VersionDocument> | undefined): StoredVersion {
  return { id, timestamp: typeof data?.timestamp === 'number' ? data.timestamp : 0, label: typeof data?.label === 'string' ? data.label : '' };
}

export interface SaveOutcome {
  /** The slots written. */
  written: string[];
  deleted: string[];
  /** The revisions skipped, for size or a time the rules refuse, by `versionKey`. */
  tooLarge: string[];
}

/**
 * Persist a history: read what is stored, plan the difference, apply it.
 *
 * Writes first, then deletes (2026-11-11, the re-audit's R3-07). They went out
 * together, which was safe while every delete was of a version no longer
 * kept; since the slots, moving a version stored before them is a write into
 * a slot and a delete of its old id, and a slot write the rules refuse (a
 * timestamp of 0 read back from an old document, say) lost that version for
 * good while its copy was being deleted. Now an old id is deleted only once
 * the version it holds is in a slot (`movedFrom`), or when it is no longer
 * kept at all.
 *
 * Throws on an I/O failure, after deleting what is safe to delete. The caller
 * decides what that means; in `App.tsx` it means the report still saved and
 * its history did not, which is a notice rather than an error.
 */
export async function saveRevisions(
  io: VersionIo,
  revisions: readonly Revision[],
  reportId: string,
  userId: string,
  max = MAX_PERSISTED_REVISIONS,
): Promise<SaveOutcome> {
  const plan = planVersionWrites(revisions, await io.list(), reportId, userId, max);
  const writes = await Promise.allSettled(plan.toWrite.map((document) => io.write(document)));
  const written = plan.toWrite.filter((_, i) => writes[i].status === 'fulfilled').map((document) => document.id);
  const landed = new Set(written);
  const deleted = plan.toDelete.filter((id) => {
    const slot = plan.movedFrom[id];
    return slot === undefined || landed.has(slot);
  });
  await Promise.all(deleted.map((id) => io.remove(id)));
  const failed = writes.find((w): w is PromiseRejectedResult => w.status === 'rejected');
  if (failed) throw failed.reason;
  return { written, deleted, tooLarge: plan.tooLarge };
}

/** Read a history back, numbered so `pushRevision` can extend it — see below. */
export async function loadRevisions(io: VersionIo): Promise<Revision[]> {
  return fromVersionDocuments(await io.read());
}

export interface VersionPlan {
  /** Documents to write: the ones not already stored, newest first, each in a free slot. */
  toWrite: VersionDocument[];
  /**
   * Stored ids to delete: slots holding a version no longer kept and not
   * reused, and every older id whose version is no longer kept or is being
   * written into a slot. An older id holding a kept version that is not being
   * written (over budget, or with no time the rules take) stays.
   */
  toDelete: string[];
  /**
   * The older ids among `toDelete` whose version is being written into a
   * slot, and that slot: each is deleted only once that write has landed.
   */
  movedFrom: Record<string, string>;
  /**
   * Skipped, by `versionKey`, so the caller can say so: over budget, or (since
   * 2026-11-12) with a time the rules refuse.
   */
  tooLarge: string[];
}

/**
 * Work out the writes a save needs, given what is already stored.
 *
 * Read-then-write-what-is-missing rather than rewriting everything: a save with
 * one new revision should cost one write, not ten. Idempotent — saving twice
 * with nothing new plans nothing.
 *
 * Since 2026-11-11 (SA-01) a version is written to a slot (`VERSION_SLOTS`):
 * one already holding a revision still kept is left alone, and a new revision
 * takes a slot that is empty or holds one that fell off the end, which is
 * overwritten rather than deleted. A stored id that is not a slot, from before
 * the slots, is deleted, and the revision it held, if still kept, is written
 * again into a slot. At most ten are kept whatever `max` says.
 */
export function planVersionWrites(
  revisions: readonly Revision[],
  stored: readonly StoredVersion[],
  reportId: string,
  userId: string,
  max = MAX_PERSISTED_REVISIONS,
): VersionPlan {
  const keep = revisions.slice(0, Math.min(max, VERSION_SLOTS.length));
  const wanted = new Set(keep.map(versionKey));

  // The slots already holding a revision that is kept, the first of two holding the same one.
  const held = new Map<string, string>();
  for (const s of stored) {
    if (!isVersionSlot(s.id)) continue;
    const key = versionKey({ at: s.timestamp, label: s.label });
    if (wanted.has(key) && !held.has(key)) held.set(key, s.id);
  }
  const taken = new Set(held.values());
  const free = VERSION_SLOTS.filter((slot) => !taken.has(slot));

  const toWrite: VersionDocument[] = [];
  const tooLarge: string[] = [];
  /** Where each kept revision is being written, by `versionKey`. */
  const slotOf = new Map<string, string>();
  for (const revision of keep) {
    const key = versionKey(revision);
    if (held.has(key)) continue;
    // A time the rules refuse (one read back from an old document with none
    // is 0): the write would fail, so it is not tried, and the old copy stays.
    // Counted with the oversized ones (2026-11-12, the review of R3-07), so
    // the save says this version was not kept in the account.
    if (!storableTime(revision.at)) {
      tooLarge.push(key);
      continue;
    }
    const slot = free[0];
    if (!slot) break;
    const document = toVersionDocument(revision, reportId, userId, slot);
    if (document.snapshot.length > VERSION_BUDGET_BYTES) {
      tooLarge.push(key);
      continue;
    }
    free.shift();
    toWrite.push(document);
    slotOf.set(key, slot);
  }

  const written = new Set(toWrite.map((d) => d.id));
  const toDelete: string[] = [];
  const movedFrom: Record<string, string> = {};
  for (const s of stored) {
    if (taken.has(s.id) || written.has(s.id)) continue;
    // A slot holding what is no longer kept and not written over: dropped off
    // the end of the cap, or belonging to a history that has moved on.
    if (isVersionSlot(s.id)) {
      toDelete.push(s.id);
      continue;
    }
    // An id from before the slots: deleted when its version is no longer kept
    // or already sits in a slot; once its slot's write lands when it is being
    // moved there; and kept when its version is kept and cannot be moved.
    const key = versionKey({ at: s.timestamp, label: s.label });
    if (!wanted.has(key) || held.has(key)) toDelete.push(s.id);
    else if (slotOf.has(key)) {
      toDelete.push(s.id);
      movedFrom[s.id] = slotOf.get(key)!;
    }
  }
  return { toWrite, toDelete, movedFrom, tooLarge };
}

/** A version's time as the rules take it: after 1970 and before 2100 (`firestore.rules`, isValidReportVersion). */
const storableTime = (at: number) => Number.isFinite(at) && at > 0 && at < 4102444800000;
