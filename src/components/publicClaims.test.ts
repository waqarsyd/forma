/**
 * What the public pages claim, held to the code that does it (2026-11-08, the
 * site audit's batch SC). Twenty claims on the home, Features and Docs pages
 * had drifted from the product, some for weeks: a settings dialog removed on
 * 2026-11-04 still sold, a progress bar and a Pause the workspace no longer
 * shows, OCR named nowhere, "no licence" over an Apache-2.0 project. Each of
 * those is a sentence this file now refuses, and each fact the pages state
 * that the code can answer is read from the code.
 *
 * Reads the page sources as text, so it needs no DOM and no render: a claim
 * is in the source or it is not.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DATA_FILE_EXTENSIONS } from '../lib/dataFiles';
import { SUPPORTED_PAGE_SIZES } from '../lib/reportGeometry';
import { BATCH_PARALLEL } from '../lib/batchQueue';

const page = (name: string) => readFileSync(`src/components/${name}.tsx`, 'utf8');
const landing = page('LandingPage');
const features = page('FeaturesPage');
const docs = page('DocsPage');
const figures = readFileSync('src/components/landing/StepFigures.tsx', 'utf8');
/** The words a visitor reads: comments taken out, so a note about a removed claim does not count as making it. */
const visible = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const all = [landing, features, docs, figures].map(visible).join('\n');

describe('the public pages do not claim what Forma no longer does', () => {
  it.each([
    ['a Pause button', /\bPause\b/],
    ['a progress bar or a character count', /progress bar|chars received|characters received|elapsed time/i],
    ['a page read visually instead of by OCR', /read(s|ing)? (it|the page) visually/i],
    ['a configuration panel before a run', /configuration panel|set in the report configuration/i],
    ['a header and footer setting', /footer options ask/i],
    ['no model to choose', /no model (picker|to choose)/i],
    ['no licence', /There is no licence/],
    ['being billed by Google as the only way', /billed by Google/],
    ['a key never stored', /never stores one/],
    ['nothing to configure before a key', /nothing to configure/i],
    ['a folder drop or parallel run that is not supported', /not supported yet/i],
    ['the spec written as .txt for a missing file', /specification as a <code[^>]*>\.txt|written spec as \.txt/],
  ])('no longer claims %s', (_what, pattern) => {
    expect(all).not.toMatch(pattern);
  });
});

describe('what the pages state, the code answers', () => {
  it('names the licence package.json declares', () => {
    const { license } = JSON.parse(readFileSync('package.json', 'utf8')) as { license: string };
    expect(visible(features)).toContain(license);
  });

  it('names every paper the report can print on, on Features and Docs', () => {
    for (const paper of SUPPORTED_PAGE_SIZES) {
      expect(visible(features), paper).toContain(paper);
      expect(visible(docs), paper).toContain(paper);
    }
  });

  it('names every data format the box takes', () => {
    const words: Record<string, string> = { '.csv': 'CSV', '.tsv': 'TSV', '.json': 'JSON', '.txt': 'text', '.sql': 'SQL', '.xlsx': 'Excel', '.docx': 'Word' };
    for (const ext of DATA_FILE_EXTENSIONS) {
      expect(visible(features), ext).toContain(words[ext]);
      expect(visible(docs), ext).toContain(words[ext]);
    }
  });

  it('says Batch runs up to as many at once as it can', () => {
    expect(Math.max(...BATCH_PARALLEL)).toBe(3);
    expect(visible(features)).toMatch(/two or three at once/);
    expect(visible(docs)).toMatch(/two or\s+three at once/);
  });

  it("names every format the Export panel offers, and OCR, on each page that describes intake", () => {
    const panel = readFileSync('src/components/ExportPanel.tsx', 'utf8');
    for (const [, label] of panel.matchAll(/\['[\w-]+', '([^']+)'/g)) {
      const name = label.replace(/ \(\.\w+\)$/, '').replace(/^Image$/, 'picture').replace(/ with outline$/, '');
      expect(visible(features), label).toContain(name);
    }
    for (const src of [landing, features, docs]) expect(visible(src)).toContain('OCR');
  });
});
