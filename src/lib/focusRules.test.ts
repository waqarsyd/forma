/**
 * The owner's rule on focus, held by reading the stylesheets (2026-11-11, audit TC-03).
 *
 * The rule: no orange border, outline or ring anywhere in the workspace (2026-11-06),
 * and no grey boundary or border change when something is clicked or typed into,
 * while the keyboard keeps its rings (2026-11-10, lib/inputModality.ts). Until this
 * file nothing read a stylesheet, so each break was found by looking at the page:
 * the 2026-11-11 audit found seventeen, among them a darker edge on both search
 * fields, Chrome's own ring on the Database panel's fields and an amber edge on the
 * Data tab's warnings, every one of which compiled and passed the suite.
 *
 * Two checks, over the six stylesheets and the CSS strings the Data tab, the
 * Database panel and the Preview carry inline:
 *
 * 1. A rule keyed on `:focus`, `:focus-visible` or `:focus-within` that is not gated
 *    on the keyboard (`html:not([data-modality='pointer'])`,
 *    `html:where(:not([data-modality='pointer']))` or `html[data-modality='keyboard']`)
 *    draws no border, no outline other than none, no ring shadow and no border-box
 *    gradient. A reset to the resting look (transparent, none, the outline-variant
 *    token, Tailwind's empty ring) is allowed, since that is what the pointer rules
 *    exist to write.
 * 2. No border or outline in the workspace uses an orange or amber colour: the accent
 *    and brand tokens, `--warn`, or their literal values.
 *
 * Deliberately a parser of a few dozen lines, not a CSS library: the stylesheets are
 * hand-written and plain, and a dependency to read them would be the larger risk.
 * The one allowed exception is named below with its reason.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

interface Rule { file: string; selectors: string[]; decls: Array<[string, string]> }

/** Style rules of a stylesheet, at any depth of @media or @layer; statement at-rules skipped. */
function parseCss(css: string, file: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let prelude = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ';') { prelude = ''; continue; }
    if (ch === '}') { prelude = ''; continue; }
    if (ch !== '{') { prelude += ch; continue; }
    const head = prelude.trim();
    prelude = '';
    if (head.startsWith('@')) continue; // a block at-rule: its contents are read as they come
    let depth = 1;
    let j = i + 1;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
    }
    const body = text.slice(i + 1, j - 1);
    const decls: Array<[string, string]> = [];
    for (const piece of body.split(';')) {
      const m = /^\s*(-{0,2}[a-z][a-z-]*)\s*:\s*([\s\S]*?)\s*$/i.exec(piece);
      if (m) decls.push([m[1].toLowerCase(), m[2]]);
    }
    rules.push({ file, selectors: splitSelectors(head), decls });
    i = j - 1;
  }
  return rules;
}

/** A selector list split at its top-level commas, quotes normalised to single. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The inline CSS a component carries: `<style>{`...`}</style>` or `const CSS = `...``. */
function inlineCss(source: string): string {
  const parts: string[] = [];
  for (const m of source.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)) parts.push(m[1]);
  for (const m of source.matchAll(/const CSS = `([\s\S]*?)`;/g)) parts.push(m[1]);
  return parts.join('\n');
}

const FOCUS = /:focus(?:-visible|-within)?(?![-\w])/;
const KEYBOARD_GATES = [
  "html:not([data-modality='pointer'])",
  "html:where(:not([data-modality='pointer']))",
  "html[data-modality='keyboard']",
];
const RESTING = /^(?:none|0|transparent|var\(--color-outline-variant\)|0 0 #0000)$/;
const SHADOW_TOKENS = /^(?:var\(--shadow-[a-z]+\)|var\(--inset-hi\))(?:\s*,\s*(?:var\(--shadow-[a-z]+\)|var\(--inset-hi\)))*$/;
const ORANGE = /var\(--accent|var\(--brand|var\(--warn\b|#fe6b00|#ff7d21|#b45309|#d9a95f|rgba\(\s*254\s*,\s*107\s*,\s*0|rgba\(\s*255\s*,\s*125\s*,\s*33/i;

/**
 * The one focus rule allowed to draw while ungated, until a decision changes it.
 * - The public site's ring helper: put on buttons, links and the changelog's select,
 *   none of which Chrome matches `:focus-visible` on a click (measured in the audit),
 *   and turned off inside the workspace by `.wb-root .u-focus-ring:focus-visible`.
 * A code block's Copy (components/markdown.css) was a second until its ring was gated
 * on the keyboard there, later the same day. The composer's blue-to-violet edge in the
 * panel's foot (Stitch's, which the owner asked for in b011a51) was listed until the
 * owner decided on 2026-11-12 (decision 1 of the 2026-11-11 audit) that a click does
 * not draw it: it is gated on the keyboard now, and the check below holds it there.
 */
const ALLOWED_FOCUS = new Set([
  '.u-focus-ring:focus-visible',
]);

/** What a focus selector that is not the keyboard's may not declare. */
function focusOffence([prop, value]: [string, string]): boolean {
  const v = value.replace(/\s*!important$/, '').trim();
  if (prop.startsWith('border') && !/radius|collapse|spacing|image/.test(prop)) return !RESTING.test(v);
  if (prop.startsWith('outline') && prop !== 'outline-offset') return !/^(?:none|0)\b/.test(v);
  if (prop === 'box-shadow') return !(RESTING.test(v) || SHADOW_TOKENS.test(v));
  if (prop.startsWith('--tw-ring')) return !RESTING.test(v);
  if (prop.startsWith('background')) return /border-box/.test(v);
  return false;
}

function focusViolations(rules: Rule[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!FOCUS.test(sel) || KEYBOARD_GATES.some((g) => sel.startsWith(g)) || ALLOWED_FOCUS.has(sel)) continue;
      for (const decl of rule.decls) if (focusOffence(decl)) out.push(`${rule.file}: ${sel} { ${decl[0]}: ${decl[1]} }`);
    }
  }
  return out;
}

function orangeEdges(rules: Rule[], onlyWorkspaceSelectors: boolean): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (onlyWorkspaceSelectors && !rule.selectors.some((s) => s.includes('.wb-'))) continue;
    for (const [prop, value] of rule.decls) {
      if ((prop.startsWith('border') || prop.startsWith('outline')) && ORANGE.test(value)) {
        out.push(`${rule.file}: ${rule.selectors.join(', ')} { ${prop}: ${value} }`);
      }
    }
  }
  return out;
}

