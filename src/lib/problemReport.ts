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
 */
export const ISSUES_URL = 'https://github.com/waqarsyd/forma/issues/new';

export interface ProblemReport {
  area: string;
  message: string;
  stack?: string;
  version: string;
  path?: string;
  browser?: string;
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
  const message = report.message.trim().split('\n')[0].slice(0, 120) || 'an error';
  const body = [
    'What were you doing when it happened?',
    '',
    '',
    '---',
    `Where: ${report.area}`,
    `Error: ${report.message.trim().slice(0, 600)}`,
    ...(report.stack ? ['', '```', stackHead(report.stack), '```'] : []),
    '',
    `Version: ${report.version}`,
    ...(report.path ? [`Page: ${report.path.split(/[?#]/)[0]}`] : []),
    ...(report.browser ? [`Browser: ${report.browser}`] : []),
  ].join('\n');
  return `${ISSUES_URL}?${new URLSearchParams({ title: `Problem in ${report.area}: ${message}`, body, labels: 'bug' }).toString()}`;
}
