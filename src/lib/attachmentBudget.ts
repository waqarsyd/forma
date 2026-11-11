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

/*
 * The intake limits (moved here from App.tsx on 2026-11-08, site audit item
 * 88): the Docs, Features and home pages state all three, and
 * `publicClaims.test.ts` holds what they say to these numbers, which it could
 * not reach while they were constants inside App.
 */
/** Beyond this the request gets slow and expensive with little added signal. */
export const MAX_ATTACHMENTS = 12;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Pages past this are reported to the user rather than silently dropped. */
export const MAX_PDF_PAGES = 8;

/**
 * The most pages one report is made from (2026-11-11, the full audit's
 * PL-22). Twelve files of eight pages each were all sent: up to ninety-six
 * pages read one after another, then one request carrying every picture,
 * past what the AI takes in one request, answered with an error and Forma's
 * own draft. Twenty is room for any one report, and a plan that keeps fewer
 * says so (`planReply` in lib/jobPlan.ts).
 */
export const MAX_REQUEST_PAGES = 20;

/**
 * How many pages of each file one report keeps under `max`: the first pages
 * of every file, a page from each in turn, so a long first file does not
 * leave the others out. Keyed by upload id; a file with no pages keeps 0.
 */
export function pagesPerFile(files: readonly { uploadId: string; pages: number }[], max = MAX_REQUEST_PAGES): Map<string, number> {
  const keep = new Map(files.map((f) => [f.uploadId, 0]));
  let left = max;
  for (let round = 0; left > 0; round++) {
    let took = false;
    for (const f of files) {
      if (left <= 0) break;
      if (f.pages > round) {
        keep.set(f.uploadId, round + 1);
        left--;
        took = true;
      }
    }
    if (!took) break;
  }
  return keep;
}

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
