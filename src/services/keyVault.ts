/**
 * Client-side encryption for the user's own Gemini API key.
 *
 * Forma is bring-your-own-key. The key belongs to the user, never to the
 * application, and it must never reach Firestore (or any server) in a form we
 * could read. Everything here runs in the browser:
 *
 *   passphrase --PBKDF2--> AES-GCM key --encrypt--> ciphertext -> Firestore
 *
 * Firestore therefore stores an opaque blob plus the public parameters needed to
 * derive the same key again (salt, iv, iteration count). Neither the passphrase
 * nor the plaintext API key is ever transmitted or persisted.
 *
 * The consequence is deliberate and cannot be engineered away: a forgotten
 * passphrase means the stored key is permanently undecryptable. There is no
 * reset path, because a reset path would mean we could read the key ourselves.
 * Say so in the UI wherever a passphrase is set.
 */

/** Stored shape. Safe to write to Firestore — contains no secret material. */
export interface EncryptedKeyRecord {
  /** Schema version, so the parameters below can change without breaking old records. */
  v: number;
  /** Base64 AES-GCM ciphertext of the API key. */
  ciphertext: string;
  /** Base64 12-byte AES-GCM initialisation vector. Unique per encryption. */
  iv: string;
  /** Base64 16-byte PBKDF2 salt. Unique per encryption. */
  salt: string;
  /** PBKDF2 iteration count actually used, so old records stay decryptable. */
  iterations: number;
}

export const KEY_VAULT_VERSION = 1;

/**
 * OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Raising this later is safe: each
 * record carries the count it was written with, and decrypt honours that value
 * rather than this constant.
 */
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Thrown when the passphrase is wrong, or the stored record has been tampered with. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("That passphrase does not unlock this key.");
    this.name = "WrongPassphraseError";
  }
}

/** Thrown when the browser has no WebCrypto — see isVaultAvailable(). */
export class VaultUnavailableError extends Error {
  constructor() {
    super(
      "Encrypted key storage needs a secure context. Open the app over HTTPS or on localhost."
    );
    this.name = "VaultUnavailableError";
  }
}

/**
 * crypto.subtle exists only in a secure context: HTTPS, or a localhost origin.
 * Plain HTTP against a LAN IP (http://192.168.x.x:3000) silently has no
 * subtle — hence an explicit check rather than a confusing "undefined" crash.
 */
export function isVaultAvailable(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

function requireSubtle(): SubtleCrypto {
  if (!isVaultAvailable()) throw new VaultUnavailableError();
  return crypto.subtle;
}

const toBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** Stretch the passphrase into an AES-GCM key. Deliberately slow — that is the point. */
async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = requireSubtle();

  const passphraseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: the derived key cannot be read back out
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt an API key under a passphrase. The result is safe to store anywhere;
 * without the passphrase it is undecryptable, including by us.
 */
export async function encryptApiKey(
  apiKey: string,
  passphrase: string
): Promise<EncryptedKeyRecord> {
  const subtle = requireSubtle();

  if (!apiKey) throw new Error("No API key to encrypt.");
  if (!passphrase) throw new Error("A passphrase is required.");

  // Fresh salt and IV per encryption — never reuse either.
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);

  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(apiKey)
  );

  return {
    v: KEY_VAULT_VERSION,
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypt a stored record. AES-GCM is authenticated, so a wrong passphrase and a
 * tampered ciphertext both surface the same way — as WrongPassphraseError.
 */
export async function decryptApiKey(
  record: EncryptedKeyRecord,
  passphrase: string
): Promise<string> {
  const subtle = requireSubtle();

  if (!record?.ciphertext || !record.iv || !record.salt) {
    throw new Error("Stored key record is incomplete.");
  }

  const aesKey = await deriveAesKey(
    passphrase,
    fromBase64(record.salt),
    // Honour the record's own iteration count so raising the constant above
    // never orphans keys written by an older build.
    record.iterations || PBKDF2_ITERATIONS
  );

  try {
    const plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(record.iv) },
      aesKey,
      fromBase64(record.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // WebCrypto reports an auth-tag mismatch as a bare OperationError.
    throw new WrongPassphraseError();
  }
}

/* ------------------------------------------------------------------ *
 * Session-scoped plaintext cache
 *
 * Holds the decrypted key for the life of one browser tab so the user
 * unlocks once per session instead of once per generation. sessionStorage
 * is the right store precisely because the browser clears it when the tab
 * closes — that erasure is guaranteed by the browser, whereas a
 * `beforeunload` handler is not (crashes, force-quit and mobile tab
 * eviction all skip it).
 * ------------------------------------------------------------------ */

const SESSION_KEY = "geminiApiKey:session";

export function cacheKeyForSession(apiKey: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, apiKey);
  } catch {
    /* storage disabled (private mode, quota) — the key still works in memory */
  }
}

export function readSessionKey(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function clearSessionKey(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Belt-and-braces cleanup for the pre-BYO-key build, which persisted the key in
 * localStorage under 'customGeminiApiKey'. Anyone upgrading still has that entry
 * sitting on disk; clear it on boot so old plaintext does not outlive the change.
 */
export function purgeLegacyPlaintextKey(): string {
  try {
    const legacy = localStorage.getItem("customGeminiApiKey") || "";
    localStorage.removeItem("customGeminiApiKey");
    return legacy;
  } catch {
    return "";
  }
}
