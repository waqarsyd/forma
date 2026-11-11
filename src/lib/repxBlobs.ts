/**
 * Embedded data kept aside while a report goes to the AI (2026-11-11, the
 * full audit, PL-03).
 *
 * A REPX carries its pictures, rich text and data source as base64 inside
 * attributes: `ImageSource="img,iVBOR..."` on a picture box or a watermark,
 * `SerializableRtfString` on rich text, `Base64` on a SQL data source. Sent as
 * they are, every refine and every uploaded report paid for them twice: once
 * read, and once typed back character by character, where a logo of 100 KB
 * cannot fit the answer's 65,536 tokens and one changed character makes the
 * picture fail to load in DevExpress with no error. The prompt asked the
 * model to copy them byte for byte, which is the one thing it cannot be
 * trusted to do.
 *
 * So each such value goes out as `forma-blob:N` and comes back from the answer
 * as it was, before any repair reads the file, the way `carryDataSource`
 * keeps a data source through a redesign. One map serves every report a
 * request sends, so a value sent twice has one placeholder. A placeholder the
 * map does not hold (the model made it up, or mistyped the number) takes its
 * attribute with it: a file never carries the word `forma-blob`.
 */

/** A value that is base64 and long enough to be data rather than a word: `img,` is DevExpress's prefix for a picture. */
const BLOB_VALUE = /^(img,)?[A-Za-z0-9+/=]{200,}$/;

/** One attribute, its name and its value; a REPX writes every value in double quotes. */
const ATTRIBUTE = /(\s)([\w.:-]+)="([^"]*)"/g;

/** The placeholder a kept value is sent as. */
const PLACEHOLDER = /^forma-blob:(\d+)$/;

/** The values kept aside, by placeholder. */
export type BlobStash = Map<string, string>;

/**
 * The report with every embedded value replaced by `forma-blob:N`, and the map
 * that restores them. Pass the map of an earlier call to add to it.
 */
export function stashBlobs(xml: string, blobs: BlobStash = new Map()): { xml: string; blobs: BlobStash } {
  const byValue = new Map([...blobs].map(([key, value]) => [value, key]));
  const out = xml.replace(ATTRIBUTE, (whole, space: string, name: string, value: string) => {
    if (!BLOB_VALUE.test(value)) return whole;
    let key = byValue.get(value);
    if (!key) {
      key = `forma-blob:${blobs.size + 1}`;
      blobs.set(key, value);
      byValue.set(value, key);
    }
    // A replacer function, never a replacement string: base64 holds no `$`, but a name could.
    return `${space}${name}="${key}"`;
  });
  return { xml: out, blobs };
}

/** The report with every `forma-blob:N` put back; one the map does not hold is removed with its attribute. */
export function restoreBlobs(xml: string, blobs: BlobStash): string {
  return xml.replace(ATTRIBUTE, (whole, space: string, name: string, value: string) => {
    if (!PLACEHOLDER.test(value.trim())) return whole;
    const kept = blobs.get(value.trim());
    return kept === undefined ? '' : `${space}${name}="${kept}"`;
  });
}

/** Whether a text is a report Forma would send (an uploaded .repx, an open report). */
export const isRepxText = (text: string) => /<XtraReportsLayoutSerializer\b/.test(text);
