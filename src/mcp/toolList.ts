/**
 * The tools Forma's MCP server lists, in the order it lists them
 * (2026-11-24, the MCP work's wave 4; finding DOC-5 of the 2026-11-23 design
 * audit). A pure list with no SDK import, so a test of the public pages and
 * the README can read it without starting a server: formaServer.ts registers
 * from it, in this order (the spec asks for a deterministic list), and its
 * test holds each tool's read-only hint to `readOnly` here and each
 * description to `needsAi`.
 *
 * - `readOnly`: the tool reads and writes no file but the one it reads, so
 *   Claude Code may run it beside other read-only calls.
 * - `needsAi`: the tool calls an AI and spends the user's own quota. None
 *   does yet; the generation tools come later.
 *
 * Pure ASCII.
 */
export interface ToolEntry {
  readonly name: string;
  readonly readOnly: boolean;
  readonly needsAi: boolean;
}

export const TOOL_LIST = [
  { name: 'forma_status', readOnly: true, needsAi: false },
  { name: 'repx_audit', readOnly: true, needsAi: false },
  { name: 'repx_outline', readOnly: true, needsAi: false },
  { name: 'repx_repair', readOnly: false, needsAi: false },
  { name: 'repx_edit', readOnly: false, needsAi: false },
  { name: 'repx_pdf', readOnly: false, needsAi: false },
] as const satisfies readonly ToolEntry[];

export type ToolName = (typeof TOOL_LIST)[number]['name'];
