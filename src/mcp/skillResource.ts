/**
 * The REPX skill, docs/skills/devexpress-repx/SKILL.md, served by Forma's
 * MCP server (2026-11-24, the MCP work's wave 4; findings PROTO-11 and GAP2-5
 * of the 2026-11-23 design audit) through the SDK's skills extension
 * (io.modelcontextprotocol/skills), which lists it among the server's
 * resources as skill://devexpress-repx/SKILL.md and serves it to a client
 * that reads skills.
 *
 * It is served with a preface of the server's own after its frontmatter
 * (`SKILL_PREFACE`), and the file itself is left as it is (GAP2-5). The
 * skill teaches the command line, whose relative names are right in a shell
 * in the clone; a model reading it through this server would copy them into
 * tool arguments, which take only full paths (paths.ts) and refuse anything
 * else. The preface says so, gives one Windows and one POSIX path, and says
 * where the skill's links to ../../notes/gemini.md and ../../../README.md
 * lead (the second since the wave-4 review's R12): the file's links stay
 * relative, so `npm run lint:links` keeps checking them (PROTO-11).
 *
 * The catalog is built once, from memory, when the server starts, and one
 * catalog serves every connection (`attach` on each server instance). Its
 * warnings go to the log, which is stderr.
 *
 * Pure ASCII; the skill's own text is served as it is written.
 */
import { readFileSync } from 'node:fs';
import { SkillsExtension, memorySkillFiles, type SkillCatalog } from '@modelcontextprotocol/server/ext/skills';

/** The skill's folder name, which its frontmatter's name must equal. */
export const SKILL_NAME = 'devexpress-repx';

/** Where a client reads it. */
export const SKILL_URI = `skill://${SKILL_NAME}/SKILL.md`;

/** What the server says ahead of the skill's own text. */
export const SKILL_PREFACE = [
  "> **Served by Forma's MCP server.** Its tools take full paths only: G:\\Reports\\invoice.repx on Windows, /home/me/reports/invoice.repx elsewhere. A relative name, ~ or a Git Bash /g/... path is refused.",
  '> repx_audit, repx_repair and repx_pdf do what the command lines below do; those lines are for a shell in a clone of Forma, where relative names are right. repx_repair, repx_edit and repx_pdf name the file they wrote; repx_audit and repx_outline write none.',
  '> The links to ../../notes/gemini.md and ../../../README.md lead to docs/notes/gemini.md and README.md in that clone.',
].join('\n');

/** The skill as served: its frontmatter, the preface, then the rest of the file unchanged. */
export function servedSkill(text: string): string {
  const front = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  if (!front) throw new Error('SKILL.md has no frontmatter');
  return `${front[0]}\n${SKILL_PREFACE}\n${text.slice(front[0].length)}`;
}

/** The skill's text as the clone holds it. */
export function skillText(): string {
  return readFileSync(new URL(`../../docs/skills/${SKILL_NAME}/SKILL.md`, import.meta.url), 'utf8');
}

/** The catalog every connection's server attaches; problems with the skill go to `log`. */
export function loadRepxSkill(log: (line: string) => void, options: { strict?: boolean } = {}): Promise<SkillCatalog> {
  return SkillsExtension.load(memorySkillFiles({ [`${SKILL_NAME}/SKILL.md`]: servedSkill(skillText()) }), {
    strict: options.strict ?? false,
    onWarning: (warning) => log(`the REPX skill: ${warning.path}: ${warning.message}`),
  });
}
