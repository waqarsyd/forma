/**
 * A ZIP file, written by hand, because forty download prompts is not a feature.
 *
 * ## Why not a library
 *
 * Batch intake hands back one `.repx` per source document, and a folder of
 * forty legacy reports is the case the whole feature exists for. Forty separate
 * downloads is forty browser prompts and forty files loose in ~/Downloads; the
 * answer is an archive.
 *
 * JSZip is ~100 kB and fflate ~30 kB, against a `dist/` budget that has already
 * been retuned once this week. What this actually needs is the STORED method —
 * no compression at all — which is roughly the arithmetic below plus a CRC.
 * `.repx` files are XML and would compress well, but the archive exists to
 * carry them out of the browser rather than to be small, and a store-only
 * archive is read by Windows Explorer, macOS Archive Utility, `unzip` and 7-Zip
 * without ceremony.
 *
 * ## What it deliberately does not do
 *
 * No compression, no encryption, no Zip64. Zip64 is the real limit: this format
 * stores sizes and offsets in 32 bits, so an archive above 4 GB or with more
 * than 65,535 entries is malformed. `buildZip` refuses rather than writing one,
 * because a truncated archive that opens and is missing files is exactly the
 * silent-loss failure this project keeps finding elsewhere.
 *
 * Every multi-byte field is little-endian, which is the format's own convention
 * and the source of most hand-rolled ZIP bugs.
 */

export interface ZipEntry {
  /** Path inside the archive. Forward slashes; no leading slash. */
  name: string;
  /** File contents. Text is encoded UTF-8 by `buildZip`. */
  content: string | Uint8Array;
}

/** Signatures, named rather than repeated as magic numbers. */
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** 4 GB and 65,535 entries: where 32-bit fields stop being able to say the truth. */
const MAX_TOTAL_BYTES = 0xffffffff;
const MAX_ENTRIES = 0xffff;

/**
 * CRC-32, the ordinary reflected polynomial ZIP uses.
 *
 * Table built once on first use rather than at module load: this file is
 * imported by anything that touches the batch queue, and most sessions never
 * build an archive.
 */
let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      // 0xEDB88320 is the reversed form of the standard polynomial; ZIP,
      // PNG and gzip all use this one.
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A file name safe inside an archive and on the three desktop filesystems.
 *
 * Windows is the strict one and the one this project targets: it reserves
 * `\ / : * ? " < > |`, forbids a trailing dot or space, and refuses the device
 * names outright — the same list `designerBridge.ts` guards against, for the
 * same reason. A report titled `Invoice: Q1/Q2` must not become two directories.
 */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeEntryName(name: string, fallback = 'report'): string {
  let base = (name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    // Control characters are legal in a ZIP name and legal nowhere useful.
    // Escaped, not literal: written as raw bytes this class is invisible in
    // every editor and survives no copy-paste, which is how the first draft
    // of this line ended up carrying a NUL.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (RESERVED_DEVICE.test(base.replace(/\.[^.]*$/, ''))) base = `_${base}`;
  return base || fallback;
}

/** Distinct names, so two reports both called "Invoice" do not collide. */
export function uniqueEntryNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    // "Invoice.repx" -> "Invoice (2).repx", not "Invoice.repx (2)".
    return dot > 0
      ? `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}`
      : `${name} (${count + 1})`;
  });
}

/** DOS date/time, which is what ZIP stores: 2-second resolution, from 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Little-endian writer over a fixed buffer. */
class Writer {
  private view: DataView;
  private pos = 0;
  constructor(public bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer);
  }
  u16(value: number) { this.view.setUint16(this.pos, value, true); this.pos += 2; }
  u32(value: number) { this.view.setUint32(this.pos, value >>> 0, true); this.pos += 4; }
  raw(value: Uint8Array) { this.bytes.set(value, this.pos); this.pos += value.length; }
  get offset() { return this.pos; }
}

export interface ZipResult {
  bytes: Uint8Array | null;
  /** Null when it refused; the reason is worth showing. */
  reason: string;
}

/**
 * Build a store-only ZIP.
 *
 * Entry names are sanitised and de-duplicated here rather than by the caller,
 * so two reports the model titled the same cannot silently overwrite one
 * another inside the archive — which is a real risk with generated titles and
 * an invisible one, since the archive still opens.
 */
export function buildZip(entries: readonly ZipEntry[], now = new Date()): ZipResult {
  if (!entries.length) return { bytes: null, reason: 'nothing to archive' };
  if (entries.length > MAX_ENTRIES) {
    return { bytes: null, reason: `${entries.length} files exceeds the ${MAX_ENTRIES} this format can index` };
  }

  const encoder = new TextEncoder();
  const names = uniqueEntryNames(entries.map((e) => safeEntryName(e.name)));
  const prepared = entries.map((entry, i) => {
    const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    return { name: encoder.encode(names[i]), data, crc: crc32(data) };
  });

  const { time, date } = dosDateTime(now);
  const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > MAX_TOTAL_BYTES) {
    return { bytes: null, reason: 'the archive would exceed the 4 GB this format can address' };
  }

  const out = new Writer(new Uint8Array(total));
  const offsets: number[] = [];

  for (const entry of prepared) {
    offsets.push(out.offset);
    out.u32(LOCAL_HEADER);
    out.u16(20);            // version needed: 2.0
    out.u16(0x0800);        // flag: names are UTF-8
    out.u16(0);             // method 0: stored
    out.u16(time);
    out.u16(date);
    out.u32(entry.crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(entry.name.length);
    out.u16(0);             // no extra field
    out.raw(entry.name);
    out.raw(entry.data);
  }

  const centralStart = out.offset;
  prepared.forEach((entry, i) => {
    out.u32(CENTRAL_HEADER);
    out.u16(20);            // version made by
    out.u16(20);            // version needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(entry.crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(entry.name.length);
    out.u16(0);             // extra
    out.u16(0);             // comment
    out.u16(0);             // disk number
    out.u16(0);             // internal attributes
    out.u32(0);             // external attributes
    out.u32(offsets[i]);
    out.raw(entry.name);
  });

  out.u32(END_OF_CENTRAL_DIRECTORY);
  out.u16(0);               // this disk
  out.u16(0);               // disk with the central directory
  out.u16(prepared.length);
  out.u16(prepared.length);
  out.u32(out.offset - centralStart);
  out.u32(centralStart);
  out.u16(0);               // comment length

  return { bytes: out.bytes, reason: `${prepared.length} file(s), ${total} bytes` };
}
