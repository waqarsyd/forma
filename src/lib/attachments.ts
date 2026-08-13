/**
 * Grouping for staged attachments.
 *
 * Intake is per *page*, not per file: a 5-page PDF becomes five images, because
 * the model is sent one image per page and `sourceRect` crops against
 * individual pages. That is correct underneath and wrong on screen — a user who
 * dropped one file and sees five thumbnails reasonably concludes the product
 * mangled their upload.
 *
 * So the array stays one entry per page and the UI groups it back into what the
 * user actually handed over. Nothing here changes what gets sent.
 */

export interface PreviewMeta {
  /** Identifies the drop this image came from. Not the filename — see below. */
  uploadId: string;
  /** Display name of the source file. */
  file: string;
  /** 1-based page number, only for multi-page sources. */
  page?: number;
}

export interface AttachmentGroup {
  /** Display name of the source file. */
  file: string;
  /** Indices into the previews array, in page order. */
  indices: number[];
  /** How many images this upload produced. 1 for a plain image. */
  pages: number;
}

/**
 * Collapse per-page entries back into one group per uploaded file.
 *
 * Grouped by `uploadId` rather than by filename, and only across *consecutive*
 * entries. Two different files can carry the same name — two scans both called
 * `scan.pdf` is the ordinary case, not an exotic one — and merging them would
 * hide one upload entirely behind the other's thumbnail.
 *
 * `total` is passed separately so a previews array that has outrun its metadata
 * still renders every image rather than silently dropping the tail.
 */
export function groupAttachments(
  meta: ReadonlyArray<PreviewMeta | undefined>,
  total: number
): AttachmentGroup[] {
  const groups: AttachmentGroup[] = [];
  let openId: string | null = null;

  for (let i = 0; i < total; i++) {
    const entry = meta[i];
    const id = entry?.uploadId ?? null;

    // A run continues only for a known upload id that matches the group being
    // built. Missing metadata always starts its own group: unknown provenance
    // is not evidence of sameness.
    if (id !== null && id === openId && groups.length > 0) {
      const open = groups[groups.length - 1];
      open.indices.push(i);
      open.pages = open.indices.length;
      continue;
    }

    groups.push({ file: entry?.file ?? `image ${i + 1}`, indices: [i], pages: 1 });
    openId = id;
  }

  return groups;
}

/** "invoice.pdf" or "invoice.pdf · 5 pages". */
export function groupLabel(group: AttachmentGroup): string {
  return group.pages > 1 ? `${group.file} · ${group.pages} pages` : group.file;
}
