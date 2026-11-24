/**
 * Forma's REPX knowledge from a command line (2026-11-11, the full audit's
 * CP-12), for a person or a coding assistant working on a report outside the
 * web app. Since 2026-11-24 (the CLI and Forma Designer work's wave 4,
 * findings CLI-1 and TEST-1 of its design audit) it forwards to Forma's
 * command line, src/mcp/commandLine.ts, through its entry, so this form keeps
 * working as the REPX skill documented it:
 *
 *   npx tsx scripts/repx.ts audit  <file.repx>            what is still wrong, one finding a line
 *   npx tsx scripts/repx.ts repair <file.repx> [out.repx]  every repair Forma makes, then the audit
 *   npx tsx scripts/repx.ts pdf    <file.repx> [out.pdf]   the report's pages as Forma lays them out
 *
 * The command line is `node <clone>/src/mcp/cli.mjs <command> ...`, from any
 * folder (cli.mjs says why plain node), with every command its help lists;
 * this script takes the same, from a shell in the clone. Its one difference
 * is the old form's second argument to repair and pdf, the file to write,
 * which it hands on as `--out`. Until wave 4 it was a script of its own: it
 * read and wrote with no path rules, replaced a file silently, the input
 * included, gave a crash the exit code an audit error has (1), and, loaded
 * through a launcher, ran nothing and exited 0, since it ran only when its
 * own name was the process's script (TEST-1). The command line refuses a
 * taken name (exit 4, `--force` to replace), reads and writes through the
 * MCP server's path rules, runs each report's work in a bounded worker
 * thread, and exits 70 on an internal error.
 *
 * What each repair and finding means, and how it was measured against
 * DevExpress, is docs/skills/devexpress-repx/SKILL.md and the gemini.md
 * headings it links.
 *
 * Pure ASCII, as every script here.
 */
const [command, file, out, ...rest] = process.argv.slice(2);
// The old form's output, a second argument to repair or pdf, is the command line's --out.
if ((command === 'repair' || command === 'pdf') && file !== undefined && out !== undefined && !out.startsWith('-')) {
  process.argv.splice(2, process.argv.length - 2, command, file, '--out', out, ...rest);
}
await import('../src/mcp/cliEntry');
