import { User } from 'firebase/auth';
import Logo from './Logo';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import HeroScanner from './landing/HeroScanner';
import VaultFigure from './landing/VaultFigure';
import SheetRuler from './landing/SheetRuler';
import { FigureIngest, FigureStream, FigureExport } from './landing/StepFigures';
import { Reveal, RevealGroup, RevealItem, SectionHead, Eyebrow, Stat, H2, LEDE, BODY } from './landing/sections';
import {
  IconSpec, IconLayout, IconCode, IconInvoice, IconGrid, IconPayslip, IconSeal, IconScan, IconRedo,
  IconArrowRight,
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
 * Header and footer come from SiteHeader / SiteFooter, which all four pages
 * share. They used to be pasted into each page, and that is how the four
 * drifted apart while this one was rebuilt against the approved design.
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
  return (
    // 16px/1.62 rather than `text-body-lg`, whose 24px line-height is a fixed
    // pixel value that inherits into every descendant regardless of its own
    // font size. The source design sets a unitless 1.62 so each element scales
    // its own leading; using the token instead squashed every block that does
    // not set `leading-` explicitly.
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="Product"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />
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
                <Stat to={5} unit="versions" label="DevExpress 24.1 back to 20.1" />
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

      <SiteFooter
        onThisPage={[
          ['What you get back', '#artifacts'],
          ['Use cases', '#cases'],
          ['How it works', '#how'],
          ['Precision', '#precision'],
          ['Your API key', '#key'],
        ]}
      />
    </div>
  );
};


export default LandingPage;
