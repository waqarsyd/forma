/**
 * Where an account's data lives, and how to remove all of it.
 *
 * ## Why this is one module
 *
 * The layout was spelled out as string literals wherever it was needed:
 * `doc(db, 'users', uid, 'vault', 'geminiKey')` in `App.tsx`, the same path
 * again in `firebase.ts`'s deletion path, and `collection(db, 'users', uid,
 * 'reports')` in three places. Two independent copies of a document's identity,
 * one of them in the code responsible for erasing it.
 *
 * That is worse than ordinary duplication because of a deliberate decision in
 * `firestore.rules`: the vault has **no `list` clause**, on the grounds that the
 * app only ever addresses one document there. Deletion therefore cannot
 * discover the vault — it has to already know the id. Rename it in `App.tsx`
 * and the app keeps working perfectly while every stored key becomes
 * undeletable, unreachable, and invisible to the person who asked to be
 * forgotten. Nothing would fail, and nothing would say so.
 *
 * So the layout lives here once, and `tests/accountDeletion.test.ts` pins it.
 *
 * ## Why it takes a `Firestore` rather than importing one
 *
 * `services/firebase.ts` creates the app singleton at import time. A test that
 * imported it would be talking to the real project config; passing the instance
 * in means the emulator can supply its own, with the production rules loaded
 * and enforced. That is what makes this testable at all.
 */
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { MAX_SHARES, inviteesOf, splitShare, type LegacyShareFields, type StoredShare } from './shares';
import { storedVersion, type VersionDocument, type VersionIo } from './revisionStore';

/** Everything for one account hangs off `users/{uid}`. */
export const USERS_COLLECTION = 'users';

/** Saved projects. `firestore.rules` allows `list` here, scoped to the owner. */
export const REPORTS_COLLECTION = 'reports';

/** The encrypted key vault. No `list` rule — see the note above. */
export const VAULT_COLLECTION = 'vault';

/**
 * What the account let Forma learn from (2026-11-10, the full audit;
 * `lib/learning.ts`): one document per event, created in the shape the rules
 * pin, listed and deleted by the owner, never changed. `deleteAccountData`
 * removes it with the rest; `deleteLearning` is Settings' "Delete what was
 * kept".
 */
export const LEARNING_COLLECTION = 'learning';

export function learningCollectionRef(db: Firestore, uid: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, LEARNING_COLLECTION);
}

export function learningDocRef(db: Firestore, uid: string, eventId: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, LEARNING_COLLECTION, eventId);
}

/**
 * How many events the account holds (2026-11-11, the full audit, LM-30), for
 * Settings: an aggregation, billed as one read per thousand events, so the
 * count never downloads what it counts.
 */
export async function countLearning(db: Firestore, uid: string): Promise<number> {
  return (await getCountFromServer(learningCollectionRef(db, uid))).data().count;
}

/**
 * What an account may write (2026-11-11, the full audit's SA-01, SE-08 and
 * LM-15), at `users/{uid}/meta/usage`, moved in the same batch as each write
 * it counts, as the share count moves (`quota`): `reports` and `report`, the
 * projects held and the last one added or removed, at most `MAX_REPORTS`;
 * `events`, `eventDay`, `eventAt` and `event`, the learning events sent on
 * the server's day, at most `MAX_EVENTS_A_DAY` and `EVENT_SPACING_MS` apart.
 * Until then one account could write without bound, on a free plan whose
 * daily writes every visitor shares. `firestore.rules` holds every number.
 */
export const USAGE_DOC_ID = 'usage';
export const MAX_REPORTS = 1000;
export const MAX_EVENTS_A_DAY = 300;
export const EVENT_SPACING_MS = 2000;

export function usageDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, META_COLLECTION, USAGE_DOC_ID);
}

