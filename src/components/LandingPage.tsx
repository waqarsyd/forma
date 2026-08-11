import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import Logo from './Logo';
import UserAvatar from './UserAvatar';
import MobileNav from './MobileNav';
import HeroScanner from './landing/HeroScanner';
import VaultFigure from './landing/VaultFigure';
import SheetRuler from './landing/SheetRuler';
import { FigureIngest, FigureStream, FigureExport } from './landing/StepFigures';
import { Reveal, RevealGroup, RevealItem, SectionHead, Eyebrow, Stat, H2, LEDE, BODY } from './landing/sections';
import {
  IconSpec, IconLayout, IconCode, IconInvoice, IconGrid, IconPayslip, IconSeal, IconScan, IconRedo,
  IconArrowRight, IconSun, IconMoon,
} from './landing/icons';

/** Document shapes Forma is built around. */
const USE_CASES = [
  {
    Icon: IconInvoice,
    title: 'Invoices and statements',
    body: 'Header block, addressed party, a line-item grid with totals underneath, payment terms in the footer. The shape Forma handles best.',
  },
  {
    Icon: IconGrid,
    title: 'Purchase orders and packing slips',
    body: 'Multi-column grids with merged headers, quantity and unit columns, and boxed totals — the widest layouts Forma is asked for.',
  },
  {
    Icon: IconPayslip,
    title: 'Payslips and remittance advice',
    body: 'Dense two-column arithmetic with right-aligned figures and rule-separated bands. Alignment and per-side borders are carried through.',
  },
  {
    Icon: IconSeal,
    title: 'Certificates and letters',
    body: 'Centred typography, a signature block, a stamp or a seal — each one located as its own element rather than flattened into the background.',
  },
  {
    Icon: IconScan,
    title: 'Legacy paper forms',
    body: 'A scan or a phone photo of a form nobody has the source for. Forma reads it visually and gives you a designer file to start from.',
  },
  {
    Icon: IconRedo,
    title: 'Redesigning an existing .repx',
    body: 'Upload the report file itself. It is parsed and validated as XML in the browser, then handed over as exact text — so refinements edit what is there.',
  },
];

/** Details that decide whether a generated report is usable or rebuilt by hand. */
const SPECS = [
  {
    k: 'coordinate grid',
    v: <><em className="not-italic text-secondary">100</em> units = 1 in</>,
    d: 'LocationFloat and SizeF in hundredths of an inch, the unit DevExpress actually stores.',
  },
  {
    k: 'page',
    v: <>850 × <em className="not-italic text-secondary">1100</em></>,
    d: 'Letter, A4 or Legal — set in the report configuration, honoured in the generated XML.',
  },
  {
    k: 'tables',
    v: <>real <em className="not-italic text-secondary">rows</em></>,
    d: 'An XRTable with populated rows and cells, weighted relatively — not a grid faked out of loose labels.',
  },
  {
    k: 'borders',
    v: <><em className="not-italic text-secondary">4</em> sides, separately</>,
    d: 'Top, right, bottom and left carried individually, with their colour — a single underline stays a single underline.',
  },
  {
    k: 'type',
    v: <>family · <em className="not-italic text-secondary">weight</em></>,
    d: 'Bold, italic, font family and size, horizontal and vertical alignment, and whether text wraps.',
  },
  {
    k: 'pictures',
    v: <>cropped, not <em className="not-italic text-secondary">guessed</em></>,
    d: 'Each logo is located in your upload and cut out of it. A rectangle that fails a sanity check falls back to a placeholder rather than showing you the wrong thing.',
  },
];

/** Same page, same model — the difference is what it was given to work from. */
const COORD_ROWS = [
  { label: 'INVOICE', guess: '~40, ~44', exact: '40, 45' },
  { label: 'Bill To', guess: '~40, ~228', exact: '40, 225' },
  { label: 'Acme Industrial', guess: '~41, ~252', exact: '40, 250' },
  { label: 'Subtotal', guess: '~566, ~772', exact: '570, 770' },
  { label: '$ 4,180.00', guess: '~648, ~800', exact: '652, 798' },
];

