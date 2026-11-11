/**
 * The Preview's test rows, asked for once (2026-11-11, batch PXB's PX-28).
 *
 * Lazy, like lib/batchRun.ts, because the workspace chunk has no room: the
 * call and the field types left App.tsx when the request gained a way to be
 * stopped. The rows are stopped by their own controller, which the Preview's
 * "Stop" button aborts while they are being written; that is the only way to
 * reach them from the page, since a chat tool asks for them after its turn has
 * ended and the Preview's button and the command menu are outside any turn.
 * The chat turn that asked (`turn`) stops them too, while it is still live.
 */
import { generateTestData, type ReportConfig } from '../services/geminiService';
import { fieldTypes } from './sqlPreview';
import type { SqlSchema } from './sqlSchema';
import type { ReportQuery } from './sqlQuery';

/** How many rows one request asks for: DevExpress's preview shows about as many. */
export const TEST_ROWS = 20;

/** `stop` aborted whenever `also` is, unless `also` already was (a turn Stop ended is not the rows' business). */
export function linkStop(stop: AbortController, also?: AbortSignal | null): void {
  if (also && !also.aborted) also.addEventListener('abort', () => stop.abort(), { once: true });
}

export async function runTestData(
  fields: readonly string[],
  about: { title?: string; description?: string },
  database: SqlSchema | null,
  query: ReportQuery | null,
  config: ReportConfig | undefined,
  signal: AbortSignal,
) {
  // Each field's SQL type, when a database says it, so the rows come as it holds them (batch DF).
  const types = database && query ? fieldTypes(database, query) : undefined;
  return generateTestData(fields, { ...about, types }, TEST_ROWS, config, signal);
}