async function readUsage(db: Firestore, uid: string): Promise<DocumentData> {
  const snap = await getDoc(usageDocRef(db, uid));
  return snap.exists() ? snap.data() : {};
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** Thrown when an account has sent its day's learning events: the rest wait in the outbox for tomorrow. */
export class LearningLimitError extends Error {
  readonly code = 'forma/learning-limit';
  constructor() {
    super(`An account sends at most ${MAX_EVENTS_A_DAY} learning events a day; the rest go tomorrow.`);
    this.name = 'LearningLimitError';
  }
}

/** When each account last sent an event from this page, so the next waits out the spacing the rules hold. */
const lastSent = new Map<string, number>();

/**
 * One event into the account, with the `userId` the rules require beside the
 * event's own fields, and the day's count raised in the same batch.
 *
 * Stamped as it is sent (2026-11-11, the full audit's LM-26): the rules take
 * an event only on the server's day, so a made-up time can no longer reach the
 * owner's pull, and one that waited in the outbox goes with the time it went.
 * The send waits out `EVENT_SPACING_MS` after this account's last one here.
 *
 * An event the account already holds counts as sent (2026-11-11, the PRIV
 * review). The rules allow `create` and never `update`, so a second write of
 * the same id is refused; and that happens whenever a write landed but the
 * device never marked it sent (the tab closed in the moment between, the
 * mark failed, or the immediate send and a sign-in flush raced). Refused as
 * a failure, that one event would sort oldest at every later flush and hold
 * back everything newer for good. So a refusal is answered by reading the
 * document: there, it went; absent, the refusal stands.
 */
export function writeLearning(db: Firestore, uid: string, event: DocumentData & { id: string }, now: () => number = Date.now): Promise<void> {
  // One send at a time from this page (2026-11-11, the LRN review): `lastSent`
  // is read as a send starts, so two started together (a Save and an Export,
  // or a record during a flush) waited the same and committed together, and
  // the rules refused one for spacing. Each now starts once the last has settled.
  const turn = sendings.then(() => sendLearning(db, uid, event, now));
  sendings = turn.catch(() => undefined);
  return turn;
}

let sendings: Promise<unknown> = Promise.resolve();

async function sendLearning(db: Firestore, uid: string, event: DocumentData & { id: string }, now: () => number): Promise<void> {
  const ref = learningDocRef(db, uid, event.id);
  const wait = (lastSent.get(uid) ?? 0) + EVENT_SPACING_MS + 100 - now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  try {
    const usage = await readUsage(db, uid);
    const at = new Date(now()).toISOString();
    const day = at.slice(0, 10);
    const sameDay = usage.eventDay === day;
    if (sameDay && count(usage.events) >= MAX_EVENTS_A_DAY) throw new LearningLimitError();
    const batch = writeBatch(db);
    batch.set(ref, { ...event, at, day, userId: uid });
    batch.set(
      usageDocRef(db, uid),
      sameDay ? { events: increment(1), eventAt: serverTimestamp(), event: event.id } : { events: 1, eventDay: day, eventAt: serverTimestamp(), event: event.id },
      { merge: true },
    );
    lastSent.set(uid, now());
    await batch.commit();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'permission-denied') {
      const held = await getDoc(ref).catch(() => null);
      if (held?.exists()) return;
    }
    throw err;
  }
}

/**
 * How many events one pass reads and deletes (2026-11-11, the full audit,
 * SA-12). The whole collection in one read, then one request per document,
 * meant a heavy account's delete downloaded every event at once, whole
 * reports on the opt-in tier, and sent hundreds of writes in parallel; a
 * page in one batch is one commit, well under Firestore's 500 a batch.
 *
 * 50 rather than the 300 first written: the web SDK cannot read a page's refs
 * without its documents, and on the opt-in tier an event may hold up to
 * 700,000 characters (firestore.rules, since LM-25), so 300 could be one read
 * of about 200 MB. 50 bounds it near 35 MB at the cost of more round trips,
 * which only an account with thousands of events will notice. (LM-16 asked for
 * 300 with the whole report moved to a document of its own; it stays inline,
 * where the owner's pull and Settings read it, so the page stays 50.)
 */
export const LEARNING_PAGE = 50;

/** Every event the account holds, removed a page at a time; tolerated when there are none. */
export async function deleteLearning(db: Firestore, uid: string): Promise<void> {
  for (;;) {
    const page = await getDocs(query(learningCollectionRef(db, uid), limit(LEARNING_PAGE)));
    if (page.empty) return;
    const batch = writeBatch(db);
    for (const entry of page.docs) batch.delete(entry.ref);
    await batch.commit();
    if (page.size < LEARNING_PAGE) return;
  }
}

