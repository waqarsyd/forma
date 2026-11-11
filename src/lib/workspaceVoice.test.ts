/**
 * A guard for the owner's first rule (2026-11-11, the full audit's TC-01):
 * the chat and every workspace message say results in plain words and never
 * describe the machinery behind them. Until this file one test held it, on
 * one function (formaTeam.test.ts, `fallbackReply`), and the audit found the
 * rule broken in a dozen places that test could not see: revisions labelled
 * "Forma's box reader", replies that "Read X with Forma's vision model", an
 * error about "REPX that no designer will open".
 *
 * It reads the source rather than rendering it, because these strings are
 * scattered through App.tsx's handlers, most of which no test can reach. Two
 * shapes put words in front of the person, and both are read:
 *
 * - a call of a speaker (`say`, `recordRevision`, `setTeamStage`, `setError`,
 *   a notice or toast setter, a notice pushed onto a list): the string
 *   literals in its arguments;
 * - a `text:` property, which is how a reply is posted
 *   (`setMessages(prev => [...prev, { role: 'assistant', text: ... }])`):
 *   the string literals in its value.
 *
 * A template literal's fixed parts count, and each must name none of the
 * words below. A value that is a variable is not seen; the function that
 * makes the words has its own test (fallbackReply, rememberedReply,
 * checksMarkdown, ocrSummary and the rest).
 *
 * The public pages are not read: they explain how Forma works, and saying
 * "OCR" there is describing the product, not narrating a run. A hit that is
 * right goes in ALLOWED with the reason; a new one fails the suite.
 *
 * Proven against the tree before the audit's VO1 batch (`890b688`,
 * 2026-11-11): run over that tree's App.tsx and components it found 7 hits,
 * all in App.tsx (`recordRevision("Forma's box reader")`, `"Forma's vision
 * model"` and `"Forma's own draft"`, `setTeamStage("Forma's vision model is
 * reading the layout")`, the vision model's two `say(...)` and a `setError`
 * offering "to repair by hand"), and over the tree after it none.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import RevisionsPanel from '../components/RevisionsPanel';
import type { Revision } from './revisions';

/** The words that describe the machinery rather than the result. */
const MACHINERY = /\b(OCR|box reader|vision model|own draft|tokens?|REPX checks?|repair|the model|companion)\b/i;

/** The calls whose words reach the person. */
const SPEAKERS = /\b(say|recordRevision|setTeamStage|setError|setSaveNotice|setNotice|setToast|showToast|toast|notices\.push)\(/g;

/** The property a posted reply carries its words in. */
const REPLY_TEXT = /\btext:\s*/g;

/** Files that are not the workspace: the public site and its copy. */
const PUBLIC = /^(DocsPage|FeaturesPage|LegalPage|LandingPage|InfoPage|infoPages|faqs|ChangelogPage|docsCorpus|publicPages|SiteHeader|SiteFooter|MobileNav|SharedReportPage|LoginPage|ContactPage)\.tsx$/;

/**
 * Hits that are right, by file and the literal's text, with why. Empty is the
 * goal; an entry is a decision, not a convenience, and one that no longer
 * matches a hit fails the suite.
 */
const ALLOWED: readonly { file: string; text: RegExp; why: string }[] = [];

/** The workspace's source files: App.tsx and every component that is not a public page. */
function workspaceFiles(): string[] {
  const components = readdirSync('src/components')
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !PUBLIC.test(f))
    .map((f) => join('src/components', f));
  return ['src/App.tsx', ...components];
}

/** The characters after which a "/" starts a regular expression rather than dividing. */
const BEFORE_REGEX = '(,=:[!&|?{};+-*%~^';

/**
 * Where the string, comment or regular expression that starts at `at` ends,
 * or -1 when none starts there. A regular expression is told from a division
 * by the code before it, as a JavaScript parser tells them: `/\(/` or `/it's/`
 * read as code would throw a bracket count off or open a string that is not
 * there, and every call after it would be misread.
 */
function skipAt(source: string, at: number): number {
  const ch = source[at];
  if (ch === '"' || ch === "'" || ch === '`') return endOfString(source, at);
  if (ch !== '/') return -1;
  if (source[at + 1] === '/') {
    const nl = source.indexOf('\n', at);
    return nl < 0 ? source.length : nl;
  }
  if (source[at + 1] === '*') {
    const end = source.indexOf('*/', at + 2);
    return end < 0 ? source.length : end + 2;
  }
  let j = at - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  const regex =
    j < 0 ||
    BEFORE_REGEX.includes(source[j]) ||
    (source[j] === '>' && source[j - 1] === '=') ||
    /\breturn$/.test(source.slice(Math.max(0, j - 6), j + 1));
  return regex ? endOfRegex(source, at) : -1;
}

