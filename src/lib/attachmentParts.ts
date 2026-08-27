/**
 * Turning what the user attached into the parts the model is sent.
 *
 * Extracted from `App.tsx` on 2026-08-27 (audit ARC-001), where it existed
 * twice — character-for-character identical in `handleGenerate` and
 * `handleResume`. Two copies of a data-URL parser stay correct exactly until
 * one of them is fixed.
 *
 * **Ordering is the load-bearing part.** Text lifted out of the uploaded files
 * goes before the page images, so the model has the exact strings and
 * coordinates in context before it looks at a picture of them. Reversing it
 * produces a worse report and no error at all.
 *
 * The original parsed blind:
 *
 *     const [mimeInfo, base64Data] = dataUrl.split(',');
 *     const mimeType = mimeInfo.split(':')[1].split(';')[0];
 *
 * which throws a TypeError on any string without a colon. Previews normally
 * come from the intake and are well-formed, but a project restored from
 * `localStorage` carries whatever was stored — and a throw here loses the whole
 * generation rather than one thumbnail. Malformed attachments are now dropped.
 */
import type { AttachmentPart } from '../services/geminiService';

/** Text recovered from an upload, as `App.tsx` holds it. */
export interface AttachmentText {
  text: string;
}

/**
 * Split `data:image/png;base64,AAAA` into its mime type and payload.
 *
 * Returns `null` for anything that is not a data URL with both halves present.
 * Note only the **first** comma separates the header — base64 does not contain
 * commas, but a `data:` URL may carry other encodings that do.
 */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  if (typeof dataUrl !== 'string') return null;

  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;

  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  if (!data) return null;

  const colon = header.indexOf(':');
  if (colon === -1) return null;

  // `data:image/png;base64` -> `image/png`. A bare `data:` has no mime type.
  const mimeType = header.slice(colon + 1).split(';')[0];
  if (!mimeType) return null;

  return { mimeType, data };
}

/**
 * The parts for one request, in the order the prompt expects them.
 *
 * Anything unparseable is left out rather than sent malformed or thrown on: one
 * unreadable thumbnail must not cost the user their report.
 */
export function toAttachmentParts(
  previews: readonly string[],
  texts: readonly AttachmentText[]
): AttachmentPart[] {
  const textParts: AttachmentPart[] = texts
    .filter((t) => t?.text?.trim())
    .map((t) => ({ text: t.text }));

  const imageParts: AttachmentPart[] = [];
  for (const preview of previews) {
    const parsed = parseDataUrl(preview);
    if (parsed) imageParts.push({ inlineData: { data: parsed.data, mimeType: parsed.mimeType } });
  }

  return [...textParts, ...imageParts];
}