const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');
const WORKSPACE_SHEETS = ['workspace.css', 'components/dialogs.css', 'components/overlays.css', 'components/ocr.css', 'components/markdown.css'];
/** The fewest rules each source is read as holding; markdown.css is one button's six. */
const minRules = (f: string) => (f === 'components/markdown.css' ? 4 : 5);
const INLINE = ['components/DataBinding.tsx', 'components/DatabasePanel.tsx', 'components/ReportPreview.tsx'];

const workspaceRules = [
  ...WORKSPACE_SHEETS.flatMap((f) => parseCss(read(f), f)),
  ...INLINE.flatMap((f) => parseCss(inlineCss(read(f)), f)),
];
const indexRules = parseCss(read('index.css'), 'index.css');

describe('the checks themselves', () => {
  it('find an ungated focus edge and pass a gated one', () => {
    const rules = parseCss(`
      @media (min-width: 1px) { .x:focus-visible { border-color: var(--ink-2); } }
      html:not([data-modality='pointer']) .y:focus-visible { border-color: var(--ink-2); }
      html[data-modality="keyboard"] .z:focus { outline: 2px solid black; }
      .a:focus { outline: none; border-radius: 4px; }
      .b:focus-within { box-shadow: var(--shadow-md); }
      .c:focus-within { box-shadow: 0 0 0 3px grey; }
      .d:focus-within { background: linear-gradient(red, red) padding-box, linear-gradient(blue, violet) border-box; }
    `, 'fixture');
    expect(focusViolations(rules)).toEqual([
      'fixture: .x:focus-visible { border-color: var(--ink-2) }',
      'fixture: .c:focus-within { box-shadow: 0 0 0 3px grey }',
      'fixture: .d:focus-within { background: linear-gradient(red, red) padding-box, linear-gradient(blue, violet) border-box }',
    ]);
  });

  it('find an orange edge and pass an orange fill', () => {
    const rules = parseCss('.wb-a { border-left: 3px solid var(--warn, #b45309); } .wb-b { background: var(--accent-wash); }', 'fixture');
    expect(orangeEdges(rules, false)).toHaveLength(1);
  });

  it('read every sheet and every inline string, so a check that matched nothing cannot pass', () => {
    for (const f of [...WORKSPACE_SHEETS, ...INLINE]) {
      expect(workspaceRules.filter((r) => r.file === f).length, f).toBeGreaterThan(minRules(f));
    }
    const focusRules = [...workspaceRules, ...indexRules].filter((r) => r.selectors.some((s) => FOCUS.test(s)));
    expect(focusRules.length).toBeGreaterThan(30);
  });
});

