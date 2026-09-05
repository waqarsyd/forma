/**
 * The archive, checked against the format rather than against itself.
 *
 * A hand-rolled ZIP is easy to write in a way that only its own reader
 * understands, so these assertions are about the bytes the specification calls
 * for: the four signatures, little-endian fields, the central directory's
 * offsets pointing at real local headers, and a CRC-32 that matches the value
 * every other implementation produces for the same input.
 */
import { describe, it, expect } from 'vitest';
import { buildZip, crc32, safeEntryName, uniqueEntryNames } from './zip';

/*
 * `>>> 0` is not decoration. JS bitwise operators work on SIGNED 32-bit
 * integers, so a value with its top bit set -- which any CRC has a 50% chance
 * of -- reads back negative and compares unequal to the number `crc32` returns.
 * The archive was correct and this reader was not.
 */
const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0);
const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('crc32', () => {
  it('matches the values every other implementation produces', () => {
    // These are the standard published check values for CRC-32/ISO-HDLC.
    expect(crc32(new TextEncoder().encode(''))).toBe(0);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode('a'))).toBe(0xe8b7be43);
  });

  it('is stable across calls, so the lazily built table is not consumed', () => {
    const bytes = new TextEncoder().encode('The quick brown fox');
    expect(crc32(bytes)).toBe(crc32(bytes));
  });
});

describe('building an archive', () => {
  const entries = [
    { name: 'Invoice.repx', content: '<XtraReportsLayoutSerializer />' },
    { name: 'Delivery Note.repx', content: '<x>2</x>' },
  ];
  const { bytes } = buildZip(entries, new Date(2026, 8, 5, 12, 0, 0));

  it('starts with the local file header signature', () => {
    expect(u32(bytes!, 0)).toBe(0x04034b50);
  });

  it('ends with the end-of-central-directory record', () => {
    const eocd = bytes!.length - 22;
    expect(u32(bytes!, eocd)).toBe(0x06054b50);
    expect(u16(bytes!, eocd + 8)).toBe(2);   // entries on this disk
    expect(u16(bytes!, eocd + 10)).toBe(2);  // entries total
  });

  it('points the central directory at a real local header', () => {
    const eocd = bytes!.length - 22;
    const centralStart = u32(bytes!, eocd + 16);
    expect(u32(bytes!, centralStart)).toBe(0x02014b50);
    // Offset field of the first central record -> a local header signature.
    const firstLocal = u32(bytes!, centralStart + 42);
    expect(u32(bytes!, firstLocal)).toBe(0x04034b50);
  });

  it('stores rather than compresses, so sizes match the input exactly', () => {
    const size = new TextEncoder().encode(entries[0].content).length;
    expect(u16(bytes!, 8)).toBe(0);          // method 0
    expect(u32(bytes!, 18)).toBe(size);      // compressed
    expect(u32(bytes!, 22)).toBe(size);      // uncompressed
  });

  it('writes the CRC the reader will check', () => {
    expect(u32(bytes!, 14)).toBe(crc32(new TextEncoder().encode(entries[0].content)));
  });

  it('carries the file contents verbatim', () => {
    const nameLen = u16(bytes!, 26);
    const start = 30 + nameLen;
    expect(text(bytes!.slice(start, start + entries[0].content.length))).toBe(entries[0].content);
  });

  it('flags the names as UTF-8', () => {
    expect(u16(bytes!, 6) & 0x0800).toBe(0x0800);
  });

  it('encodes a non-ASCII name as UTF-8 rather than truncating it', () => {
    const result = buildZip([{ name: 'Rapport Détaillé.repx', content: 'x' }]);
    const nameLen = u16(result.bytes!, 26);
    expect(text(result.bytes!.slice(30, 30 + nameLen))).toBe('Rapport Détaillé.repx');
  });

  it('refuses an empty set rather than writing an archive of nothing', () => {
    const result = buildZip([]);
    expect(result.bytes).toBeNull();
    expect(result.reason).toBe('nothing to archive');
  });

  it('says how much it wrote', () => {
    expect(buildZip(entries).reason).toMatch(/2 file\(s\), \d+ bytes/);
  });

  it('accepts binary content as well as text', () => {
    const raw = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const result = buildZip([{ name: 'b.bin', content: raw }]);
    const nameLen = u16(result.bytes!, 26);
    expect([...result.bytes!.slice(30 + nameLen, 30 + nameLen + 6)]).toEqual([...raw]);
  });
});

describe('naming entries safely', () => {
  it('replaces the characters Windows reserves, rather than making directories', () => {
    // "Invoice: Q1/Q2" must not become a path.
    expect(safeEntryName('Invoice: Q1/Q2.repx')).toBe('Invoice- Q1-Q2.repx');
    expect(safeEntryName('a\\b*c?d"e<f>g|h')).toBe('a-b-c-d-e-f-g-h');
  });

  it('strips control characters', () => {
    expect(safeEntryName('Inv\u0000oice\u001f.repx')).toBe('Invoice.repx');
  });

  it('removes a trailing dot or space, which Windows refuses', () => {
    expect(safeEntryName('Report. ')).toBe('Report');
  });

  it('escapes a reserved device name', () => {
    expect(safeEntryName('CON.repx')).toBe('_CON.repx');
    expect(safeEntryName('lpt1.repx')).toBe('_lpt1.repx');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeEntryName('///')).toBe('---');
    expect(safeEntryName('')).toBe('report');
    expect(safeEntryName('   ')).toBe('report');
  });

  it('keeps spaces and hyphens, which are ordinary in a report title', () => {
    // The bug this pins: a character class meant for control characters that is
    // really "space or hyphen" strips both out of every name.
    expect(safeEntryName('Sales by Region - Q1.repx')).toBe('Sales by Region - Q1.repx');
  });
});

describe('de-duplicating names', () => {
  it('numbers a repeat before the extension', () => {
    expect(uniqueEntryNames(['Invoice.repx', 'Invoice.repx', 'Invoice.repx']))
      .toEqual(['Invoice.repx', 'Invoice (2).repx', 'Invoice (3).repx']);
  });

  it('treats names differing only in case as the same, as Windows does', () => {
    expect(uniqueEntryNames(['a.repx', 'A.repx'])).toEqual(['a.repx', 'A (2).repx']);
  });

  it('leaves distinct names alone', () => {
    expect(uniqueEntryNames(['a.repx', 'b.repx'])).toEqual(['a.repx', 'b.repx']);
  });

  it('handles a name with no extension', () => {
    expect(uniqueEntryNames(['report', 'report'])).toEqual(['report', 'report (2)']);
  });

  it('is applied by buildZip, so two reports of the same title cannot collide', () => {
    // Generated titles repeat, and an archive that silently holds one file
    // where two were expected opens without complaint.
    const result = buildZip([
      { name: 'Invoice.repx', content: 'first' },
      { name: 'Invoice.repx', content: 'second' },
    ]);
    const all = text(result.bytes!);
    expect(all).toContain('Invoice.repx');
    expect(all).toContain('Invoice (2).repx');
    expect(all).toContain('first');
    expect(all).toContain('second');
  });
});
