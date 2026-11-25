/**
 * The tools Forma's MCP server lists, in the order it lists them
 * (2026-11-24, the MCP work's wave 4; finding DOC-5 of the 2026-11-23 design
 * audit). A pure list with no SDK import, so a test of the public pages and
 * the README can read it without starting a server: formaServer.ts registers
 * from it, in this order (the spec asks for a deterministic list), and its
 * test holds each tool's read-only hint to `readOnly` here, its open-world
 * hint to `openWorld` and each description to `needsAi`.
 *
 * - `readOnly`: the tool reads and writes no file but the one it reads, so
 *   Claude Code may run it beside other read-only calls.
 * - `needsAi`: the tool calls an AI and spends the user's own quota: since
 *   wave 8 (2026-11-24), generate_report and revise_report (aiTools.ts),
 *   which refuse with what to set while no AI is set up for the server.
 * - `openWorld`: the tool may reach something off this computer (since the
 *   CLI and Forma Designer work's wave 7, 2026-11-25; finding MCP-1 of its
 *   design audit, which found the hint tied to `needsAi`): an AI, or a SQL
 *   Server through Forma Designer, which the tools that take `connection`
 *   reach when it is given (the two AI tools, repx_edit and repx_convert).
 *   database_connections lists what Forma Designer keeps in a file on this
 *   computer and opens no connection, so it is not.
 *
 * Since that wave: repx_convert, an SSRS or FastReport report made into a
 * repaired .repx with no AI (the command line's convert, findings GAP1-1
 * and GAP1-5, the owner's OC7), and database_connections, the Forma
 * Designer connections the person lists in the server's entry
 * (databaseTools.ts; D2-11, the owner's OC6), listed on every platform,
 * since the list never changes after start-up, and refusing in words where
 * Forma Designer cannot answer.
 *
 * Pure ASCII.
 */
export interface ToolEntry {
  readonly name: string;
  readonly readOnly: boolean;
  readonly needsAi: boolean;
  readonly openWorld: boolean;
}

export const TOOL_LIST = [
  { name: 'forma_status', readOnly: true, needsAi: false, openWorld: false },
  { name: 'repx_audit', readOnly: true, needsAi: false, openWorld: false },
  { name: 'repx_outline', readOnly: true, needsAi: false, openWorld: false },
  { name: 'repx_repair', readOnly: false, needsAi: false, openWorld: false },
  { name: 'repx_edit', readOnly: false, needsAi: false, openWorld: true },
  { name: 'repx_pdf', readOnly: false, needsAi: false, openWorld: false },
  { name: 'repx_convert', readOnly: false, needsAi: false, openWorld: true },
  { name: 'database_connections', readOnly: true, needsAi: false, openWorld: false },
  { name: 'generate_report', readOnly: false, needsAi: true, openWorld: true },
  { name: 'revise_report', readOnly: false, needsAi: true, openWorld: true },
] as const satisfies readonly ToolEntry[];

export type ToolName = (typeof TOOL_LIST)[number]['name'];