const STEPS = [
  {
    co: '01 — SHOW IT',
    title: 'Give it something to read',
    body: (
      <>
        Drag in a screenshot, a scan, a multi-page PDF, or a <span className="font-code-sm">.repx</span> you already
        have. Images are downscaled and re-encoded before they are sent; a{' '}
        <span className="font-code-sm">.repx</span> is parsed and validated as XML in the browser first.
      </>
    ),
    points: [
      'PNG, JPG, PDF and .repx, several at once',
      'Multi-page PDFs read and text-extracted, up to 8 pages',
      'Every file you add is confirmed on screen before it is sent',
    ],
    figure: <FigureIngest />,
  },
  {
    co: '02 — BUILD IT',
    title: 'Watch it resolve',
    body: (
      <>
        The response streams, so the progress bar tracks output actually received rather than a timer inventing
        percentages. Pause and Stop genuinely abort the request in flight.
      </>
    ),
    points: [
      'Live elapsed time and characters received',
      'Refinements edit the existing report instead of regenerating it',
      'Plain chat stays chat — asking a question does not build a report',
    ],
    figure: <FigureStream />,
  },
  {
    co: '03 — SHIP IT',
    title: 'Take the file',
    body: (
      <>
        Download the <span className="font-code-sm">.repx</span>, named after the report title, and open it in the
        DevExpress designer. Or copy the XML straight out of the viewer.
      </>
    ),
    points: [
      'Parsed and checked in the viewer before you download',
      'Copy the XML from the viewer, or take the .repx file',
      'Save the session to your account, or keep it on this device',
    ],
    figure: <FigureExport />,
  },
];

/**
 * The marketing home page.
 *
 * Extracted from App.tsx, where it had been defined inline alongside the
 * workspace. It is a sibling of FeaturesPage / DocsPage / ContactPage and takes
 * the same props, so the four marketing surfaces now live together in
 * src/components/ and share one shape.
 *
 * Its header is the same pattern as theirs: the tagline is hidden below lg and
 * the auth controls move into MobileNav below md, because at phone widths the
 * full set does not fit and used to overlap.
 */