/** The index just past the regular expression that starts at `at`, its flags included. */
function endOfRegex(source: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    // A regular expression never crosses a line: this was a division after all.
    if (ch === '\n') return at + 1;
    if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') inClass = true;
    else if (ch === '/') {
      i++;
      while (/[a-z]/i.test(source[i] ?? '')) i++;
      return i;
    }
    i++;
  }
  return at + 1;
}

/** The index just past the string literal that starts at `at`; a template's `${...}` is skipped whole. */
function endOfString(source: string, at: number): number {
  const quote = source[at];
  let i = at + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      i = endOfPlaceholder(source, i + 2);
      continue;
    }
    i++;
  }
  return i;
}

/** The index just past the `}` that closes a template's `${`, from just after it. */
function endOfPlaceholder(source: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const skip = skipAt(source, i);
    if (skip >= 0) {
      i = skip;
      continue;
    }
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  return i;
}

/** The text of a call's arguments, from just after its "(" to its matching ")", strings, comments and regular expressions skipped over. */
function argumentsAt(source: string, open: number): string {
  let depth = 1;
  let i = open;
  while (i < source.length && depth > 0) {
    const skip = skipAt(source, i);
    if (skip >= 0) {
      i = skip;
      continue;
    }
    if (source[i] === '(') depth++;
    if (source[i] === ')') depth--;
    i++;
  }
  return source.slice(open, i - 1);
}

/** A property's value, from `start` to the `,`, `;` or closing bracket that ends it. */
function valueAt(source: string, start: number): string {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const skip = skipAt(source, i);
    if (skip >= 0) {
      i = skip;
      continue;
    }
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) break;
    i++;
  }
  return source.slice(start, i);
}

/** The string literals in a piece of source, a template's fixed parts joined with "…"; comments and regular expressions are not literals. */
function literalsIn(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = endOfString(code, i);
      const body = code.slice(i + 1, end - 1);
      out.push(ch === '`' ? stripPlaceholders(body) : body);
      i = end;
      continue;
    }
    const skip = skipAt(code, i);
    i = skip >= 0 ? skip : i + 1;
  }
  return out;
}