/** Thrown by `deleteAccountData` when the learning events could not be removed, before anything else was. */
export class LearningNotDeletedError extends Error {
  readonly code = 'forma/learning-not-deleted';
  constructor(cause: unknown) {
    super('Your learning data could not be deleted yet; nothing else was removed. Try again in a moment.', { cause });
    this.name = 'LearningNotDeletedError';
  }
}

/**
 * Revision history, one document per version, beneath its report.
 *
 * A subcollection because a saved report is size-budgeted and a `result` runs
 * 50–200 kB; ten of those inline would break the budget several times over.
 * See `lib/revisionStore.ts`.
 *
 * **This is the collection that makes deletion non-obvious.** Firestore does
 * not delete a subcollection when its parent document is deleted — the parent
 * is not even required to exist for children to. So a report deleted without
 * its versions leaves them behind, reachable by nobody and invisible to
 * everybody, which is exactly the stranding this module exists to prevent for
 * the vault. `deleteReportAndVersions` is the only way a report should be
 * removed.
 */
export const VERSIONS_COLLECTION = 'versions';

/**
 * The one document the vault ever holds.
 *
 * Pinned by a test. If this ever needs to change, the migration has to delete
 * the old document *before* the new id ships, because afterwards nothing will
 * be able to find it.
 */
export const VAULT_DOC_ID = 'geminiKey';

/**
 * Shared copies of reports (2026-11-06, lib/shares.ts), top level because
 * people other than the owner read them. Each names its owner and the project
 * it came from, and **is removed with that project and with the account**:
 * a share left behind is a copy of someone's report still readable by
 * whoever holds its link, after they asked for it to be gone.
 */
export const SHARES_COLLECTION = 'shares';

export function shareDocRef(db: Firestore, shareId: string): DocumentReference {
  return doc(db, SHARES_COLLECTION, shareId);
}

/**
 * Who a share opens for (2026-11-11, the full audit, SE-04), beneath the share
 * at `shares/{id}/acl/emails` as `{ ownerId, list }`: out of the document a
 * link share hands to anyone, and read and written by the owner alone, while
 * the rules read it to let an invitee in. Written and deleted in the same
 * batch as its share, by `writeShare` and `deleteShare`.
 */
export const SHARE_ACL_COLLECTION = 'acl';
export const SHARE_ACL_DOC_ID = 'emails';

export function shareAclRef(db: Firestore, shareId: string): DocumentReference {
  return doc(db, SHARES_COLLECTION, shareId, SHARE_ACL_COLLECTION, SHARE_ACL_DOC_ID);
}

/** The invitees of one of the owner's shares: its access list, or the `emails` a share from before it still carries. */
export async function readShareEmails(db: Firestore, share: { id: string } & LegacyShareFields): Promise<string[]> {
  const acl = await getDoc(shareAclRef(db, share.id));
  return inviteesOf(acl.exists() ? acl.data() : null, share);
}

/** The owner's shares, of one project or of all of them; the rules allow `list` only by a query naming the owner. */
export function ownedShares(db: Firestore, uid: string, reportId?: string): Query {
  const owned = where('ownerId', '==', uid);
  return reportId ? query(collection(db, SHARES_COLLECTION), owned, where('reportId', '==', reportId)) : query(collection(db, SHARES_COLLECTION), owned);
}

/**
 * The account's share count (2026-11-08, site audit item 57), at
 * `users/{uid}/meta/quota`: `{ shares, last }`. `firestore.rules` lets it move
 * only by one, in the same batch as the share it counts, and caps shares at
 * `MAX_SHARES`; so a share is created and deleted only through `writeShare`
 * and `deleteShare` below, one at a time.
 */
export const META_COLLECTION = 'meta';
export const QUOTA_DOC_ID = 'quota';
// MAX_SHARES lives in shares.ts (2026-11-08), which loads no Firestore, so the
// public Security page can state the limit without pulling the SDK in.

export function quotaDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, META_COLLECTION, QUOTA_DOC_ID);
}

/**
 * The account's two learning switches (2026-11-11, the full audit, LM-01 and
 * SA-13), at `users/{uid}/meta/learning` as `{ structure, full }`. They lived
 * in one browser's storage only, so the whole-report switch one person turned
 * on stayed on for the next person to sign in there, and turning learning off
 * on one computer left it on at every other. `firestore.rules` pins the two
 * booleans; `deleteAccountData` removes the document.
 */
export const LEARNING_PREFS_DOC_ID = 'learning';

