import { useEffect, useRef, useState, type ReactNode } from 'react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import { Eyebrow } from './landing/sections';
import { articleMatches, docsIssueUrl } from '../lib/docsSearch';
import { shortcutGroups } from '../lib/shortcuts';
import {
  IconSearch, IconChevronDown, IconThumbUp, IconThumbDown, IconCheck, IconArrowRight,
} from './landing/icons';

/**
 * The documentation page.
 *
 * Rebuilt on 2026-08-11 against the drafting-sheet design, and the copy was
 * rewritten against the code rather than carried over. The previous version
 * told readers two things that had stopped being true:
 *
 *  - that Forma "operates using a shared developers API key" and a custom key
 *    only exists to bypass daily limits. The application owns no key at all.
 *  - that their key is "stored securely within your browser's local state
 *    (localStorage)". That entry is deleted on boot; the working copy lives in
 *    sessionStorage and the optional durable copy is AES-GCM ciphertext.
 *
 * The second was the dangerous one — it described plaintext on disk as secure.
 *
 * It also had a functional bug worth not reintroducing: `<main>` carried
 * `overflow-hidden` while the sidebar used `sticky`, and an overflow ancestor
 * silently disables sticky positioning, so the nav scrolled away. Nothing in
 * the chain above `<aside>` may set overflow.
 */

interface DocsPageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

/**
 * `keys` are words an article should be found by without saying them, as
 * "billing" for the FAQ. Since 2026-11-08 (site audit item 87) search also
 * reads each article's own text, collected in an effect once the page has
 * drawn (`lib/docsSearch.ts`); reading the DOM during render was impure and
 * found nothing on the first pass, which is why it was keywords alone.
 */
const SECTIONS: Array<{ id: string; n: string; title: string; keys: string }> = [
  { id: 'start', n: '01', title: 'Getting started', keys: 'start begin first steps tutorial upload workflow guide describe prompt words' },
  { id: 'key', n: '02', title: 'Your API key', keys: 'key api gemini google studio session vault passphrase encrypt security storage' },
  { id: 'ai', n: '03', title: 'Choosing your AI', keys: 'ai provider model automatic gemini local ollama lm studio openrouter free offline private vision' },
  { id: 'account', n: '04', title: 'Your account', keys: 'account sign in signup register google email password forgot reset sync devices optional verify delete' },
  { id: 'upload', n: '05', title: 'What you can upload', keys: 'upload file formats png jpg pdf repx size limit pages attachments text extraction scan ocr photo' },
  { id: 'run', n: '06', title: 'Running and refining', keys: 'run generate working dots stop escape queue steer resume cancel read result specification mockup preview export refine change edit undo redo changed iterate conversation' },
  { id: 'workspace', n: '07', title: 'The workspace', keys: 'workspace tour sidebar rail home starting points views panes request card log reply project menu rename duplicate archive delete pin command menu clean screen zoom' },
  { id: 'data', n: '08', title: 'Data and binding', keys: 'data tab bind binding fields schema json csv create table map columns expression prompt-to-expression test data rows sample' },
  // xrchart and xrgauge are searchable because both are now written into the
  // file — a real XRChart with its series, and a real XRGauge with its value
  // and range. This comment used to say the opposite, and was left behind by
  // the work that added them.
  { id: 'controls', n: '09', title: 'Supported controls', keys: 'controls xrlabel xrtable xrpicturebox xrbarcode xrline xrpageinfo pageinfo page numbers xrchart xrgauge chart gauge xrcheckbox checkbox xrpanel panel xrshape shape crossband cross-band xrcrosstab cross-tab pivot xrsubreport subreport table of contents elements supported' },
  { id: 'repx', n: '10', title: 'The .repx file', keys: 'repx xml schema serializer band detail bands units grid coordinates export download audit warnings errors checks accessibility' },
  { id: 'config', n: '11', title: 'Settings and what is worked out', keys: 'config configure settings worked out version paper size letter a4 legal tabloid landscape rtl right to left stored procedure data model picker auto fast balanced local ai ollama lm studio openrouter unit units scale hundredths inch millimetre millimeter pixels locationfloat sizef' },
  { id: 'saving', n: '12', title: 'Saving your work', keys: 'save saved projects account cloud local storage sign out history' },
  { id: 'share', n: '13', title: 'Sharing a report', keys: 'share sharing link restricted anyone people invite email verified stop sharing collaborate' },
  { id: 'memory', n: '14', title: 'Memory and house style', keys: 'memory remember from now on forget house style library report library learn kept reports formatting' },
  /* Batch and Revisions are two of the five rail panels and both shipped on
     2026-09-05, and neither appeared anywhere on this page or on Features
     until 2026-09-08 — on a page whose sibling is titled "Everything it does".
     Batch in particular is the migration story: it is the thing a
     prompt-driven competitor structurally cannot offer, and it was the one
     feature a visitor could not discover without opening the app. */
  { id: 'batch', n: '15', title: 'Batch generation', keys: 'batch bulk many folder drop queue multiple files parallel two three zip archive migration legacy convert retry stop download all at once' },
  { id: 'revisions', n: '16', title: 'Revision history', keys: 'revisions history versions restore undo diff changed previous rollback compare' },
  { id: 'shortcuts', n: '17', title: 'Keyboard shortcuts', keys: 'keyboard shortcuts keys hotkeys ctrl cmd command' },
  { id: 'trouble', n: '18', title: 'Troubleshooting', keys: 'trouble error 404 429 503 quota overload fail slow retired invalid problem draft local not answering context sign in login pop-up popup password' },
  { id: 'faq', n: '19', title: 'FAQ', keys: 'faq questions common help cost price free billing visual studio photo' },
];

/** The furniture the newer articles share (2026-11-08). */
const H3 = 'mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface';
const LINK = 'font-semibold text-secondary hover:underline';
const KBD =
  'inline-block min-w-[1.6em] rounded-md border border-outline-variant bg-surface-container-low px-1.5 py-px text-center font-code-sm text-[11.5px] leading-[1.5] text-on-surface';

const FAQS: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'Does Forma cost anything to use?',
    a: (
      <p>
        Forma itself is open source (Apache-2.0) and free, and it is built to stay inside Google's free tier
        for your own Gemini key. If you turn on billing for your key, Google bills you directly; Forma takes
        no cut. A local AI costs nothing at all. Whoever runs Forma pays nothing for your requests, and you
        never wait behind another user's quota.
      </p>
    ),
  },
  {
    q: 'Which file formats can I upload?',
    a: (
      <p>
        Pictures (PNG, JPG and the like), PDF documents, existing DevExpress <code className="doc-code">.repx</code>{' '}
        files, and data files (CSV, TSV, JSON, text, SQL, Excel and Word), several at once, and you can mix them.
      </p>
    ),
  },
  {
    q: 'Can I open the generated file in Visual Studio?',
    a: (
      <p>
        Yes. The output is standard <code className="doc-code">XtraReportsLayoutSerializer</code> XML and
        opens in the Visual Studio report designer or an end-user designer. The version is read from a
        report you bring; ask in the chat for another if your SDK needs it.
      </p>
    ),
  },
  {
    q: 'Can Forma read a photo of a printed form?',
    a: (
      <p>
        Yes — that is one of the cases it is built for. Its words are read by OCR in your browser and its
        layout from the picture, so expect the odd misread string where a digital PDF would be exact. If
        you have a digital PDF of the same document, use that instead: the text layer gives exact positions.
      </p>
    ),
  },
  {
    q: 'Why does my grid come out as separate labels?',
    a: (
      <>
        <p>
          Ask for it explicitly in the conversation — say the region is a table and should be one control
          with rows and cells. With a report open the chat edits it in place where it can, and asks before a
          redesign where it cannot, so you keep everything else.
        </p>
        <p className="mt-2.5">
          Projects saved before tables were supported still contain the older split-label form and will keep
          rendering that way.
        </p>
      </>
    ),
  },
  {
    q: "Is my design or my key sent to Forma's servers?",
    a: (
      <p>
        No. Generation runs entirely in your browser and talks to Google directly — there is no generation
        endpoint on Forma's server to route through. Signed in, your projects are saved to your own account
        as you work; the key is never part of them.
      </p>
    ),
  },
];

/* ------------------------------------------------------------ furniture */

const CARD =
  'rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-sm)]';
const KICKER =
  'font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.14em] uppercase text-[color:var(--ink-faint)]';
