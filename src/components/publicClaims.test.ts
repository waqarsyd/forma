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
import { MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_PDF_PAGES } from '../lib/attachmentBudget';
import { MIN_PASSWORD } from '../lib/passwordPolicy';
import { MAX_PERSISTED_REVISIONS } from '../lib/revisionStore';
import { STARTING_POINTS } from '../lib/startingPoints';

const page = (name: string) => readFileSync(`src/components/${name}.tsx`, 'utf8');
const landing = page('LandingPage');
const features = page('FeaturesPage');
const docs = page('DocsPage');
const figures = readFileSync('src/components/landing/StepFigures.tsx', 'utf8');
/** The words a visitor reads: comments taken out, so a note about a removed claim does not count as making it. */
const visible = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
// With the FAQ and the pages SJ added (2026-11-08), which make claims too.
const faqs = readFileSync('src/components/faqs.tsx', 'utf8');
const info = readFileSync('src/components/infoPages.tsx', 'utf8');
const all = [landing, features, docs, figures, faqs, info].map(visible).join('\n');

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
    // The site audit's batch SD (2026-11-08), on the Docs page.
    ['an upload as the only way to start a report', /An upload is what starts a generation/],
    ['an unverified account missing nothing', /Nothing is withheld/],
    ['the account dialog in columns', /one in another column/],
    ['a docs fix promised for feedback nobody receives', /gets fixed in the next pass/],
    // Batch SE (2026-11-08): projects are saved as you work.
    ['a project saved only when you choose to', /Projects you choose to save|Save the session to your account|sign in and save a project/],
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

  /*
   * The numbers (2026-11-08, site audit item 88): every figure the pages give
   * a visitor is the constant the code enforces, read here rather than
   * remembered. Tags and `{' '}` are taken out first, so "Up to <strong>8
   * pages</strong>" reads as the sentence a visitor sees.
   */
  const prose = (src: string) => visible(src).replace(/\{' '\}/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const numbers = (src: string, pattern: RegExp) => [...prose(src).matchAll(pattern)].map((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : WORDS.indexOf(m[1].toLowerCase())));

  it('gives the PDF page limit the intake enforces, on every page that names it', () => {
    for (const [name, src] of [['home', landing], ['Features', features], ['Docs', docs]] as const) {
      const said = numbers(src, /up to (\d+) pages/gi);
      expect(said.length, name).toBeGreaterThan(0);
      for (const n of said) expect(n, name).toBe(MAX_PDF_PAGES);
    }
  });

  it('gives the attachment count and file size the intake enforces', () => {
    expect(numbers(docs, /up to (\d+) attachments/gi)).toEqual([MAX_ATTACHMENTS]);
    expect(numbers(docs, /each up to (\d+) MB/gi)).toEqual([MAX_FILE_BYTES / 1024 / 1024]);
  });

  it('gives the password length sign-up enforces, and the revisions a project keeps', () => {
    expect(numbers(docs, /at least (\w+) characters/gi)).toEqual([MIN_PASSWORD]);
    for (const src of [features, docs]) {
      const said = numbers(src, /the newest (\w+) are saved/gi);
      expect(said.length).toBeGreaterThan(0);
      for (const n of said) expect(n).toBe(MAX_PERSISTED_REVISIONS);
    }
  });

  it('counts the examples it offers', () => {
    expect(numbers(info, /(\w+) reports to start from/gi)).toEqual([STARTING_POINTS.length]);
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

/*
 * The Docs page covers what the workspace does (2026-11-08, the site audit's
 * batch SD): sharing, memory, the library, the data view, the workspace
 * itself and its shortcuts had no article, and the account article described
 * a dialog that had been rebuilt in sections the day before.
 */
describe('the Docs page covers the workspace as it is', () => {
  const labels = (src: string) => [...src.matchAll(/\{ id: '\w+', label: '([^']+)'/g)].map((m) => m[1]);

  it('has an article for each part of the workspace a visitor asks about', () => {
    for (const id of ['ai', 'workspace', 'data', 'share', 'memory', 'shortcuts']) {
      expect(docs, id).toContain(`<Article id="${id}"`);
    }
  });

  it("names every section of Settings and of the account dialog", () => {
    const settings = labels(readFileSync('src/components/SettingsDialog.tsx', 'utf8'));
    const account = labels(readFileSync('src/components/AccountDialog.tsx', 'utf8'));
    expect(settings.length).toBeGreaterThanOrEqual(4);
    expect(account.length).toBeGreaterThanOrEqual(4);
    for (const label of [...settings, ...account]) expect(visible(docs), label).toContain(label);
  });

  it('says on every page whose code and name it is (site audit items 83 and 35)', () => {
    const footer = readFileSync('src/components/SiteFooter.tsx', 'utf8');
    const holder = readFileSync('LICENSE', 'utf8').match(/^\s*Copyright (\d{4} .+?)\s*$/m)?.[1];
    expect(holder).toBeTruthy();
    expect(footer).toContain(`export const COPYRIGHT = '© ${holder}'`);
    expect(visible(footer)).toMatch(/trademarks of Developer Express Inc\. Forma is an independent project, not\s+affiliated/);
    expect(visible(footer)).not.toContain('getFullYear');
  });

  it('gives the security route SECURITY.md gives, on the contact page (item 81)', () => {
    const security = readFileSync('SECURITY.md', 'utf8');
    const contact = visible(readFileSync('src/components/ContactPage.tsx', 'utf8'));
    expect(security).toMatch(/private vulnerability reporting/);
    expect(contact).toMatch(/private vulnerability reporting/);
    expect(security).toContain('"Forma security" in the subject');
    expect(contact).toContain('"Forma security" in the subject');
    expect(contact).toMatch(/delivered by[\s\S]{0,200}FormSubmit/);
  });

  it('prints the shortcuts from the list the workspace dialog uses, not a copy', () => {
    expect(docs).toContain("import { shortcutGroups } from '../lib/shortcuts'");
    expect(readFileSync('src/components/ShortcutsDialog.tsx', 'utf8')).toContain("import { shortcutGroups } from '../lib/shortcuts'");
  });
});
