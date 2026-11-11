/**
 * A project as its account document, inside Firestore's budget (moved out of
 * App.tsx on 2026-11-11, batch PXB, and loaded only when a signed-in save,
 * Duplicate or the copy of this device's projects writes one): whole when it
 * fits, else without the uploaded pictures (the spec, layout and REPX are
 * what matter), else null.
 *
 * Firestore's hard ceiling is 1,048,576 bytes per document. The budget leaves
 * headroom for the field names, the id/name/timestamp fields and UTF-8
 * expansion, so a save that passes this check is not rejected for size alone.
 * Measured: a detailed 2048px photo at the intake's own JPEG quality is
 * ~4.7 MB against that ceiling, and writing it was an opaque rejection.
 */
import { toFirestoreDocument, type SavedReportLike, type StoredReportDocument } from './savedReport';

export const CLOUD_SAVE_BUDGET_BYTES = 900_000;

/** The part of a message that carries pictures: its own, and its earlier versions' (2026-11-05). */
interface Pictured {
  images?: string[];
  branches?: { images?: string[]; tail: Pictured[] }[];
}

export function cloudPayload<M extends Pictured, R>(draft: SavedReportLike<M, R>, uid: string): { payload: StoredReportDocument; imagesDropped: boolean } | null {
  const fits = (p: StoredReportDocument) => p.messages.length + p.result.length <= CLOUD_SAVE_BUDGET_BYTES;
  const whole = toFirestoreDocument(draft, uid);
  if (fits(whole)) return { payload: whole, imagesDropped: false };
  // The same message less its pictures, so still a T: a cast the spread cannot prove.
  const withoutImages = <T extends Pictured>(list: T[]): T[] =>
    list.map((m) => ({
      ...m,
      images: undefined,
      branches: m.branches?.map((b) => ({ ...b, images: undefined, tail: withoutImages(b.tail) })),
    }) as T);
  const lighter = toFirestoreDocument({ ...draft, messages: withoutImages(draft.messages) }, uid);
  return fits(lighter) ? { payload: lighter, imagesDropped: true } : null;
}
