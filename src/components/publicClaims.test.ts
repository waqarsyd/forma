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
import { pdfPagesToRead } from '../lib/repxIntake';
import { fallbackReply } from '../lib/formaTeam';
import { MIN_PASSWORD } from '../lib/passwordPolicy';
import { MAX_PERSISTED_REVISIONS } from '../lib/revisionStore';
import { STARTING_POINTS } from '../lib/startingPoints';
import { AI_SAMPLE_VALUES, MAX_SAMPLE_ROWS, MAX_SAMPLE_VALUE } from '../lib/sqlSchema';
import { SAMPLE_SCRIPT_ROWS } from '../lib/sqlSchemaScript';
import { MAX_DATABASES } from '../lib/sqlSchemaStore';
import { MAX_AI_OBJECTS } from '../lib/databaseAi';
import { DESIGNER_REQUIREMENTS, DEVEXPRESS_TRIAL_URL, designerDownloadUrl } from '../lib/designerRelease';
import { DESIGNER_ORIGIN } from '../lib/designerBridge';

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
// And the hero's drawn file, whose pane label was a variable name (2026-11-11, full audit PS-22).
const hero = readFileSync('src/components/landing/HeroScanner.tsx', 'utf8');
// And the header, the phone menu and the contact page, whose labels and lines
// batch PSB set (2026-11-11, PS-23), and the sign-in card, whose Google
// button said "Sign up" beside a tab saying "Create account".
const chrome = ['SiteHeader', 'MobileNav', 'ContactPage', 'SiteFooter', 'LoginPage'].map(page);
const all = [landing, features, docs, figures, faqs, info, hero, ...chrome].map(visible).join('\n');
/** One Docs article's source, from its opening tag to its close. */
const article = (id: string) => {
  const start = docs.indexOf(`<Article id="${id}"`);
  expect(start, id).toBeGreaterThan(0);
  return visible(docs.slice(start, docs.indexOf('</Article>', start)));
};

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
    // The SQL Server programme (2026-11-09): Forma reads a layout you export; it never connects.
    ['a connection to your database', /Forma (connects|logs in) to your (SQL Server|database|server)|live connection to your/i],
    /*
     * The full audit (2026-11-11, batch PSA). The chat carries a request out
     * at once (the owner's rule of 2026-11-10), and it answers "how does Forma
     * work" from the Docs page, so a page that promised a button or a question
     * first was a promise the chat then repeated.
     */
    ['a button to proceed, or a question before a redesign', /offers a button|asks? before (a )?redesign|asks before redesigning/i],
    ['a questionnaire before a described report', /a question or two first/i],
    ['the reply narrating every step', /every step behind the scenes/i],
    ['recovery as it was before the free chain', /re-detects and retries once\. If Google|nothing runs out halfway/i],
    ['a chat that changes the DevExpress version', /ask in the chat for another/i],
    ['a command line or a companion where Forma Designer is installed', /--serve|\bcompanion\b/i],
    ['one host alone asking to reach the PC', /(on|whether) (openforma|forma-201ba)\.web\.app/i],
    ['the key kept in one tab', /\bin this tab\b/i],
    ['a bill for a free-tier request', /\bbilled\b/i],
    ['the code’s own names as copy', /analyzeReportDesign|repxContent|temperature['",\s]+0/],
    // Batch PSB (2026-11-11, PS-23): claims nobody measured, and one label per action.
    ['accuracy no one measured', /Accurate down to|most common single correction|two or three passes/i],
    ['a slogan where the next step goes', /Let.s build something precise|Ready when you are|The application is the portfolio/i],
    ['a second label for the workspace or for sign-up', /Launch the workspace|\bSign up\b/],
    // Batch LG (2026-11-11, PS-09, SE-03): a CSP narrows where script may post; it does not stop a key leaving.
    ['a CSP that keeps a stolen key in', /could not send your key anywhere else/i],
    ['the old name of Settings’ Download everything button', /has Download all\b/],
    // Encrypted sync keeps a copy of the key in the account, so "never" needs its condition.
    ['the key never reaching Forma, whatever is switched on', /Your key, never:/],
    /*
     * The re-audit (2026-11-11, batch FIX2D): what the waves changed under
     * sentences that stayed. A kept report joins the library on its own and
     * goes with a first report (R4-01); Forma Designer is asked about each new
     * report after one Open in designer (R4-02); a reply after a change says
     * what it left to fix, and Retry runs stopped files too (R4-11); Forma
     * opens SSRS reports itself (R4-04).
     */
    ['a library used only once a report is ticked', /nothing is used until you do/i],
    ['a report kept only by export or save', /report you export or save counts as kept/i],
    ['Forma Designer asked only when Open in designer is chosen', /whether it is there, and only then/i],
    ['the checks described as an audit', /structural audit|The audit runs after|how many the checks found/i],
    ['a Retry that runs only what failed', /Retry requeues only what failed/i],
    ['SSRS reports converted elsewhere before Forma opens them', /convert with Reporting\.Import, then bring the \.repx/i],
  ])('no longer claims %s', (_what, pattern) => {
    // On one line, so a sentence the source wraps between two words is still found (2026-11-11).
    expect(all.replace(/\s+/g, ' ')).not.toMatch(pattern);
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

  // Batch PSB (2026-11-11, CP-04c): a longer PDF keeps its last page, where totals print.
  it('says which pages of a longer PDF are read, as the intake chooses them', () => {
    const pages = pdfPagesToRead(MAX_PDF_PAGES + 12);
    expect(pages).toHaveLength(MAX_PDF_PAGES);
    expect(pages[pages.length - 1]).toBe(MAX_PDF_PAGES + 12);
    expect(numbers(docs, /the first (\w+) pages and the last/gi)).toEqual([MAX_PDF_PAGES - 1]);
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

  it('gives the numbers the SQL Server article states, from the code (2026-11-09)', () => {
    expect(numbers(docs, /Up to (\d+) databases/gi)).toEqual([MAX_DATABASES]);
    expect(numbers(docs, /takes (\d+) rows from each table/gi)).toEqual([SAMPLE_SCRIPT_ROWS]);
    expect(numbers(docs, /at most (\d+) rows a table/gi)).toEqual([MAX_SAMPLE_ROWS]);
    expect(numbers(docs, /(\d+) characters a value/gi)).toEqual([MAX_SAMPLE_VALUE]);
    expect(numbers(docs, /the (\d+) likeliest/gi)).toEqual([MAX_AI_OBJECTS]);
    expect(numbers(docs, /up to (\d+) sample values/gi)).toEqual([AI_SAMPLE_VALUES]);
    expect(docs).toContain('<Article id="sql"');
  });

  /*
   * The download page (2026-11-09, the owner's download programme, batch WG):
   * every requirement it states read from where the companion decides it, the
   * one DevExpress link the companion's own, the file only GitHub's release,
   * and nothing between the button and the file.
   */
  it('states what Forma Designer needs as the companion decides it, and gates nothing', () => {
    const project = readFileSync('tools/RepxDesigner/RepxDesigner.csproj', 'utf8');
    const locator = readFileSync('tools/RepxDesigner/DevExpressLocator.cs', 'utf8');
    expect(/<TargetFrameworkVersion>v([\d.]+)<\/TargetFrameworkVersion>/.exec(project)![1]).toBe(DESIGNER_REQUIREMENTS.dotnet);
    const oldest = /Oldest = new Version\((\d+), (\d+)\)/.exec(locator)!;
    expect(`${oldest[1]}.${oldest[2]}`).toBe(DESIGNER_REQUIREMENTS.devexpressOldest);
    expect(/TrialUrl = "([^"]+)"/.exec(locator)![1]).toBe(DEVEXPRESS_TRIAL_URL);
    expect(DESIGNER_ORIGIN).toBe(`http://127.0.0.1:${DESIGNER_REQUIREMENTS.port}`);
    expect(designerDownloadUrl()).toMatch(/^https:\/\/github\.com\/waqarsyd\/forma\/releases\/download\/v[\d.]+\/FormaDesigner-[\d.]+-windows\.zip$/);
    const start = info.indexOf('export const DOWNLOAD');
    const end = info.indexOf('/* ---', start);
    expect(start).toBeGreaterThan(0);
    const download = visible(info.slice(start, end < 0 ? undefined : end));
    expect(download).toContain('not part of this download');
    expect(download).toContain('commercial product of Developer Express Inc');
    expect(download).not.toMatch(/<form|<input|mailto:|utm_/i);
    expect([...download.matchAll(/devexpress\.com[^'"`\s]*/gi)].map((m) => m[0])).toEqual([]);
  });

  /*
   * The full audit (2026-11-11, batch PSA): what sharing needs, what happens
   * at a limit, and the file the hero draws, each as the code has it.
   */
  it('says sharing needs a verified address and a project of your own, and the limit the rules hold', () => {
    const share = article('share');
    expect(share).toMatch(/verified\s+address/);
    expect(share).toMatch(/project\s+of\s+your\s+own/);
    expect(share).toContain('{MAX_SHARES}');
    expect(share).toContain('{MAX_INVITED}');
    expect(docs).toContain("import { MAX_INVITED, MAX_SHARES } from '../lib/shares'");
    expect(visible(docs)).not.toMatch(/one\s+thing\s+a\s+verified\s+address\s+unlocks/i);
  });

  it('describes the free chain and the page reader, and quotes the reply a stand-in report gets', () => {
    const ai = article('ai');
    expect(ai).toContain('<Def t="When the AI you chose reaches its limit">');
    expect(ai).toContain('<Def t="Page reader">');
    expect(article('trouble')).toContain(`<Def t={'"So here is a quicker version of the page"'}>`);
    expect(article('trouble')).toContain('<Def t="A model was retired">');
    // The quoted words are the reply's own (batch PSB, 2026-11-11): someone
    // searching the docs for what the chat said finds this heading.
    const quoted = /<Def t=\{'"([^"]+)"'\}>/.exec(article('trouble'))![1];
    const reply = fallbackReply('Gemini', 'quota exceeded', false);
    expect(reply.toLowerCase()).toContain(quoted.toLowerCase());
  });

  it('lists every article in the footer, from the list the sidebar draws', () => {
    expect(docs).toMatch(/onThisPage=\{SECTIONS\.map\(/);
  });

  it('names data files among the uploads', () => {
    expect(article('upload')).toContain('<Def t="Data files">');
  });

  it('draws the hero’s file at the version Forma writes by default, its title where the table says', () => {
    const version = (src: string) => /SerializerVersion=(?:<\/P><P c=\{T\.s\}>)?"([\d.]+)"/.exec(src)?.[1];
    expect(version(hero)).toBe('23.2.3.0');
    expect(version(docs)).toBe(version(hero));
    const title = /const TITLE = \{ x: (\d+), y: (\d+)/.exec(hero)!;
    expect(landing).toContain(`{ label: 'INVOICE', guess: '~208, ~44', exact: '${title[1]}, ${title[2]}' }`);
  });

  /*
   * Learning is on by default, so every page that says what Forma keeps
   * names where to turn it off (2026-11-11, batch LG: PS-02, LM-19, PS-06).
   */
  it('names Settings → Learning on /faq, on /security and in the Docs', () => {
    const start = info.indexOf('export const SECURITY');
    const security = info.slice(start, info.indexOf('/* ---', start));
    expect(start).toBeGreaterThan(0);
    for (const [name, src] of [['/faq', faqs], ['/security', security], ['Docs', docs]] as const) {
      expect(prose(src), name).toContain('Settings → Learning');
    }
    expect(prose(docs)).toContain('Opens Settings: General, AI, Gemini key, Memory and Learning.');
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

/*
 * What the fix waves built, said where a person and the chat look for it
 * (2026-11-11, the re-audit's R4-01, R4-02, R4-04, R4-11 to R4-13, batch
 * FIX2D). The chat answers "how do I" from the Docs page (docsCorpus.tsx), so
 * a feature the Docs leave out is one the chat cannot tell anyone about. Each
 * claim is held to the code that does it, read as source where importing it
 * would pull Firestore or the library's IndexedDB into a test of prose.
 */
describe('the public pages say what the waves built', () => {
  const prose = (src: string) => visible(src).replace(/\{' '\}/g, ' ').replace(/<[^>]+>/g, '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  const source = (path: string) => readFileSync(path, 'utf8');
  const constant = (path: string, name: string) => Number(new RegExp(`export const ${name} = ([\\d_]+);`).exec(source(path))![1].replace(/_/g, ''));
  const WORDS: Record<number, string> = { 2: 'twice', 20: 'twenty', 30: 'thirty' };
  const security = () => {
    const start = info.indexOf('export const SECURITY');
    return info.slice(start, info.indexOf('/* ---', start));
  };

  it('names SSRS and FastReport reports wherever the uploads are listed, as the intake opens them', () => {
    const intake = source('src/lib/repxIntake.ts');
    expect(intake).toMatch(/\/\\\.\(rdlc\?\|frx\)\$\/i/);
    for (const [name, src] of [['Docs upload', article('upload')], ['FAQ', faqs], ['Features', features], ['home', landing]] as const) {
      expect(prose(src), name).toMatch(/FastReport/);
    }
    for (const ext of ['.rdl', '.rdlc', '.frx']) {
      expect(prose(article('upload')), ext).toContain(ext);
      expect(prose(faqs), ext).toContain(ext);
    }
    // A Crystal file is answered with how to export a PDF, which the pages say rather than promise it opens.
    expect(intake).toMatch(/is a Crystal Reports file\. Export it from Crystal Reports as a PDF/);
    expect(prose(article('upload'))).toMatch(/Crystal Reports \.rpt cannot be read in a browser/);
  });

  it('says a Word or Excel template is followed when asked, and a crooked page straightened', () => {
    expect(source('src/lib/repxIntake.ts')).toContain('export function templateCorrection');
    expect(article('upload')).toContain('<Def t="Word and Excel templates">');
    expect(prose(article('upload'))).toMatch(/its page, margins, table and fonts are followed/);
    expect(prose(article('upload'))).toMatch(/straightened before it is read/);
    expect(source('src/lib/deskew.ts')).toMatch(/straightened once at intake/);
  });

  it('describes Compare with the original and the Language list, as the Preview draws them', () => {
    expect(source('src/components/PreviewRail.tsx')).toContain('aria-label="Compare with the original"');
    expect(source('src/lib/shortcuts.ts')).toMatch(/key === 'o'.*'compare'/);
    expect(article('workspace')).toContain('<Def t="Compare with the original">');
    expect(prose(article('workspace'))).toMatch(/Compare \(or O\)/);
    expect(prose(features)).toMatch(/Compare with the original/);
    expect(source('src/components/ReportPreview.tsx')).toMatch(/Language\{' '\}\s*<select/);
    expect(prose(article('run'))).toMatch(/Ask for both languages/);
    expect(prose(article('run'))).toMatch(/Language list/);
    expect(prose(faqs)).toMatch(/Language list/);
  });

  it('says several exports asked at once are saved as one .zip, and the print with the page’s rows', () => {
    expect(source('src/lib/exportJob.ts')).toMatch(/saved as one\s+\*\s+\.zip/);
    expect(prose(article('run'))).toMatch(/saved together as one \.zip/);
    expect(source('src/lib/printCheck.ts')).toMatch(/prints-extra-pages/);
    expect(prose(article('run'))).toMatch(/printed before you see it, with the rows that page shows/);
  });

  it('says what a reply after a change says, and lists the errors the checks added', () => {
    expect(source('src/lib/agentEdit.ts')).toMatch(/This change left \$\{count\} to fix/);
    const repx = prose(article('repx'));
    expect(repx).toMatch(/a reply after a change says what it left to fix/);
    const audit = source('src/lib/repxAudit.ts');
    for (const [code, said] of [
      ['report-has-scripts', 'code that runs when the report is previewed'],
      ['expression-invalid', 'an expression DevExpress cannot read'],
      ['margins-not-whole', 'margins or a custom page size written with a fraction'],
      ['field-unknown', 'a group or sort on a field the data does not have'],
      ['expression-field-unknown', 'a field an expression names that the data does not have'],
    ] as const) {
      expect(audit, code).toContain(`'${code}'`);
      expect(repx, code).toContain(said);
    }
  });

  it('says Retry runs the failed and the stopped files, as the queue does', () => {
    expect(source('src/lib/batchQueue.ts')).toMatch(/item\.status === 'failed' \|\| item\.status === 'cancelled'/);
    expect(prose(features)).toMatch(/Retry runs the failed and stopped files again/);
  });

  it('states the write limits the rules hold, where a person reads about saving', () => {
    const projects = constant('src/lib/accountData.ts', 'MAX_REPORTS');
    const events = constant('src/lib/accountData.ts', 'MAX_EVENTS_A_DAY');
    const rules = source('firestore.rules');
    expect(rules).toContain(`after.reports <= ${projects}`);
    expect(rules).toContain(`after.events <= ${events}`);
    const n = projects.toLocaleString('en-US');
    expect(prose(article('saving'))).toContain(`keeps up to ${n} projects`);
    expect(prose(security())).toContain(`keeps up to ${n} projects and sends at most ${events} learning events a day`);
  });

  it('says what the kept reports do, with the numbers the code keeps', () => {
    const memory = prose(article('memory'));
    expect(source('src/lib/memory.ts')).toMatch(/const EMPTY: MemoryState = \{[^}]*learnFromKept: true/);
    expect(memory).toMatch(/which it is unless you turn it off in Settings → Memory/);
    expect(memory).toContain(`the styles of the newest ${WORDS[constant('src/lib/memory.ts', 'MAX_KEPT')]} are kept`);
    expect(memory).toContain(`the newest ${WORDS[constant('src/services/library.ts', 'MAX_KEPT_REPORTS')]}`);
    expect(memory).toMatch(/a report you export, save or open in the designer counts as kept/);
    expect(memory).toMatch(/the kept report most like it goes to the AI with your request, every word in it replaced/);
    expect(memory).toContain(`The same change made ${WORDS[constant('src/lib/corrections.ts', 'LEARN_AFTER')]} becomes a memory`);
    expect(memory).toMatch(/Learned from your changes/);
    expect(source('src/components/MemorySettings.tsx')).toContain('A report is kept when you export it, save it or open it in the designer.');
  });

  /*
   * "Answered", not "opened a report" (the review of 2026-11-11): askDesigner
   * sets both flags designerAnswered() reads as soon as /health answers,
   * before /open is sent. If that ever moves after a successful open, this
   * fails and the sentence can say "opened" again.
   */
  it('says Forma Designer is handed each new report once it has answered, as designerBridge.ts decides', () => {
    const bridge = source('src/lib/designerBridge.ts');
    expect(bridge).toMatch(/post\('\/inspect'/);
    expect(bridge).toMatch(/answered = true;\s*\n\s*inspects = health\.inspects === true;/);
    const designer = prose(article('designer'));
    expect(designer).toMatch(/Once Forma Designer has answered in a tab, which it does when you choose Open in designer while it is running, whether or not the report then opens, Forma also hands it each new report you make in the same tab/);
    expect(designer).not.toMatch(/has opened a report/);
    expect(designer).not.toMatch(/nothing on the page reaches your PC/);
  });

  it('says on Features that a kept report goes with a first report, not that all of it stays in the browser', () => {
    expect(source('src/lib/learningLoop.ts')).toContain('keptExampleBlock(');
    const features = source('src/components/FeaturesPage.tsx');
    expect(features).toContain('With a first report, the kept report most like it goes to the AI you chose as formatting to follow');
    expect(features).not.toMatch(/a memory you can see and forget, all in this browser/);
  });

  it('opens SSRS reports itself on /compare, and credits handwriting only with its condition on /about', () => {
    const compare = prose(info.slice(info.indexOf('export const COMPARE'), info.indexOf('export const ABOUT')));
    expect(compare).toMatch(/Forma opens RDL and RDLC reports itself, and FastReport’s \.frx too/);
    const about = prose(info.slice(info.indexOf('export const ABOUT'), info.indexOf('/* ---', info.indexOf('export const ABOUT'))));
    // Built in only with --with-handwriting (scripts/deploy.mjs); Owner decision 27 is still open.
    if (/--with-handwriting/.test(source('scripts/deploy.mjs'))) {
      expect(about).toContain('where the site is built with it, Transformers.js for handwriting');
    }
  });
});
