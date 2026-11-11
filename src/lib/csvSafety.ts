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
 * the panel or the chat asked for the file. Unreadable storage means off.
 */
const SAFE_KEY = 'forma.csvSafeForSpreadsheets';

/** Whether this browser asked for CSV safe for spreadsheets. */
export function csvSafetyPreferred(): boolean {
  try {
    return globalThis.localStorage?.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember, in this browser, whether CSV is written safe for spreadsheets. */
export function preferCsvSafety(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(SAFE_KEY, '1');
    else globalThis.localStorage?.removeItem(SAFE_KEY);
  } catch {
    // Storage refused (a private window): the switch holds for this visit only.
  }
}