describe('the owner\'s focus rule in the stylesheets', () => {
  it('draws no border, outline, ring or gradient edge on a focus the keyboard did not bring', () => {
    expect(focusViolations([...workspaceRules, ...indexRules])).toEqual([]);
  });

  // 2026-11-12, the owner's decision 1 of the 2026-11-11 audit: the composer's
  // Stitch edge stays, for the keyboard only. The check above keeps a click from
  // drawing it; this one keeps the keyboard's edge from being dropped with it.
  it('lights the composer\'s blue-to-violet edge for the keyboard only', () => {
    const edge = workspaceRules.filter((r) => r.selectors.some((s) => s.endsWith('.wb-panel-foot .wb-box:not(.wb-is-locked):focus-within')));
    expect(edge.length).toBeGreaterThan(0);
    for (const r of edge) {
      for (const s of r.selectors) expect(s.startsWith("html:not([data-modality='pointer'])"), s).toBe(true);
      expect(r.decls.some(([p, v]) => p === 'background' && /border-box/.test(v))).toBe(true);
    }
  });

  it('draws no orange or amber border or outline anywhere in the workspace', () => {
    expect([...orangeEdges(workspaceRules, false), ...orangeEdges(indexRules, true)]).toEqual([]);
  });

  // 2026-11-11, audit FB-12, FB-13, FB-14: the open project, the request shown on the
  // Preview and the word chosen in the OCR review each darkened a grey edge on a click.
  it('shows a selection by a fill or the selection blue, never a grey edge', () => {
    const SELECTED = /wb-is-open|is-focus|is-selected|\[aria-current|\[aria-selected/;
    const GREY = /var\(--(?:rule-strong|ink|ink-2|ink-faint)\)/;
    const greyEdges = workspaceRules.flatMap((rule) =>
      rule.selectors.some((s) => SELECTED.test(s))
        ? rule.decls.filter(([p, v]) => (p.startsWith('border') || p.startsWith('outline')) && GREY.test(v)).map(([p, v]) => `${rule.file}: ${rule.selectors.join(', ')} { ${p}: ${v} }`)
        : [],
    );
    expect(greyEdges).toEqual([]);
  });

  // 2026-11-11, audit UI1/FB-7: both search fields opened as a grey outlined capsule.
  it('draws both search fields as a fill with no edge at rest', () => {
    for (const name of ['.wb-chat-search', '.wb-panel-search']) {
      const base = workspaceRules.filter((r) => r.selectors.includes(name));
      const border = base.flatMap((r) => r.decls).filter(([p]) => p === 'border' || p === 'border-color').map(([, v]) => v);
      expect(border.length, name).toBeGreaterThan(0);
      for (const v of border) expect(v, name).toMatch(/transparent|^0$|^none$/);
    }
  });

  // 2026-11-11, audit FB-2, FB-3, FB-5, FB-8: each drew Chrome's ring, or its own, on a click.
  it('turns the ring off on the fields and dialogs that show focus some other way', () => {
    const outlineOf = (sel: string) =>
      workspaceRules.filter((r) => r.selectors.includes(sel)).flatMap((r) => r.decls).filter(([p]) => p === 'outline').map(([, v]) => v);
    for (const sel of ['.dbx-input', '.db-paste', '.rp-textedit', '.wb-root .wb-keys:focus-visible', '.wb-root .wb-share:focus-visible']) {
      expect(outlineOf(sel), sel).toContain('none');
    }
  });

  // Found in review on 2026-11-11: FB-4 turned the lookup list's ring off and
  // darkened only the input's underline, so a Tab onto the list showed nothing.
  // Taking a ring away is only half of the rule; the keyboard has to get one back.
  it('gives the keyboard an indicator back wherever a field\'s own ring is turned off', () => {
    const keyboardRule = (sel: string) =>
      workspaceRules.some((r) => r.decls.length > 0 && r.selectors.some((s) => s.startsWith("html[data-modality='keyboard']") && s.endsWith(sel)));
    for (const sel of ['.rp-param input:focus-visible', '.rp-param select:focus-visible', '.db-paste:focus-visible', '.wb-ctl:focus-visible']) {
      expect(keyboardRule(sel), sel).toBe(true);
    }
    const cmd = workspaceRules.filter((r) => r.selectors.some((s) => KEYBOARD_GATES.some((g) => s.startsWith(g)) && s.endsWith('.wb-cmd-search:focus-within')));
    expect(cmd.flatMap((r) => r.decls).some(([p]) => p === 'box-shadow'), '.wb-cmd-search').toBe(true);
  });

  // 2026-11-11, audit FB-9: the form focuses the first bad field after a failed
  // submit, and the click reset turned its red edge grey as the person began fixing it.
  it('leaves a flagged public field its red edge when it is clicked', () => {
    const resets = indexRules.filter((r) => r.decls.some(([p]) => p === 'border-color'))
      .flatMap((r) => r.selectors)
      .filter((s) => s.includes('.landing') && FOCUS.test(s) && !s.startsWith("html[data-modality='keyboard']"));
    expect(resets.length).toBeGreaterThan(0);
    for (const s of resets) expect(s).toContain(":not([aria-invalid='true'])");
  });

  it('keeps the pointer reset of the browser\'s own ring, unlayered, at the end of index.css', () => {
    const css = read('index.css');
    const at = css.lastIndexOf("html[data-modality='pointer'] :focus-visible { outline: none; }");
    expect(at).toBeGreaterThan(0);
    // Unlayered: every brace opened before the rule is closed, so no @layer or @media holds it.
    const before = css.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, '');
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length);
  });
});
