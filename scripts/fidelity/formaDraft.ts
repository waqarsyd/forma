/**
 * Forma's own draft of a case with no AI asked, as the fidelity benchmark's
 * `--forma` scores it and a replay's coverage reads it (scripts/fidelity/run.ts).
 * Moved out of run.ts on 2026-11-24 (the wave-10 review's R3): run.ts runs
 * its `main` when it is imported, so no test could call its code, and
 * src/mcp/nodeMakeReport.test.ts held a copy of these steps instead, which a
 * change here would not have failed. Both now call this module, which does
 * nothing when it is imported.
 *
 * It takes the core's parts as given (the MCP server's Node parts in the
 * runner, src/mcp/nodeGeneration.ts, and the test's own), so it imports
 * nothing from src/mcp itself. Pure ASCII.
 */
import type { ReportConfig } from '../../src/services/geminiService';
import type { AnalysisResponse } from '../../src/lib/reportTypes';
import { applyDetected, type DetectedSettings } from '../../src/lib/autoConfig';
import { asConfigured, makeReport, prepareTeam, type GenerationDeps, type IntakeDeps, type Made, type PageRead } from '../../src/lib/generationCore';
import { layoutFromRepx } from '../../src/lib/repxViews';

/**
 * Run `fn` with the console captured into `lines`, still echoed to the real
 * one. A line `skip` matches is neither kept nor echoed.
 */
export async function capturingConsole<T>(lines: string[], fn: () => Promise<T>, skip?: (line: string) => boolean): Promise<T> {
  const methods = ['log', 'warn', 'error', 'debug', 'info'] as const;
  const original = Object.fromEntries(methods.map((m) => [m, console[m]])) as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      const line = `[${m}] ${args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' ')}`;
      if (skip?.(line)) return;
      lines.push(line);
      original[m](...args);
    };
  }
  try {
    return await fn();
  } finally {
    for (const m of methods) console[m] = original[m];
  }
}

/** What the core read and worked out on a run, seen through its own parts. */
export interface Seen {
  /** Every page OCR read. */
  read: PageRead[];
  /** The settings the core last worked out, the ones its request was made with. */
  detected: DetectedSettings | null;
}

/** The core's parts, unchanged, with what they read and work out kept in `seen`. */
export function watched(deps: GenerationDeps & IntakeDeps, seen: Seen): GenerationDeps & IntakeDeps {
  return {
    ...deps,
    detect: (sources) => (seen.detected = deps.detect(sources)),
    readPages: async (pages, signal, settings, now) => {
      const read = await deps.readPages(pages, signal, settings, now);
      seen.read.push(...read);
      return read;
    },
  };
}

/** The settings a run's request was made with: the stored ones with what the core last worked out laid over them, as the core lays them. */
export const settingsOf = (config: ReportConfig, seen: Seen): ReportConfig => (seen.detected ? applyDetected(config, seen.detected) : config);

/** What the AI that is never asked says, and the words its refusal is known by in the log. */
const REFUSED = 'no AI is asked in this run (--forma, or the reading for coverage)';

/** What the request the core made carried, as the AI would have been handed it. */
export type Carried = NonNullable<Parameters<NonNullable<GenerationDeps['ask']>>[6]>;

export interface FormaDraft {
  /** The report that stands in, as the core configures it: through the repair chain, turned right to left where the page is. */
  standIn: { repxContent: string; source: string } | null;
  /** The same draft before the repair chain. */
  raw: AnalysisResponse | null;
  /** The draft the AI is asked to correct, as text; null where no reader built one. */
  correctText: string | null;
  /** The pictures the source became. */
  pictures: number;
  /** The settings the core worked out and made its request with. */
  settings: ReportConfig;
  /**
   * Whether the draft taken again, configured as the core configures a
   * stand-in, is the report that stood in; null when nothing stood in. False
   * means the before-the-chain score is of another report.
   */
  sameAsStandIn: boolean | null;
  /** What each refused request carried (the draft, the brief, OCR's evidence), in order. */
  carried: Carried[];
}

/**
 * Forma's own draft of a case, with no AI: the core run with an ask that
 * refuses, so what stands in is what the app shows when every AI has given
 * out (lib/generationCore.ts `generateReport`), and the same draft taken again
 * through the core's own `prepareTeam`, over the pages and the settings that
 * run read and worked out, before the repair chain. The two are held to each
 * other (`sameAsStandIn`).
 *
 * The core logs the refusal as an error in generation, as it logs an AI that
 * failed; that line is left out of `log` (the wave-10 review's R6), since a
 * run that asks no AI did not fail one.
 */
export async function formaDraftOf(
  parts: { deps(config: ReportConfig): GenerationDeps & IntakeDeps },
  request: { files: { file: File; uploadId: string }[]; words: string; config: ReportConfig },
  log: string[],
): Promise<FormaDraft> {
  const { config } = request;
  const seen: Seen = { read: [], detected: null };
  const carried: Carried[] = [];
  const refuse: NonNullable<GenerationDeps['ask']> = async (_words, _parts, _asked, _previous, _signal, _onProgress, options) => {
    if (options) carried.push(options);
    throw new Error(REFUSED);
  };
  const deps = { ...watched(parts.deps(config), seen), ask: refuse };
  const signal = new AbortController().signal;
  const made: Made | null = await capturingConsole(log, () => makeReport({ files: request.files, words: request.words, config, signal }, deps), (line) => line.includes(REFUSED));
  const pictures = made?.pictures ?? 0;
  const standIn = made && !made.ok && made.standIn ? { repxContent: made.standIn.result.repxContent ?? '', source: made.standIn.source } : null;
  const settings = settingsOf(config, seen);
  const team = await prepareTeam(seen.read.length ? { read: seen.read } : undefined, signal, settings, deps);
  const draft = standIn && team.draft ? await team.draft() : null;
  const raw = draft?.result.repxContent ? { markdown: draft.result.content, layout: draft.result.layout ?? layoutFromRepx(draft.result.repxContent), repxContent: draft.result.repxContent } : null;
  const sameAsStandIn = standIn ? (await asConfigured(raw?.repxContent ?? '', settings, draft?.source !== 'offline', true)) === standIn.repxContent : null;
  return { standIn, raw, correctText: team.correct?.text ?? null, pictures, settings, sameAsStandIn, carried };
}
