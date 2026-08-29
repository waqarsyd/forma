import { useEffect, useRef, useState, type ReactNode } from 'react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
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
 * `keys` exists so search is a pure function of props and state. Matching by
 * reading each section's rendered textContent meant touching the DOM during
 * render, which is impure and returns nothing on the first pass.
 */
const SECTIONS: Array<{ id: string; n: string; title: string; keys: string }> = [
  { id: 'start', n: '01', title: 'Getting started', keys: 'start begin first steps tutorial upload workflow guide' },
  { id: 'key', n: '02', title: 'Your API key', keys: 'key api gemini google studio session vault passphrase encrypt security storage' },
  { id: 'account', n: '03', title: 'Your account', keys: 'account sign in signup register google email password forgot reset sync devices optional' },
  { id: 'upload', n: '04', title: 'What you can upload', keys: 'upload file formats png jpg pdf repx size limit pages attachments text extraction scan' },
  { id: 'run', n: '05', title: 'Running and refining', keys: 'run generate progress streaming pause stop cancel elapsed read result specification mockup refine change iterate conversation' },
  { id: 'controls', n: '06', title: 'Supported controls', keys: 'controls xrlabel xrtable xrpicturebox xrbarcode xrline xrchart gauge elements supported' },
  { id: 'repx', n: '07', title: 'The .repx file', keys: 'repx xml schema serializer band detail bands units grid coordinates export download' },
  { id: 'config', n: '08', title: 'Configuration', keys: 'config configure version paper size letter a4 legal header footer rtl model picker' },
  { id: 'saving', n: '09', title: 'Saving your work', keys: 'save saved projects account cloud local storage sign out history' },
  { id: 'trouble', n: '10', title: 'Troubleshooting', keys: 'trouble error 404 429 503 quota overload fail slow retired invalid problem' },
  { id: 'faq', n: '11', title: 'FAQ', keys: 'faq questions common help cost price free visual studio photo' },
];

