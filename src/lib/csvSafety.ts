/**
 * Whether this browser asked for CSV safe for spreadsheets (2026-11-11, the
 * full audit's SE-18): the Export panel's "Safe for spreadsheets" switch.
 *
 * On its own since 2026-11-11 (the PXA follow-up in batch PXB): it lived in
 * csvExport.ts, so the Export panel, which reads only this flag, imported the
 * CSV writer and with it the Preview's whole engine, into the chunk the
 * workspace loads before anything is exported. csvExport.ts reads it from
 * here.
 *
 * The choice is the viewer's own, kept in this browser like a remembered tab:
 * the Export panel sets it, and every CSV written here follows it, whether
 * the panel or the chat asked for the file.
 *
 * Held in this page as well (2026-11-11, the re-audit's R3-09). Where storage
 * is refused (a private window), the switch showed on and every CSV was
 * written without it, since the only copy was the one that could not be
 * stored; and where reading works and writing throws, the two disagreed the
 * same way. Once set in this page, this page's copy is the answer; before
 * that, storage's, and unreadable storage means off.
 */
const SAFE_KEY = 'forma.csvSafeForSpreadsheets';

/** The choice made in this page, which outranks storage; null until one is made. */
let chosen: boolean | null = null;

/** Whether this browser asked for CSV safe for spreadsheets. */
export function csvSafetyPreferred(): boolean {
  if (chosen !== null) return chosen;
  try {
    return globalThis.localStorage?.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember, in this page and in this browser, whether CSV is written safe for spreadsheets. */
export function preferCsvSafety(on: boolean): void {
  chosen = on;
  try {
    if (on) globalThis.localStorage?.setItem(SAFE_KEY, '1');
    else globalThis.localStorage?.removeItem(SAFE_KEY);
  } catch {
    // Storage refused (a private window): the switch holds for this visit only, as `chosen`.
  }
}

/** Forgets the choice made in this page, for a test that starts again. */
export function resetCsvSafety(): void {
  chosen = null;
}
