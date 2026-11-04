/**
 * Persistence for the report configuration — and only the part of it that is
 * the user's standing setup.
 *
 * Since 2026-11-04 that is the DevExpress version and the report unit, and
 * both are learned rather than chosen: Forma reads them from the reports the
 * user brings (lib/autoConfig.ts) and keeps them for the requests that bring
 * none, since a user targeting DevExpress 20.1 targets it every session.
 * Everything else the settings dialog used to ask for (page size, header,
 * footer, right to left, stored procedure, OCR languages, handwriting) is
 * worked out per request now, and a stored value nobody can see or change
 * would only overrule what the request shows. Old entries for them are
 * dropped on the way in, as any unknown field is.
 *
 * The API key is not a preference and must never be written here. It lives in
 * `sessionStorage`, erased by the browser when the tab closes, with an optional
 * AES-GCM copy in Firestore — see `keyVault.ts`. A previous build kept it in
 * `localStorage` in plaintext and `purgeLegacyPlaintextKey()` exists to undo
 * that; persisting the whole config object would quietly reintroduce it under a
 * new name. Hence an allowlist rather than a blocklist: a field added to
 * `ReportConfig` later is *not* persisted until someone adds it here on purpose.
 */

import { isSupportedUnit } from './reportGeometry';

export const STORAGE_KEY = 'reportConfig';

/** Exactly the fields learned from the user's reports. Nothing else is stored. */
const PERSISTED_FIELDS = ['version', 'unit'] as const;

export interface PersistableConfig {
  version?: string;
  unit?: string;
}

/**
 * The subset that may go to disk. Takes a wider object and narrows it, so the
 * caller cannot pass the key through by accident.
 */
export function toPersistable<T extends PersistableConfig>(config: T): PersistableConfig {
  const out: PersistableConfig = {};
  for (const field of PERSISTED_FIELDS) {
    const value = config[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/**
 * Merge a stored config over the defaults.
 *
 * Anything unparseable, missing or of the wrong shape falls back to the default
 * rather than throwing — a corrupted entry must not stop the workspace loading.
 * Unknown fields in the stored object are dropped, which is what stops a key
 * written by a future bug (or by hand) from being read back into the config,
 * and what retires the fields this file stopped keeping on 2026-11-04.
 */
export function mergeStoredConfig<T extends PersistableConfig>(defaults: T, raw: string | null): T {
  if (!raw) return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
  const stored = parsed as Record<string, unknown>;

  const merged: T = { ...defaults };
  for (const field of PERSISTED_FIELDS) {
    const value = stored[field];
    if (typeof value !== 'string') continue;

    // Type is not enough for the unit. It is a DevExpress enum name that
    // reaches the geometry *and* gets written verbatim into the REPX, so an
    // unrecognised one produces a plausible layout at the wrong scale.
    // Accepting any string here is what made BUG-001 reachable: a stored
    // `"Document"` silently converted at 100 units per inch instead of 300.
    if (field === 'unit' && !isSupportedUnit(value)) continue;
    // A version is a SerializerVersion's major and minor, nothing else.
    if (field === 'version' && !/^\d{2}\.\d$/.test(value)) continue;

    merged[field] = value;
  }

  return merged;
}