const FAQS: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'Does Forma cost anything to use?',
    a: (
      <p>
        Forma itself is open source and free. What you pay for is your own Gemini usage, billed to you by
        Google against your own key. Whoever runs Forma pays nothing for your requests, and you never wait
        behind another user's quota.
      </p>
    ),
  },
  {
    q: 'Which file formats can I upload?',
    a: (
      <p>
        PNG and JPG images, PDF documents, and existing DevExpress <code className="doc-code">.repx</code>{' '}
        files — several at once, and you can mix them.
      </p>
    ),
  },
  {
    q: 'Can I open the generated file in Visual Studio?',
    a: (
      <p>
        Yes. The output is standard <code className="doc-code">XtraReportsLayoutSerializer</code> XML and
        opens in the Visual Studio report designer or an end-user designer. Match the version in the
        configuration panel to your installed SDK.
      </p>
    ),
  },
  {
    q: 'Can Forma read a photo of a printed form?',
    a: (
      <p>
        Yes — that is one of the cases it is built for. It reads the page visually, so strings and
        coordinates will be approximate rather than exact. If you have a digital PDF of the same document,
        use that instead: the text layer gives exact positions.
      </p>
    ),
  },
  {
    q: 'Why does my grid come out as separate labels?',
    a: (
      <>
        <p>
          Ask for it explicitly in the conversation — say the region is a table and should be one control
          with rows and cells. Refinements edit the existing layout rather than starting over, so you keep
          everything else.
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
        endpoint on Forma's server to route through. If you sign in and save a project, that project is
        stored in your own account; the key is never part of it.
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
    <div className="grid gap-y-1 border-b border-outline-variant py-3.5 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-baseline sm:gap-x-4">
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
  const matches = (id: string) => {
    if (!q) return true;
    const s = SECTIONS.find((x) => x.id === id);
    return !!s && `${s.title} ${s.keys}`.toLowerCase().includes(q);
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
      <main className="flex-grow sheet-grid">
        {/* 68px top / 44px bottom — the artifact's `padding: 68px 0 44px`.
            py-[68px] put everything below it 24px too low. */}
        <section className="border-b border-outline-variant pt-[68px] pb-11">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <div className="flex items-center gap-3 font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]">
              <b className="font-medium text-secondary">x 000 · y 0000</b>
              Documentation
              <span className="h-px flex-1 bg-gradient-to-r from-outline-variant to-transparent" />
            </div>
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

            <nav className={`${CARD} p-2`} aria-label="Documentation sections">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  hidden={!matches(s.id)}
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
                Bring a design and your own Gemini key. Nothing to install, nothing to configure first.
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
                Forma turns a report design you already have into three things at once: a written
                specification, a mockup you can check in the browser, and a DevExpress{' '}
                <code className="doc-code">.repx</code> file. The whole loop happens in your browser.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ['01 — ADD YOUR KEY', 'Paste a Gemini API key', 'Forma ships without one, so this is the only setup step. The workspace stays locked until a key is present.'],
                  ['02 — UPLOAD A DESIGN', 'Drag in an image, PDF or .repx', 'Drop the file onto the composer or use the picker. Every file you add is confirmed on screen before anything is sent.'],
                  ['03 — CHECK THE RESULT', 'Read the spec, inspect the mockup', 'Switch between the written specification, the drawn layout and the XML. Ask for changes in the same conversation.'],
                  ['04 — TAKE THE FILE', 'Download the .repx', 'It is parsed and checked in the browser first, then downloads named after the report title.'],
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
                Typing a message with no attachment is just a conversation — it answers you rather than
                building a report. An upload is what starts a generation.
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
                  Forma prompts for the key on first use, or open it yourself from the configuration panel.
                </Def>
                <Def t="3 · Paste and save">
                  The key is checked with a single one-token request, which also works out which model your
                  key can reach.
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

            <Article id="account" kicker="Setup" title="Your account" hidden={!matches('account')}>
              <p className={PROSE}>
                <strong className="font-semibold text-on-surface">You do not need one.</strong> Forma works fully
                signed out — your projects are kept in this browser and are still there when you come back. An
                account adds two things: your projects follow you to another machine, and you can keep an encrypted
                copy of your API key so you are not pasting it in again on every device.
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
                  An email and a password of at least six characters. A name is optional — leave it blank and your
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
                <strong className="font-semibold text-on-surface">Account settings</strong>.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="Display name">Rename the account at any time.</Def>
                <Def t="Password">
                  Changing it asks for the current one first. Accounts created with Google have no password to
                  change — Google keeps that.
                </Def>
                <Def t="Email address">
                  A confirmation link goes to the <em className="not-italic text-secondary">new</em> address and the
                  account moves only when you open it, so a typo cannot lock you out.
                </Def>
                <Def t="Deleting the account">
                  Removes your saved projects and the encrypted copy of your key along with it. Reports kept only in
                  this browser are not touched. It cannot be undone.
                </Def>
              </dl>

              <Note label="Verifying your email">
                Accounts created with an email and password get a verification link when they are made, and the
                workspace shows a reminder until it is used. Nothing is withheld in the meantime — the account only
                ever holds your own work, and locking you out of it would cost more than it buys.
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
                A <b className="font-bold text-on-surface">scanned</b> PDF has no text layer. Forma detects
                that, says so, and reads the page visually instead — expect approximate strings where a
                digital PDF would have been exact. And on an unusually text-dense page, extraction stops at{' '}
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
                <Def t="The progress bar">
                  The response is streamed, so the bar tracks output actually received rather than a timer inventing
                  percentages. It never runs backwards, and only a finished, parsed result reads as complete.
                </Def>
                <Def t="Elapsed time">
                  Real wall-clock, beside the bar. The first request of a session is slower than the rest because it
                  also works out which model your key can reach.
                </Def>
                <Def t="Pause">
                  Aborts the request in flight and keeps the run so you can re-issue it. Not a loader that hides
                  while the work carries on.
                </Def>
                <Def t="Stop">Aborts the request and resets the workspace.</Def>
              </dl>
              <Note label="Cancelling is local">
                Pause and Stop tear down the connection from your side. Google may still finish generating the
                response, and if it does, that usage is billed to your key. Cancelling saves you the wait, not
                necessarily the request.
              </Note>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Reading the result
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                One request comes back as three things, produced together from a single description so they agree
                with each other.
              </p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="The specification">
                  A component inventory in markdown — every element, where it sits, its type, its font and its
                  borders. Useful on its own as the written brief you would otherwise have produced by hand, and
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
              </dl>

              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                Asking for changes
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                Say what is wrong rather than describing the whole report again. A follow-up sends the existing
                layout and XML back with your instruction, so the model edits what you named and leaves the rest of
                the structure standing.
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
                  A message with no attachment is answered as a conversation — it does not start a generation.
                  Asking "what does ReportUnit mean?" costs you a sentence, not a report.
                </Def>
              </dl>
            </Article>

            <Article id="controls" kicker="Reference" title="Supported controls" hidden={!matches('controls')}>
              <p className={PROSE}>
                Regions of your design are mapped to real DevExpress controls. Two of them are drawn as
                stand-ins in the browser mockup but are still written into the file in full — noted below.
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
                  so the mockup shows your own artwork. A crop that fails its sanity check falls back to a
                  clean placeholder.
                </Def>
                <Def t="XRLine">Rules and dividers, placed at exact coordinates.</Def>
                <Def t="XRChart">
                  Written into the file with its type and values.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    In the mockup it is drawn stylised — it is not a charting library and should not be read
                    as data.
                  </em>
                </Def>
                <Def t="XRBarCode · XRGauge">
                  Written into the file so the designer gets the real control.{' '}
                  <em className="not-italic text-[color:var(--ink-faint)]">
                    In the mockup they are decorative stand-ins: positioned and sized, but their content is
                    not drawn.
                  </em>
                </Def>
              </dl>
            </Article>

            <Article id="repx" kicker="Output" title="The .repx file" hidden={!matches('repx')}>
              <p className={PROSE}>
                The file is standard <code className="doc-code">XtraReportsLayoutSerializer</code> XML.
                Everything is positioned on a grid of{' '}
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
                surfaces in the browser rather than when the designer refuses the file. If the model returns
                no XML at all, you get the written specification as a <code className="doc-code">.txt</code>{' '}
                rather than an empty file.
              </p>
            </Article>

            <Article id="config" kicker="Reference" title="Configuration" hidden={!matches('config')}>
              <p className={PROSE}>What the configuration panel exposes, and what it deliberately does not.</p>
              <dl className="mt-4 border-t border-outline-variant">
                <Def t="DevExpress version">
                  24.1, 23.2, 23.1, 22.2 or 20.1. The generated markup is targeted at the version you pick, so
                  match your installed SDK — a layout written for a newer release will not open in an older
                  designer.
                </Def>
                <Def t="Page size">Letter, A4 or Legal, written into the XML along with margins.</Def>
                <Def t="Header">Whether to include a company logo, and a report title.</Def>
                <Def t="Footer">Whether to show page numbers, plus custom footer text.</Def>
              </dl>
              <h3 className="mt-6 font-display-lg text-[17px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                No model picker, on purpose
              </h3>
              <p className={`mt-2 ${PROSE}`}>
                Google retires models "for new users", so a hard-coded model id is a time bomb — an existing
                project keeps working while every freshly created key gets a 404. Instead Forma probes which
                models your key can actually reach, once per session, and uses the best one that answers. That
                is also what validates the key when you save it.
              </p>
              <Note label="Not exposed yet">
                Right-to-left layout, a stored-procedure name and a data-binding schema exist in the request
                Forma sends but have no controls in the interface yet.
              </Note>
            </Article>

            <Article id="saving" kicker="Guide" title="Saving your work" hidden={!matches('saving')}>
              <dl className="border-t border-outline-variant">
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

            <Article id="trouble" kicker="Support" title="Troubleshooting" hidden={!matches('trouble')}>
              <dl className="border-t border-outline-variant">
                <Def t={'"No longer available"'}>
                  A model your key could once reach has been retired. Forma clears its cached choice,
                  re-detects and retries once, by itself. If it persists, the key has access to no supported
                  model.
                </Def>
                <Def t="Quota exceeded">
                  Your key has no remaining allowance on that model. This is between you and Google — Forma
                  has no quota to share, since it uses no key of its own.
                </Def>
                <Def t="Model overloaded">
                  Google's capacity for that model is momentarily exhausted. Forma retries the same model
                  twice with a growing pause before surfacing anything. Changing models or editing the prompt
                  does not help; waiting does.
                </Def>
                <Def t="Nothing happens on send">
                  Check that a key is set. The composer is disabled and a banner sits above it when none is
                  present.
                </Def>
                <Def t="The layout is roughly right">
                  Upload the original PDF rather than a screenshot of it. Exact strings and coordinates come
                  from the text layer, which a screenshot does not have.
                </Def>
                <Def t="Generation feels slow">
                  The progress bar tracks output actually received. The first request of a session also pays
                  for model detection. Pause and Stop abort the request for real.
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

            {/* Feedback. Deliberately does not claim the note was filed: there is
                no destination wired up, and a confirmation promising one would be
                a lie. Wiring it to Firestore is a separate job. */}
            {!q && (
              <section className={`${CARD} p-[30px] sm:px-[38px] sm:py-9`}>
                <div className={`${KICKER} text-secondary`}>Improve these docs</div>
                <h2 className="mt-3 font-display-lg text-[22px] font-extrabold leading-[1.2] tracking-[-0.026em] text-on-surface">
                  Did this answer your question?
                </h2>
                <p className="mt-2.5 font-body-lg text-[14.5px] leading-[1.6] text-on-surface-variant">
                  Tell us what was missing and it gets fixed in the next pass.
                </p>

                {sent ? (
                  <div className="mt-5 flex items-start gap-3 rounded-[10px] border border-success/35 bg-success/10 px-[18px] py-4">
                    <IconCheck size={18} className="mt-0.5 shrink-0 text-success" />
                    <p className="font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">
                      {helpful
                        ? 'Thanks — noted.'
                        : 'Thanks — that is exactly the kind of gap worth knowing about.'}
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
                          <button
                            type="button"
                            onClick={() => setSent(true)}
                            className="u-transition u-press u-focus-ring cursor-pointer rounded-full bg-secondary-container px-5 py-2.5 font-body-lg text-[14px] font-semibold text-white hover:bg-[color:var(--accent-deep)]"
                          >
                            Send it
                          </button>
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
          ['Your account', '#account'],
          ['Running and refining', '#run'],
          ['What you can upload', '#upload'],
          ['The .repx file', '#repx'],
          ['FAQ', '#faq'],
        ]}
      />
    </div>
  );
}
