/**
 * The public pages' colours meet WCAG AA (2026-11-08, site audit item 17):
 * the brand orange read 2.9:1 under white button text, 2.5:1 as text and the
 * captions 3.2:1, and nothing measured them. This reads the palette out of
 * src/index.css and computes each pairing a visitor reads, so a token
 * changed back by eye fails here instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');

/** The declarations of one rule, by its exact selector line. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';
const sheet = block('.sheet, .landing');
const pages = block('.landing');
const darkSheet = block('.dark .sheet, .dark .landing');
const darkPages = block('.dark .landing.landing');

describe('the public pages meet 4.5:1', () => {
  const light = { ...sheet, ...pages };
  const dark = { ...sheet, ...pages, ...darkSheet, ...darkPages };

  it.each([
    ['accent text on a panel', light['--color-secondary'], light['--color-surface-container-lowest']],
    ['accent text on the sheet', light['--color-secondary'], light['--color-surface']],
    ['a filled button', WHITE, light['--color-secondary-container']],
    ['a filled button, hovered', WHITE, light['--accent-deep']],
    ['a caption on a panel', light['--ink-faint'], light['--color-surface-container-lowest']],
    ['a caption on the sheet', light['--ink-faint'], light['--color-surface']],
    ['dark: accent text on a panel', dark['--color-secondary'], dark['--color-surface-container-lowest']],
    ['dark: a filled button', WHITE, dark['--color-secondary-container']],
    ['dark: a filled button, hovered', WHITE, dark['--accent-deep']],
    ['dark: a caption on a panel', dark['--ink-faint'], dark['--color-surface-container-lowest']],
    ['dark: a caption on the sheet', dark['--ink-faint'], dark['--color-surface']],
  ])('%s', (_what, fg, bg) => {
    expect(fg, 'colour missing').toMatch(/^#[0-9a-f]{6}$/);
    expect(bg, 'ground missing').toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the bright brand orange for what carries no words', () => {
    expect(pages['--brand']).toBe('#fe6b00');
    expect(contrast(WHITE, '#fe6b00')).toBeLessThan(4.5); // why it is not a button's fill
  });
});
