import { memo, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import { Eyebrow } from './landing/sections';
import { articleMatches, docsIssueUrl, DOCS_SECTIONS as SECTIONS } from '../lib/docsSearch';
import { shortcutGroups } from '../lib/shortcuts';
import { FAQS } from './faqs';
import { DESIGNER_REQUIREMENTS, DEVEXPRESS_TRIAL_URL } from '../lib/designerRelease';
import { MAX_INVITED, MAX_SHARES } from '../lib/shares';
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

// The sections and their keywords live in lib/docsSearch.ts (2026-11-10), where the chat reads them too.

/** The furniture the newer articles share (2026-11-08). */
const H3 = 'mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface';
const LINK = 'font-semibold text-secondary hover:underline';
const KBD =
  'inline-block min-w-[1.6em] rounded-md border border-outline-variant bg-surface-container-low px-1.5 py-px text-center font-code-sm text-[11.5px] leading-[1.5] text-on-surface';


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

/**
 * Draws `render()` again only when `deps` changes (2026-11-11, full audit
 * PR-25). The thirty articles were re-drawn on every keystroke in the search
 * and every time the section being read changed, though all they depend on is
 * which of them a search hides. `render` is new on every draw of the page, so
 * when `deps` does change it is the current one that runs.
 */
const Kept = memo(
  function Kept({ render }: { deps: string; render: () => ReactNode }) {
    return <>{render()}</>;
  },
  (before, after) => before.deps === after.deps,
);

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

  // The search filters a step behind the typing (2026-11-11, full audit
  // PR-25): every keystroke re-drew all thirty articles before the box
  // showed the letter, so a fast typist waited on the page.
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();
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
  // What the articles depend on, and all they depend on: which are hidden.
  const hiddenKey = SECTIONS.filter((s) => !matches(s.id)).map((s) => s.id).join(' ');

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
              app is right and this page is a bug. What changed, and when, is on the{' '}
              {/* Site audit item 109 left this link for the Docs rewrite, which did not add it (2026-11-08). */}
              <a href="/changelog" className={LINK}>changelog</a>.
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
            {/* Drawn again only when a search hides or shows an article (PR-25). */}
            <Kept deps={hiddenKey} render={() => (<>
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
                a total per region") and Forma designs it straight away. Only when there is too little to start
                from does it ask one short question first. A question is answered as a conversation, and with a
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
                <Def t="A new tab">
                  A Forma tab you open while another is open gets the key from it, inside this browser, so you
                  do not paste it again; when the last Forma tab closes, it is gone. Settings, under Gemini key,
                  turns this off.
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
                  is in. Free models have daily limits, and their providers may log requests. The key is held in
                  your open Forma tabs only, as the Gemini key is.
                </Def>
                <Def t="A vision model">
                  Optional, on Ollama or LM Studio: Forma's own vision model reads a picture's layout and OCR places
                  its words in it. The AI designs from that draft, and if it cannot answer, the draft is your report.
                </Def>
                {/* The free chain and the page reader shipped in 1.4.0 and had no
                    words here (2026-11-11, full audit PS-12). */}
                <Def t="When the AI you chose reaches its limit">
                  Gemini first moves to another model your key can reach. When its free allowance is used up,
                  the next AI you have set up answers on its own, OpenRouter and then a local AI. A request you
                  sent to a local AI is never sent on to another, since you chose that nothing leaves your
                  computer. When none can answer, Forma&apos;s own quicker version of the page is your report,
                  and you can send the request again later.
                </Def>
                <Def t="Page reader">
                  Optional, on Ollama or LM Studio: a model that reads a picture&apos;s text, such as glm-ocr. Its
                  reading goes to the AI beside the text OCR read, so a word the two read differently is checked
                  against the picture. With Local AI chosen, Settings → AI suggests one sized for this
                  computer&apos;s memory.
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
                  (its link stops opening), what Forma learned from your use, and the encrypted copy of your key.
                  Reports kept only in this browser
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
                workspace reminds you until it is used. Your own work is never held back. A verified address is
                needed to share a report, and to open one shared with you as Restricted, so nobody can share or
                read under someone else's address.
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
                  anything already smaller is passed through untouched. A photo or a scan taken crooked, or on
                  its side, is straightened before it is read.
                </Def>
                <Def t="PDF">
                  Up to <strong className="font-semibold text-on-surface">8 pages</strong> per file. Each page
                  is rendered at roughly <strong className="font-semibold text-on-surface">250 DPI</strong>{' '}
                  and its text layer is extracted in the same pass. A longer PDF is read as the first seven pages
                  and the last, where a report's totals and footer print, and the notice says so.
                </Def>
                <Def t=".repx">
                  Read as text and validated as XML in your browser before a request is spent, then sent as
                  exact markup so a refinement edits what is really there.
                </Def>
                {/* What the waves added to the intake (2026-11-11, the re-audit's
                    R4-04): SSRS and FastReport converted in the browser
                    (lib/importForeign.ts), a Crystal file answered with how to
                    export a PDF, a Word or Excel file's layout followed
                    (lib/docxLayout.ts, xlsxLayout.ts), a crooked page
                    straightened (lib/deskew.ts). The chat answers from this page. */}
                <Def t=".rdl · .rdlc · .frx">
                  A report from SQL Server Reporting Services (.rdl, .rdlc) or FastReport (.frx) is opened as a
                  DevExpress report in your browser, its bands, positions, fields and totals as written, and what
                  you ask for is built on it. A Crystal Reports .rpt cannot be read in a browser: export it from
                  Crystal Reports as a PDF and attach that.
                </Def>
                <Def t="Data files">
                  CSV, TSV, JSON, text, SQL, Excel or Word, read for their columns; and your{' '}
                  <a href="#sql" className={LINK}>SQL Server layout script</a>.
                </Def>
                <Def t="Word and Excel templates">
                  Ask for a report from a .docx or .xlsx (&quot;make the report from this template&quot;, &quot;laid
                  out like the Word document&quot;) and its page, margins, table and fonts are followed, and a Word
                  file&apos;s header and footer too; otherwise it is read for its columns like any data file.
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
                A report often takes a pass or two of changes after the first. The first gets the structure, and the
                ones after it fix the parts that came out wrong. Nothing is thrown away between them.
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
                  Word, RTF, HTML or a picture, all in your browser. Ask the chat for several at once (&quot;a PDF
                  and an Excel file&quot;) and they are saved together as one .zip.
                </Def>
              </dl>
              <p className={`mt-4 ${PROSE}`}>
                A report made from a page you brought is printed before you see it, with the rows that page
                shows, and what would print wrong is put right as far as it can be: pages the page does not have,
                text cut off at the margin, a field that prints blank, groups that run together, a total that does
                not match the page, or a number or date not written the way the page writes it.
              </p>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Asking for changes
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                Say what is wrong rather than describing the whole report again. With a report open, the chat
                answers a question about it, or makes the change: an edit in place (a move, a font, a colour, a
                border, a number format, a binding, a page number, a table's row or column, a duplicate, a band's
                height), or, where an edit cannot reach, a redesign that starts straight away. Each reply lists
                what changed, with Undo and Redo, and "undo that" takes the last change back. Ask for the report
                in another language ("translate it into German") and it is translated: every typed caption and
                title, the layout as it was, kept as a revision beside the original. Ask for both languages ("in
                English and German", "add German") and the report keeps its own words and carries the second
                language beside them, as DevExpress's own localisation does; the Preview's Language list shows
                each. A question about the data
                (which row is highest, what the amounts add up to) is held the first time while Forma asks whether the rows the Preview prints may go to the
                AI; nothing of them goes until you say so, and the reply says when they went. Right-click a control on
                the Preview and choose Describe for the AI to say in a sentence what it is for; the AI reads it with
                the report, so "make the tax line bold" finds the control you described as the tax line.
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
                <Def t="Configure">Opens Settings: General, AI, Gemini key, Memory and Learning.</Def>
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
                <Def t="The project menu and the title">
                  The button before the project's name renames, duplicates, archives or deletes a saved project.
                  The pin beside the name pins it on this device. Each of the workspace's options has one place:
                  projects and Settings in the sidebar, Share and Export in the bar, help, the shortcuts and the
                  command menu in the ? at the corner.
                </Def>
                <Def t="Save, Share, Export">
                  In the bar above the report. Export opens every format in one panel, the .repx first;{' '}
                  <a href="#share" className={LINK}>Share</a> needs an account.
                </Def>
              </dl>

              <h3 className={H3}>The conversation</h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="The conversation panel">
                  Down the left of the report: every request of the project in one thread, with the message box at
                  its foot. Each message stays pinned at the top while you read Forma's replies to it, and carries
                  its time, Copy, Edit and Withdraw, and its versions when you edited it (1/2, with arrows between
                  them). Forma's reply carries Copy, Good reply and Bad reply, Try again, and for a change what was
                  Changed, with Undo and Redo; the eye on a message shows what it changed on the Preview.
                </Def>
                <Def t="+, Tools and the house style">
                  In the box: + uploads files; Tools (the / button, or / typed in an empty box) puts a request in the
                  box to finish: a total, a group, a column, the paper or the headings; the palette turns your house
                  style on or off. The examples are on the empty workspace's home.
                </Def>
                <Def t="Mark an area">
                  On the Preview, the rail at the right holds Select and Mark an area. Mark (or M) lets you
                  drag a box over the report: every control in it is selected and goes to the box as one chip, to ask
                  the chat about or to change with the toolbar. V goes back to selecting one at a time.
                </Def>
                <Def t="Compare with the original">
                  For a report made from a picture or a PDF, the rail also holds Compare (or O): the page you
                  brought, drawn under the report, with one slider for how much of it shows and another for how far
                  across the page it reaches, so a line or a total out of place stands out.
                </Def>
                <Def t="Search, download and fold">
                  The panel's search marks every match and Enter goes to the next; its download saves the whole
                  chat as a Markdown file. Collapse, at the panel's top right, folds the panel and the box to one square at the top left, with Forma's mark in it; Expand opens it again,
                  to see the whole report.
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

            {/* The SQL Server programme (2026-11-09, batch DH, checklist item 31). Every number below is
                read from the code by publicClaims.test.ts. */}
            <Article id="sql" kicker="Guide" title="Your SQL Server data" hidden={!matches('sql')}>
              <p className={PROSE}>
                Forma in your browser never connects to your server. It reads your database’s layout from a script
                you run yourself, writes the report’s data source the way DevExpress does, and leaves the connection
                to your application, which already has it. The steps are on the{' '}
                <strong className="font-semibold text-on-surface">Data</strong> view.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="1 · The layout script">
                  Copy the layout script and run it in SSMS on your database. It reads SQL Server’s catalog only:
                  no rows, no logins, nothing changed. Click its one result cell, copy all of it, and paste it on
                  the Data view or drop the file into the chat. Up to 5 databases are kept in this browser.
                </Def>
                <Def t="2 · Sample rows, if you like">
                  A second read-only script takes 5 rows from each table the report reads, so columns can be matched
                  by the values they print and the Preview can show real rows. Forma keeps at most 10 rows a table
                  and 200 characters a value.
                </Def>
                <Def t="3 · What the report reads">
                  A table or view with the joins its foreign keys suggest, a stored procedure, or custom SQL: one
                  SELECT, checked against the layout, so a table or column your database does not have is refused.
                  A table pointing back, such as an order’s lines, prints as a detail band under each record.
                </Def>
                <Def t="4 · Into the report">
                  <strong className="font-semibold text-on-surface">Write into the report</strong> writes DevExpress’s
                  own SQL data source, its parameters (several values, a list of values, one list depending on
                  another) and calculated fields. The connection is a name, as your application’s config knows it,
                  never a connection string or a password.
                </Def>
                <Def t="5 · In your application">
                  The Spec shows the <code className="doc-code">connectionStrings</code> entry the name needs and the
                  code that runs the report.
                </Def>
              </dl>
              <div className="mt-5 overflow-hidden rounded-[10px] border border-outline-variant">
                <div className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low px-3.5 py-2.5">
                  <span className={KICKER}>app.config</span>
                  <span className={`${KICKER} text-secondary`}>your server, your login</span>
                </div>
                <pre className="m-0 overflow-x-auto bg-[color:var(--code-bg)] p-4 font-code-sm text-[11.5px] leading-[1.75] text-[color:var(--code-ink)]">
{`<connectionStrings>
  <add name="Sales" providerName="System.Data.SqlClient"
       connectionString="Data Source=YOUR_SERVER;Initial Catalog=Sales;Integrated Security=True" />
</connectionStrings>

var report = XtraReport.FromFile("report.repx", true);
report.ExportToPdf("report.pdf");`}
                </pre>
              </div>
              <Note label="What the AI sees" tone="safe">
                Nothing of your database unless you share it: attaching the layout in the chat shares it, and{' '}
                <strong className="font-semibold text-on-surface">Send names and sample values to the AI</strong> on
                the Data view says which and turns it off. Shared, a report designed or changed in the chat is given
                the 12 likeliest tables, views and procedures for your request, with up to 3 sample values a column,
                and binds to your real columns; Forma checks every name it uses and writes the data source itself.
              </Note>
              <Note label="On your own PC, straight from the database">
                With Forma running on your own computer and{' '}
                <a href="#designer" className={LINK}>Forma Designer</a> installed (
                <a href="/download" className={LINK}>download</a>), add your connection from Forma Designer’s tray
                menu, <em className="not-italic text-on-surface">SQL Server connections</em>: a login’s password
                is typed there, encrypted for your Windows user, and never reaches the browser.{' '}
                <strong className="font-semibold text-on-surface">Read from my SQL Server</strong> on the Data view
                then reads the layout and sample rows with no script to copy,{' '}
                <strong className="font-semibold text-on-surface">Live rows</strong> on the Preview prints the report
                from your database with the values you type, a stored procedure only when you press the button that
                names it, and the designer opens with the connection set, saving still only its name. On the
                website, Forma Designer opens reports but does not read your database, so there it is the scripts.
              </Note>
              <Note label="A report that already has one">
                Its data source shows on the Data view, a redesign keeps it, and with a newer export it is checked
                for a renamed or missing column, a changed type or a stored procedure’s changed parameters, each
                with its fix. It matters: DevExpress refuses to print a report whose query names a column your
                database no longer has. On the Preview,{' '}
                <strong className="font-semibold text-on-surface">Sample rows</strong> prints your sample rows,
                typed as SQL Server hands them to DevExpress.
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
                surfaces in the browser rather than when the designer refuses the file. It is also checked for
                what DevExpress would drop or print wrong. A generation that ends without a complete file is
                repaired where it can be, and otherwise marked as failed with Try again, never handed to you
                as a broken file.
              </p>

              <h3 className={H3}>What the checks find</h3>
              <p className={`mt-2 ${PROSE}`}>
                Forma fixes what it can first, so what is listed is what is still wrong, and nothing is held back
                for it. An <strong className="font-semibold text-on-surface">error</strong> means DevExpress will
                lose content or refuse part of the file; a{' '}
                <strong className="font-semibold text-on-surface">warning</strong> means it will print differently
                from how it looks. The REPX view lists them under a count, and a reply after a change says what it
                left to fix.
              </p>
              {/* The errors the waves added (2026-11-11, the re-audit's R4-11;
                  lib/repxAudit.ts): code in the report, an expression that
                  cannot be read, margins or a page size with a fraction, and a
                  group on a field the data does not have. */}
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Errors">
                  A file that stops before its end; a reused <code className="doc-code">Ref</code>, which makes the
                  designer drop content without a word; a total with no running scope, which prints blank; a detail
                  report with no Detail band; a calculated field with no expression or a duplicate name; a cross-tab
                  with no layout; a formatting rule that points at nothing; code that runs when the report is
                  previewed (Forma never writes any); an expression DevExpress cannot read; margins or a custom page
                  size written with a fraction, which DevExpress drops; a group or sort on a field the data does not
                  have, once the data&apos;s fields are known.
                </Def>
                <Def t="Layout">
                  Controls that overlap, leave the page or fall below their band; a band taller than the page; a
                  grid drawn as loose labels rather than a table; a page size that does not match the paper.
                </Def>
                <Def t="Data">
                  A parameter used but not declared, or declared and unused; a group with no fields; a sort on the
                  wrong band; a chart with no series; a subreport with no source; a field an expression names that
                  the data does not have; an expression typed as plain text, which prints its brackets; a field
                  named after the report&apos;s words rather than its data.
                </Def>
                <Def t="Accessibility">
                  Text too small, contrast too low, a picture with no description: the three checks DevExpress's
                  own designer runs on every edit.
                </Def>
              </dl>
            </Article>

            <Article id="designer" kicker="Output" title="Open in the DevExpress designer" hidden={!matches('designer')}>
              <p className={PROSE}>
                Open in designer hands the report to the DevExpress report designer on your PC, the real one, where you
                can move, resize and bind anything and save the file. It goes through{' '}
                <strong className="font-semibold text-on-surface">Forma Designer</strong>, a free Windows app:{' '}
                <a href="/download" className={LINK}>download it</a>, install it (for you alone, with no administrator),
                and it starts with Windows.
              </p>
              <p className={`mt-4 ${PROSE}`}>
                Forma Designer needs{' '}
                <strong className="font-semibold text-on-surface">
                  DevExpress Reporting for WinForms, {DESIGNER_REQUIREMENTS.devexpressOldest} or later
                </strong>
                , on the same PC, and uses the version you installed. DevExpress is a separate commercial product of
                Developer Express Inc. If you do not have it, their free 30-day trial needs no registration:{' '}
                <a href={DEVEXPRESS_TRIAL_URL} className={LINK} target="_blank" rel="noopener noreferrer">get the DevExpress trial</a>.
              </p>

              <h3 className={H3}>What happens when you choose it</h3>
              <p className={`mt-2 ${PROSE}`}>
                Forma asks Forma Designer on your PC whether it is there; until you choose it, nothing on the page
                asks Forma Designer anything, unless you run Forma on your own PC and ask it to read your SQL
                Server. On the website your browser asks the first time whether this site may reach apps
                on your device: allow it. If Forma Designer is installed but not running, Forma asks Windows to
                start it; if your browser asks to open Forma Designer, choose Open. Then the report opens in the
                designer.
              </p>
              {/* Said since 2026-11-11 (the re-audit's R4-02): once Forma Designer
                  has answered in a tab, each new report is put through it
                  (lib/designerBridge.ts, inspectInDesigner), which "and only
                  then" no longer covered. The privacy policy says the same.
                  "Answered", not "opened a report": designerAnswered() turns
                  true when /health answers in the dialog, before /open is sent
                  and whether or not it succeeds (the review of 2026-11-11). */}
              <p className={`mt-4 ${PROSE}`}>
                Once Forma Designer has answered in a tab, which it does when you choose Open in designer while it is
                running, whether or not the report then opens, Forma also hands it each new report you make in the
                same tab, with the rows read off your page, if your copy of Forma Designer can take them, to ask how
                DevExpress loads and prints it; what it finds is listed in the REPX view. It all stays on your
                computer.
              </p>

              <h3 className={H3}>If something is missing</h3>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Get Forma Designer">
                  Nothing answered: it is not installed, or not running. Download it, or start it from the Start menu,
                  and choose Try again.
                </Def>
                <Def t="DevExpress is not installed">
                  Forma Designer is running, but the designer is part of DevExpress Reporting, which this PC does not
                  have, or has in a version older than {DESIGNER_REQUIREMENTS.devexpressOldest}. Install it (the trial
                  is fine), then choose Try again.
                </Def>
                <Def t="Your browser blocked it">
                  The browser was told not to let the site reach apps on your device. Click the icon at the left of the
                  address bar, open Site settings, and set Apps on device (or Local network access) to Allow.
                </Def>
                <Def t="The designer runs on Windows">
                  On a Mac or Linux, export the .repx and open it on a Windows PC.
                </Def>
              </dl>
              <p className={`mt-4 ${PROSE}`}>
                Every one of these offers Export .repx, which saves the file and needs nothing installed. A report a web
                page hands Forma Designer opens with report scripts turned off, since it may be one somebody shared with
                you.
              </p>
            </Article>

            <Article id="config"kicker="Reference" title="Settings and what is worked out" hidden={!matches('config')}>
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
                  Projects are saved to your account and appear on every device you sign in from. An account
                  keeps up to 1,000 projects; delete one to save another.
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
                Share a report as you would a document: sign in with a verified address, open a project of your
                own and choose <strong className="font-semibold text-on-surface">Share</strong> above the report.
                An account can share up to {MAX_SHARES} reports at once. What you share is a copy of the report;
                the conversation is never part of it.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Restricted">
                  Only the people you add by email address, up to {MAX_INVITED}, can open it, signed in with that
                  address verified.
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
                {/* Said as the code does it since 2026-11-11 (the re-audit's
                    R4-01, lib/learningLoop.ts): on unless turned off, kept
                    reports join the library, the nearest goes with a first
                    report, and repeated changes become memories. */}
                <Def t="Learning your style">
                  With <em className="not-italic text-on-surface">Learn the style of reports I keep</em> on, which
                  it is unless you turn it off in Settings → Memory, a report you export, save or open in the
                  designer counts as kept, and from two of them Forma learns your house style; the styles of the
                  newest thirty are kept. A kept report also joins your report library in this browser, stripped as
                  below, the newest twenty. When you ask for a first report while the box&apos;s house style is on,
                  the kept report most like it goes to the AI with your request, every word in it replaced, as
                  formatting to follow. Forget kept reports and Forget everything ask before they act, and take
                  them out of the library too.
                </Def>
                <Def t="Learned from your changes">
                  With the same switch on, Forma counts what you change in the reports it made: a font, a size,
                  bold, an alignment, a colour or a margin, and the value you gave it, never a word of the report.
                  The same change made twice becomes a memory, listed in Settings → Memory under Learned from your
                  changes with a switch and Forget; undoing what Forma did counts against it.
                </Def>
                {/* Learning is on by default, so it is documented where a
                    visitor and the chat's Docs knowledge look (2026-11-11, the
                    full audit's PS-06 and LM-19). */}
                <Def t="Learning from use">
                  Settings → Learning. With{' '}
                  <em className="not-italic text-on-surface">Help Forma learn from the shape of my reports</em> on,
                  which it is unless you turn it off, each report you make or change is kept as its shape: where
                  each control sits, its size, font and alignment, never its words, a field name or a picture.
                  Signed in, that goes to your account, where Forma&apos;s maintainer uses it to train Forma&apos;s own
                  model; signed out, it stays in this browser.{' '}
                  <em className="not-italic text-on-surface">Share whole reports and what I asked for</em>, off
                  until you turn it on, sends the full file and your words too. The section shows what was kept and
                  deletes it.
                </Def>
              </dl>

              <h3 className={H3}>The report library</h3>
              <p className={`mt-2 ${PROSE}`}>
                <strong className="font-semibold text-on-surface">Report library</strong> in the sidebar holds
                reports whose formatting Forma can match: the ones you add, and the ones you keep. Add .repx files,
                several at once; before anything is stored, every text, name, field, data source, expression and
                link in them is replaced, keeping only positions, fonts, colours and formats, and a report you keep
                is stripped the same way. A report you add is used only once you tick it as house style; a report
                you keep is marked You kept this and needs no tick. Remove takes either out. The library lives in
                this browser; adding a report to it uses your Gemini key, and keeping one does not.
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
                <Def t="Each made as one report is">
                  Every file is made the way a single report is: its pages read, its paper, unit and direction
                  worked out from it, and the language or anything else your words ask for carried out.
                </Def>
                <Def t="A verdict per row">
                  Each finished row says whether the report came out clean or what is still wrong with it, as
                  the REPX view would, because the point of running forty files is knowing which of the forty are
                  worth opening.
                </Def>
                <Def t="Stop and retry">
                  Stop cancels what has not started and leaves the request already in flight alone, since it
                  counts against your key&apos;s allowance either way. Retry requeues the failed and cancelled
                  files and keeps what succeeded. A limit, or a key or permission failure, stops the whole run
                  rather than producing forty identical errors; a limit pauses the batch, kept in this browser,
                  and Retry carries on from where it stopped.
                </Def>
                <Def t="Taking them away">
                  A finished row opens in the workspace or downloads on its own, and Download as .zip takes
                  them all at once.
                </Def>
              </dl>
              <Note label="Files or a folder">
                Choose files, as many as you like, or a folder, or drop a folder onto the panel: every report
                in it is queued with its path. Files handed over while a batch runs are added to it, not put in
                its place.
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
                <Def t="A model was retired">
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
                <Def t="Is it down?">
                  Forma&apos;s live site is checked every three hours, and the{' '}
                  <a href="https://github.com/waqarsyd/forma/actions/workflows/live.yml" target="_blank" rel="noopener" className={LINK}>
                    latest check
                  </a>{' '}
                  says whether it passed. An outage of the AI or of sign-in is often Google&apos;s: see the{' '}
                  <a href="https://aistudio.google.com/status" target="_blank" rel="noopener" className={LINK}>
                    Gemini API status
                  </a>{' '}
                  and the{' '}
                  <a href="https://status.firebase.google.com" target="_blank" rel="noopener" className={LINK}>
                    Firebase status
                  </a>
                  .
                </Def>
                <Def t="Model overloaded">
                  Google's capacity for that model is momentarily exhausted. Forma retries it with a growing
                  pause, then moves to another model your key can reach. Editing the prompt does not help;
                  waiting does.
                </Def>
                {/* Quotes the reply as it reads since the full audit (2026-11-11,
                    PS-12): a heading nobody saw on screen is one nobody finds. */}
                <Def t={'"So here is a quicker version of the page"'}>
                  The AI could not answer, and the reply says why: you are offline, its free limit is used up for
                  now, it is busy, or it could not be reached. A quicker version Forma made from what it read on
                  the page stands in, so you are not left with nothing; check its figures and fonts, and send the
                  request again later to have it designed in full.
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
            </>)} />

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
        // Every article, from the list the sidebar draws (2026-11-11, full
        // audit PS-32): a hand-kept copy named 8 of the 21.
        onThisPage={SECTIONS.map((s): [string, string] => [s.title, `#${s.id}`])}
      />
    </div>
  );
}
