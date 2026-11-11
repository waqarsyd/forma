/**
 * Saving a file the browser makes, the one way every download in Forma does
 * it (2026-11-11, the full audit's PR-17 and WS-42).
 *
 * Five places wrote this by hand, and three of them got it wrong in one of two
 * ways that each lose the file without a word. A link never put in the page
 * is ignored by Firefox's click, so the Batch panel's .zip and .repx, and the
 * Data tab's script, saved nothing there. And a blob address revoked straight
 * after the click is gone before a browser that starts the download once the
 * click has returned reads it: the Preview's exports, the conversation's
 * Markdown and the Batch panel did that. The shared report page's download
 * (2026-11-08, site audit item 84) was the one written right, and this is it:
 * the link is put in the page, clicked and taken out, and the address is let
 * go a minute later.
 */

/** How long a blob address is kept after its click: long enough for any browser to start reading it. */
export const REVOKE_AFTER_MS = 60_000;

/** A name a file system takes: the characters Windows refuses become a dash, and nothing left is `fallback`. */
export function safeFileName(name: string, fallback = 'report'): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || fallback;
}

/** Saves `blob` as `name`, as a download. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Saves text as a file of the given type. */
export function saveText(name: string, text: string, type = 'text/plain;charset=utf-8'): void {
  saveBlob(name, new Blob([text], { type }));
}