export function learningPrefsDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, META_COLLECTION, LEARNING_PREFS_DOC_ID);
}

/** The account's switches, or null when it has never set them. */
export async function readLearningPrefs(db: Firestore, uid: string): Promise<{ structure: boolean; full: boolean } | null> {
  const snap = await getDoc(learningPrefsDocRef(db, uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return { structure: data.structure === true, full: data.full === true };
}

export async function writeLearningPrefs(db: Firestore, uid: string, prefs: { structure: boolean; full: boolean }): Promise<void> {
  await setDoc(learningPrefsDocRef(db, uid), { structure: prefs.structure === true, full: prefs.full === true });
}

/** Thrown when an account already has `MAX_SHARES` shares. */
export class ShareLimitError extends Error {
  constructor() {
    super(`An account can share up to ${MAX_SHARES} reports at once. Stop sharing one to share another.`);
    this.name = 'ShareLimitError';
  }
}

async function sharesCounted(db: Firestore, uid: string): Promise<number> {
  const quota = await getDoc(quotaDocRef(db, uid));
  const n = quota.exists() ? Number(quota.data().shares) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Write a share and who it opens for, in one batch: a new one with the count
 * raised in the same batch, an existing one as it is. The addresses go to the
 * access list and never into the document (SE-04), and rewriting a share made
 * before that moves its `emails` out, since the document is replaced whole.
 */
export async function writeShare(
  db: Firestore,
  uid: string,
  share: StoredShare & { emails?: readonly string[] },
  isNew: boolean,
): Promise<void> {
  const { stored, acl } = splitShare(share);
  const batch = writeBatch(db);
  if (isNew) {
    const count = await sharesCounted(db, uid);
    if (count >= MAX_SHARES) throw new ShareLimitError();
    batch.set(quotaDocRef(db, uid), { shares: count + 1, last: share.id });
  }
  batch.set(shareDocRef(db, share.id), stored);
  batch.set(shareAclRef(db, share.id), acl);
  await batch.commit();
}

/** Delete a share and its access list, lowering the count in the same batch while there is one to lower. */
export async function deleteShare(db: Firestore, uid: string, shareId: string): Promise<void> {
  const count = await sharesCounted(db, uid);
  const batch = writeBatch(db);
  batch.delete(shareDocRef(db, shareId));
  batch.delete(shareAclRef(db, shareId));
  if (count > 0) batch.set(quotaDocRef(db, uid), { shares: count - 1, last: shareId });
  await batch.commit();
}

/** Delete shares one at a time, as the count requires. */
async function deleteShares(db: Firestore, uid: string, shareIds: string[]): Promise<void> {
  for (const id of shareIds) await deleteShare(db, uid, id);
}

export function reportsCollectionRef(db: Firestore, uid: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, REPORTS_COLLECTION);
}

/**
 * One saved project.
 *
 * `firestore.rules` requires `incoming().id == reportId` on create and pins
 * both on update, so the document id and the `id` field are the same value by
 * rule. Building the ref here keeps that pairing in one place.
 */
export function reportDocRef(db: Firestore, uid: string, reportId: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, REPORTS_COLLECTION, reportId);
}

/** Thrown when an account already holds `MAX_REPORTS` projects. */
export class ReportLimitError extends Error {
  readonly code = 'forma/report-limit';
  constructor() {
    super(`An account can keep up to ${MAX_REPORTS.toLocaleString('en-US')} projects. Delete one to save another.`);
    this.name = 'ReportLimitError';
  }
}

/**
 * One project saved (2026-11-11, the full audit's SA-01): a new one with the
 * account's count raised in the same batch, as the rules require, an existing
 * one as it is. `isNew` is the caller's best knowledge (whether its list holds
 * the project); a refusal tries the other way once, so a list that was behind
 * costs one more request rather than a failed save.
 */
export async function writeReport(db: Firestore, uid: string, reportId: string, payload: DocumentData, isNew: boolean): Promise<void> {
  const ref = reportDocRef(db, uid, reportId);
  const create = async () => {
    if (count((await readUsage(db, uid)).reports) >= MAX_REPORTS) throw new ReportLimitError();
    const batch = writeBatch(db);
    batch.set(ref, payload);
    batch.set(usageDocRef(db, uid), { reports: increment(1), report: reportId }, { merge: true });
    await batch.commit();
  };
  const update = () => setDoc(ref, payload);
  try {
    await (isNew ? create() : update());
  } catch (err) {
    // At the limit, a project guessed new may be one the account holds (its
    // index entry missing, or the list not loaded yet): the limit stops
    // creating a project, never saving one that exists (2026-11-11).
    if (isNew && err instanceof ReportLimitError) {
      await update().catch(() => {
        throw err;
      });
      return;
    }
    if ((err as { code?: unknown } | null)?.code !== 'permission-denied') throw err;
    await (isNew ? update() : create());
  }
}

/**
 * The account's index of its projects (2026-11-08, site audit item 63): one
 * small document per project, `lib/savedReport.ts`'s `StoredReportIndex`,
 * which the list listens to instead of the projects themselves. Written beside
 * the project on every save, and deleted with it and with the account.
 */
export const REPORT_INDEX_COLLECTION = 'reportIndex';

export function reportIndexCollectionRef(db: Firestore, uid: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, REPORT_INDEX_COLLECTION);
}

