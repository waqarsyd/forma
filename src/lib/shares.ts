/**
 * A report shared from its project (2026-11-06, the owner's choice of Google
 * Stitch's Share dialog): what the shared copy holds, its link, and who may
 * open it. Pure, so the shape firestore.rules pins (`isValidShare`) is built
 * in one place and tested without Firebase.
 *
 * A share is a COPY of the report, written by its owner into `shares/{id}`;
 * the saved project under users/{uid} stays the owner's alone whatever is
 * shared. The copy changes when the owner updates it from the dialog, not on
 * every edit. Its id is random, 22 characters of base64url (132 bits), and it
 * is the secret "anyone with the link" means. Forma has no server, so it
 * cannot send an invitation: adding someone grants their verified address
 * access, and the owner sends the link.
 */

export type ShareAccess = 'restricted' | 'link';

/**
 * What a share's document holds, as firestore.rules' isValidShare pins it:
 * everything anyone the share is open to may read.
 *
 * The invitees' addresses are NOT here since 2026-11-11 (the full audit,
 * SE-04). They were, and the document is what a link share hands to anyone
 * at all, so switching a restricted share to "anyone with the link" published
 * the colleagues' addresses to everyone the link reached, and each invitee of
 * a restricted one saw the others'. They live in `ShareAcl` now, which only
 * the owner reads; a share written before then still carries an `emails`
 * field until its owner next changes it (`LegacyShareFields`).
 */
export interface StoredShare {
  id: string;
  ownerId: string;
  reportId: string;
  name: string;
  /** The shared report as JSON: its title, REPX and layout, nothing of the conversation. */
  result: string;
  access: ShareAccess;
  timestamp: number;
}

/** Who a restricted share opens for, at `shares/{id}/acl/emails`, read and written by its owner alone. */
export interface ShareAcl {
  ownerId: string;
  /** Lower-cased addresses; the rules compare a verified token's address against them. */
  list: string[];
}

/** A share written before the addresses moved out (2026-11-11): the rules still read `emails` from it. */
export interface LegacyShareFields {
  emails?: unknown;
}

/** A share as its owner's dialog holds it: the document and who it opens for, together. */
export interface ShareDocument extends StoredShare {
  emails: string[];
}

/** A share split into what everyone it is open to reads, and the list only its owner reads. */
export function splitShare(share: StoredShare & { emails?: readonly string[] }): { stored: StoredShare; acl: ShareAcl } {
  // Field by field, not a spread: whatever else the object carries, a legacy
  // `emails` included, stays out of the document everyone may read.
  const stored: StoredShare = {
    id: share.id,
    ownerId: share.ownerId,
    reportId: share.reportId,
    name: share.name,
    result: share.result,
    access: share.access,
    timestamp: share.timestamp,
  };
  return { stored, acl: { ownerId: share.ownerId, list: (share.emails ?? []).map(normaliseEmail).slice(0, MAX_INVITED) } };
}

/** The invitees of a share as read back: its access list, or a legacy share's own field, or none. */
export function inviteesOf(acl: Partial<ShareAcl> | null | undefined, legacy?: LegacyShareFields | null): string[] {
  const list = acl ? acl.list : legacy?.emails;
  return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
}

/**
 * Whether a report carries code DevExpress runs (2026-11-11, the full audit,
 * SE-02): `ScriptsSource` holds C# for the report's events, and a `<Scripts>`
 * element names a handler per event. DevExpress compiles and runs it when the
 * report is previewed or printed in a designer, Forma Designer included. Forma
 * never writes either. Here rather than in repxAudit so the shared-report page
 * can ask without loading the whole audit; the audit asks the same question.
 */
export function hasReportScripts(xml: string): boolean {
  return /\sScriptsSource="[^"]|<Scripts\b[^>]*\sOn\w+="[^"]/.test(xml);
}

/** The part of a report a shared copy carries. */
export interface SharedReport {
  title?: string;
  repxContent?: string;
  layout?: unknown;
}

/** The rules' cap on `emails`. */
export const MAX_INVITED = 50;
/** The rules' cap on `result`, in characters. */
export const MAX_SHARED_RESULT = 1_000_000;
/** How many shares an account may hold at once (2026-11-08, site audit item 57); firestore.rules caps the count at the same number. */
export const MAX_SHARES = 100;

/** A new share id: 22 random base64url characters. */
export function makeShareId(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(17));
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

/** An address as the rules compare it: trimmed and lower case. */
export function normaliseEmail(text: string): string {
  return text.trim().toLowerCase();
}

/** Whether a typed address looks like one; the account that opens the link is what proves it. */
export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normaliseEmail(text));
}

/** The invitees with one more added, kept unique and in the order added; unchanged when it is not an address or the list is full. */
export function withInvitee(emails: readonly string[], typed: string): string[] {
  const email = normaliseEmail(typed);
  if (!isEmail(email) || emails.includes(email) || emails.length >= MAX_INVITED) return [...emails];
  return [...emails, email];
}

/** The share's document, or null when the report is too large for one. */
export function shareDocument(input: {
  id: string;
  ownerId: string;
  reportId: string;
  name: string;
  report: SharedReport;
  access: ShareAccess;
  emails: readonly string[];
  now?: number;
}): ShareDocument | null {
  const result = JSON.stringify({ title: input.report.title, repxContent: input.report.repxContent, layout: input.report.layout });
  if (result.length > MAX_SHARED_RESULT) return null;
  return {
    id: input.id,
    ownerId: input.ownerId,
    reportId: input.reportId,
    name: input.name.slice(0, 256),
    result,
    access: input.access,
    emails: input.emails.map(normaliseEmail).slice(0, MAX_INVITED),
    timestamp: input.now ?? Date.now(),
  };
}

/** The shared report read back from its document; null when it is not one. */
export function readSharedReport(result: unknown): SharedReport | null {
  if (typeof result !== 'string') return null;
  try {
    const parsed = JSON.parse(result) as SharedReport;
    return parsed && typeof parsed.repxContent === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** The link a share is opened by; `sharedReportId` in lib/routes.ts reads it back. */
export function shareLink(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${id}`;
}
