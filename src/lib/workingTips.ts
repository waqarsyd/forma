/**
 * The tip above the box while Forma works (2026-11-06), as Google Stitch
 * shows one above its prompt bar during a task: one at a time, a new one
 * every few seconds, each about something the workspace really does.
 *
 * **Only write what is true.** A tip is the workspace describing itself to
 * someone waiting on it, so a tip about a feature that is gone is worse than
 * none: when a feature changes, change or remove its tip in the same commit.
 * Keys are written for a PC; `forPlatform` rewrites them for a Mac.
 */
export const WORKING_TIPS: readonly string[] = [
  'Press Ctrl+K to find any action, pane or control by name.',
  'Right-click a control on Preview to duplicate, format or delete it.',
  'Click the zoom number at the bottom right and type a size.',
  'Press ? to see every keyboard shortcut.',
  'Select controls on Preview, then ask about "these" in the box.',
  'Press ↑ in an empty box to bring back a message you sent.',
  'Export, at the top right, has every format: the .repx, PDF, Excel, Word and more.',
  "Click the report's title to rename, duplicate or delete the project.",
  'Send a message while Forma works and it waits its turn; Steer stops this and sends it.',
  "Attach a CSV, JSON or Excel file and it becomes the report's data.",
  'Start a message with "Remember" and Forma keeps it for every report.',
  'Press Ctrl+Backslash for a clean screen with the report alone.',
];

/** How long each tip stays, in milliseconds. */
export const TIP_INTERVAL_MS = 7000;

/** The tip for a count of intervals, starting from `start` and wrapping round. */
export function tipAt(start: number, step: number, tips: readonly string[] = WORKING_TIPS): string {
  const n = tips.length;
  return tips[(((start + step) % n) + n) % n];
}

/** A tip's keys as a Mac writes them: Ctrl+ as ⌘. */
export function forPlatform(tip: string, mac: boolean): string {
  return mac ? tip.replace(/Ctrl\+/g, '⌘') : tip;
}