export function reportIndexDocRef(db: Firestore, uid: string, reportId: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, REPORT_INDEX_COLLECTION, reportId);
}

export function vaultDocRef(db: Firestore, uid: string): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, VAULT_COLLECTION, VAULT_DOC_ID);
}

export function versionsCollectionRef(db: Firestore, uid: string, reportId: string): CollectionReference {
  return collection(db, USERS_COLLECTION, uid, REPORTS_COLLECTION, reportId, VERSIONS_COLLECTION);
}

export function versionDocRef(
  db: Firestore,
  uid: string,
  reportId: string,
  versionId: string,
): DocumentReference {
  return doc(db, USERS_COLLECTION, uid, REPORTS_COLLECTION, reportId, VERSIONS_COLLECTION, versionId);
}

/**
 * The four operations `lib/revisionStore.ts` persists a history through, for
 * one report (moved here from App.tsx on 2026-11-11, batch LRN, so they load
 * with the SDK rather than with the workspace). The `orderBy` is not
 * decoration: `fromVersionDocuments` numbers downwards from the newest and
 * trusts the caller to have ordered them.
 */
export function versionIoFor(db: Firestore, uid: string, reportId: string): VersionIo {
  const collectionRef = versionsCollectionRef(db, uid, reportId);
  const docRef = (id: string) => versionDocRef(db, uid, reportId, id);
  return {
    // Each stored version's slot and what it holds (2026-11-11, SA-01): the plan fills the slots by it.
    list: async () => (await getDocs(collectionRef)).docs.map((entry) => storedVersion(entry.id, entry.data() as Partial<VersionDocument>)),
    read: async () => (await getDocs(query(collectionRef, orderBy('timestamp', 'desc')))).docs.map((entry) => entry.data() as VersionDocument),
    write: async (document) => {
      await setDoc(docRef(document.id), document);
    },
    remove: async (id) => {
      await deleteDoc(docRef(id));
    },
  };
}

/**
 * Delete one report AND its version history.
 *
 * Versions first, then the report. The order matters for the same reason the
 * account-deletion order does: while the report exists the path to its versions
 * is ordinary, and a failure part-way leaves a report whose history is short
 * rather than an orphaned history with no report. The reverse order, on a
 * failure, leaves documents nobody can enumerate a route to.
 *
 * Never call `deleteDoc(reportDocRef(...))` directly. Firestore leaves the
 * subcollection behind, silently, and the result looks exactly like a
 * successful delete.
 */
export async function deleteReportAndVersions(
  db: Firestore,
  uid: string,
  reportId: string,
): Promise<void> {
  // Its shared copies first (2026-11-06): they are readable by others, so a
  // deleted project must not leave one behind.
  const shares = await getDocs(ownedShares(db, uid, reportId));
  await deleteShares(db, uid, shares.docs.map((entry) => entry.id));
  const versions = await getDocs(versionsCollectionRef(db, uid, reportId));
  await Promise.all(versions.docs.map((entry) => deleteDoc(entry.ref)));
  // The account's count lowered in the same batch while there is one to lower
  // (2026-11-11, SA-01); a project saved before the count existed leaves it at
  // zero, and goes without one, as a share does.
  if (count((await readUsage(db, uid)).reports) > 0) {
    const batch = writeBatch(db);
    batch.delete(reportDocRef(db, uid, reportId));
    batch.set(usageDocRef(db, uid), { reports: increment(-1), report: reportId }, { merge: true });
    await batch.commit();
  } else {
    await deleteDoc(reportDocRef(db, uid, reportId));
  }
  // Its index entry last (2026-11-08): a report gone and still listed opens
  // to nothing, which is better than one gone from the list and still stored.
  await deleteDoc(reportIndexDocRef(db, uid, reportId)).catch((error) => {
    console.warn('Could not remove the project from the index:', error);
  });
}

