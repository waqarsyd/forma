/**
 * forma_status, the one tool of the MCP server's first wave (2026-11-24):
 * what this server is and may do, so a host's model, or a person setting the
 * server up, can see it working before any report tool exists. It reads no
 * file and calls no AI, and it never returns a key or any other secret: the
 * server holds none in this wave, and the result is built only from the
 * version, the request's era and the folders in effect.
 *
 * The folders are worked out exactly as a file tool works them out
 * (roots.ts), so on a 2026-07-28 client that declared roots this tool asks
 * for them first, like any other; what it reports is what a file tool would
 * use, or the reason there is none, with each host's recipe.
 *
 * Pure ASCII.
 */
import * as z from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { AskClient, defineTool, type ToolDeps } from './toolShape';

const SOURCES = ['FORMA_MCP_ROOTS', 'client', 'CLAUDE_PROJECT_DIR'] as const;

export const STATUS_DESCRIPTION =
  "What this Forma server is and may do: Forma's version, the protocol revision this request came in on, and the folders its tools may read and write, with where they came from, or why there are none and how to set one. It reads no file, calls no AI, and never returns a key or any other secret. Call it first when a path is refused as outside the folders.";

/** Puts forma_status on `server`. */
export function registerStatus(server: McpServer, deps: ToolDeps, info: { version: string }): void {
  defineTool(
    server,
    deps,
    {
      name: 'forma_status',
      title: "Forma's status",
      description: STATUS_DESCRIPTION,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      input: {},
      output: {
        name: z.literal('forma'),
        version: z.string(),
        protocol: z.looseObject({ era: z.enum(['modern', 'legacy']), version: z.string() }),
        folders: z.looseObject({
          source: z.enum(SOURCES).nullable(),
          paths: z.array(z.string()),
          why: z.string().optional(),
          notes: z.array(z.string()),
        }),
      },
    },
    async (_args, tc) => {
      const found = await tc.roots();
      // The wrapper returns the question; the client retries with its roots.
      if (found.kind === 'ask') throw new AskClient(found.result);
      const protocol = { era: tc.era.era, version: tc.era.protocolVersion };
      const over = tc.era.era === 'modern' ? `MCP ${protocol.version}` : `MCP ${protocol.version}, a 2025-era connection`;
      // Each folder as it was spelled; a note beside it names where it really is when a link leads elsewhere.
      const folders =
        found.kind === 'roots'
          ? { source: found.source, paths: found.roots.map((root) => root.path), notes: found.notes }
          : { source: null, paths: [], why: found.why, notes: found.notes };
      const where =
        found.kind === 'roots'
          ? `Its tools may use ${found.roots.length === 1 ? 'one folder' : `${found.roots.length} folders`}, from ${found.source === 'client' ? "the client's roots" : found.source}.`
          : 'No folder is set for its tools; "why" says how to set one.';
      return { summary: `Forma ${info.version}, over ${over}. ${where}`, data: { name: 'forma' as const, version: info.version, protocol, folders } };
    },
  );
}
