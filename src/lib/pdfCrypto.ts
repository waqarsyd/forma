/**
 * Password protection for Forma's own PDF (parity row 73, 2026-11-01).
 *
 * A report keeps its PDF passwords in the file, in plain text:
 * `<ExportOptions><Pdf><PasswordSecurityOptions OpenPassword=… PermissionsPassword=…
 * EncryptionLevel=…/>`. DevExpress 20.1 encrypted its export with the PDF
 * standard security handler at the level named, measured in s61a to s61e:
 *
 * | `EncryptionLevel`   | Dictionary              | Crypt filter | Header   |
 * | ------------------- | ----------------------- | ------------ | -------- |
 * | `AES128`, default   | `/V 4 /R 4 /Length 128` | `AESV2`      | PDF-1.6  |
 * | `ARC4`              | `/V 4 /R 4 /Length 128` | `V2`         | PDF-1.6  |
 * | `AES256`            | `/V 5 /R 6 /Length 256` | `AESV3`      | PDF-1.7  |
 *
 * `/P` was -4, everything allowed, with only an open password, and -3392
 * with a permissions password and the default permissions: no printing,
 * changing, copying or assembling, screen readers allowed.
 *
 * The algorithms are the PDF specification's (ISO 32000, 7.6), written here
 * from it: MD5, RC4 and AES are small enough to carry, and must run
 * synchronously as each object is written. SHA-256, -384 and -512, which only
 * AES-256's key derivation needs, come from the platform's WebCrypto.
 */
import { unescapeXml } from './xmlEscape';

/** What a report's `PasswordSecurityOptions` asks for. */
export interface PdfSecurity {
  openPassword: string;
  permissionsPassword: string;
  level: 'AES128' | 'AES256' | 'ARC4';
}

/** The file's `PasswordSecurityOptions`, or null when it asks for no password. */
export function pdfSecurityOf(xml: string | null | undefined): PdfSecurity | null {
  const tag = /<PasswordSecurityOptions\b[^>]*>/.exec(xml ?? '')?.[0];
  if (!tag) return null;
  const attr = (name: string) => {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    return m ? unescapeXml(m[1]) : '';
  };
  const openPassword = attr('OpenPassword');
  const permissionsPassword = attr('PermissionsPassword');
  if (!openPassword && !permissionsPassword) return null;
  const level = attr('EncryptionLevel');
  return { openPassword, permissionsPassword, level: level === 'AES256' || level === 'ARC4' ? level : 'AES128' };
}

