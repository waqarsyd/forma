/**
 * How many files are staged, and how many more may be added.
 *
 * ## The bug this arithmetic already had once
 *
 * `MAX_ATTACHMENTS` has always claimed to count *files*. The count was taken
 * over rows instead — one preview image and one extracted-text record per PDF
 * page — so an eight-page PDF spent sixteen of the twelve allowed slots and the
 * next drop was refused with "you can attach up to 12 items" to somebody who had
 * attached one. The fix is to count distinct upload ids, which is why an upload
 * id exists at all.
 *
 * It lived in `App.tsx` as a `useMemo` and a stretch of `ingestFiles`, where
 * nothing could reach it. The wording it produces is what the user reads when a
 * drop is refused, and off-by-one arithmetic here is invisible until somebody
 * hits the limit — which is exactly the shape this project keeps finding.
 */

/** Anything carrying the id that identifies one dropped file. */
export interface Staged {
  uploadId: string;
}

/**
 * Files staged, counted as FILES.
 *
 * Both lists are keyed by the same upload id, so a PDF contributing eight
 * images and eight text records still counts once.
 */
export function countStagedUploads(
  previews: readonly Staged[],
  texts: readonly Staged[],
): number {
  const ids = new Set<string>();
  for (const item of previews) ids.add(item.uploadId);
  for (const item of texts) ids.add(item.uploadId);
  return ids.size;
}

export interface Admission<T> {
  /** The prefix of `incoming` there is room for. */
  accepted: T[];
  /** What to tell the user, empty when everything was taken. */
  notices: string[];
  /** True when there was no room at all, so the caller can stop early. */
  full: boolean;
}

/**
 * Decide how many of a drop to take.
 *
 * Truncates rather than refusing the whole drop: someone dragging fifteen files
 * at a twelve limit wants the twelve, and throwing all fifteen away to make a
 * point would be worse. The notice says what happened either way, because a
 * drop that silently loses three files is the version of this that gets
 * noticed at export time.
 */
export function admitFiles<T>(
  incoming: readonly T[],
  staged: number,
  max: number,
): Admission<T> {
  const room = max - staged;
  if (room <= 0) {
    return {
      accepted: [],
      notices: [`You can attach up to ${max} items. Remove one to add another.`],
      full: true,
    };
  }

  const accepted = incoming.slice(0, room);
  const notices: string[] = [];
  if (incoming.length > accepted.length) {
    notices.push(
      `Only the first ${accepted.length} of ${incoming.length} files were added (limit ${max}).`,
    );
  }
  return { accepted, notices, full: false };
}