const PROSE = 'font-body-lg text-[15.5px] leading-[1.68] text-on-surface-variant';

/** One row of a definition list — the shape most of this page is made of. */
function Def({ t, children }: { t: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-y-1 border-b border-outline-variant py-3.5 [&>*]:min-w-0 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-baseline sm:gap-x-4">
      {/* No `leading-`: the artifact's `.defs dt` sets none, so it inherits
          the body's 1.62 and renders at 20.3px rather than 18.8px. */}
      <dt className="font-code-sm text-[12.5px] font-medium text-on-surface">{t}</dt>
      <dd className="m-0 font-body-lg text-[13.5px] leading-[1.58] text-on-surface-variant">{children}</dd>
    </div>
  );
}

function Note({ label, tone = 'accent', children }: { label: string; tone?: 'accent' | 'safe'; children: ReactNode }) {
  const safe = tone === 'safe';
  return (
    <div
      className={`mt-5 rounded-[10px] border px-[17px] py-[15px] font-body-lg text-[13.5px] leading-[1.62] text-on-surface-variant ${
        safe
          ? 'border-[color:var(--ok-line)] bg-[color:var(--ok-wash)]'
          : 'border-[color:var(--accent-line)] bg-[color:var(--accent-wash)]'
      }`}
    >
      <span
        className={`mb-1.5 block font-code-sm text-[9.5px] font-semibold leading-[1.62] tracking-[0.14em] uppercase ${
          safe ? 'text-[color:var(--ok-ink)]' : 'text-secondary'
        }`}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The .repx sample, syntax-coloured with the same four token colours the
 * artifact uses. Rendered as spans rather than a plain string because the
 * artifact colours it — a monochrome block is the single most visible
 * difference between the two.
 *
 * Written as tokens rather than parsed: the input is a fixed literal, so a
 * tokeniser would be machinery with nothing to earn it.
 */
const T = { p: '#5d7290', t: '#7cc5de', a: '#a9b8cc', s: '#ff9d5c' };
const P = ({ c, children }: { c: string; children: ReactNode }) => (
  <span style={{ color: c }}>{children}</span>
);

function XmlSample() {
  return (
    <>
      <P c={T.p}>&lt;?</P><P c={T.a}>xml version=</P><P c={T.s}>"1.0"</P> <P c={T.a}>encoding=</P><P c={T.s}>"utf-8"</P><P c={T.p}>?&gt;</P>{'\n'}
      <P c={T.p}>&lt;</P><P c={T.t}>XtraReportsLayoutSerializer</P> <P c={T.a}>SerializerVersion=</P><P c={T.s}>"23.2.3.0"</P>{'\n'}
      {'  '}<P c={T.a}>ControlType=</P><P c={T.s}>"DevExpress.XtraReports.UI.XtraReport"</P>{'\n'}
      {'  '}<P c={T.a}>ReportUnit=</P><P c={T.s}>"HundredthsOfAnInch"</P>{'\n'}
      {'  '}<P c={T.a}>PageWidth=</P><P c={T.s}>"850"</P> <P c={T.a}>PageHeight=</P><P c={T.s}>"1100"</P><P c={T.p}>&gt;</P>{'\n'}
      {'  '}<P c={T.p}>&lt;</P><P c={T.t}>Bands</P><P c={T.p}>&gt;</P>{'\n'}
      {'    '}<P c={T.p}>&lt;</P><P c={T.t}>Item1</P> <P c={T.a}>ControlType=</P><P c={T.s}>"TopMarginBand"</P> <P c={T.a}>HeightF=</P><P c={T.s}>"100"</P> <P c={T.p}>/&gt;</P>{'\n'}
      {'    '}<P c={T.p}>&lt;</P><P c={T.t}>Item2</P> <P c={T.a}>ControlType=</P><P c={T.s}>"DetailBand"</P> <P c={T.a}>HeightF=</P><P c={T.s}>"640"</P><P c={T.p}>&gt;</P>{'\n'}
      {'      '}<P c={T.p}>&lt;</P><P c={T.t}>Controls</P><P c={T.p}>&gt;</P>{'\n'}
      {'        '}<P c={T.p}>&lt;</P><P c={T.t}>Item1</P> <P c={T.a}>ControlType=</P><P c={T.s}>"XRLabel"</P> <P c={T.a}>Text=</P><P c={T.s}>"INVOICE"</P>{'\n'}
      {'          '}<P c={T.a}>LocationFloat=</P><P c={T.s}>"40,45"</P> <P c={T.a}>SizeF=</P><P c={T.s}>"400,30"</P> <P c={T.p}>/&gt;</P>{'\n'}
      {'      '}<P c={T.p}>&lt;/</P><P c={T.t}>Controls</P><P c={T.p}>&gt;</P>{'\n'}
      {'    '}<P c={T.p}>&lt;/</P><P c={T.t}>Item2</P><P c={T.p}>&gt;</P>{'\n'}
      {'  '}<P c={T.p}>&lt;/</P><P c={T.t}>Bands</P><P c={T.p}>&gt;</P>{'\n'}
      <P c={T.p}>&lt;/</P><P c={T.t}>XtraReportsLayoutSerializer</P><P c={T.p}>&gt;</P>
    </>
  );
}

function Article({
  id,
  kicker,
  title,
  hidden,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  hidden: boolean;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      hidden={hidden}
      className={`${CARD} scroll-mt-24 p-[30px] sm:px-[38px] sm:py-9`}
    >
      <div className={`${KICKER} text-secondary`}>{kicker}</div>
      <h2 className="mt-3.5 font-display-lg text-[clamp(22px,2.2vw,28px)] font-extrabold leading-[1.16] tracking-[-0.028em] text-on-surface">
        {title}
      </h2>
      <div className="my-6 h-px bg-outline-variant" />
      {children}
    </article>
  );
}

/* ----------------------------------------------------------------- page */

export default function DocsPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: DocsPageProps) {
  const [query, setQuery] = useState('');
  // Empty rather than 'start': the artifact highlights nothing until its
  // observer fires, so pre-selecting the first entry was a visible difference
  // on load.
  const [active, setActive] = useState('');
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);
  const [comment, setComment] = useState('');
  const docRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  /*
   * Each article's own words, read once it has drawn (2026-11-08, site audit
   * item 87, lib/docsSearch.ts): search matched titles and keywords only, so
   * "OCR" or "Ollama" found nothing the articles said. In an effect, so the
   * render stays pure; an article hidden by a search is still in the page.
   */
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    const read: Record<string, string> = {};
    root.querySelectorAll<HTMLElement>('article[id]').forEach((el) => {
      read[el.id] = el.textContent ?? '';
    });
    setTexts(read);
  }, []);
  const matches = (id: string) => {
    if (!q) return true;
    const s = SECTIONS.find((x) => x.id === id);
    return !!s && articleMatches(q, { title: s.title, keys: s.keys, text: texts[id] });
  };

  // Which section am I in. The bottom margin keeps the highlight on the
  // section you are reading rather than the one just entering the viewport.
  useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: '-96px 0px -62% 0px' },
    );
    root.querySelectorAll('article[id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const visible = SECTIONS.filter((s) => matches(s.id));
  const nothingFound = q.length > 0 && visible.length === 0;

  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="Docs"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />

      {/* No overflow anywhere in this chain — see the note at the top. */}
      <main id="main" tabIndex={-1} className="outline-none flex-grow sheet-grid">
        {/* 68px top / 44px bottom — the artifact's `padding: 68px 0 44px`.
            py-[68px] put everything below it 24px too low. */}
        <section className="border-b border-outline-variant pt-[68px] pb-11">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <Eyebrow>Documentation</Eyebrow>
            {/* The accented trailing clause the other marketing pages carry —
                same `text-secondary`, same underline bar at `bottom-[0.12em]`,
                same 0.26 opacity. Only the colour treatment: this page's own
                type scale is left alone, since the docs headline sits above a
                full-width article rather than a hero. */}
            <h1 className="mt-5 font-display-lg text-[clamp(34px,5.4vw,54px)] font-extrabold leading-[1.04] tracking-[-0.038em] text-on-surface text-balance">
              <span className="inline-block">How Forma works,</span>{' '}
              <span className="relative inline-block text-secondary">
                in detail.
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-[0.12em] h-1 origin-left rounded-[2px] bg-secondary opacity-[0.26]"
                />
              </span>
            </h1>
            <p className="mt-4 max-w-[62ch] font-body-lg text-[clamp(16.5px,1.3vw,18.5px)] leading-[1.58] text-on-surface-variant">
              Everything below describes what the application actually does today — the file it produces, the
              limits it enforces, and where your API key lives. If something here disagrees with the app, the
              app is right and this page is a bug.
            </p>
          </div>
        </section>

        {/* No horizontal padding, matching the artifact: its `.doc-body`
            declared `padding: 44px 0 96px`, and that shorthand overrode the
            `0 32px` it inherited from `.wrap`. The article is therefore 880px
            here rather than the 816px a padded container would give.

            `grid-cols-[minmax(0,1fr)]` and `[&>*]:min-w-0` are the same guard the
            `lg:` rule already carries, applied at the base width too — and they
            are load-bearing below 1024px. Without them this collapses to one
            implicit `auto` track shared by the aside and the article, an `auto`
            track floors at its content's min-content width, and the article's
            widest element sets the column. Measured at a 390px viewport the
            track computed to 489px, so the search box and the section list were
            drawn 99px past the right edge. Nothing scrolled sideways — an
            ancestor clipped it — so the sidebar was simply cut off, which is why
            a page-level overflow check reports the page as fine. The `<pre>`
            blocks below already carry `overflow-x-auto`; that only takes effect
            once their ancestors are allowed to shrink. */}
        <div className="max-w-container-max mx-auto grid grid-cols-[minmax(0,1fr)] items-start gap-10 pt-11 pb-24 [&>*]:min-w-0 lg:grid-cols-[244px_minmax(0,1fr)] lg:gap-14">
          {/* ------------------------------------------------- sidebar */}
          <aside className="grid gap-3.5 lg:sticky lg:top-[92px]">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--ink-faint)]">
                <IconSearch size={15} />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the docs"
                aria-label="Search documentation"
                className="u-transition w-full rounded-full border border-outline-variant bg-surface-container-lowest dark:bg-card py-[11px] pl-9 pr-3.5 font-body-lg text-[13.5px] leading-[1.5] text-on-surface placeholder:text-[color:var(--ink-faint)] focus:border-secondary focus:outline-none focus:ring-4 focus:ring-[color:var(--accent-wash)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="u-transition absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-full px-2.5 py-1.5 font-code-sm text-[9.5px] tracking-[0.12em] uppercase text-[color:var(--ink-faint)] hover:text-secondary"
                >
                  clear
                </button>
              )}
            </div>
            {/* What a search found, said aloud (item 79): the list filtered in
                silence, so a screen reader heard nothing change. */}
            <p className="sr-only" role="status" aria-live="polite">
              {q ? (visible.length ? `${visible.length} ${visible.length === 1 ? 'section matches' : 'sections match'}` : 'No section matches') : ''}
            </p>

            <nav className={`${CARD} p-2`} aria-label="Documentation sections">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  hidden={!matches(s.id)}
                  // The section being read, to a screen reader too (2026-11-08, site audit item 79).
                  aria-current={active === s.id ? 'location' : undefined}
                  className={`u-transition flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-body-lg text-[13.5px] leading-[1.4] ${
                    active === s.id
                      ? 'bg-[color:var(--accent-wash)] font-semibold text-secondary'
                      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                  }`}
                >
                  <span
                    className={`shrink-0 font-code-sm text-[10px] ${
                      active === s.id ? 'text-secondary' : 'text-[color:var(--ink-faint)]'
                    }`}
                  >
                    {s.n}
                  </span>
                  {s.title}
                </a>
              ))}
            </nav>

            <div className={`${CARD} p-[18px]`}>
              <div className={`${KICKER} text-secondary`}>Ready to try it</div>
              <p className="mt-2 mb-3.5 font-body-lg text-[12.5px] leading-[1.55] text-on-surface-variant">
                Bring a design and your own Gemini key. Nothing to install, and nothing else to set first.
              </p>
              <button
                onClick={onEnterWorkspace}
                className="u-transition u-press u-focus-ring group inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-secondary-container px-[18px] py-2.5 font-body-lg text-[14px] font-semibold tracking-[-0.005em] text-white hover:bg-[color:var(--accent-deep)]"
              >
                Open the workspace
                <IconArrowRight size={14} className="u-transition group-hover:translate-x-[3px]" />
              </button>
            </div>
          </aside>

          {/* ------------------------------------------------- content

              Same guard as the grid above, and it is needed separately: this is
              a nested grid, so constraining the outer one only caps THIS box —
              its own implicit track is still `auto` and still floors at the
              min-content width of the <Article> cards, which carry the default
              `min-width: auto`. Measured at 390px the outer fix left the column
              correctly at 390 while the cards inside it sat at 489 and spilled
              out of it, so 150 headings, paragraphs and links were still drawn
              outside the viewport. The `<pre>` blocks keep their
              `overflow-x-auto`, so genuinely wide code scrolls in place rather
              than being cut off — verified: applying this takes the count of
              clipped, non-scrollable elements to zero as well. */}
          <div ref={docRef} className="grid grid-cols-[minmax(0,1fr)] gap-7 [&>*]:min-w-0">
            <Article id="start" kicker="Guide" title="Getting started" hidden={!matches('start')}>
              <p className={PROSE}>
                Forma turns a report design you already have, or one you describe in words, into a DevExpress{' '}
                <code className="doc-code">.repx</code> file, with a written specification and a mockup read off
                it and a Preview that prints it as DevExpress would. The whole loop happens in your browser.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ['01 — ADD YOUR KEY', 'Paste a Gemini API key', 'Forma ships without one, so this is the only setup step. The workspace stays locked until a key is present.'],
                  ['02 — SHOW OR DESCRIBE IT', 'Attach a design, or write one', 'Drop a picture, a PDF or a .repx onto the box, or say what the report should show. Every file you add is confirmed on screen before anything is sent.'],
                  ['03 — CHECK THE RESULT', 'Preview it, then ask for changes', 'Switch between the Preview, the mockup, the data, the spec and the XML. Ask for changes in the same conversation, and the chat edits the report in place.'],
                  ['04 — TAKE THE FILE', 'Download the .repx, or export', 'It is parsed and checked in the browser first, then downloads named after the report title; the Preview exports it as PDF, Excel, Word and more.'],
                ].map(([n, h, d]) => (
                  <div key={n} className="rounded-[10px] border border-outline-variant bg-surface-container-low px-[18px] py-4">
                    <div className="font-code-sm text-[10px] font-semibold leading-[1.62] tracking-[0.12em] text-secondary">{n}</div>
                    {/* No `leading-`: the artifact's `.steps h4` sets none, so
                        it inherits the body's 1.62 and renders at 23.5px. */}
                    <h3 className="mt-1.5 font-display-lg text-[14.5px] font-bold tracking-[-0.014em] text-on-surface">{h}</h3>
                    <p className="mt-1.5 font-body-lg text-[13px] leading-[1.55] text-on-surface-variant">{d}</p>
                  </div>
                ))}
              </div>
              <Note label="Good to know">
                Words alone can build a report: describe what it should show ("a sales report by region, with
                a total per region") and Forma designs it, asking a question or two first when something is
                open, each with a suggestion you can keep. A question is answered as a conversation, and with a
                report open the chat changes that report rather than starting another.
              </Note>
            </Article>

            <Article id="key" kicker="Setup" title="Your API key" hidden={!matches('key')}>
              <p className={PROSE}>
                <strong className="font-semibold text-on-surface">
                  Forma ships with no API key and cannot be given one.
                </strong>{' '}
                There is no shared quota and no application key behind the scenes. You supply your own, and
                your browser calls Google directly with it — it never passes through Forma's server, because
                there is no generation endpoint there to pass through.
              </p>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Getting a key
              </h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="1 · Google AI Studio">
                  Sign in at{' '}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener"
                    className="font-semibold text-secondary hover:underline"
                  >
                    aistudio.google.com/apikey
                  </a>{' '}
                  and create a key.
                </Def>
                <Def t="2 · Open the workspace">
                  Without a key the message box is locked, and its button opens Settings at the key; Settings is
                  also under Configure in the sidebar.
                </Def>
                <Def t="3 · Paste it">
                  Into Settings → Gemini key, where it takes effect as you paste it. Check key sends a single
                  one-token request, which also works out which model your key can reach.
                </Def>
              </dl>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Where it is kept
              </h3>
              <p className={`mt-2 ${PROSE}`}>The key is never written to disk in plaintext, on any tier.</p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Working copy">
                  <strong className="font-semibold text-on-surface">Session storage.</strong> The browser
                  erases it when the tab closes — a guarantee a page-unload handler cannot make, because it
                  never fires on a crash or a force-quit.
                </Def>
                <Def t="Durable copy">
                  <strong className="font-semibold text-on-surface">Opt-in, encrypted.</strong> If you want
                  the key on more than one machine, it is encrypted in your browser under a passphrase you
                  choose and only the ciphertext is uploaded.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">Requires a signed-in account.</em>
                </Def>
                <Def t="Legacy plaintext">
                  An older build kept the key unencrypted in local storage. That entry is now deleted
                  automatically every time the app loads.
                </Def>
              </dl>

              <Note label="Only you can decrypt it" tone="safe">
                The passphrase never leaves your browser, so{' '}
                <b className="font-bold text-on-surface">a forgotten passphrase cannot be recovered</b> —
                there is deliberately no reset, because a reset would mean whoever runs Forma could read your
                key. Keep it somewhere safe.
              </Note>
              <Note label="Secure context required">
                Browser encryption is only available over HTTPS or on{' '}
                <code className="doc-code">localhost</code>. Reaching Forma over plain HTTP on a LAN address
                disables the encrypted sync option rather than silently storing anything unprotected.
              </Note>
            </Article>

            <Article id="ai" kicker="Setup" title="Choosing your AI" hidden={!matches('ai')}>
              <p className={PROSE}>
                Gemini designs your reports unless you choose another AI, under{' '}
                <strong className="font-semibold text-on-surface">Settings → AI</strong>. Whichever you choose,
                OCR and Forma's own model work beside it on every request, and every choice can be used for free.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Automatic">
                  Google Gemini with your own free key. Forma finds the models the key can reach and uses the
                  best one that answers; the box offers Fast and Balanced beside Auto.
                </Def>
                <Def t="Local AI">
                  Ollama or LM Studio on this computer: free, unlimited and private, since nothing leaves the
                  machine. The server address starts at <code className="doc-code">http://localhost:11434/v1</code>,
                  where Ollama answers; LM Studio answers at port 1234. Name the model, or{' '}
                  <strong className="font-semibold text-on-surface">Find models</strong> lists what the server has.
                </Def>
                <Def t="OpenRouter">
                  OpenRouter's free models, with a key of your own from openrouter.ai.{' '}
                  <strong className="font-semibold text-on-surface">Find free models</strong> lists them once the key
                  is in. Free models have daily limits, and their providers may log requests. The key is held for
                  this tab only, as the Gemini key is.
                </Def>
                <Def t="A vision model">
                  Optional, on Ollama or LM Studio: Forma's own vision model reads a picture's layout and OCR places
                  its words in it. The AI designs from that draft, and if it cannot answer, the draft is your report.
                </Def>
              </dl>
              <Note label="A local AI needs room">
                A report request is long. Start Ollama with{' '}
                <code className="doc-code">OLLAMA_CONTEXT_LENGTH=32768</code>, or load the model in LM Studio with a
                context of 32,768; a shorter window cuts the request off, and the reply says so.
              </Note>
              <Note label="The Gemini key is still the way in" tone="safe">
                Forma needs your Gemini key to open the workspace whichever AI designs, so the box stays locked
                without one, and Settings → AI offers to add it. Settings → General counts the requests this
                browser has made today.
              </Note>
            </Article>

            <Article id="account" kicker="Setup" title="Your account" hidden={!matches('account')}>
              <p className={PROSE}>
                <strong className="font-semibold text-on-surface">You do not need one.</strong> Forma works fully
                signed out — your projects are kept in this browser and are still there when you come back. An
                account adds three things: your projects and their revisions follow you to another machine, you
                can{' '}
                <a href="#share" className="font-semibold text-secondary hover:underline">
                  share a report
                </a>{' '}
                by link, and you can keep an encrypted copy of your API key so you are not pasting it in again on
                every device.
              </p>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Creating one
              </h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="With Google">
                  One click, nothing to remember. This is the quicker route and the one to prefer unless you have a
                  reason not to.
                </Def>
                <Def t="With an email address">
                  An email and a password of at least eight characters. A name is optional — leave it blank and your
                  email is used instead.
                </Def>
                <Def t="Either way">
                  Signing in never asks for your API key, and your key is never part of a saved project.
                </Def>
              </dl>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Forgotten password
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                Enter your email address on the sign-in screen and choose <strong className="font-semibold text-on-surface">Forgot password</strong>.
                A reset link is sent if an account exists for that address.
              </p>
              <Note label="The wording is the same either way">
                Forma tells you a link is on its way whether or not an account exists for the address you typed. That
                is deliberate: a message that distinguished the two cases would let anyone use this form to find out
                which email addresses have accounts here.
              </Note>

              <Note label="Signing out clears the workspace" tone="safe">
                Not just the credential. The design you uploaded, the text extracted from it and the generated report
                are all cleared, so the next person at that browser does not see your work. Ending a session in
                another tab clears this one too.
              </Note>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Managing the account
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                In the workspace, open the account disc at the foot of the rail and choose{' '}
                <strong className="font-semibold text-on-surface">Account settings</strong>. The dialog lists its
                sections on the left, as Settings does: Profile, then Password and Email address on an account
                with a password, then Delete account.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Profile">
                  The address you are signed in with, a reminder with Send it again until it is verified, and
                  your display name, which you can change at any time. Two characters or more.
                </Def>
                <Def t="Password">
                  Changing it asks for the current one first, and for the new one twice — a typo would otherwise set
                  a password you do not know, and you would find out at the next sign-in somewhere else. Accounts
                  created with Google have no password to change — Google keeps that.
                </Def>
                <Def t="Email address">
                  A confirmation link goes to the <em className="not-italic text-secondary">new</em> address and the
                  account moves only when you open it, so a typo cannot lock you out. Your current password confirms
                  the change, typed in that section.
                </Def>
                <Def t="Deleting the account">
                  Type <strong className="font-semibold text-on-surface">DELETE</strong> and, on a password account,
                  your password. Removes your saved projects with their revision history, every report you shared
                  (its link stops opening), and the encrypted copy of your key. Reports kept only in this browser
                  are not touched. It cannot be undone.
                </Def>
                <Def t="Signed in somewhere you should not be">
                  Change your password: every other session ends within the hour, as Firebase ends them when a
                  password or an address changes. An account that signs in with Google ends its sessions from its
                  Google Account&apos;s security page. If you cannot get in to do either, write through the contact
                  page and the account can be suspended, which ends its sessions, until it is yours again.
                  Forma offers no second factor: Firebase&apos;s needs a paid upgrade, and Forma stays free.
                </Def>
                <Def t="Each section asks for its own password">
                  A password typed under <em className="not-italic text-secondary">Password</em> does not arm the
                  delete button or confirm an email change: each section reads its own box, whichever section
                  you typed in last.
                </Def>
              </dl>

              <Note label="Verifying your email">
                Accounts created with an email and password get a verification link when they are made, and the
                workspace shows a reminder until it is used. Your own work is never withheld in the meantime. The
                one thing a verified address unlocks is a report someone shared with you as Restricted: it opens
                only for the people added, signed in with that address verified, so nobody can read it by signing
                up under someone else's address.
              </Note>
            </Article>

            <Article id="upload" kicker="Input" title="What you can upload" hidden={!matches('upload')}>
              <p className={PROSE}>
                Files are prepared in your browser before anything is sent — resized, rendered, parsed.
                Anything that cannot be used is named on screen rather than skipped silently.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="PNG · JPG">
                  Screenshots, exports and phone photos. Large images are downscaled to a{' '}
                  <strong className="font-semibold text-on-surface">2048px</strong> long edge and re-encoded;
                  anything already smaller is passed through untouched.
                </Def>
                <Def t="PDF">
                  Up to <strong className="font-semibold text-on-surface">8 pages</strong> per file. Each page
                  is rendered at roughly <strong className="font-semibold text-on-surface">250 DPI</strong>{' '}
                  and its text layer is extracted in the same pass. Pages beyond the cap are reported.
                </Def>
                <Def t=".repx">
                  Read as text and validated as XML in your browser before a request is spent, then sent as
                  exact markup so a refinement edits what is really there.
                </Def>
                <Def t="Per request">
                  Up to <strong className="font-semibold text-on-surface">12 attachments</strong>, each up to{' '}
                  <strong className="font-semibold text-on-surface">20 MB</strong>.
                </Def>
              </dl>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Why a PDF beats a screenshot
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                A digital PDF already contains every string and its exact position. Forma reads each page
                twice — once as an image for borders, fills and logos, once as text for content and
                coordinates — and converts every position from PDF points into the report's own grid before
                sending.
              </p>
              <div className="mt-5 overflow-hidden rounded-[10px] border border-outline-variant">
                <div className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low px-3.5 py-2.5">
                  <span className={KICKER}>point conversion</span>
                  <span className={`${KICKER} text-secondary`}>exact</span>
                </div>
                <pre className="m-0 overflow-x-auto bg-[color:var(--code-bg)] p-4 font-code-sm text-[11.5px] leading-[1.75] text-[color:var(--code-ink)]">
{`612 × 792 pt  →  × 100 / 72  →  850 × 1100 report units
y_top = pageHeight − (baseline + height)`}
                </pre>
              </div>
              <Note label="Two things to watch">
                A <b className="font-bold text-on-surface">scanned</b> PDF or a photo has no text layer. Forma
                reads its words with OCR in your browser instead (English, and Arabic, Urdu, Hindi, French,
                German or Spanish when the page is in one) — expect the odd misread string where a digital PDF
                would have been exact; the picture's viewer shows what was read. And on an unusually text-dense page, extraction stops at{' '}
                <b className="font-bold text-on-surface">400 strings per page</b>, so if accuracy drops off at
                the bottom of a busy page, that is the cause.
              </Note>
            </Article>

            <Article id="run" kicker="Guide" title="Running and refining" hidden={!matches('run')}>
              <p className={PROSE}>
                Most reports take two or three passes. The first gets the structure, and the ones after it fix the
                parts that came out wrong. Nothing is thrown away between them.
              </p>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                While it runs
              </h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Three dots">
                  While Forma works, the reply shows three dots and every step happens behind the scenes, as in
                  the chat apps you know. The first request of a session is slower than the rest because it also
                  works out which model your key can reach.
                </Def>
                <Def t="Stop">
                  The send button becomes Stop while Forma works, and aborts the request in flight; Escape in
                  the box does the same.
                </Def>
                <Def t="The queue">
                  What you send while Forma works waits in a queue over the box. Steer sends one now and changes
                  the request under way; Stop pauses the queue, and Resume sends it on.
                </Def>
              </dl>
              <Note label="Cancelling is local">
                Stop tears down the connection from your side. Google may still finish generating the response,
                and if it does, it counts against your key. Cancelling saves you the wait, not necessarily the
                request.
              </Note>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Reading the result
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                One request comes back as the .repx, and the specification and the mockup are read off it, so the
                three always agree.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="The specification">
                  A component inventory in markdown, read off the .repx — every element, where it sits, its type,
                  its font and its borders. Useful on its own as the written brief you would otherwise have produced by hand, and
                  worth reading first: if the specification describes the wrong thing, the layout will too.
                </Def>
                <Def t="The mockup">
                  The layout drawn at true proportions, on a sheet that stays white in both light and dark themes
                  because a printed report does. Check positions and alignment here rather than in the XML. Charts
                  are stylised and gauges and barcodes are marked out but not drawn — see{' '}
                  <a href="#controls" className="font-semibold text-secondary hover:underline">
                    Supported controls
                  </a>{' '}
                  for what that means.
                </Def>
                <Def t="The XML">
                  The DevExpress file itself, syntax-coloured with line numbers and a copy action. Covered in{' '}
                  <a href="#repx" className="font-semibold text-secondary hover:underline">
                    The .repx file
                  </a>
                  .
                </Def>
                <Def t="The Preview">
                  The report paged as DevExpress prints it, over test data Forma can make. Drag or retype a
                  control here, and export it as PDF (with an outline, a password, or as PDF/A), Excel, CSV,
                  Word, RTF, HTML or a picture, all in your browser.
                </Def>
              </dl>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Asking for changes
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                Say what is wrong rather than describing the whole report again. With a report open, the chat reads
                its outline and does one of three things: answers a question about it; edits the file in place (a
                move, a font, a colour, a border, a number format, a binding, a page number, a table's row or
                column, a duplicate, a band's height); or, for what an edit cannot reach, asks before redesigning
                it. Each reply lists what changed, with Undo and Redo, and "undo that" in the chat takes the last
                change back.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Name the region">
                  <em className="not-italic text-[color:var(--ink-faint)]">"The totals block should sit under the
                  table, not beside it."</em> Pointing at a part of the page works better than restating the
                  requirements.
                </Def>
                <Def t="One thing at a time">
                  A short instruction is easier to apply correctly than five bundled together, and it is easier to
                  tell which one did not take.
                </Def>
                <Def t="Say it is a table">
                  If a grid came back as separate labels, ask for that region to be one table with rows and cells.
                  It is the most common single correction.
                </Def>
                <Def t="Questions stay questions">
                  A question is answered as a conversation, not with a new report. Asking "what does
                  ReportUnit mean?" costs you a sentence; describing a report is what builds one.
                </Def>
              </dl>
            </Article>

            <Article id="workspace" kicker="Guide" title="The workspace" hidden={!matches('workspace')}>
              <p className={PROSE}>
                Laid out as the chat apps you know: a sidebar on the left, the report filling the rest, and one box
                at the foot that takes every request — a file, a description, a question or a change.
              </p>

              <h3 className={H3}>The sidebar</h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="New report">
                  An empty workspace whose home asks{' '}
                  <em className="not-italic text-on-surface">What report shall we make?</em>, with six starting
                  points — invoice, customer list, sales by region, employee directory, purchase order, inventory
                  status — that fill the box for you, and your five most recent projects.
                </Def>
                <Def t="Search and Saved projects">Find a project and reopen it where you left it.</Def>
                <Def t="Revisions, Batch, Report library">
                  Three panels: the{' '}
                  <a href="#revisions" className={LINK}>versions of this report</a>,{' '}
                  <a href="#batch" className={LINK}>many files at once</a>, and{' '}
                  <a href="#memory" className={LINK}>reports whose style to match</a>.
                </Def>
                <Def t="Configure">Opens Settings: General, AI, Gemini key and Memory.</Def>
                <Def t="Your account">
                  The disc at the foot: Account settings and Sign out, or Sign in. Ctrl+B shows or hides the
                  sidebar; on a phone it is a drawer.
                </Def>
              </dl>

              <h3 className={H3}>The report</h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Five views">
                  <strong className="font-semibold text-on-surface">Mockup</strong>,{' '}
                  <strong className="font-semibold text-on-surface">Preview</strong>,{' '}
                  <strong className="font-semibold text-on-surface">Data</strong>,{' '}
                  <strong className="font-semibold text-on-surface">Spec</strong> and{' '}
                  <strong className="font-semibold text-on-surface">REPX</strong>, all read off the one file. Zoom
                  with + and −, and Ctrl+\ clears the screen of everything but the report.
                </Def>
                <Def t="On the Preview">
                  Click a control to select it, drag it or nudge it with the arrows, double-click to retype it, and
                  right-click for its menu. Ctrl+L puts the selection in the chat, so a request can name it.
                </Def>
                <Def t="The title">
                  The project's name, with its menu: Rename, Duplicate, Archive and Delete for a saved project. The
                  pin beside it pins the project on this device.
                </Def>
                <Def t="Save, Share, Export">
                  In the bar above the report. Export opens every format in one panel, the .repx first;{' '}
                  <a href="#share" className={LINK}>Share</a> needs an account.
                </Def>
              </dl>

              <h3 className={H3}>The conversation</h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="The request card">
                  Floats over the report and shows one request at a time. Your message carries its time, Copy,
                  Edit and Withdraw, and its versions when you edited it (1/2, with arrows between them). Forma's
                  reply carries Copy, Good reply and Bad reply, Try again, and for a change what was Changed, with
                  Undo and Redo. Fold the reply away to see the report under it.
                </Def>
                <Def t="The request log">
                  Every request of the project, each marked Working, Failed, Waiting for you or Answered, with a
                  search box, and an export of the whole chat as a Markdown file.
                </Def>
                <Def t="The command menu">
                  Ctrl+K, then type: a view, an export, Share, test data, a zoom, Go to a control, a project or a
                  panel. "?" lists every <a href="#shortcuts" className={LINK}>keyboard shortcut</a>.
                </Def>
              </dl>
            </Article>

            <Article id="data" kicker="Guide" title="Data and binding" hidden={!matches('data')}>
              <p className={PROSE}>
                A report designed from a picture prints the values it saw. The{' '}
                <strong className="font-semibold text-on-surface">Data</strong> view binds them to your fields, so
                it prints your records instead. Attach a data file to a message (CSV, TSV, JSON, text, SQL, Excel or
                Word) and its fields are used from the start; or bind an existing report in three steps.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="1 · Your data">
                  Paste a JSON row, a CSV, a <code className="doc-code">CREATE TABLE</code> statement or a list of
                  field names. It is read in your browser, never sent anywhere.
                </Def>
                <Def t="2 · Map the columns">
                  Each column of the report, the sample it shows now, and the field it should print.
                </Def>
                <Def t="2b · Prompt-to-Expression">
                  For a column that is worked out rather than read, describe it —{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">"quantity times unit price, less the
                  discount"</em> — and Generate writes the DevExpress expression; Use expression puts it on the
                  column. It may name only fields your data has, and waits while a problem is listed.
                </Def>
                <Def t="3 · Write the bindings">
                  Apply to the .repx writes them into the file. The view then says how many fields the report is
                  bound to, or, for a report that cannot be bound yet, why.
                </Def>
              </dl>
              <Note label="Test data">
                Once fields are bound,{' '}
                <strong className="font-semibold text-on-surface">Test data</strong> on the Preview's toolbar asks
                the AI for up to twenty made-up rows, one request, so you can see the report page, group and total
                as it will with real records. They are never written into the file, and Clear takes them away.
              </Note>
            </Article>

            <Article id="controls" kicker="Reference" title="Supported controls" hidden={!matches('controls')}>
              <p className={PROSE}>
                Regions of your design are mapped to real DevExpress controls. These are the ones Forma
                asks for by name; where the mockup and the file differ, it is said so below.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="XRLabel">
                  Headings, field labels, addresses and values. Carries font family, size and weight, bold and
                  italic, horizontal and vertical alignment, wrapping, colour, and per-side borders.
                </Def>
                <Def t="XRTable">
                  Line-item grids, as a real table with populated rows and cells weighted relatively — not a
                  grid faked out of loose labels that falls apart when a column moves.
                </Def>
                <Def t="XRPictureBox">
                  Logos, stamps and photo slots. Each picture is located in your upload and cropped out of it,
                  so the mockup shows your own artwork.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    In the file it is placed and sized where the picture was, for you to point at the image in
                    the designer: the image itself is not written into the .repx.
                  </em>
                </Def>
                <Def t="XRLine">Rules and dividers, placed at exact coordinates.</Def>
                <Def t="XRPageInfo">
                  Page numbers and dates, where the source has them or when you ask for them in the chat.
                </Def>
                <Def t="XRCheckBox">A tick box, checked or not, or bound to a yes-or-no field.</Def>
                <Def t="XRPanel">
                  A box that holds other controls and moves them as one. The mockup draws what is inside it.
                </Def>
                <Def t="XRShape and cross-band lines">
                  Rectangles, ellipses and lines, and the lines and boxes drawn from one band to another, as on a
                  form with a border round the page.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">The Preview draws them; the mockup does not.</em>
                </Def>
                <Def t="XRCrossTab">
                  A pivot of rows against columns, written with the layout DevExpress generates for it.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    The Preview draws its grid over test data; the mockup marks where it sits.
                  </em>
                </Def>
                <Def t="XRSubreport and a table of contents">
                  Kept from a report you bring; Forma does not invent a subreport. A table of contents is built
                  from the report's bookmarks.
                </Def>
                <Def t="XRBarCode">
                  Written into the file as a real barcode control, carrying its symbology.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    In the mockup it is a decorative stand-in: positioned and sized, but its content is not
                    drawn.
                  </em>
                </Def>
                <Def t="Charts">
                  A real <code className="doc-code">XRChart</code> in the file, with a series bound to the
                  fields the axes name — bar, column, line, area, scatter and pie.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    In the mockup it is drawn stylised from its type and values. That is not a charting
                    library and should not be read as data; the file carries the control, the picture is an
                    approximation of it.
                  </em>
                </Def>
                <Def t="Gauges and sparklines">
                  A dial or a trend line becomes a real <code className="doc-code">XRGauge</code> or{' '}
                  <code className="doc-code">XRSparkline</code>, carrying its value, range and target.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    On screen it stays a positioned placeholder — the mockup draws no needle.
                  </em>
                </Def>
              </dl>
            </Article>

            <Article id="repx" kicker="Output" title="The .repx file" hidden={!matches('repx')}>
              <p className={PROSE}>
                The file is standard <code className="doc-code">XtraReportsLayoutSerializer</code> XML.
                Everything is positioned in the report's unit, by default{' '}
                <strong className="font-semibold text-on-surface">hundredths of an inch</strong> — 100 units
                to the inch, which is the unit DevExpress itself stores — so a Letter page is 850 × 1100.
              </p>
              <div className="mt-5 overflow-hidden rounded-[10px] border border-outline-variant">
                <div className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low px-3.5 py-2.5">
                  <span className={KICKER}>invoice_report.repx</span>
                  <span className={`${KICKER} text-secondary`}>parse-checked before download</span>
                </div>
                <pre className="m-0 overflow-x-auto bg-[color:var(--code-bg)] p-4 font-code-sm text-[11.5px] leading-[1.75] text-[color:var(--code-ink)]">
                  <XmlSample />
                </pre>
              </div>
              <p className={`mt-4 ${PROSE}`}>
                Before you can download it, Forma parses the XML and checks that it has the right root element
                and a <code className="doc-code">&lt;Bands&gt;</code> section. A malformed generation therefore
                surfaces in the browser rather than when the designer refuses the file. It is also audited for
                what DevExpress would drop or print wrong. A generation that ends without a complete file is
                repaired where it can be, and otherwise marked as failed with Try again, never handed to you
                as a broken file.
              </p>

              <h3 className={H3}>What the checks find</h3>
              <p className={`mt-2 ${PROSE}`}>
                The audit runs after Forma's own repairs, so what it lists is what is still wrong. It blocks
                nothing. An <strong className="font-semibold text-on-surface">error</strong> means DevExpress will
                lose content or refuse part of the file; a{' '}
                <strong className="font-semibold text-on-surface">warning</strong> means it will print differently
                from how it looks. The REPX view lists them under a count, and a reply after a change says how many
                the checks found.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Errors">
                  A file that stops before its end; a reused <code className="doc-code">Ref</code>, which makes the
                  designer drop content without a word; a total with no running scope, which prints blank; a detail
                  report with no Detail band; a calculated field with no expression or a duplicate name; a cross-tab
                  with no layout; a formatting rule that points at nothing.
                </Def>
                <Def t="Layout">
                  Controls that overlap, leave the page or fall below their band; a band taller than the page; a
                  grid drawn as loose labels rather than a table; a page size that does not match the paper.
                </Def>
                <Def t="Data">
                  A parameter used but not declared, or declared and unused; a group with no fields; a sort on the
                  wrong band; a chart with no series; a subreport with no source.
                </Def>
                <Def t="Accessibility">
                  Text too small, contrast too low, a picture with no description: the three checks DevExpress's
                  own designer runs on every edit.
                </Def>
              </dl>
            </Article>

            <Article id="config" kicker="Reference" title="Settings and what is worked out" hidden={!matches('config')}>
              <p className={PROSE}>
                Nothing has to be set before a run. What used to be a configuration dialog is worked out from what
                you bring, and anything else is a sentence in the chat. Settings shows what was worked out for the
                last request, and why.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="DevExpress version">
                  The version a .repx you bring declares, otherwise the version of the last one you brought,
                  otherwise 23.2. The tag is not a gate: a report targeting a
                  newer release still opens, and the designer rewrites the version when it saves.
                </Def>
                <Def t="Paper">
                  Letter, A4, Legal or Tabloid, portrait or landscape: from the page you attach, then your words
                  ("on A4, landscape"), then your region — Letter in the Americas and the Philippines, A4 elsewhere.
                </Def>
                <Def t="Report unit">
                  Hundredths of an inch, tenths of a millimetre, or pixels, read from a .repx you bring or the last
                  one. This is the scale every coordinate and size in the generated file is written in — change it and{' '}
                  <code className="doc-code">LocationFloat</code> and{' '}
                  <code className="doc-code">SizeF</code> mean something different, so it has to match
                  what your report expects. Hundredths of an inch is the DevExpress default and what a
                  Letter page of 850 × 1100 refers to. The REPX pane names the scale in use, so the
                  file you are about to export is never ambiguous. Font sizes are the one exception:
                  they are always in points, whatever this is set to.
                </Def>
                <Def t="Direction">Right to left when the text you bring reads that way.</Def>
                <Def t="Data">
                  The fields from a data file you attach, or the Data tab, or the columns your words name; a
                  stored procedure from your words or your data.
                </Def>
              </dl>
              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                The model: found for you, and yours to change
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                Google retires models "for new users", so a hard-coded model id is a time bomb — an existing
                project keeps working while every freshly created key gets a 404. So Forma probes which models
                your key can actually reach, once per session, and uses the best one that answers (Auto). The
                box offers Fast and Balanced beside it, and Settings → AI swaps Gemini for a local AI (Ollama
                or LM Studio) or OpenRouter's free models.
              </p>
            </Article>

            <Article id="saving" kicker="Guide" title="Saving your work" hidden={!matches('saving')}>
              <dl className="border-t border-outline-variant">
                <Def t="Saved as you work">
                  There is nothing to remember to do: a project is saved a moment after each change, and as soon as
                  a message is sent. Save above the report saves at once.
                </Def>
                <Def t="Signed in">
                  Projects are saved to your account and appear on every device you sign in from.
                </Def>
                <Def t="Signed out">
                  Projects stay in this browser. Reload the page and they are still there — they simply do not
                  follow you to another machine.
                </Def>
                <Def t="Either way">Your API key is never part of what gets saved.</Def>
              </dl>
              <p className={`mt-4 ${PROSE}`}>
                Your uploads travel inside the saved conversation, so a very large design can outgrow a single
                cloud record. When that happens Forma re-saves the project without the source thumbnails and
                tells you it did — keeping the specification, the layout and the XML is strictly better than
                losing the save. A saved project without its thumbnails still reopens and still exports.
              </p>
              <Note label="Signing out clears the workspace">
                Not just the credential: the uploaded design, the text extracted from it and the generated
                report are all cleared, so the next person at that browser does not see your work. Ending a
                session in another tab clears this one too.
              </Note>
            </Article>

            <Article id="share" kicker="Guide" title="Sharing a report" hidden={!matches('share')}>
              <p className={PROSE}>
                Share a report as you would a document: sign in, open it and choose{' '}
                <strong className="font-semibold text-on-surface">Share</strong> above the report. What you share
                is a copy of the report; the conversation is never part of it.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Restricted">
                  Only the people you add by email address, up to fifty, can open it, signed in with that address
                  verified.
                </Def>
                <Def t="Anyone with the link">Opens for anyone who has the link, without signing in.</Def>
                <Def t="Sending it">
                  Forma sends no email. Copy link, and send it yourself however you like.
                </Def>
                <Def t="What they see">
                  The report's name, its Preview, read-only, and Download .repx. A link that is not theirs to open
                  says so, and nothing else.
                </Def>
                <Def t="Keeping it current">
                  The copy stays as it was shared until you choose Update the shared copy.
                </Def>
                <Def t="Stopping">
                  Stop sharing, and the link stops opening. Deleting the project, or your account, deletes its
                  shared copies too.
                </Def>
              </dl>
              <Note label="Kept out of search" tone="safe">
                Shared links ask search engines not to index them, so a report shared with anyone who has the
                link is still found only through the link.
              </Note>
            </Article>

            <Article id="memory" kicker="Guide" title="Memory and house style" hidden={!matches('memory')}>
              <p className={PROSE}>
                Forma can keep what you tell it and learn how your reports usually look. Both stay in this
                browser.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Remember">
                  Start a message with <em className="not-italic text-on-surface">remember</em> or{' '}
                  <em className="not-italic text-on-surface">from now on</em> —{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">"From now on, put the logo top
                  right"</em> — and Forma keeps it for the reports after. A question is never kept, and nothing
                  else you say becomes a memory.
                </Def>
                <Def t="Seeing them">
                  Settings → Memory lists every memory, with a switch to pause it, Edit and Forget; Remember adds
                  one by hand.
                </Def>
                <Def t="Learning your style">
                  With <em className="not-italic text-on-surface">Learn the style of reports I keep</em> on, a
                  report you export or save counts as kept, and from two of them Forma learns your house style.
                  The newest thirty are kept; Forget kept reports and Forget everything ask before they act.
                </Def>
              </dl>

              <h3 className={H3}>The report library</h3>
              <p className={`mt-2 ${PROSE}`}>
                <strong className="font-semibold text-on-surface">Report library</strong> in the sidebar holds
                reports you have already published, so Forma can match their formatting. Add .repx files, several
                at once; before anything is stored, every text, name, field, data source, expression and link in
                them is replaced, keeping only positions, fonts, colours and formats. A report is used only once
                you tick it as house style — nothing is used until you do. The library lives in this browser, and
                adding to it uses your Gemini key.
              </p>
            </Article>

            <Article id="batch" kicker="Guide" title="Batch generation" hidden={!matches('batch')}>
              <p className={PROSE}>
                The <b className="font-bold text-on-surface">Batch</b> panel turns a set of legacy
                reports into a set of <code>.repx</code> files — each source document becoming its own
                report. That is the opposite of attaching several files to the composer, where several
                pages build <em>one</em> report, and the two are indistinguishable from the files
                themselves, so the distinction is made by where you put them.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="One at a time, or two or three">
                  Files run one at a time by default. Your key carries the quota, and forty simultaneous
                  requests turn a slow success into a fast 429; a key whose quota allows it can run two or
                  three at once.
                </Def>
                <Def t="A verdict per row">
                  Each finished row carries the structural audit's answer in the same words the REPX pane
                  uses — clean, N warnings, or N errors and content will be lost — because the point of
                  running forty files is knowing which of the forty are worth opening.
                </Def>
                <Def t="Stop and retry">
                  Stop cancels what has not started and leaves the request already in flight alone, since it
                  is billed to your key either way. Retry requeues the failed and cancelled files and keeps
                  what succeeded. A quota, key or permission failure stops the whole run rather than
                  producing forty identical errors.
                </Def>
                <Def t="Taking them away">
                  A finished row opens in the workspace or downloads on its own, and Download as .zip takes
                  them all at once.
                </Def>
              </dl>
              <Note label="Files or a folder">
                Choose files, as many as you like, or a folder, or drop a folder onto the panel: every report
                in it is queued with its path.
              </Note>
            </Article>

            <Article id="revisions" kicker="Guide" title="Revision history" hidden={!matches('revisions')}>
              <p className={PROSE}>
                Every generation, refinement and data-binding pass is kept in the{' '}
                <b className="font-bold text-on-surface">Revisions</b> panel, newest first, with what it
                changed — so a refinement that made the report worse is one click from being undone.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="What changed, not just when">
                  The difference is worked out structurally, by control name: added, removed, moved, resized,
                  retyped, plus any change in the band count. A line-by-line comparison of two XML files
                  would be almost entirely noise, because the model rewrites whitespace and attribute order
                  freely between runs.
                </Def>
                <Def t="Restoring is itself recorded">
                  Going back to an earlier version does not lose the newer one. Otherwise Restore would be
                  the very trap the panel exists to remove.
                </Def>
                <Def t="Nudging is not a revision">
                  Dragging or retyping a control on the Preview is undone with Undo at the corner of the report, or
                  Ctrl+Z, one step per gesture.
                  Recording those here would bury the three or four versions you actually want under forty
                  small adjustments.
                </Def>
                <Def t="How long they last">
                  Signed in, the newest ten are saved with the project and come back when you reopen it.
                  Signed out, they live for the session. The panel says which of the two you are getting.
                </Def>
              </dl>
            </Article>

            <Article id="shortcuts" kicker="Reference" title="Keyboard shortcuts" hidden={!matches('shortcuts')}>
              <p className={PROSE}>
                The same list the workspace shows when you press <kbd className={KBD}>?</kbd> outside a text field.
                On a Mac, <kbd className={KBD}>⌘</kbd> takes the place of Ctrl.
              </p>
              <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {shortcutGroups(false).map((group) => (
                  <section key={group.title} aria-label={group.title}>
                    <div className={`${KICKER} text-secondary`}>{group.title}</div>
                    <dl className="mt-2 border-t border-outline-variant">
                      {group.rows.map(([label, keys]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-3 border-b border-outline-variant py-2"
                        >
                          <dt className="font-body-lg text-[14px] leading-[1.45] text-on-surface-variant">{label}</dt>
                          <dd className="flex shrink-0 gap-1">
                            {keys.map((k) => (
                              <kbd key={k} className={KBD}>
                                {k}
                              </kbd>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </Article>

            <Article id="trouble" kicker="Support" title="Troubleshooting" hidden={!matches('trouble')}>
              <dl className="border-t border-outline-variant">
                {/* The sign-in page sends "Cannot get in?" here (2026-11-08,
                    site audit item 46), and there was nothing about signing in. */}
                <Def t="Cannot sign in">
                  With Google, the sign-in opens in a pop-up: if nothing appears, allow pop-ups for this site and
                  try again. With an email address, check it is the one the account was made with; Forgot password
                  on the sign-in page sends a reset link. Signing in is optional — Forma works signed out, with your
                  work kept in this browser — and{' '}
                  <a href="#account" className={LINK}>Your account</a> has the rest.
                </Def>
                <Def t={'"No longer available"'}>
                  A model your key could once reach has been retired. Forma clears its cached choice,
                  re-detects and retries once, by itself. If it persists, the key has access to no supported
                  model.
                </Def>
                <Def t="Quota exceeded">
                  Your key has no remaining allowance on that model. Forma sets the model aside for as long as
                  Google says the limit lasts, so the next request starts on another model your key can reach.
                  The allowance is between you and Google — Forma has no quota to share, since it uses no key of
                  its own.
                </Def>
                <Def t="Model overloaded">
                  Google's capacity for that model is momentarily exhausted. Forma retries it with a growing
                  pause, then moves to another model your key can reach. Editing the prompt does not help;
                  waiting does.
                </Def>
                <Def t={'"Forma built this draft without it"'}>
                  The AI could not answer, and the reply says why: offline, out of quota, overloaded, not
                  reachable, or a context window too small. A draft Forma built itself, from the text OCR read
                  and its own models, stands in so you are not left with nothing; send the request again when the
                  AI is back to have it designed in full.
                </Def>
                <Def t="A local AI does not answer">
                  Check that Ollama or LM Studio is running at the server address in Settings → AI, and that the
                  model named there is loaded. "Too small" means the context window: start it with 32,768, as{' '}
                  <a href="#ai" className={LINK}>Choosing your AI</a> says. A model that spends its whole answer
                  reasoning writes no report; choose another.
                </Def>
                <Def t="Nothing happens on send">
                  Check that a key is set. With none, the box is locked and its button opens Settings at the
                  key.
                </Def>
                <Def t="The layout is roughly right">
                  Upload the original PDF rather than a screenshot of it. Exact strings and coordinates come
                  from the text layer, which a screenshot does not have.
                </Def>
                <Def t="Generation feels slow">
                  The first request of a session also pays for model detection, and a picture's words are read
                  by OCR before it is sent. Stop aborts the request for real.
                </Def>
              </dl>
            </Article>

            <Article id="faq" kicker="Support" title="Frequently asked questions" hidden={!matches('faq')}>
              <div className="grid gap-2.5">
                {FAQS.map((f) => (
                  // <details> rather than a state-driven accordion: keyboard and
                  // screen-reader behaviour comes free and correct.
                  <details
                    key={f.q}
                    className="group overflow-hidden rounded-[10px] border border-outline-variant bg-surface-container-low"
                  >
                    <summary className="u-transition flex cursor-pointer list-none items-center justify-between gap-3.5 px-[18px] py-[15px] font-body-lg text-[14.5px] font-semibold tracking-[-0.012em] text-on-surface hover:bg-surface-container-high [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <IconChevronDown
                        size={16}
                        className="u-transition shrink-0 text-[color:var(--ink-faint)] group-open:rotate-180"
                      />
                    </summary>
                    {/* The wrapper is 14px, but its paragraphs are 15.5px/1.68.
                        That is not an inconsistency — in the artifact the <p>
                        inside .ans is caught by `article p`, which outranks the
                        wrapper's own font-size, so the answers render larger
                        than the container that holds them. */}
                    <div className="px-[18px] pb-4 font-body-lg text-[14px] leading-[1.65] text-on-surface-variant [&>p]:text-[15.5px] [&>p]:leading-[1.68]">
                      {f.a}
                    </div>
                  </details>
                ))}
              </div>
            </Article>

            {nothingFound && (
              <div className="rounded-2xl border border-dashed border-outline-variant px-8 py-14 text-center">
                <p className="font-body-lg text-[15px] text-on-surface-variant">Nothing here matches that search.</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-3 cursor-pointer font-body-lg text-[14px] font-semibold text-secondary hover:underline"
                >
                  Clear the search
                </button>
              </div>
            )}

            {/* Feedback. Since 2026-11-08 (site audit item 12) "Not really" opens a
                GitHub issue prefilled with what was typed and the article being
                read, which the person sends themselves: the box promised a fix and
                threw the words away, nothing being wired behind it. Forma collects
                nothing here; the site promises no analytics. */}
            {!q && (
              <section className={`${CARD} p-[30px] sm:px-[38px] sm:py-9`}>
                <div className={`${KICKER} text-secondary`}>Improve these docs</div>
                <h2 className="mt-3 font-display-lg text-[22px] font-extrabold leading-[1.2] tracking-[-0.026em] text-on-surface">
                  Did this answer your question?
                </h2>
                <p className="mt-2.5 font-body-lg text-[14.5px] leading-[1.6] text-on-surface-variant">
                  If not, say what was missing: it opens as an issue on GitHub, where the docs are fixed and you can
                  follow the answer.
                </p>

                {sent ? (
                  <div className="mt-5 flex items-start gap-3 rounded-[10px] border border-success/35 bg-success/10 px-[18px] py-4">
                    <IconCheck size={18} className="mt-0.5 shrink-0 text-success" />
                    <p className="font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">
                      {helpful
                        ? 'Thanks.'
                        : 'Thanks. The issue opened in a new tab; it is filed once you submit it there.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mt-5 flex gap-2.5">
                      {[
                        { yes: true, label: 'Yes', Icon: IconThumbUp },
                        { yes: false, label: 'Not really', Icon: IconThumbDown },
                      ].map(({ yes, label, Icon }) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={helpful === yes}
                          onClick={() => {
                            setHelpful(yes);
                            if (yes) setSent(true);
                          }}
                          // leading-[normal]: the artifact has no Tailwind
                          // preflight, so its buttons keep the UA's
                          // line-height:normal rather than inheriting 1.62.
                          className={`u-transition inline-flex flex-1 cursor-pointer items-center justify-center gap-2.5 rounded-full border px-4 py-3 font-body-lg text-[14px] font-semibold leading-[normal] ${
                            helpful === yes
                              ? 'border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-secondary'
                              : 'border-outline-variant bg-surface-container-low text-on-surface-variant hover:border-[color:var(--ink-faint)] hover:text-on-surface'
                          }`}
                        >
                          <Icon size={15} />
                          {label}
                        </button>
                      ))}
                    </div>

                    {helpful === false && (
                      <div className="mt-4">
                        <label htmlFor="docs-feedback" className={`${KICKER} block`}>
                          What were you looking for?
                        </label>
                        <textarea
                          id="docs-feedback"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="e.g. how to bind a report to a stored procedure"
                          className="u-transition mt-2 min-h-24 w-full resize-y rounded-[10px] border border-outline-variant bg-surface-container-low px-4 py-3 font-body-lg text-[14px] leading-[1.6] text-on-surface placeholder:text-[color:var(--ink-faint)] focus:border-secondary focus:outline-none focus:ring-4 focus:ring-[color:var(--accent-wash)]"
                        />
                        <div className="mt-3.5 flex justify-end">
                          <a
                            href={docsIssueUrl(comment, active)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setSent(true)}
                            className="u-transition u-press u-focus-ring cursor-pointer rounded-full bg-secondary-container px-5 py-2.5 font-body-lg text-[14px] font-semibold text-white hover:bg-[color:var(--accent-deep)]"
                          >
                            Open an issue on GitHub
                          </a>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      </main>

      <SiteFooter
        onThisPage={[
          ['Getting started', '#start'],
          ['Your API key', '#key'],
          ['Choosing your AI', '#ai'],
          ['The workspace', '#workspace'],
          ['Data and binding', '#data'],
          ['Sharing a report', '#share'],
          ['Keyboard shortcuts', '#shortcuts'],
          ['FAQ', '#faq'],
        ]}
      />
    </div>
  );
}