/** A template literal's fixed text, each `${...}` replaced by "…". */
function stripPlaceholders(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\') {
      out += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (body[i] === '$' && body[i + 1] === '{') {
      i = endOfPlaceholder(body, i + 2);
      out += '…';
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

/**
 * Whether `at` sits in a comment: after `//` on its line, or on a line that
 * opens a block comment or continues one with `*`. A block comment is not
 * tracked across lines, since `accept="image/*"` would open one that never
 * closes and hide every reply after it; a comment line this misses can only
 * fail the suite, never pass it.
 */
function inComment(source: string, at: number): boolean {
  const prefix = source.slice(source.lastIndexOf('\n', at - 1) + 1, at);
  return /(^|[^:\\])\/\//.test(prefix) || /^\s*(\*|\/\*|\{\/\*)/.test(prefix);
}

interface Hit {
  file: string;
  line: number;
  speaker: string;
  text: string;
}

/** Every literal a speaker is called with or a reply's `text:` holds, where it names the machinery. */
function machineryIn(file: string, source = readFileSync(file, 'utf8')): Hit[] {
  const path = file.replace(/\\/g, '/');
  const hits: Hit[] = [];
  const read = (at: number, speaker: string, code: string) => {
    for (const text of literalsIn(code)) {
      if (MACHINERY.test(text)) hits.push({ file: path, line: source.slice(0, at).split('\n').length, speaker, text });
    }
  };
  for (const m of source.matchAll(SPEAKERS)) {
    if (!inComment(source, m.index!)) read(m.index!, m[1], argumentsAt(source, m.index! + m[0].length));
  }
  for (const m of source.matchAll(REPLY_TEXT)) {
    if (!inComment(source, m.index!)) read(m.index!, 'text:', valueAt(source, m.index! + m[0].length));
  }
  return hits;
}

const allowed = (h: Hit) => ALLOWED.some((a) => h.file.endsWith(a.file) && a.text.test(h.text));
const said = (h: Hit) => `${h.file}:${h.line} ${h.speaker}(${JSON.stringify(h.text)})`;

describe('the workspace says results, never machinery', () => {
  it('reads App.tsx and the workspace components, and finds what it looks for', () => {
    const files = workspaceFiles();
    expect(files).toContain('src/App.tsx');
    expect(files.some((f) => f.endsWith('RevisionsPanel.tsx'))).toBe(true);
    expect(files.some((f) => /DocsPage|LandingPage/.test(f))).toBe(false);
    // The scanner itself: a literal in a call, a template's fixed text, a nested call's words.
    const sample = "say(`Read \"${t}\" with Forma's vision model`, x); recordRevision('From your page', r); setError(f('the OCR failed'));";
    const found = [...sample.matchAll(SPEAKERS)].flatMap((m) => literalsIn(argumentsAt(sample, m.index! + m[0].length)));
    expect(found).toEqual(["Read \"…\" with Forma's vision model", 'From your page', 'the OCR failed']);
    expect(found.filter((t) => MACHINERY.test(t))).toHaveLength(2);
  });

  it('reads a posted reply, and is not thrown by a regular expression or a comment', () => {
    const source = [
      "setMessages(prev => [...prev, { id: 1, role: 'assistant', text: `Built ${t} with Forma's box reader.`, result }]);",
      // A regular expression with a quote and a bracket in it, then a speaker after it on the same line.
      "const n = s.replace(/it's \\(/g, ''); say('Read by OCR');",
      // A division is not a regular expression: the quote after it still opens a string.
      "const half = a / 2; say(`${half} done by the model`);",
      '// say("a comment about OCR is not a reply")',
      '/* text: "nor is this, with the box reader" */',
      "const reply = { text: draftToText(k), readBy: 'not a reply' };",
    ].join('\n');
    expect(machineryIn('sample.tsx', source).map((h) => [h.line, h.speaker, h.text])).toEqual([
      [2, 'say', 'Read by OCR'],
      [3, 'say', '… done by the model'],
      [1, 'text:', "Built … with Forma's box reader."],
    ]);
  });

  it('names no part of Forma in a reply, a revision, an error or a notice', () => {
    const hits = workspaceFiles().flatMap((f) => machineryIn(f)).filter((h) => !allowed(h));
    expect(hits.map(said), hits.map(said).join('\n')).toEqual([]);
  });

  it('keeps every allowance in use', () => {
    // An allowance nothing needs is a hole left open: remove it.
    const hits = workspaceFiles().flatMap((f) => machineryIn(f));
    for (const a of ALLOWED) {
      expect(hits.some((h) => h.file.endsWith(a.file) && a.text.test(h.text)), `${a.file} ${a.text}`).toBe(true);
    }
  });
});

describe("a revision's label", () => {
  const revision = (id: number, label: string): Revision => ({
    id,
    label,
    at: Date.UTC(2026, 10, 11, 10, 15),
    snapshot: { content: '', repxContent: `<r${id}/>`, title: 'Invoice' },
  });
  const shown = (label: string) => renderToString(createElement(RevisionsPanel, { revisions: [revision(1, label)], onRestore: () => {} }));

  // Labels saved before 2026-11-11 named the part of Forma that made them; a saved project keeps them.
  it('reads the labels a saved project still carries in plain words', () => {
    expect(shown("Forma's box reader")).toContain('From your page');
    expect(shown("Forma's vision model")).toContain('From your page');
    expect(shown("Forma's own draft")).toContain('First version');
    expect(shown('Read from the page')).toContain('Your page as printed');
    expect(shown(`Restored "Forma's box reader"`)).toContain('Restored &quot;From your page&quot;');
    for (const old of ["Forma's box reader", "Forma's vision model", "Forma's own draft"]) {
      expect(shown(old)).not.toMatch(MACHINERY);
    }
    // A label already in plain words is shown as it is.
    expect(shown('Changed in the chat')).toContain('Changed in the chat');
  });

  it('shows the time and no count of the file', () => {
    const html = shown('Generated');
    expect(html).not.toMatch(/chars|characters/);
    expect(renderToString(createElement(RevisionsPanel, { revisions: [], onRestore: () => {} }))).toContain('Every report, redesign and data binding');
  });
});
