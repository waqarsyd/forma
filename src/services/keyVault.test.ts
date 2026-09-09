// @vitest-environment jsdom
// Needs crypto.subtle and sessionStorage. Must stay line 1; see vitest.config.ts.
/**
 * The cryptography protecting a stored Gemini key.
 *
 * This module had no test until the 2026-08-27 audit (TEST-001), and it is the
 * one place in the repo where that mattered most: `tests/firestore.rules.test.ts`
 * proves the *shape* of what gets stored, and nothing at all proved that what
 * goes in comes back out. The product promises a forgotten passphrase is
 * unrecoverable by design — there is no reset, because a reset would mean the
 * operator could decrypt — so a regression here is not a bug that gets noticed
 * and fixed. It permanently orphans every key already stored.
 *
 * The failures worth catching run in both directions:
 *
 *   - decryption breaking, which destroys stored keys silently; and
 *   - the encryption weakening, which nothing else would see. The rules only
 *     require `iterations >= 100000` while this module uses 310,000, so a
 *     client-side drop to the floor passes every existing check. The iteration
 *     count is therefore pinned here as a literal: changing it downward has to
 *     be a deliberate edit to a failing test.
 *
 * Everything runs on real WebCrypto under jsdom — no key, no network, no
 * emulator. PBKDF2 at 310,000 iterations is deliberately slow, so records are
 * shared between cases where the case is about the record rather than about
 * encrypting.
 */
import { describe, it, expect } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  cacheKeyForSession,
  readSessionKey,
  clearSessionKey,
  purgeLegacyPlaintextKey,
  isVaultAvailable,
  KEY_VAULT_VERSION,
  WrongPassphraseError,
  type EncryptedKeyRecord,
} from './keyVault';

/*
 * Deliberately NOT shaped like a Google API key, and it must stay that way.
 *
 * Until 2026-09-09 this was a fabricated string that nonetheless had the real
 * key format exactly: the `AIzaSy` prefix followed by 33 more characters, 39 in
 * total. GitHub's secret scanner cannot tell a fake from a live key without
 * validating it, so it raised an alert on this line the day the repository went
 * public, and it would do so again for every fork.
 *
 * Note this comment deliberately *describes* that format rather than quoting the
 * old value: pasting it here would match the scanner from inside the very
 * comment explaining the fix. The first draft did exactly that and was caught
 * by re-running the sweep instead of trusting the edit.
 *
 * The vault encrypts whatever bytes it is handed, so the plaintext's shape is
 * irrelevant to everything asserted below. Making it *look* realistic bought
 * nothing and cost a false positive that takes a human to dismiss. The only
 * constraint is length: one test asserts the serialised record does not contain
 * `API_KEY.slice(0, 12)`, so keep it comfortably over twelve characters.
 *
 * The three other fake keys in this repo (`VaultFigure.tsx`,
 * `reportConfigStore.test.ts`, `firestore.rules.test.ts`) are all too short to
 * match the pattern and were left alone.
 */
const API_KEY = 'gemini-api-key-placeholder-not-a-real-credential';
const PASSPHRASE = 'correct horse battery staple';

/** One shared record — deriving a key costs ~310k PBKDF2 rounds each time. */
const recordPromise = encryptApiKey(API_KEY, PASSPHRASE);

describe('isVaultAvailable', () => {
  it('is true where WebCrypto exists', () => {
    expect(isVaultAvailable()).toBe(true);
  });
});