/**
 * Remove every document stored under an account.
 *
 * Called while the account still exists and is signed in, which is not
 * negotiable: `firestore.rules` only lets the owner touch these paths, so
 * deleting the Firebase Auth user first would strand the data with nobody able
 * to reach it. `deleteAccountAndData` in `services/firebase.ts` owns that
 * ordering; this function owns what gets deleted.
 *
 * The vault delete tolerates failure. Most accounts never stored a key, and
 * `deleteDoc` on a missing document is a no-op rather than an error — but a
 * rules edge on one optional document must not block the erasure the user
 * actually asked for. The reports delete is not tolerated: if those fail, the
 * caller needs to know before the account disappears. Nor, since 2026-11-11,
 * is the learning delete, which runs first; see the note at its call.
 */
export async function deleteAccountData(db: Firestore, uid: string): Promise<void> {
  // What the account let Forma learn from, FIRST and not tolerated (2026-11-11,
  // the full audit, LM-02). It was last and its failure was swallowed, "as
  // the owner pulls it to their own PC" -- which is the reason it must not be:
  // the account was then deleted, and the owner's pull went on collecting
  // events of someone who had asked to be forgotten, under an account nobody
  // could sign in to and delete them from. Retried once, then the deletion
  // stops here, before anything else has gone, so trying again later starts
  // from a whole account rather than half of one.
  try {
    await deleteLearning(db, uid).catch(() => deleteLearning(db, uid));
  } catch (error) {
    throw new LearningNotDeletedError(error);
  }

  const reports = await getDocs(reportsCollectionRef(db, uid));
  // Through deleteReportAndVersions, not deleteDoc: a report's version history
  // is a subcollection, and Firestore does not remove those with the parent.
  // Deleting the reports directly here would leave every version behind, under
  // an account that no longer exists, addressable by nobody -- the precise
  // outcome the ordering in `deleteAccountAndData` exists to avoid.
  // One report at a time since 2026-11-08: each deletes its shares through
  // the share count, which moves by one per batch and so cannot be raced.
  for (const entry of reports.docs) await deleteReportAndVersions(db, uid, entry.id);
  // And any share whose project had already gone (2026-11-06): nothing else
  // would ever find it once the account does.
  const shares = await getDocs(ownedShares(db, uid));
  await deleteShares(db, uid, shares.docs.map((entry) => entry.id));
  // And any index entry whose project had already gone (2026-11-08);
  // tolerated, since the index is a copy of what the deletions above removed.
  await getDocs(reportIndexCollectionRef(db, uid))
    .then((index) => Promise.all(index.docs.map((entry) => deleteDoc(entry.ref))))
    .catch((error) => console.warn('Could not clear the projects index while deleting the account:', error));
  // The count itself, at zero now (2026-11-08); tolerated like the vault.
  await deleteDoc(quotaDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the share count while deleting the account:', error);
  });
  // The write counts (2026-11-11, SA-01), at zero projects now; tolerated like
  // the share count. The rules keep it on a day the account sent learning
  // events, since deleting it would restart that day's count. So its two ids
  // go first (the last project's, which is when it was made, and the last
  // event's), and on such a day what stays is the counts and a time alone.
  await updateDoc(usageDocRef(db, uid), { report: deleteField(), event: deleteField() }).catch(() => undefined);
  await deleteDoc(usageDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the write counts while deleting the account:', error);
  });
  // The learning switches (2026-11-11); tolerated like the count: two booleans, nothing of the person's work.
  await deleteDoc(learningPrefsDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the learning switches while deleting the account:', error);
  });

  await deleteDoc(vaultDocRef(db, uid)).catch((error) => {
    console.warn('Could not remove the stored key while deleting the account:', error);
  });
}
