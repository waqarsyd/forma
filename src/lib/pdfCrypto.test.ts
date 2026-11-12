/**
 * PDF passwords (row 73). The primitives against their published vectors,
 * the file's options as DevExpress wrote them in s61, and Forma's encrypted
 * PDFs opened by an independent reader, pdf.js, with and without the
 * password, at each of the three levels DevExpress offers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { aesCbc, md5, pdfSecurityOf, rc4 } from './pdfCrypto';
import { writePdf, type PdfDocument } from './pdfWriter';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const ascii = (s: string) => new TextEncoder().encode(s);

describe('the primitives, against their published vectors', () => {
  it('MD5 (RFC 1321)', () => {
    expect(hex(md5(ascii('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(ascii('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(md5(ascii('12345678901234567890123456789012345678901234567890123456789012345678901234567890')))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('RC4', () => {
    expect(hex(rc4(ascii('Key'), ascii('Plaintext')))).toBe('bbf316e8d940af0ad3');
    expect(hex(rc4(ascii('Secret'), ascii('Attack at dawn')))).toBe('45a01f645fc35b383552544b9bf5');
  });

  it('AES-128 and AES-256 (FIPS 197, appendix C), one block with a zero vector', () => {
    const plain = bytes('00112233445566778899aabbccddeeff');
    const zero = new Uint8Array(16);
    expect(hex(aesCbc(bytes('000102030405060708090a0b0c0d0e0f'), zero, plain, false))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
    expect(hex(aesCbc(bytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'), zero, plain, false))).toBe('8ea2b7ca516745bfeafc49904b496089');
    // PKCS#7: a whole block of padding after a whole block of data.
    expect(aesCbc(bytes('000102030405060708090a0b0c0d0e0f'), zero, plain)).toHaveLength(32);
  });
});

describe('pdfSecurityOf', () => {
  it('reads the options as DevExpress wrote them in s61, AES-128 when no level is named', () => {
    expect(pdfSecurityOf('<Pdf Ref="6"><PasswordSecurityOptions Ref="7" OpenPassword="test-open" /></Pdf>')).toEqual({ openPassword: 'test-open', permissionsPassword: '', level: 'AES128' });
    expect(pdfSecurityOf('<PasswordSecurityOptions Ref="7" PermissionsPassword="test-perm" OpenPassword="test-open" EncryptionLevel="AES256" />')).toEqual({ openPassword: 'test-open', permissionsPassword: 'test-perm', level: 'AES256' });
    expect(pdfSecurityOf('<PasswordSecurityOptions Ref="7" OpenPassword="a&amp;b" EncryptionLevel="ARC4" />')).toMatchObject({ openPassword: 'a&b', level: 'ARC4' });
    expect(pdfSecurityOf('<Pdf Ref="6" />')).toBeNull();
    expect(pdfSecurityOf('<PasswordSecurityOptions Ref="7" EncryptionLevel="AES256" />')).toBeNull();
  });
});

describe('an encrypted PDF of Forma\'s own, opened by pdf.js', () => {
  type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
  let pdfjs: PdfJs;
  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }, 60_000);

  const doc = (security: PdfDocument['security']): PdfDocument => ({
    title: 'Protected copy',
    security,
    pages: [{ width: 612, height: 792, ops: [
      { kind: 'text', x: 72, y: 100, size: 12, font: 'Helvetica', colour: [0, 0, 0], text: 'Protected copy', scale: 1 },
      { kind: 'link', x: 72, y: 120, w: 100, h: 14, uri: 'https://example.com/a(b)' },
    ] }],
    outline: { title: 'Root', page: 0, y: 0, children: [{ title: 'Grüße', page: 0, y: 100, children: [] }] },
  });
  // pdf.js 6 evaluates no code at all, so `isEvalSupported: false` went with it (2026-11-12).
  const open = async (data: Uint8Array, password?: string) =>
    pdfjs.getDocument({ data: data.slice(), password, verbosity: 0 }).promise;
  /** pdf.js 6 answers a Set, or null when the file restricts nothing. */
  const permissionsOf = async (reader: Awaited<ReturnType<typeof open>>) => [...((await reader.getPermissions()) ?? [])];

  it.each([
    ['AES128', '1.6', '/V 4 /Length 128', '/AESV2'],
    ['ARC4', '1.6', '/V 4 /Length 128', '/CFM /V2'],
    ['AES256', '1.7', '/V 5 /Length 256', '/AESV3'],
  ] as const)('%s: opens with the password, reads its text, title, link and outline, and not without', async (level, version, dict, filter) => {
    const pdf = await writePdf(doc({ openPassword: 'test-open', permissionsPassword: 'test-perm', level }));
    const head = new TextDecoder('latin1').decode(pdf);
    expect(head.startsWith(`%PDF-${version}`)).toBe(true);
    expect(head).toContain(dict);
    expect(head).toContain(filter);
    expect(head).not.toContain('Protected copy');

    await expect(open(pdf)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(open(pdf, 'wrong')).rejects.toMatchObject({ name: 'PasswordException' });
    for (const password of ['test-open', 'test-perm']) {
      const reader = await open(pdf, password);
      const page = await reader.getPage(1);
      const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
      expect(text).toBe('Protected copy');
      expect((await reader.getMetadata()).info).toMatchObject({ Title: 'Protected copy', Producer: 'Forma' });
      const annots = await page.getAnnotations();
      expect(annots[0].url).toBe('https://example.com/a(b)');
      const outline = await reader.getOutline();
      expect(outline[0].title).toBe('Root');
      expect(outline[0].items[0].title).toBe('Grüße');
      await reader.loadingTask.destroy();
    }
  }, 60_000);

  it('allows everything with only an open password, and denies printing and copying with a permissions password', async () => {
    const openOnly = await open(await writePdf(doc({ openPassword: 'test-open', permissionsPassword: '', level: 'AES128' })), 'test-open');
    // /P -4: every permission there is.
    expect(await permissionsOf(openOnly)).toEqual(expect.arrayContaining(Object.values(pdfjs.PermissionFlag)));
    const restricted = await open(await writePdf(doc({ openPassword: '', permissionsPassword: 'test-perm', level: 'AES128' })));
    const allowed = await permissionsOf(restricted);
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed).not.toContain(pdfjs.PermissionFlag.PRINT);
    expect(allowed).not.toContain(pdfjs.PermissionFlag.COPY);
    await openOnly.loadingTask.destroy();
    await restricted.loadingTask.destroy();
  }, 60_000);
});