/* ------------------------------------------------------------------ MD5 */

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 of `data` (RFC 1321). */
export function md5(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array(((data.length + 8) >> 6) * 64 + 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      const sum = (a + f + MD5_K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => o.setUint32(i * 4, w, true));
  return out;
}

/* ------------------------------------------------------------------ RC4 */

/** RC4 of `data` under `key`; encryption and decryption are the same. */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/* ------------------------------------------------------------------ AES */

const SBOX = (() => {
  const box = new Uint8Array(256);
  const rotl = (x: number, n: number) => ((x << n) | (x >> (8 - n))) & 0xff;
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    box[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63;
  } while (p !== 1);
  box[0] = 0x63;
  return box;
})();
const xtime = (x: number) => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;

/** AES's round keys for a 16- or 32-byte key (FIPS 197). */
function expandKey(key: Uint8Array): Uint8Array {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const w = new Uint8Array(16 * (rounds + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) {
      t = new Uint8Array([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]);
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      t = t.map((b) => SBOX[b]);
    }
    for (let k = 0; k < 4; k++) w[i * 4 + k] = w[(i - nk) * 4 + k] ^ t[k];
  }
  return w;
}

function encryptBlock(block: Uint8Array, w: Uint8Array): Uint8Array {
  const rounds = w.length / 16 - 1;
  let s = block.map((b, i) => b ^ w[i]);
  for (let round = 1; round <= rounds; round++) {
    const sub = s.map((b) => SBOX[b]);
    const shifted = new Uint8Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) shifted[r + 4 * c] = sub[r + 4 * ((c + r) % 4)];
    if (round < rounds) {
      for (let c = 0; c < 4; c++) {
        const [a0, a1, a2, a3] = shifted.subarray(4 * c, 4 * c + 4);
        shifted[4 * c] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
        shifted[4 * c + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
        shifted[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
        shifted[4 * c + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    s = shifted.map((b, i) => b ^ w[round * 16 + i]);
  }
  return s;
}

/**
 * AES in CBC mode under a 16- or 32-byte key. With `pad`, PKCS#7 padding, as
 * a PDF's AES crypt filters take it; without, `data` must fill whole blocks.
 */
export function aesCbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad = true): Uint8Array {
  const w = expandKey(key);
  const fill = pad ? 16 - (data.length % 16) : 0;
  const input = new Uint8Array(data.length + fill);
  input.set(data);
  input.fill(fill, data.length);
  const out = new Uint8Array(input.length);
  let prev = iv;
  for (let off = 0; off < input.length; off += 16) {
    const block = encryptBlock(input.subarray(off, off + 16).map((b, i) => b ^ prev[i]), w);
    out.set(block, off);
    prev = block;
  }
  return out;
}

/* ------------------------------------------------------------- the handler */

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const latin1 = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff));
const le32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** A password padded or cut to 32 bytes, as revisions 2 to 4 take it. */
function padded(password: string): Uint8Array {
  return concat(latin1(password).slice(0, 32), PAD).slice(0, 32);
}

async function sha(name: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest(name, data as unknown as ArrayBuffer));
}

/** Revision 6's hash (ISO 32000-2, algorithm 2.B). */
async function hash6(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha('SHA-256', concat(password, salt, udata));
  // At least 64 rounds, then until the last byte of E is no more than the
  // rounds done less 32.
  for (let done = 1; ; done++) {
    const k1 = concat(...Array.from({ length: 64 }, () => concat(password, k, udata)));
    const e = aesCbc(k.slice(0, 16), k.slice(16, 32), k1, false);
    const mod = e.slice(0, 16).reduce((s, b) => s + b, 0) % 3;
    k = await sha(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', e);
    if (done >= 64 && e[e.length - 1] <= done - 32) break;
  }
  return k.slice(0, 32);
}

/** What `writePdf` needs to encrypt a document. */
export interface PdfEncryption {
  /** The header's version: 1.6, or 1.7 for AES-256. */
  version: string;
  /** The encryption dictionary, written as an object of its own and never encrypted. */
  dictionary: string;
  /** The file identifier, for the trailer's `/ID`. */
  id: Uint8Array;
  /** Encrypts a string's or a stream's bytes, which belong to object `n`. */
  encrypt(n: number, data: Uint8Array): Uint8Array;
}

/**
 * The standard security handler for `security`, with a fresh file
 * identifier, keys and salts from `random`.
 */
export async function pdfEncryption(
  security: PdfSecurity,
  random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
): Promise<PdfEncryption> {
  // With a permissions password the default permissions: no printing,
  // changing, copying or assembling, screen readers allowed (s61b).
  const p = security.permissionsPassword ? -3392 : -4;
  const owner = security.permissionsPassword || security.openPassword;
  const id = random(16);
  const filters = (cfm: string, bits: number) =>
    `/CF << /StdCF << /CFM /${cfm} /Length ${bits / 8} >> >> /StmF /StdCF /StrF /StdCF`;

  if (security.level === 'AES256') {
    const key = random(32);
    const utf8 = (s: string) => new TextEncoder().encode(s.normalize('NFKC')).slice(0, 127);
    const user = utf8(security.openPassword);
    const ownerPw = utf8(owner);
    const [uv, uk, ov, ok] = [random(8), random(8), random(8), random(8)];
    const u = concat(await hash6(user, uv, new Uint8Array(0)), uv, uk);
    const ue = aesCbc(await hash6(user, uk, new Uint8Array(0)), new Uint8Array(16), key, false);
    const o = concat(await hash6(ownerPw, ov, u), ov, ok);
    const oe = aesCbc(await hash6(ownerPw, ok, u), new Uint8Array(16), key, false);
    const perms = aesCbc(key, new Uint8Array(16), concat(le32(p), new Uint8Array([0xff, 0xff, 0xff, 0xff]), latin1('Tadb'), random(4)), false);
    return {
      version: '1.7',
      id,
      dictionary:
        `<< /Filter /Standard /V 5 /Length 256 ${filters('AESV3', 256)} /R 6` +
        ` /O <${hex(o)}> /U <${hex(u)}> /OE <${hex(oe)}> /UE <${hex(ue)}> /P ${p} /Perms <${hex(perms)}> /EncryptMetadata true >>`,
      encrypt: (_n, data) => {
        const iv = random(16);
        return concat(iv, aesCbc(key, iv, data));
      },
    };
  }

  // Revision 4, 128 bits: the owner entry (algorithm 3), the file key
  // (algorithm 2) and the user entry (algorithm 5).
  let ownerKey = md5(padded(owner));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  let o = rc4(ownerKey, padded(security.openPassword));
  for (let i = 1; i <= 19; i++) o = rc4(ownerKey.map((b) => b ^ i), o);
  let key = md5(concat(padded(security.openPassword), o, le32(p), id));
  for (let i = 0; i < 50; i++) key = md5(key);
  let u = rc4(key, md5(concat(PAD, id)));
  for (let i = 1; i <= 19; i++) u = rc4(key.map((b) => b ^ i), u);
  u = concat(u, new Uint8Array(16));

  const aes = security.level === 'AES128';
  return {
    version: '1.6',
    id,
    dictionary:
      `<< /Filter /Standard /V 4 /Length 128 ${filters(aes ? 'AESV2' : 'V2', 128)} /R 4` +
      ` /O <${hex(o)}> /U <${hex(u)}> /P ${p} /EncryptMetadata true >>`,
    encrypt: (n, data) => {
      // Each object's own key (algorithm 1), salted for AES.
      const objectKey = md5(concat(key, new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, 0, 0]), aes ? latin1('sAlT') : new Uint8Array(0)));
      if (!aes) return rc4(objectKey, data);
      const iv = random(16);
      return concat(iv, aesCbc(objectKey, iv, data));
    },
  };
}
