/**
 * "Report this problem" (2026-11-08, site audit item 64): a GitHub issue
 * prefilled with what broke, where, and in which build, which the person
 * reads and files themselves. The site has no server to send an error to,
 * and a free error collector would hand each report, and whatever its
 * message holds, to a third party; this way nothing leaves until a person
 * looks at it and presses Submit.
 *
 * What it carries: the area, the error's message, the first lines of its
 * stack (file and line, no data), the build (lib/buildInfo.ts), the page's
 * path without its query, and the browser. Not the report, the conversation
 * or the key, which the error boundary never sees.
 *
 * Through the bug form since 2026-11-11 (full audit PS-15 and SE-15). A plain
 * `?title=&body=` link met blank issues being off (.github/ISSUE_TEMPLATE/
 * config.yml), and GitHub sends anyone who is not a collaborator to the
 * template chooser with what was prefilled gone. A form named by `template`
 * fills each field from the parameter of its id, so the parameters below are
 * bug-report.yml's ids: rename one there and it fills nothing, silently.
 * Two things may not reach a public issue even though the error boundary
 * passes them on: a shared report's id, which is the link itself (the path
 * says `/s/(a shared report)`), and an API key an error message happened to
 * quote (Gemini's or OpenRouter's, said as "(a key)").
 */
const ISSUES_URL = 'https://github.com/waqarsyd/forma/issues/new';
/** The issue form it opens, and the ids of the fields it fills. */
export const BUG_TEMPLATE = 'bug-report.yml';

export interface ProblemReport {
  area: string;
  message: string;
  stack?: string;
  version: string;
  path?: string;
  browser?: string;
}

// Both of AI Studio's Gemini key formats (2026-11-12): AIza… and the newer AQ.…
// (about 53 characters), which this missed until then.
const KEYS = /AIza[0-9A-Za-z_-]{35}|\bAQ\.[A-Za-z0-9._-]{20,}|sk-or-v1-[0-9a-f]+/g;

/** Text with any Gemini or OpenRouter key in it said as "(a key)". */
export function withoutKeys(text: string): string {
  return text.replace(KEYS, () => '(a key)');
}

/** A page's path for a public issue: no query or fragment, and a shared report's id not named. */
export function publicPath(path: string): string {
  return withoutKeys(path.split(/[?#]/)[0]).replace(/^\/s\/[^/]+/, () => '/s/(a shared report)');
}

/** A stack's first lines, with any query string or fragment cut from its addresses. */
export function stackHead(stack: string | undefined, lines = 6): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .slice(0, lines)
    .map((line) => line.replace(/\?[^\s:)]*/g, '').replace(/#[^\s:)]*/g, '').trimEnd())
    .join('\n');
}

export function problemReportUrl(report: ProblemReport): string {
  const said = withoutKeys(report.message.trim());
  const message = said.split('\n')[0].slice(0, 120) || 'an error';
  const where = [`Where: ${report.area}`, ...(report.path ? [`Page: ${publicPath(report.path)}`] : [])].join('\n');
  const stack = report.stack ? withoutKeys(stackHead(report.stack)) : '';
  const fields: Record<string, string> = {
    template: BUG_TEMPLATE,
    title: `Problem in ${report.area}: ${message}`,
    // "What happened, and what you expected": the person writes the rest.
    what: `${where}\n\nWhat were you doing when it happened?\n`,
    error: said.slice(0, 600),
    version: report.version,
  };
  if (stack) fields.console = stack;
  if (report.browser) fields.env = report.browser;
  return `${ISSUES_URL}?${new URLSearchParams(fields).toString()}`;
}
