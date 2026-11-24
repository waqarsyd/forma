/**
 * The commands of Forma's command line, in the order its help lists them
 * (2026-11-24, the CLI and Forma Designer work's wave 4; findings CLI-1,
 * GAP1-2 and TEST-1 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`). A pure list
 * with no import, as toolList.ts is for the MCP server's tools, so a test of
 * the public pages can read it without loading the command line: its docs
 * wave is to hold the README, the Docs page and the REPX skill to it, and to
 * the launcher below.
 *
 * - `needsAi`: the command calls the AI set up in the environment the
 *   command runs in and spends the person's own quota, so it checks that an
 *   AI is set up before it reads any file and exits 3 when none is (CLI-7);
 *   the others never look, so the job CI runs on a fork's pull request, which
 *   is given no secret, can audit every report (GAP1-2). `'by route'`: the
 *   batch, which asks the AI only for the files whose route needs one
 *   (folderBatch.ts), and checks the gate before reading any file only when
 *   one does.
 * - `usage`: what follows the command's name, its inputs and its own
 *   options; `says`: what it does, in one sentence a person reads in its help.
 * - `options`: the options it takes beside `--json`, `--verbose` and
 *   `--help`, which every command takes; commandLine.ts refuses any other as a usage
 *   error (exit 2).
 * - `soon`: registered and not built yet, so it is refused as a usage error
 *   and the help says so. None is since the same wave's second part built
 *   `convert` and `batch`; the field stays for the commands its later waves
 *   register before they are built.
 *
 * `CLI_LAUNCHER` is the launcher's path in the clone. The documented command
 * is `node <clone>/src/mcp/cli.mjs <command> ...`, from any folder (cli.mjs
 * says why plain node and never npx or the tsx CLI); commandLine.test.ts spawns
 * exactly that.
 *
 * Pure ASCII.
 */
export interface CliCommand {
  readonly name: string;
  readonly needsAi: boolean | 'by route';
  readonly usage: string;
  readonly says: string;
  readonly options: readonly string[];
  readonly soon?: true;
}

/** The launcher, relative to the clone, run with plain node. */
export const CLI_LAUNCHER = 'src/mcp/cli.mjs';

export const CLI_COMMANDS = [
  {
    name: 'audit',
    needsAi: false,
    usage: '<file|folder>...',
    says: 'Checks a report (.repx or .vsrepx), or every report directly in a folder, as Forma checks the reports it makes, and lists what is still wrong; writes nothing.',
    options: ['--fail-on'],
  },
  {
    name: 'outline',
    needsAi: false,
    usage: '<file>',
    says: "Prints a report as Forma's chat is shown it: the paper, every band, every control by the name edit takes, the fields it prints, and its data sources by connection name only.",
    options: [],
  },
  {
    name: 'repair',
    needsAi: false,
    usage: '<file> [--out <file|folder>] [--force]',
    says: 'Runs every repair Forma makes on the reports it generates, in the same order, and writes <name>.repaired.repx with the audit of the result.',
    options: ['--out', '--force', '--fail-on'],
  },
  {
    name: 'pdf',
    needsAi: false,
    usage: '<file> [--out <file|folder>] [--force]',
    says: "Draws a report as a draft PDF, laid out by the engine of Forma's Preview with no data, and writes <name>.pdf.",
    options: ['--out', '--force'],
  },
  {
    name: 'edit',
    needsAi: false,
    usage: '<file> --edits <edits.json|json> [--out <file|folder>] [--force]',
    says: "Makes the edits Forma's chat makes, by control name, each a splice of the file, and writes <name>.edited.repx.",
    options: ['--edits', '--out', '--force', '--fail-on'],
  },
  {
    name: 'convert',
    needsAi: false,
    usage: '<file|folder>... [--out <file|folder>] [--force]',
    says: 'Makes an SSRS (.rdl, .rdlc) or FastReport (.frx) report, or every one directly in a folder, into a repaired .repx with no AI, as DevExpress 20.1 writes one, and writes <name>.converted.repx with the audit of the result.',
    options: ['--out', '--force', '--fail-on'],
  },
  {
    name: 'generate',
    needsAi: true,
    usage: '[<file>...] [--description "..."] [--data <file>]... [--out <file|folder>] [--force] [--allow-stand-in] [--mock]',
    says: "Makes a report as Forma's workspace makes one, from pictures, PDFs, a report or template to start from, and/or a description, and writes <first file>.generated.repx.",
    options: ['--description', '--data', '--out', '--force', '--allow-stand-in', '--mock', '--fail-on'],
  },
  {
    name: 'revise',
    needsAi: true,
    usage: '<file> --words "..." [--edits-only] [--out <file|folder>] [--force] [--mock]',
    says: "Changes a report as a request in words asks, as Forma's chat does, by control name where it can, and writes <name>.revised.repx; a question is answered and nothing written.",
    options: ['--words', '--edits-only', '--out', '--force', '--mock', '--fail-on'],
  },
  {
    name: 'batch',
    needsAi: 'by route',
    usage:
      '<folder> --out <folder> [--words "..."] [--description "..."] [--data <file>]... [--repair] [--edits-only] [--skip-existing | --force] [--allow-stand-in] [--dry-run] [--max <n>] [--mock]',
    says: 'Makes every report source in a folder and its subfolders, one file at a time, each in a thread of its own: pictures and PDFs generated, SSRS and FastReport reports converted (and revised with --words), reports revised with --words or repaired with --repair; writes each under --out, its subfolder kept, and ends with a summary. Only the files whose route needs one ask the AI.',
    options: ['--out', '--words', '--description', '--data', '--repair', '--edits-only', '--skip-existing', '--force', '--allow-stand-in', '--dry-run', '--max', '--mock', '--fail-on'],
  },
] as const satisfies readonly CliCommand[];

export type CliCommandName = (typeof CLI_COMMANDS)[number]['name'];
