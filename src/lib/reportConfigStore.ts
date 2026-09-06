/**
 * Persistence for the report configuration — and only the report parts of it.
 *
 * The settings that describe the *document* (DevExpress version, unit, page
 * size, header, footer) are a standing preference: a user targeting DevExpress
 * 20.1 targets it every session, and losing that on reload means the next export
 * silently goes out as 23.2 and is refused by their designer.
 *
 * The API key is not a preference and must never be written here. It lives in
 * `sessionStorage`, erased by the browser when the tab closes, with an optional
 * AES-GCM copy in Firestore — see `keyVault.ts`. A previous build kept it in
 * `localStorage` in plaintext and `purgeLegacyPlaintextKey()` exists to undo
 * that; persisting the whole config object would quietly reintroduce it under a
 * new name. Hence an allowlist rather than a blocklist: a field added to
 * `ReportConfig` later is *not* persisted until someone adds it here on purpose.
 */

import { isSupportedUnit, isSupportedPageSize } from './reportGeometry';

export const STORAGE_KEY = 'reportConfig';

/** Exactly the fields the settings UI exposes. Nothing else is stored. */
const PERSISTED_FIELDS = ['version', 'unit', 'pageSize', 'header', 'footer', 'leanPrompt', 'detailedSpec'] as const;

export interface PersistableConfig {
  version?: string;
  unit?: string;
  pageSize?: string;
  header?: { showCompanyLogo?: boolean; title?: string };
  footer?: { showPageNumbers?: boolean; customText?: string };
  /**
   * Persisted because it describes how this person works rather than this one
   * report, and retyping it every session is how a setting stops being used.
   * It is not a document property like the others here, which is the only
   * reason it is worth pointing out.
   */
  leanPrompt?: boolean;
  detailedSpec?: boolean;
}

/**
 * The subset that may go to disk. Takes a wider object and narrows it, so the
 * caller cannot pass the key through by accident.
 */
export function toPersistable<T extends PersistableConfig>(config: T): PersistableConfig {
  const out: PersistableConfig = {};
  for (const field of PERSISTED_FIELDS) {
    const value = config[field];
    if (value !== undefined) (out as Record<string, unknown>)[field] = value;
  }
  return out;
}

/**
 * Merge a stored config over the defaults.
 *
 * Anything unparseable, missing or of the wrong shape falls back to the default
 * rather than throwing — a corrupted entry must not stop the workspace loading.
 * Unknown fields in the stored object are dropped, which is what stops a key
 * written by a future bug (or by hand) from being read back into the config.
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
    if (value === undefined || value === null) continue;

    if (field === 'header' || field === 'footer') {
      if (typeof value === 'object' && !Array.isArray(value)) {
        (merged as Record<string, unknown>)[field] = { ...(defaults[field] as object), ...(value as object) };
      }
      continue;
    }

    if (typeof value !== 'string') continue;

    // Type is not enough for these two. `unit` and `pageSize` are DevExpress
    // enum names that reach the geometry *and* get written verbatim into the
    // REPX, so an unrecognised one produces a plausible layout at the wrong
    // scale, or a file DevExpress refuses. Accepting any string here is what
    // made BUG-001 reachable: a stored `"Document"` silently converted at 100
    // units per inch instead of 300.
    //
    // Rejecting falls back to the default rather than throwing, for the same
    // reason the rest of this function does: a corrupted entry must not stop
    // the workspace loading.
    if (field === 'unit' && !isSupportedUnit(value)) continue;
    if (field === 'pageSize' && !isSupportedPageSize(value)) continue;

    (merged as Record<string, unknown>)[field] = value;
  }

  return merged;
}