describe('encryptApiKey / decryptApiKey', () => {
  it('round-trips the key', async () => {
    const record = await recordPromise;
    await expect(decryptApiKey(record, PASSPHRASE)).resolves.toBe(API_KEY);
  });

  it('round-trips a key containing non-ASCII, so the encoder pair agrees', async () => {
    // TextEncoder writes UTF-8 and TextDecoder reads it; a mismatched pair
    // would still round-trip pure ASCII and silently corrupt anything else.
    const unicode = 'schlüssel-🔑-ключ';
    const record = await encryptApiKey(unicode, PASSPHRASE);
    await expect(decryptApiKey(record, PASSPHRASE)).resolves.toBe(unicode);
  });

  it('rejects a wrong passphrase rather than returning garbage', async () => {
    const record = await recordPromise;
    await expect(decryptApiKey(record, 'not the passphrase')).rejects.toBeInstanceOf(
      WrongPassphraseError
    );
  });

  it('rejects an empty passphrase', async () => {
    const record = await recordPromise;
    await expect(decryptApiKey(record, '')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('refuses to encrypt without a key or without a passphrase', async () => {
    await expect(encryptApiKey('', PASSPHRASE)).rejects.toThrow(/no api key/i);
    await expect(encryptApiKey(API_KEY, '')).rejects.toThrow(/passphrase is required/i);
  });

  it('reports an incomplete record distinctly from a wrong passphrase', async () => {
    // A truncated document is a different problem from a bad passphrase and
    // has a different remedy, so it must not be flattened into the same error.
    const record = await recordPromise;
    for (const missing of ['ciphertext', 'iv', 'salt'] as const) {
      const broken = { ...record, [missing]: '' };
      await expect(decryptApiKey(broken, PASSPHRASE)).rejects.toThrow(/incomplete/i);
    }
  });
});

describe('tampering is detected — AES-GCM is authenticated', () => {
  /** Flip one base64 character so the bytes change but the field still decodes. */
  const corrupt = (value: string): string => {
    const i = Math.floor(value.length / 2);
    const replacement = value[i] === 'A' ? 'B' : 'A';
    return value.slice(0, i) + replacement + value.slice(i + 1);
  };

  it('rejects a modified ciphertext', async () => {
    const record = await recordPromise;
    const tampered: EncryptedKeyRecord = { ...record, ciphertext: corrupt(record.ciphertext) };
    await expect(decryptApiKey(tampered, PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects a modified IV', async () => {
    const record = await recordPromise;
    const tampered: EncryptedKeyRecord = { ...record, iv: corrupt(record.iv) };
    await expect(decryptApiKey(tampered, PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects a modified salt, which derives a different key', async () => {
    const record = await recordPromise;
    const tampered: EncryptedKeyRecord = { ...record, salt: corrupt(record.salt) };
    await expect(decryptApiKey(tampered, PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe('the stored record', () => {
  it('uses 310,000 PBKDF2 iterations — OWASP\'s floor for HMAC-SHA256', async () => {
    // Pinned as a literal on purpose. firestore.rules only demands >= 100000,
    // so a weakening to the floor would pass every other check in the repo.
    const record = await recordPromise;
    expect(record.iterations).toBe(310_000);
  });

  it('carries exactly the five fields firestore.rules allows, and no others', async () => {
    // `isValidKeyVault` uses hasOnly + hasAll on this exact set. A sixth field
    // added here would be rejected at write time by a rule this test cannot
    // see, so the shape is asserted on both sides of the boundary.
    const record = await recordPromise;
    expect(Object.keys(record).sort()).toEqual(
      ['ciphertext', 'iterations', 'iv', 'salt', 'v'].sort()
    );
  });

  it('stamps the schema version', async () => {
    const record = await recordPromise;
    expect(record.v).toBe(KEY_VAULT_VERSION);
  });

  it('contains no plaintext key material', async () => {
    const record = await recordPromise;
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain(API_KEY);
    // Also check a substring, in case a future change stores a prefix "hint".
    expect(serialised).not.toContain(API_KEY.slice(0, 12));
  });

  it('fits the 2048-character ciphertext bound the rules impose', async () => {
    const record = await recordPromise;
    expect(record.ciphertext.length).toBeGreaterThan(0);
    expect(record.ciphertext.length).toBeLessThanOrEqual(2048);
  });

  it('uses a fresh salt and IV for every encryption', async () => {
    // Reusing an IV under the same key is the classic way to break AES-GCM.
    const [a, b] = await Promise.all([
      encryptApiKey(API_KEY, PASSPHRASE),
      encryptApiKey(API_KEY, PASSPHRASE),
    ]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('decrypts using the count stored in the record, not the current constant', async () => {
    // This is what makes raising PBKDF2_ITERATIONS safe: a record written by an
    // older build carries its own count and must keep opening. Written at a
    // lower count here and decrypted without the constant being involved.
    const record = await recordPromise;
    const lowered: EncryptedKeyRecord = { ...record, iterations: 120_000 };
    // Same passphrase, but a different derivation — so it must NOT open,
    // proving decrypt really used the record's value rather than the constant.
    await expect(decryptApiKey(lowered, PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe('session cache', () => {
  it('stores, reads back, and clears', () => {
    clearSessionKey();
    expect(readSessionKey()).toBe('');

    cacheKeyForSession(API_KEY);
    expect(readSessionKey()).toBe(API_KEY);

    clearSessionKey();
    expect(readSessionKey()).toBe('');
  });

  it('uses sessionStorage, not localStorage — the tab close is the erasure', () => {
    // The guarantee is the browser's, not a beforeunload handler's. If this
    // ever moves to localStorage the key outlives the tab, on disk.
    clearSessionKey();
    localStorage.clear();
    cacheKeyForSession(API_KEY);

    expect(JSON.stringify(localStorage)).not.toContain(API_KEY);
    expect(JSON.stringify(sessionStorage)).toContain(API_KEY);
    clearSessionKey();
  });
});

describe('purgeLegacyPlaintextKey', () => {
  it('returns the pre-BYO-key entry and removes it from disk', () => {
    localStorage.setItem('customGeminiApiKey', API_KEY);

    expect(purgeLegacyPlaintextKey()).toBe(API_KEY);
    expect(localStorage.getItem('customGeminiApiKey')).toBeNull();
  });

  it('is a no-op when there is nothing to purge', () => {
    localStorage.removeItem('customGeminiApiKey');
    expect(purgeLegacyPlaintextKey()).toBe('');
  });
});