const LandingPage = ({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    // 16px/1.62 rather than `text-body-lg`, whose 24px line-height is a fixed
    // pixel value that inherits into every descendant regardless of its own
    // font size. The source design sets a unitless 1.62 so each element scales
    // its own leading; using the token instead squashed every block that does
    // not set `leading-` explicitly.
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      {/* TopNavBar */}
      <header className="w-full sticky top-0 z-50 bg-surface/[0.84] [backdrop-filter:blur(16px)_saturate(1.5)] border-b border-outline-variant">
        <nav className="flex h-[68px] gap-6 justify-between items-center px-margin-desktop max-w-container-max mx-auto">
          <div className="flex items-center gap-[11px]">
            <Logo size={30} />
            <div className="flex flex-col">
              <span className="font-display-lg text-[20px] leading-[1.05] font-extrabold tracking-[-0.03em] text-on-surface">
                Forma
              </span>
              <span className="mt-px font-code-sm text-[8.5px] leading-[1.62] font-medium tracking-[0.2em] text-[color:var(--ink-faint)] uppercase hidden lg:block">Show it &#183; Build it &#183; Ship it</span>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-1">
            <a className="u-transition relative rounded-lg px-[13px] py-[7px] font-body-lg text-[14px] leading-[1.62] font-semibold text-on-surface after:absolute after:inset-x-[13px] after:bottom-[3px] after:h-[1.5px] after:bg-secondary" href="/">Product</a>
            <a className="u-transition rounded-lg px-[13px] py-[7px] font-body-lg text-[14px] leading-[1.62] font-medium text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface" href="/features">Features</a>
            <a className="u-transition rounded-lg px-[13px] py-[7px] font-body-lg text-[14px] leading-[1.62] font-medium text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface" href="/docs">Docs</a>
            <a className="u-transition rounded-lg px-[13px] py-[7px] font-body-lg text-[14px] leading-[1.62] font-medium text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface" href="/contact">Contact</a>
          </div>
          <div className="flex items-center gap-2.5">
            <MobileNav active="Product" signedIn={!!user} />
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="u-transition u-press u-focus-ring w-[37px] h-[37px] grid place-items-center rounded-full border border-outline-variant bg-surface-container-lowest/60 hover:border-secondary text-on-surface-variant hover:text-secondary cursor-pointer select-none"
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {/* The mark shows the theme you are in, not the one you would
                  switch to — the source design's reading. */}
              {isDarkMode ? <IconMoon size={16} /> : <IconSun size={16} />}
            </button>
            {user ? (
              <div className="flex items-center gap-4 relative" ref={profileMenuRef}>
                <div
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-2.5 px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 rounded-full select-none cursor-pointer transition-colors"
                >
                  <UserAvatar user={user} />
                  <span className="font-label-caps text-[11px] text-on-surface-variant font-semibold hidden lg:inline max-w-[120px] truncate">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                  <span className="hidden lg:inline"><span className="material-symbols-outlined text-[16px] text-on-surface-variant select-none">
                    {showProfileMenu ? 'expand_less' : 'expand_more'}
                  </span></span>
                </div>
                <button
                  onClick={onEnterWorkspace}
                  className="hidden lg:inline-block whitespace-nowrap font-label-caps text-on-surface-variant text-body-sm px-4 py-2 hover:text-secondary hover:bg-surface-container-low rounded-full transition-all active:scale-95 cursor-pointer"
                >
                  Workspace
                </button>

                {showProfileMenu && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-surface-container-lowest dark:bg-card border border-outline-variant rounded-2xl shadow-2xl z-50 overflow-hidden py-2">
                    <div className="px-4 py-3 border-b border-outline-variant/30 flex flex-col text-left">
                      <span className="text-xs font-bold text-on-surface truncate">
                        {user.displayName || 'Developer User'}
                      </span>
                      <span className="text-[10px] text-on-surface-variant truncate font-mono mt-0.5">
                        {user.email || 'developer@example.com'}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        logOut();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-error-container text-error hover:text-error transition-colors text-left text-xs font-semibold font-label-caps cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">logout</span>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden lg:flex items-center gap-2.5">
                <button
                  onClick={onSignIn}
                  className="u-transition u-press u-focus-ring whitespace-nowrap rounded-full border border-transparent px-[18px] py-[10px] font-body-lg text-[14px] leading-[1.62] tracking-[-0.005em] font-semibold text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface cursor-pointer"
                >
                  Sign in
                </button>
                <button
                  onClick={onSignUp}
                  className="u-transition u-press u-focus-ring whitespace-nowrap rounded-full border border-transparent bg-secondary-container px-[18px] py-[10px] font-body-lg text-[14px] leading-[1.62] tracking-[-0.005em] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)] cursor-pointer"
                >
                  Sign up
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>
      <main className="flex-grow sheet-grid">
        {/* ---------------------------------------------------------- HERO */}
        <section id="top" className="relative overflow-hidden pt-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-[10%] -top-[14%] h-[940px] w-[940px] max-w-[120vw] rounded-full opacity-50 blur-[40px]"
            style={{
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--color-secondary-container) 20%, transparent), transparent 58%)',
            }}
          />
          <div className="relative max-w-container-max mx-auto px-margin-desktop">
            <div className="grid items-center gap-[60px] lg:grid-cols-[minmax(0,1fr)_minmax(0,548px)]">
              <div>
                <Reveal>
                  <Eyebrow coord="x 000 · y 0000">Report designer</Eyebrow>
                </Reveal>
                <Reveal delay={0.06}>
                  {/* Each phrase is inline-block so a line can only break
                      between them — "Show it. Build / it. Ship it." reads as a
                      mistake. */}
                  <h1 className="mt-[22px] font-display-lg text-display-lg md:text-[82px] font-extrabold leading-[0.98] tracking-[-0.042em] text-on-surface">
                    <span className="inline-block">Show it.</span>{' '}
                    <span className="inline-block">Build it.</span>{' '}
                    <span className="relative inline-block text-secondary">
                      Ship it.
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-[0.12em] h-1 origin-left rounded-[2px] bg-secondary opacity-[0.26]"
                      />
                    </span>
                  </h1>
                </Reveal>
                <Reveal delay={0.14}>
                  <p className="mt-6 font-body-lg text-[clamp(17px,1.45vw,19.5px)] leading-[1.55] tracking-[-0.008em] text-on-surface-variant max-w-[62ch]">
                    Upload a report design — a photo, a PDF, or an existing{' '}
                    <span className="font-code-sm">.repx</span>. Forma reads its geometry and returns a written
                    specification, a live in-browser mockup, and valid DevExpress XML you can open in the designer.
                    Three artifacts, one request.
                  </p>
                </Reveal>
                <Reveal delay={0.2}>
                  <div className="mt-[34px] flex flex-wrap gap-3">
                    {/* .btn.lg: 13px/24px at 14.5px, and a 1px transparent
                        border so the filled and outlined buttons are the same
                        height. */}
                    <button
                      onClick={onEnterWorkspace}
                      className="u-transition u-press u-focus-ring group inline-flex cursor-pointer items-center gap-[9px] rounded-full border border-transparent bg-secondary-container px-6 py-[13px] font-body-lg text-[14.5px] leading-[1.62] tracking-[-0.005em] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)]"
                    >
                      Open the workspace
                      <IconArrowRight
                        size={15}
                        className="u-transition group-hover:translate-x-[3px]"
                      />
                    </button>
                    <a
                      href="#textlayer"
                      className="u-transition u-press u-focus-ring inline-flex cursor-pointer items-center gap-[9px] rounded-full border border-outline bg-surface-container-lowest px-6 py-[13px] font-body-lg text-[14.5px] leading-[1.62] tracking-[-0.005em] font-semibold text-on-surface hover:border-[color:var(--ink-faint)] hover:bg-surface-container-low"
                    >
                      See how it reads a page
                    </a>
                  </div>
                </Reveal>
                <Reveal delay={0.26}>
                  <p className="mt-[22px] flex max-w-[54ch] items-baseline gap-[9px] font-code-sm text-[12px] leading-[1.7] text-[color:var(--ink-faint)]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary-container ring-[3px] ring-secondary-container/10" />
                    Bring your own Gemini key — Forma ships with none, and never stores one.
                  </p>
                </Reveal>
              </div>

              <Reveal delay={0.1}>
                <HeroScanner />
              </Reveal>
            </div>

            {/* stat strip */}
            <RevealGroup className="mt-[76px] grid grid-cols-2 border-y border-outline-variant bg-surface-container-lowest/45 md:grid-cols-4">
              <RevealItem className="border-outline-variant px-0 py-6 md:pr-[26px]">
                <Stat to={3} label="artifacts per request" />
              </RevealItem>
              <RevealItem className="border-l border-outline-variant px-6 py-6 md:px-[26px]">
                <Stat to={4} unit="versions" label="DevExpress 24.1 back to 22.2" />
              </RevealItem>
              <RevealItem className="border-t border-outline-variant px-0 py-6 md:border-l md:border-t-0 md:px-[26px]">
                <Stat to={8} unit="pages / PDF" label="read and text-extracted per file" />
              </RevealItem>
              <RevealItem className="border-l border-t border-outline-variant px-6 py-6 md:border-t-0 md:px-[26px]">
                <Stat to={0} label="API keys Forma holds" />
              </RevealItem>
            </RevealGroup>
          </div>
        </section>

        {/* -------------------------------------------------------- OUTPUT */}
        <section id="artifacts" className="py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              coord="x 000 · y 0840"
              eyebrow="Output"
              title="One request comes back as three finished things."
              lede="Not a chat answer you have to interpret. A response schema forces the model to return all three together, so the mockup you look at and the XML you download describe the same report."
            />

            <div className="grid items-start gap-13 lg:grid-cols-[296px_minmax(0,1fr)]">
              <Reveal>
                <div className="reg-marks rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card p-[22px] shadow-[var(--shadow-md),var(--inset-hi)]">
                  {[
                    ['request', 'analyzeReportDesign()'],
                    ['attachments', '2 images · 1 text layer'],
                    ['response schema', '{ markdown, layout, repxContent }'],
                    ['temperature', '0'],
                  ].map(([k, v], i) => (
                    <div key={k} className={i ? 'mt-3.5 border-t border-outline-variant pt-3.5' : undefined}>
                      <div className="font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                        {k}
                      </div>
                      <div className="mt-[5px] break-words font-code-sm text-[12.5px] leading-[1.62] text-on-surface">{v}</div>
                    </div>
                  ))}
                </div>
              </Reveal>

              <RevealGroup className="grid gap-3" stagger={0.11}>
                {[
                  {
                    Icon: IconSpec,
                    title: 'Written specification',
                    ext: 'markdown',
                    body: 'A component inventory in markdown — every element, its coordinates, its font, its borders. The document you would otherwise have written by hand before building anything.',
                  },
                  {
                    Icon: IconLayout,
                    title: 'Live layout mockup',
                    ext: 'JSON',
                    body: 'The layout drawn in the browser at true proportions, on a sheet that stays white in both light and dark themes — because a report does. What you check on screen is the file, not an approximation of it.',
                  },
                  {
                    Icon: IconCode,
                    title: 'DevExpress XML',
                    ext: '.repx',
                    body: (
                      <>
                        Real <span className="font-code-sm">XtraReportsLayoutSerializer</span> markup, syntax-coloured
                        with line numbers and a copy action. A parse check runs before you ever download it, so a
                        malformed generation shows up here — not when the designer refuses the file.
                      </>
                    ),
                  },
                ].map((a) => (
                  <RevealItem key={a.title}>
                    <div className="u-transition grid grid-cols-[38px_minmax(0,1fr)] items-start gap-[18px] rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-[22px] py-5 shadow-[var(--shadow-sm)] hover:translate-x-[5px] hover:border-[color:var(--accent-line)] hover:shadow-[var(--shadow-md)] min-[561px]:grid-cols-[40px_minmax(0,1fr)_auto]">
                      <span className="grid h-[38px] place-items-center rounded-[9px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-secondary">
                        <a.Icon size={17} />
                      </span>
                      <div>
                        <h3 className="font-display-lg text-[19px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">{a.title}</h3>
                        <p className="mt-1.5 font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant">{a.body}</p>
                      </div>
                      <span className="col-start-2 mt-[9px] justify-self-start whitespace-nowrap rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 font-code-sm text-[10.5px] leading-[1.62] font-medium text-[color:var(--ink-faint)] min-[561px]:col-start-3 min-[561px]:mt-0">
                        {a.ext}
                      </span>
                    </div>
                  </RevealItem>
                ))}
              </RevealGroup>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- SCOPE */}
        <section id="cases" className="border-y border-outline-variant band-alt py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              coord="x 000 · y 1260"
              eyebrow="Scope"
              title="Built for the documents you already have."
              lede="Most reporting work starts from something that already exists — a printed form, a PDF a client sent, a report someone built years ago. Forma starts there too."
            />
            <RevealGroup className="grid gap-px overflow-hidden rounded-xl border border-outline-variant bg-outline-variant sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((c) => (
                <RevealItem
                  key={c.title}
                  className="u-transition bg-surface-container-lowest dark:bg-card px-[22px] py-6 hover:bg-surface-container-low"
                >
                  <span className="mb-3.5 grid h-[34px] w-[34px] place-items-center rounded-full bg-[color:var(--accent-wash)] text-secondary">
                    <c.Icon size={17} />
                  </span>
                  <h3 className="font-display-lg text-[16px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">{c.title}</h3>
                  <p className="mt-[7px] font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">{c.body}</p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* ------------------------------------------------------ WORKFLOW */}
        <section id="how" className="py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              coord="x 000 · y 1680"
              eyebrow="Workflow"
              title="Three steps, and the middle one is the only one you wait for."
            />
            <div className="grid gap-y-9 md:grid-cols-3 md:gap-x-15">
              {STEPS.map((s, i) => (
                <Reveal key={s.co} delay={i * 0.12} className="h-full">
                  <div
                    className={`relative flex h-full flex-col ${
                      i ? 'border-t border-outline-variant pt-9 md:border-t-0 md:pt-0' : ''
                    }`}
                  >
                    {/* The divider sits in the 60px gutter rather than being a
                        border with padding — padding would shrink the column
                        and wrap the copy a word earlier than the source. */}
                    {i > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute -left-[30px] top-0 bottom-0 hidden w-px bg-outline-variant md:block"
                      />
                    )}
                    <div className="font-code-sm text-[10.5px] leading-[1.62] font-medium tracking-[0.13em] text-secondary">
                      {s.co}
                    </div>
                    <h3 className="mt-[11px] font-display-lg text-[19px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">{s.title}</h3>
                    <p className="mt-[11px] font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant">{s.body}</p>
                    <ul className="mt-[17px] mb-[26px] grid gap-2">
                      {s.points.map((p) => (
                        <li key={p} className="relative pl-[18px] font-body-lg text-[13.5px] leading-[1.5] text-on-surface-variant">
                          <span className="absolute left-0 top-[9px] h-[1.5px] w-2 bg-secondary-container" />
                          {p}
                        </li>
                      ))}
                    </ul>
                    {s.figure}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ ACCURACY */}
        <section id="textlayer" className="border-y border-outline-variant band-alt py-[108px]">
          <div className="max-w-container-max mx-auto grid items-center gap-[60px] px-margin-desktop lg:grid-cols-[minmax(0,1fr)_minmax(0,512px)]">
            <div>
              <Reveal>
                <Eyebrow coord="x 000 · y 2100">Accuracy</Eyebrow>
              </Reveal>
              <Reveal delay={0.06}>
                <h2 className={`mt-[18px] ${H2}`}>
                  It reads the file. Not a picture of the file.
                </h2>
              </Reveal>
              <Reveal delay={0.12}>
                <p className={`mt-[17px] ${LEDE}`}>
                  A digital PDF already contains every string and its exact position. Rasterising it and asking a model
                  to read the text back out of pixels throws that away — and the coordinates come back approximate.
                </p>
              </Reveal>
              <Reveal delay={0.18}>
                <p className={`mt-4 max-w-[60ch] ${BODY}`}>
                  Forma reads each page twice, for two different purposes. It renders the page as an image for visual
                  structure — borders, fills, logos — and it extracts the page's own text layer, converting every
                  position from PDF points into the report grid before anything is sent. The prompt ranks the extracted
                  text above the image for content and position.
                </p>
              </Reveal>
              <Reveal delay={0.24}>
                <div className="mt-6 overflow-x-auto rounded-r-[10px] border border-l-[3px] border-outline-variant border-l-secondary-container bg-surface-container-lowest/70 px-4 py-[13px] font-code-sm text-[12.5px] leading-[1.9] text-on-surface-variant">
                  612 × 792 pt &nbsp;→&nbsp; × <b className="font-bold text-on-surface">100 / 72</b> &nbsp;→&nbsp;{' '}
                  <b className="font-bold text-on-surface">850 × 1100</b> report units
                  <br />
                  y<sub>top</sub> = pageHeight − (baseline + height)
                </div>
              </Reveal>
              <Reveal delay={0.3}>
                <p className="mt-[15px] font-body-lg text-[13.5px] leading-[1.55] text-[color:var(--ink-faint)]">
                  A scanned PDF has no text layer. That is detected and reported, and it falls back to reading the page
                  visually.
                </p>
              </Reveal>
            </div>

            <Reveal delay={0.1}>
              <div className="reg-marks overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-lg),var(--inset-hi)]">
                <div className="grid grid-cols-2 border-b border-outline-variant bg-surface-container-low font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.12em] uppercase text-[color:var(--ink-faint)]">
                  <span className="px-4 py-[11px]">read from pixels</span>
                  <span className="border-l border-outline-variant px-4 py-[11px] text-secondary">read from the file</span>
                </div>
                <div className="grid grid-cols-2">
                  <div className="p-4">
                    {COORD_ROWS.map((r) => (
                      <div
                        key={r.label}
                        className="flex justify-between gap-2.5 border-b border-dashed border-outline-variant py-[7px] font-code-sm text-[10.5px] leading-[1.62] tabular-nums text-on-surface-variant last:border-b-0"
                      >
                        <span>{r.label}</span>
                        <span className="text-[color:var(--ink-faint)]">{r.guess}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-l border-outline-variant p-4">
                    {COORD_ROWS.map((r) => (
                      <div
                        key={r.label}
                        className="flex justify-between gap-2.5 border-b border-dashed border-outline-variant py-[7px] font-code-sm text-[10.5px] leading-[1.62] tabular-nums text-on-surface-variant last:border-b-0"
                      >
                        <span>{r.label}</span>
                        <span className="font-medium text-secondary">{r.exact}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-outline-variant bg-surface-container-low px-4 py-3 font-body-lg text-[12.5px] leading-[1.62] text-[color:var(--ink-faint)]">
                  Same page, same model. The difference is what it was given to work from.
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------------------------------- PRECISION */}
        <section id="precision" className="border-t border-outline-variant py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              coord="x 000 · y 2520"
              eyebrow="Precision"
              title="Accurate down to the hundredth of an inch."
              lede="These are the details Forma carries through from your design into the XML, so the report opens in the designer ready to work with."
            />
            <RevealGroup className="grid border-l border-t border-outline-variant bg-surface-container-lowest/40 sm:grid-cols-2 lg:grid-cols-3">
              {SPECS.map((s) => (
                <RevealItem
                  key={s.k}
                  className="u-transition border-b border-r border-outline-variant px-6 py-[26px] hover:bg-[color:var(--accent-wash)]"
                >
                  <div className="font-code-sm text-[9.5px] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                    {s.k}
                  </div>
                  <div className="mt-[9px] font-code-sm text-[21px] font-medium tracking-[-0.03em] tabular-nums text-on-surface">
                    {s.v}
                  </div>
                  <p className="mt-[9px] font-body-lg text-[13px] leading-[1.52] text-on-surface-variant">{s.d}</p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* ------------------------------------------------------- YOUR KEY */}
        <section id="key" className="border-y border-outline-variant band-alt py-[108px]">
          <div className="max-w-container-max mx-auto grid items-center gap-[60px] px-margin-desktop lg:grid-cols-[minmax(0,512px)_minmax(0,1fr)]">
            <Reveal>
              <VaultFigure />
            </Reveal>
            <div>
              <Reveal>
                <Eyebrow coord="x 000 · y 2940">Your key</Eyebrow>
              </Reveal>
              <Reveal delay={0.06}>
                <h2 className={`mt-[18px] ${H2}`}>
                  Forma ships with no API key, and cannot be given one.
                </h2>
              </Reveal>
              <Reveal delay={0.12}>
                <p className={`mt-[17px] ${LEDE}`}>
                  You supply your own Gemini key and your browser calls Google directly with it. It never touches
                  Forma's server — there is no generation endpoint there to touch. No shared quota, no waiting behind
                  anyone else, no per-user cost to whoever runs it.
                </p>
              </Reveal>
              <Reveal delay={0.18}>
                <p className={`mt-4 max-w-[60ch] ${BODY}`}>
                  The working copy lives in <span className="font-code-sm">sessionStorage</span>, which the browser
                  erases when the tab closes. If you want it on more than one machine, it is encrypted in your browser
                  under a passphrase you choose, and only the ciphertext is uploaded.
                </p>
              </Reveal>
              <Reveal delay={0.24}>
                <div className="mt-6 rounded-[10px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] px-[17px] py-[15px] font-body-lg text-[13.5px] leading-[1.6] text-on-surface-variant">
                  <b className="font-bold text-on-surface">Only you can decrypt it.</b> There is deliberately no reset
                  path, because a reset would mean whoever runs Forma could read your key. Keep your passphrase
                  somewhere safe and the key stays yours alone.
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- CTA */}
        <section
          data-dark-band
          className="relative overflow-hidden border-t border-outline-variant bg-[#030a15] py-[100px] text-center text-white"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.045]"
            style={{
              backgroundImage:
                'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
              backgroundSize: '96px 96px, 96px 96px',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 -top-[46%] h-[980px] w-[980px] max-w-[130vw] -translate-x-1/2"
            style={{
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--color-secondary-container) 20%, transparent), transparent 60%)',
            }}
          />
          <div className="relative max-w-container-max mx-auto px-margin-desktop">
            <Reveal>
              <Logo size={46} className="mx-auto mb-[22px]" alt="Forma" />
              {/* The eyebrow's trailing rule is suppressed here — centred text
                  with a rule running off one side reads as a mistake. */}
              <div className="font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-white/[0.46]">
                Ready when you are
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="mt-5 font-display-lg text-[clamp(29px,3.5vw,45px)] font-extrabold leading-[1.08] tracking-[-0.032em] text-white text-balance">
                Let's build something precise.
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              {/* Body copy, not the lede scale — the source sets this one at
                  the base 16px/1.62. */}
              <p className="mx-auto mt-[18px] max-w-[56ch] font-body-lg text-[16px] leading-[1.62] text-white/[0.64]">
                Bring a design and your own Gemini key. The workspace opens with nothing to configure and nothing to pay
                for.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-[34px] flex flex-wrap justify-center gap-3">
                <button
                  onClick={onEnterWorkspace}
                  className="u-transition u-press u-focus-ring group inline-flex cursor-pointer items-center gap-[9px] rounded-full border border-transparent bg-secondary-container px-6 py-[13px] font-body-lg text-[14.5px] leading-[1.62] tracking-[-0.005em] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)]"
                >
                  Launch the workspace
                  <IconArrowRight size={15} className="u-transition group-hover:translate-x-[3px]" />
                </button>
                <a
                  href="/docs"
                  className="u-transition u-press u-focus-ring inline-flex cursor-pointer items-center gap-[9px] rounded-full border border-white/[0.26] bg-white/[0.04] px-6 py-[13px] font-body-lg text-[14.5px] leading-[1.62] tracking-[-0.005em] font-semibold text-white hover:border-white hover:bg-white/10"
                >
                  Read the documentation
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Footer — four columns: the brand, real pages, in-page anchors, and
          genuine external links. */}
      <footer className="w-full bg-surface-container-lowest dark:bg-card border-t border-outline-variant pt-12 mt-auto">
        <div className="max-w-container-max mx-auto px-margin-desktop">
          <div className="grid grid-cols-2 gap-10 pb-[42px] lg:grid-cols-[1.7fr_1fr_1fr_1fr]">
            <div>
              <a href="/" className="mb-3.5 flex items-center gap-[11px] select-none">
                <Logo size={30} />
                <span className="font-display-lg text-[20px] leading-[1.05] font-extrabold tracking-[-0.03em] text-on-surface">
                  Forma
                </span>
              </a>
              <p className="max-w-[36ch] font-body-lg text-[13.5px] leading-[1.55] text-[color:var(--ink-faint)]">
                An AI report designer for DevExpress. Open source, bring your own key.
              </p>
              <p className="mt-2.5 font-body-lg text-[13.5px] leading-[1.55] text-[color:var(--ink-faint)]">
                © 2026 Forma. Designed &amp; built by{' '}
                <strong className="font-bold text-secondary">Waqar Sayyed</strong>.
              </p>
            </div>

            {[
              {
                h: 'Product',
                links: [
                  ['Features', '/features'],
                  ['Documentation', '/docs'],
                  ['Contact', '/contact'],
                  ['Open the workspace', '/workspace'],
                ],
              },
              {
                h: 'On this page',
                links: [
                  ['What you get back', '#artifacts'],
                  ['Use cases', '#cases'],
                  ['How it works', '#how'],
                  ['Precision', '#precision'],
                  ['Your API key', '#key'],
                ],
              },
              {
                h: 'Elsewhere',
                links: [
                  ['Get a Gemini key', 'https://aistudio.google.com/apikey'],
                  ['DevExpress Reporting', 'https://www.devexpress.com/products/net/reporting/'],
                  ['Privacy', '/'],
                  ['Terms', '/'],
                ],
              },
            ].map((col) => (
              <div key={col.h}>
                <h4 className="mb-3.5 font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]">
                  {col.h}
                </h4>
                {col.links.map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
                    className="u-transition block py-[5px] font-body-lg text-[14px] leading-[1.62] text-on-surface-variant hover:translate-x-[3px] hover:text-secondary"
                  >
                    {label}
                  </a>
                ))}
              </div>
            ))}
          </div>

          {/* Sign-off. Sits inside the footer's measure, under a rule that
              spans the container — not a full-bleed bar. Same line on all five
              pages; keep them in step. */}
          <div className="flex justify-center border-t border-outline-variant py-5 text-center select-none">
            <span className="font-code-sm text-[10.5px] leading-[1.62] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-faint)]">
              Crafting the future of report generation.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};


export default LandingPage;
