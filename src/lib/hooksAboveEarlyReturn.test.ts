/**
 * Every hook in App stays above its one early return (2026-11-12).
 *
 * App draws the public pages and the workspace from one component, and returns
 * the public page early (`if (!showWorkspace) {`). A hook written below that line
 * runs only once the workspace shows, so the first render that crosses from a
 * public page into the workspace calls one hook more than the render before it,
 * and React throws "Rendered more hooks than during the previous render": the
 * error boundary replaces the whole workspace. That is what happened on
 * 2026-11-12, when Go to's state (put below the line on 2026-11-11, R1-10) took
 * the workspace down on every load in development, and no test noticed, because
 * nothing renders App. This reads the source instead, as workspaceVoice.test.ts
 * and focusRules.test.ts do.
 *
 * A comment or a string naming a hook is not a call, so comment lines are
 * skipped; the scan is from the early return to App's closing brace, which is
 * the first line after it that is a bare `}` at column 0.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const EARLY_RETURN = /^ {2}if \(!showWorkspace\) \{/;
const HOOK_CALL = /\buse[A-Z]\w*\s*(<[^>]*>+)?\s*\(/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/** Each `line: text` of a hook called after the early return, before the component closes. */
function hooksAfterEarlyReturn(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => EARLY_RETURN.test(l));
  if (start < 0) throw new Error('the early return was not found: update EARLY_RETURN');
  const found: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) return found;
    if (COMMENT_LINE.test(lines[i])) continue;
    if (HOOK_CALL.test(lines[i])) found.push(`${i + 1}: ${lines[i].trim()}`);
  }
  throw new Error("App's closing brace was not found after the early return");
}

describe('hooks above App’s early return', () => {
  it('finds a hook below the line, with or without a type argument, and ignores comments', () => {
    const source = [
      'export default function App() {',
      '  const [a] = useState(0);',
      '  if (!showWorkspace) {',
      '    return null;',
      '  }',
      '  // useEffect( in a comment is not a call',
      '  const [goTo, setGoTo] = useState<[string, string][]>([]);',
      '  useEffect(() => {}, []);',
      '  return null;',
      '}',
    ].join('\n');
    expect(hooksAfterEarlyReturn(source)).toEqual([
      '7: const [goTo, setGoTo] = useState<[string, string][]>([]);',
      '8: useEffect(() => {}, []);',
    ]);
  });

  it('App.tsx calls no hook after `if (!showWorkspace)`', () => {
    expect(hooksAfterEarlyReturn(readFileSync('src/App.tsx', 'utf8'))).toEqual([]);
  });
});
