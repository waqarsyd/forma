import { User } from 'firebase/auth';
import type { ReactNode } from 'react';
import Logo from './Logo';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import { Reveal, RevealGroup, RevealItem, SectionHead, Eyebrow, Stat, BODY } from './landing/sections';
import {
  IconImage, IconDoc, IconCode, IconStack,
  IconText, IconBorder, IconGrid, IconChart, IconGauge,
  IconPulse, IconPause, IconRedo, IconChat,
  IconSpec, IconLayout, IconDownload, IconShieldCheck, IconKey,
  IconCheck, IconMinus, IconDot, IconArrowRight, IconScan,
} from './landing/icons';

/**
 * The Features page.
 *
 * Rebuilt on 2026-08-11 against the same drafting-sheet design as the home
 * page, which it had never been matched to — it was still running rounded-3xl
 * gradient cards, 3D tilt and lucide icons under the shared header.
 *
 * The rewrite was as much a correctness pass as a visual one. The previous copy
 * advertised a "Dev Console" feature (the in-app DebugConsole was removed on
 * 2026-08-09), a `POST /api/parse` round-trip (that endpoint was deleted when
 * generation moved fully into the browser), and figures — "99.8% coordinate
 * match", "Engine v2.4-Aida", "< 2s avg. ingest" — that were invented. Its
 * centrepiece was a "Live Studio" that simulated parsing with setTimeout and an
 * "AI Refine" box doing substring matching on the input. None of that is what
 * Forma does, and it read as marketing against a home page whose whole voice is
 * that it tells you exactly what happens.
 *
 * Every number on this page is read out of the code: the caps from App.tsx, the
 * version and paper lists from the config modal, the layout properties from the
 * schema in geminiService.ts. If you change one of those, change it here — the
 * page claims precision, so a stale figure costs more here than elsewhere.
 */

/* ------------------------------------------------------------------ intake */

const FORMATS = [
  {
    Icon: IconImage,
    kind: 'PNG · JPG',
    title: 'Screenshots and photos',
    body: 'Resized and re-encoded in your browser before anything is sent, so a phone photo of a printed form uploads as fast as a screenshot. A file that is already small enough is passed through untouched.',
  },
  {
    Icon: IconDoc,
    kind: 'PDF',
    title: 'Multi-page documents',
    body: 'Up to 8 pages, each rendered at print resolution and text-extracted in the same pass. Anything past that is reported on screen rather than quietly dropped.',
  },
  {
    Icon: IconCode,
    kind: '.repx',
    title: 'Reports you already have',
    body: 'Read as text, then parsed and validated as XML in your browser before a request is spent. It goes up as exact markup, so a refinement edits what is actually there.',
  },
  {
    Icon: IconStack,
    kind: 'several',
    title: 'Several files at once',
    body: 'Drag them in or pick them — both routes run the same intake. Text recovered from your files is ordered ahead of the page images so exact strings are in context first.',
  },
];

/* ------------------------------------------------------------------- setup */

/** What the configuration panel actually exposes before a run. */
const SETUP: Array<{ Icon: typeof IconText; k: string; v: string; d: string }> = [
  {
    Icon: IconCode,
    k: 'DevExpress version',
    v: '24.1 · 23.2 · 23.1 · 22.2 · 20.1',
    d: 'The generated markup is targeted at the version you pick, so it opens in the designer you actually have rather than one release ahead of it.',
  },
  {
    Icon: IconLayout,
    k: 'Page size',
    v: 'Letter · A4 · Legal',
    d: 'Written into the XML as real page dimensions, so the sheet you review and the sheet that prints are the same size.',
  },
  {
    Icon: IconImage,
    k: 'Header',
    v: 'logo · title',
    d: 'Include a company logo, and give the report a title — set before it generates rather than corrected afterwards in the designer.',
  },
  {
    Icon: IconSpec,
    k: 'Footer',
    v: 'page numbers · custom text',
    d: 'Turn page numbering on, and add your own footer line — a document reference, a confidentiality note, whatever the form needs.',
  },
];

/* ---------------------------------------------------------------- fidelity */

type Mark = 'full' | 'partial' | 'standin';
type Cell = { mark: Mark; note: string };

const MARKS: Record<Mark, { Icon: typeof IconCheck; cls: string }> = {
  full: {
    Icon: IconCheck,
    cls: 'border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-secondary',
  },
  partial: {
    Icon: IconMinus,
    cls: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  },
  standin: {
    Icon: IconDot,
    cls: 'border-outline-variant bg-surface-container-low text-[color:var(--ink-faint)]',
  },
};

const CARRIES: Array<{ Icon: typeof IconText; k: string; d: string; mock: Cell; repx: Cell }> = [
  {
    Icon: IconText,
    k: 'Text and its position',
    d: 'Content, x and y, width and height — in hundredths of an inch, the unit DevExpress stores.',
    mock: { mark: 'full', note: 'drawn' },
    repx: { mark: 'full', note: 'XRLabel' },
  },
  {
    Icon: IconText,
    k: 'Type',
    d: 'Font family, size and weight, with bold and italic carried as their own flags rather than baked into a name.',
    mock: { mark: 'full', note: 'drawn' },
    repx: { mark: 'full', note: 'Font' },
  },
  {
    Icon: IconLayout,
    k: 'Alignment and wrapping',
    d: 'Horizontal and vertical alignment, and whether a cell wraps its text or clips it.',
    mock: { mark: 'full', note: 'drawn' },
    repx: { mark: 'full', note: 'TextAlignment' },
  },
  {
    Icon: IconBorder,
    k: 'Borders',
    d: 'Each of the four sides separately, with its colour — so a single underline stays a single underline.',
    mock: { mark: 'full', note: 'drawn' },
    repx: { mark: 'full', note: 'Borders' },
  },
  {
    Icon: IconGrid,
    k: 'Tables',
    d: 'One table with real rows and cells, weighted relatively the way XRTableCell does — not a grid faked out of loose labels.',
    mock: { mark: 'full', note: 'real rows' },
    repx: { mark: 'full', note: 'XRTable' },
  },
  {
    Icon: IconImage,
    k: 'Pictures and logos',
    d: 'Each one located in your upload and cut out of it. A rectangle that fails the sanity check falls back to a placeholder — a wrong crop is worse than none.',
    mock: { mark: 'full', note: 'cropped' },
    repx: { mark: 'full', note: 'XRPictureBox' },
  },
  {
    Icon: IconGauge,
    k: 'Barcodes',
    d: 'A decorative stand-in on screen — positioned and sized, with its content left undrawn — and a real XRBarCode carrying its symbology in the file.',
    mock: { mark: 'standin', note: 'placeholder' },
    repx: { mark: 'full', note: 'XRBarCode' },
  },
  {
    Icon: IconChart,
    k: 'Charts and gauges',
    d: 'Located and sized, and a chart is drawn stylised from its type and values — there is no charting library behind the mockup. Forma does not ask for a chart or gauge control by name, so the file is not guaranteed to carry one; the region is marked out for you to place it in the designer.',
    mock: { mark: 'partial', note: 'stylised' },
    repx: { mark: 'standin', note: 'not requested' },
  },
];

/* ----------------------------------------------------------------- control */

const CONTROLS = [
  {
    Icon: IconPulse,
    title: 'Progress you can believe',
    body: 'The response is streamed, so the bar tracks output actually received rather than a timer inventing percentages. It can never run backwards, and only a finished, parsed result ever reads as complete.',
  },
  {
    Icon: IconPause,
    title: 'Pause and Stop really stop',
    body: 'Both abort the request in flight rather than hiding a loader. Pause keeps the run alive so it can be re-issued; Stop resets the workspace.',
  },
  {
    Icon: IconChat,
    title: 'Say what is wrong, not what to build',
    body: 'It is a conversation, not a one-shot generator. Point at the part that came out wrong — "the totals block should sit under the table" — and ask again. Most reports take two or three passes, and each one starts from the last.',
  },
  {
    Icon: IconRedo,
    title: 'Refinements edit, not regenerate',
    body: 'A follow-up sends the existing layout and XML back with your instruction, so the model changes what you asked about and leaves the rest of the structure standing.',
  },
  {
    Icon: IconShieldCheck,
    title: 'It recovers on its own',
    body: 'Google retires models and runs out of capacity. If the model you were using disappears, Forma re-detects and retries once. If Google is briefly overloaded, it waits and tries the same model again. You see a result, not an error to interpret.',
  },
  {
    Icon: IconLayout,
    title: 'Come back to it later',
    body: 'A saved project reopens with its whole conversation — the design you uploaded, the specification, the layout and the XML — so you can carry on refining it days later instead of starting again.',
  },
];

/*
 * The "What it does not do" list that used to live here was removed on
 * 2026-08-11. Four of its six items were already stated earlier and in a
 * confident frame — charts and gauges are rows 7 and 8 of the fidelity matrix,
 * the scanned-PDF case is the third row of the intake stack, and "not proxied"
 * is the whole argument of Custody. Repeating them at the end under a negative
 * heading turned disclosure into apology. The truncation item was dropped
 * outright: it published a silent data-loss behaviour as though it were a
 * policy. The one genuinely new item, the configuration that has no UI yet,
 * belongs in the docs.
 */

/* ------------------------------------------------------------- furniture */

/** A small mono chip — the same shape as the landing page's `.repx` tag. */
function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 font-code-sm text-[10.5px] leading-[1.62] font-medium text-[color:var(--ink-faint)] ${className}`}
    >
      {children}
    </span>
  );
}

/** One cell of the fidelity matrix: a marker and what it resolves to. */
function MarkChip({ cell }: { cell: Cell }) {
  const { Icon, cls } = MARKS[cell.mark];
  return (
    <span
      className={`inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border px-2.5 py-1 font-code-sm text-[10.5px] leading-[1.62] font-medium ${cls}`}
    >
      <Icon size={10} />
      {cell.note}
    </span>
  );
}

/**
 * The XML sample, coloured the way the real viewer colours it.
 *
 * A tokeniser rather than hand-tagged spans because the card beside this figure
 * claims the pane is syntax-coloured, and a flat grey sample quietly contradicts
 * it. The input is a fixed literal below, so this only has to handle the subset
 * REPX actually uses — attribute-based markup with no text nodes.
 */
const CODE = {
  punc: '#5d7290',
  tag: '#7cc5de',
  attr: '#a9b8cc',
  str: '#ff9d5c',
};

function XmlLine({ src }: { src: string }) {
  const re = /("[^"]*")|(<\/?)|(\/?>)|([A-Za-z][\w.:-]*)|(=)|(\s+)/g;
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let key = 0;
  let expectTag = false;

  while ((m = re.exec(src)) !== null) {
    let color: string | undefined;
    if (m[1]) color = CODE.str;
    else if (m[2]) {
      color = CODE.punc;
      expectTag = true;
    } else if (m[3] || m[5]) color = CODE.punc;
    else if (m[4]) {
      color = expectTag ? CODE.tag : CODE.attr;
      expectTag = false;
    }
    out.push(
      <span key={key++} style={color ? { color } : undefined}>
        {m[0]}
      </span>,
    );
  }
  return <>{out}</>;
}

/** The hero's figure: the pipeline, doubling as this page's contents. */
function PipelineCard() {
  const stops: Array<[string, string, string, string]> = [
    ['01', 'Intake', 'What you can hand it', '#intake'],
    ['02', 'Setup', 'What you set first', '#setup'],
    ['03', 'Fidelity', 'What survives the trip', '#fidelity'],
    ['04', 'Control', 'The run itself', '#control'],
    ['05', 'Output', 'Checked before download', '#output'],
    ['06', 'Custody', 'Your key, your work', '#custody'],
  ];
  return (
    <div className="reg-marks rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card p-[22px] shadow-[var(--shadow-lg),var(--inset-hi)]">
      <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant pb-3.5">
        <span className="font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
          the path a file takes
        </span>
        <span className="font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.14em] uppercase text-secondary">
          6 stops
        </span>
      </div>
      {stops.map(([n, name, note, href]) => (
        <a
          key={n}
          href={href}
          className="u-transition group -mx-2 flex items-center gap-[15px] rounded-lg px-2 py-3 hover:bg-[color:var(--accent-wash)]"
        >
          <span className="font-code-sm text-[11px] leading-[1.62] font-medium tabular-nums text-secondary">{n}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display-lg text-[15.5px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">
              {name}
            </span>
            <span className="block font-body-lg text-[13px] leading-[1.5] text-on-surface-variant">{note}</span>
          </span>
          <IconArrowRight
            size={14}
            className="u-transition shrink-0 text-[color:var(--ink-faint)] group-hover:translate-x-[3px] group-hover:text-secondary"
          />
        </a>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- page */

interface FeaturesPageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

export default function FeaturesPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: FeaturesPageProps) {
  return (
    // 16px/1.62 rather than `text-body-lg`, whose fixed 24px line-height would
    // inherit into every descendant — see the note in LandingPage.
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="Features"
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
            <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-[60px] [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,468px)]">
              <div>
                <Reveal>
                  <Eyebrow>Capability</Eyebrow>
                </Reveal>
                <Reveal delay={0.06}>
                  <h1 className="mt-[22px] font-display-lg text-display-lg md:text-[70px] font-extrabold leading-[1.0] tracking-[-0.042em] text-on-surface">
                    <span className="inline-block">Everything it does,</span>{' '}
                    <span className="relative inline-block text-secondary">
                      and where it stops.
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-[0.12em] h-1 origin-left rounded-[2px] bg-secondary opacity-[0.26]"
                      />
                    </span>
                  </h1>
                </Reveal>
                <Reveal delay={0.14}>
                  <p className="mt-6 font-body-lg text-[clamp(17px,1.45vw,19.5px)] leading-[1.55] tracking-[-0.008em] text-on-surface-variant max-w-[62ch]">
                    A page of capabilities is easy to write and hard to trust. So everything below is read out of
                    the code that actually runs — and where Forma stops short, it says so in the same table where
                    it says what it does, <em className="not-italic text-secondary">not</em> in a footnote at the
                    bottom.
                  </p>
                </Reveal>
                <Reveal delay={0.2}>
                  <div className="mt-[34px] flex flex-wrap gap-3">
                    <button
                      onClick={onEnterWorkspace}
                      className="u-transition u-press u-focus-ring group inline-flex cursor-pointer items-center gap-[9px] rounded-full border border-transparent bg-secondary-container px-6 py-[13px] font-body-lg text-[14.5px] leading-[1.62] tracking-[-0.005em] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)]"
                    >
                      Open the workspace
                      <IconArrowRight size={15} className="u-transition group-hover:translate-x-[3px]" />
                    </button>
                    <a
                      href="#fidelity"
                      className="u-transition u-press u-focus-ring inline-flex cursor-pointer items-center gap-[9px] rounded-full border border-outline bg-surface-container-lowest px-6 py-[13px] font-body-lg text-[14.5px] leading-[1.62] tracking-[-0.005em] font-semibold text-on-surface hover:border-[color:var(--ink-faint)] hover:bg-surface-container-low"
                    >
                      See what it carries over
                    </a>
                  </div>
                </Reveal>
              </div>

              <Reveal delay={0.1}>
                <PipelineCard />
              </Reveal>
            </div>

            {/* stat strip */}
            <RevealGroup className="mt-[76px] grid grid-cols-2 border-y border-outline-variant bg-surface-container-lowest/45 md:grid-cols-4">
              <RevealItem className="border-outline-variant px-0 py-6 md:pr-[26px]">
                <Stat to={4} unit="file types" label="PNG, JPG, PDF and .repx" />
              </RevealItem>
              <RevealItem className="border-l border-outline-variant px-6 py-6 md:px-[26px]">
                <Stat to={8} unit="pages / PDF" label="rendered and text-extracted" />
              </RevealItem>
              <RevealItem className="border-t border-outline-variant px-0 py-6 md:border-l md:border-t-0 md:px-[26px]">
                <Stat to={3} unit="artifacts" label="spec, mockup and XML, per request" />
              </RevealItem>
              <RevealItem className="border-l border-t border-outline-variant px-6 py-6 md:border-t-0 md:px-[26px]">
                <Stat to={0} label="plaintext copies of your key" />
              </RevealItem>
            </RevealGroup>
          </div>
        </section>

        {/* -------------------------------------------------------- INTAKE */}
        <section id="intake" className="py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Intake"
              title="Hand it what you already have."
              lede="Nothing needs converting first. Files are prepared in your browser — resized, rendered, parsed — and anything that cannot be used says so on screen instead of failing quietly."
            />

            <RevealGroup className="grid gap-3 md:grid-cols-2" stagger={0.09}>
              {FORMATS.map((f) => (
                <RevealItem key={f.kind}>
                  <div className="u-transition h-full rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-[22px] py-5 shadow-[var(--shadow-sm)] hover:border-[color:var(--accent-line)] hover:shadow-[var(--shadow-md)]">
                    <div className="flex items-center gap-[13px]">
                      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[9px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-secondary">
                        <f.Icon size={17} />
                      </span>
                      <h3 className="font-display-lg text-[17px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">
                        {f.title}
                      </h3>
                      <Tag className="ml-auto">{f.kind}</Tag>
                    </div>
                    <p className="mt-3 font-body-lg text-[14.5px] leading-[1.62] text-on-surface-variant">{f.body}</p>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>

            {/* the two-pass read */}
            <div className="mt-13 grid grid-cols-[minmax(0,1fr)] items-center gap-[60px] [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,472px)]">
              <div>
                <Reveal>
                  <h3 className="font-display-lg text-[24px] font-bold leading-[1.18] tracking-[-0.026em] text-on-surface">
                    Every page is read twice, for two different reasons.
                  </h3>
                </Reveal>
                <Reveal delay={0.06}>
                  <p className={`mt-[15px] max-w-[60ch] ${BODY}`}>
                    A digital PDF already knows every string and exactly where it sits. Forma renders the page as an
                    image <em className="not-italic font-semibold text-on-surface">and</em> pulls its text layer,
                    converting each position out of PDF points into the report's own grid before anything is sent.
                    The prompt then ranks that extracted text above the image for content and position, and leaves the
                    image authoritative for borders, fills and logos.
                  </p>
                </Reveal>
                <Reveal delay={0.12}>
                  <div className="mt-6 overflow-x-auto rounded-r-[10px] border border-l-[3px] border-outline-variant border-l-secondary-container bg-surface-container-lowest/70 px-4 py-[13px] font-code-sm text-[12.5px] leading-[1.9] text-on-surface-variant">
                    612 × 792 pt &nbsp;→&nbsp; × <b className="font-bold text-on-surface">100 / 72</b> &nbsp;→&nbsp;{' '}
                    <b className="font-bold text-on-surface">850 × 1100</b> report units
                    <br />y<sub>top</sub> = pageHeight − (baseline + height)
                  </div>
                </Reveal>
              </div>

              <Reveal delay={0.1}>
                <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-md),var(--inset-hi)]">
                  {[
                    {
                      Icon: IconImage,
                      h: 'the page as an image',
                      d: 'Rendered at print resolution on a white ground. Authoritative for borders, fills, logos and visual structure.',
                    },
                    {
                      Icon: IconText,
                      h: 'the page as text',
                      d: 'Every string with its exact position, converted into hundredths of an inch. Authoritative for content.',
                    },
                    {
                      Icon: IconScan,
                      h: 'no text layer found',
                      d: 'A scan is detected and reported, and the page falls back to being read visually.',
                    },
                  ].map((r, i) => (
                    <div
                      key={r.h}
                      className={`flex items-start gap-[15px] px-[22px] py-[18px] ${
                        i ? 'border-t border-outline-variant' : ''
                      } ${i === 2 ? 'bg-surface-container-low' : ''}`}
                    >
                      <span
                        className={`mt-[2px] grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full ${
                          i === 2
                            ? 'bg-surface-container text-[color:var(--ink-faint)]'
                            : 'bg-[color:var(--accent-wash)] text-secondary'
                        }`}
                      >
                        <r.Icon size={15} />
                      </span>
                      <div>
                        <div className="font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                          {r.h}
                        </div>
                        <p className="mt-[5px] font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">
                          {r.d}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal>
              {/* Marker in the gutter rather than a flex child: as a flex item
                  it is pushed onto a line of its own the moment the text wraps,
                  which it does on a phone. */}
              <p className="relative mt-9 pl-[18px] font-code-sm text-[12px] leading-[1.7] text-[color:var(--ink-faint)]">
                <span className="absolute left-0 top-2 h-1.5 w-1.5 rounded-full bg-secondary-container ring-[3px] ring-secondary-container/10" />
                Every file you add is confirmed on screen — anything unsupported or too large is named, not silently skipped
              </p>
            </Reveal>
          </div>
        </section>

        {/* --------------------------------------------------------- SETUP */}
        <section id="setup" className="border-y border-outline-variant band-alt py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Setup"
              title="Decide the shape before it builds."
              lede="Four settings, all of them things you would otherwise fix by hand in the designer afterwards. They are written into the generated XML rather than applied to it later."
            />

            <RevealGroup className="grid gap-px overflow-hidden rounded-xl border border-outline-variant bg-outline-variant sm:grid-cols-2" stagger={0.09}>
              {SETUP.map((s) => (
                <RevealItem
                  key={s.k}
                  className="u-transition bg-surface-container-lowest dark:bg-card px-[22px] py-6 hover:bg-surface-container-low"
                >
                  <div className="flex items-center gap-[13px]">
                    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[color:var(--accent-wash)] text-secondary">
                      <s.Icon size={17} />
                    </span>
                    <h3 className="font-display-lg text-[17px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">
                      {s.k}
                    </h3>
                  </div>
                  <div className="mt-3.5 font-code-sm text-[13px] font-medium leading-[1.5] tracking-[-0.01em] text-secondary">
                    {s.v}
                  </div>
                  <p className="mt-[7px] font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">{s.d}</p>
                </RevealItem>
              ))}
            </RevealGroup>

            <Reveal delay={0.1}>
              <div className="mt-9 rounded-[10px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] px-[17px] py-[15px] font-body-lg text-[13.5px] leading-[1.6] text-on-surface-variant">
                <b className="font-bold text-on-surface">There is no model to choose, and that is deliberate.</b>{' '}
                Google retires models "for new users", so a hard-coded id is a time bomb — an existing project keeps
                working while every freshly created key gets a 404. Forma probes the candidates your key can actually
                reach, once per session, and uses the best one that answers. One less setting, and one less thing to
                be wrong about in six months.
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------ FIDELITY */}
        <section id="fidelity" className="py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Fidelity"
              title="What survives the trip."
              lede="The mockup you look at and the XML you download are generated together from one description, so they agree with each other. This is what that description carries — including the two rows where it stops short."
            />

            <Reveal>
              <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-md)]">
                {/* header — hidden where the rows stack */}
                <div className="hidden border-b border-outline-variant bg-surface-container-low px-[22px] py-[11px] font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.12em] uppercase text-[color:var(--ink-faint)] md:grid md:grid-cols-[minmax(0,1fr)_132px_132px] md:gap-6">
                  <span>property</span>
                  <span>in the mockup</span>
                  <span className="text-secondary">in the .repx</span>
                </div>

                {CARRIES.map((r, i) => (
                  <div
                    key={r.k}
                    className={`u-transition px-[22px] py-[18px] hover:bg-[color:var(--accent-wash)] md:grid md:grid-cols-[minmax(0,1fr)_132px_132px] md:items-center md:gap-6 ${
                      i ? 'border-t border-outline-variant' : ''
                    }`}
                  >
                    <div className="flex items-start gap-[13px]">
                      <span className="mt-[3px] shrink-0 text-[color:var(--ink-faint)]">
                        <r.Icon size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-display-lg text-[15.5px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                          {r.k}
                        </div>
                        <p className="mt-[5px] font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">
                          {r.d}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2 pl-[29px] md:mt-0 md:block md:pl-0">
                      <MarkChip cell={r.mock} />
                      <span className="md:hidden">
                        <MarkChip cell={r.repx} />
                      </span>
                    </div>
                    <div className="hidden md:block">
                      <MarkChip cell={r.repx} />
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* Paper size and version moved to Setup, where they are a
                control rather than a fact. What is left is the one number that
                belongs beside the matrix. */}
            <Reveal>
              <div className="mt-9 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-outline-variant bg-surface-container-lowest/60 dark:bg-card px-[18px] py-[15px]">
                <span className="font-code-sm text-[13px] font-medium leading-[1.5] tracking-[-0.01em] text-on-surface">
                  100 units = 1 inch
                </span>
                <span className="font-body-lg text-[12.5px] leading-[1.5] text-[color:var(--ink-faint)]">
                  the grid both artifacts are drawn on — the unit DevExpress stores, so nothing is converted on the
                  way in or out
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- CONTROL */}
        <section id="control" className="border-y border-outline-variant band-alt py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Control"
              title="You are not watching a spinner."
              lede="A generation takes real time, and the interface is honest about where that time goes rather than filling it with an animation."
            />
            <RevealGroup className="grid gap-px overflow-hidden rounded-xl border border-outline-variant bg-outline-variant sm:grid-cols-2" stagger={0.09}>
              {CONTROLS.map((c) => (
                <RevealItem
                  key={c.title}
                  className="u-transition bg-surface-container-lowest dark:bg-card px-[22px] py-6 hover:bg-surface-container-low"
                >
                  <span className="mb-3.5 grid h-[34px] w-[34px] place-items-center rounded-full bg-[color:var(--accent-wash)] text-secondary">
                    <c.Icon size={17} />
                  </span>
                  <h3 className="font-display-lg text-[17px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">
                    {c.title}
                  </h3>
                  <p className="mt-[7px] font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">{c.body}</p>
                </RevealItem>
              ))}
            </RevealGroup>

          </div>
        </section>

        {/* -------------------------------------------------------- OUTPUT */}
        <section id="output" className="py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Output"
              title="Checked before you download it."
              lede="A malformed generation should show up here, in the browser, and not when the DevExpress designer refuses the file."
            />

            {/* The base `grid-cols-[minmax(0,1fr)]` and `[&>*]:min-w-0` are the
                same guard the `lg:` rule carries, applied at the base width too.
                Without them this is one implicit `auto` track below 1024px, and
                an `auto` track floors at its content's min-content width: at a
                320px viewport it measured 339px, so the four cards below and
                their headings were drawn 28px past the right edge. Same defect
                as the two grids in DocsPage. */}
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[60px] [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,516px)]">
              <div>
                <RevealGroup className="grid gap-3" stagger={0.1}>
                  {[
                    {
                      Icon: IconSpec,
                      t: 'The written specification',
                      d: 'A component inventory in markdown — every element, its coordinates, its font and its borders. The document you would otherwise have written by hand.',
                    },
                    {
                      Icon: IconLayout,
                      t: 'The live mockup',
                      d: 'Drawn at true proportions on a sheet that stays white in both light and dark themes, because a printed report does. It scales to your viewport without reflowing the layout.',
                    },
                    {
                      Icon: IconShieldCheck,
                      t: 'The XML, parsed and checked',
                      d: 'Syntax-coloured with line numbers and a copy action. Before you download, it is parsed and asserted to have the right root element and a Bands section.',
                    },
                    {
                      Icon: IconDownload,
                      t: 'The file itself',
                      d: 'Downloads as a .repx named after the report title. If the model returned no XML at all, you get the written spec as .txt rather than an empty file.',
                    },
                  ].map((o) => (
                    <RevealItem key={o.t}>
                      <div className="u-transition grid grid-cols-[38px_minmax(0,1fr)] items-start gap-[18px] rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-[22px] py-5 shadow-[var(--shadow-sm)] hover:translate-x-[5px] hover:border-[color:var(--accent-line)] hover:shadow-[var(--shadow-md)]">
                        <span className="grid h-[38px] place-items-center rounded-[9px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-secondary">
                          <o.Icon size={17} />
                        </span>
                        <div>
                          <h3 className="font-display-lg text-[16.5px] font-bold leading-[1.28] tracking-[-0.018em] text-on-surface">
                            {o.t}
                          </h3>
                          <p className="mt-1.5 font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">{o.d}</p>
                        </div>
                      </div>
                    </RevealItem>
                  ))}
                </RevealGroup>
              </div>

              {/* the XML pane, drawn in its own tokens */}
              <Reveal delay={0.1}>
                <div className="reg-marks overflow-hidden rounded-xl border border-outline-variant shadow-[var(--shadow-lg)]">
                  <div className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low px-4 py-[11px]">
                    <span className="font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.12em] uppercase text-[color:var(--ink-faint)]">
                      invoice_report.repx
                    </span>
                    <span className="inline-flex items-center gap-[6px] rounded-full border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] px-2.5 py-[3px] font-code-sm text-[10px] leading-[1.62] font-medium text-secondary">
                      <IconCheck size={9} />
                      parse check passed
                    </span>
                  </div>
                  <pre
                    className="overflow-x-auto px-4 py-4 font-code-sm text-[11.5px] leading-[1.75]"
                    style={{ background: 'var(--code-bg)', color: 'var(--code-ink)' }}
                  >
                    {[
                      ['1', '<XtraReportsLayoutSerializer'],
                      ['2', '    ControlType="XtraReport"'],
                      ['3', '    PageWidth="850" PageHeight="1100">'],
                      ['4', '  <Bands>'],
                      ['5', '    <Item1 ControlType="DetailBand"'],
                      ['6', '           HeightF="640">'],
                      ['7', '      <Controls>'],
                      ['8', '        <Item1 ControlType="XRLabel"'],
                      ['9', '          Text="INVOICE"'],
                      ['10', '          LocationFloat="40,45" />'],
                      ['11', '        <Item2 ControlType="XRTable" />'],
                      ['12', '      </Controls>'],
                      ['13', '    </Item1>'],
                      ['14', '  </Bands>'],
                      ['15', '</XtraReportsLayoutSerializer>'],
                    ].map(([n, line]) => (
                      <div key={n} className="flex gap-4">
                        <span className="w-5 shrink-0 select-none text-right tabular-nums opacity-40">{n}</span>
                        <span className="whitespace-pre">
                          <XmlLine src={line} />
                        </span>
                      </div>
                    ))}
                  </pre>
                  <div
                    className="border-t px-4 py-3 font-body-lg text-[12.5px] leading-[1.62]"
                    style={{ borderColor: 'var(--code-rule)', background: 'var(--code-bg)', color: 'var(--ink-faint)' }}
                  >
                    Rendered as text nodes, never as markup — the viewer cannot be made to inject anything.
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- CUSTODY */}
        <section id="custody" className="border-y border-outline-variant band-alt py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Custody"
              title="Your key, and your saved work."
              lede="Forma ships with no API key and cannot be given one. Yours is never written to disk in plaintext, on any tier."
            />

            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[60px] [&>*]:min-w-0 lg:grid-cols-[minmax(0,532px)_minmax(0,1fr)]">
              <Reveal>
                <div className="reg-marks overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-md),var(--inset-hi)]">
                  {[
                    {
                      Icon: IconKey,
                      h: 'working copy',
                      w: 'sessionStorage',
                      d: 'Erased by the browser when the tab closes — a guarantee an unload handler cannot make, since it never fires on a crash or a force-quit.',
                      on: true,
                    },
                    {
                      Icon: IconShieldCheck,
                      h: 'durable copy · opt-in',
                      w: 'AES-GCM ciphertext',
                      d: 'Encrypted in your browser under a passphrase you choose, with only the ciphertext uploaded. There is deliberately no reset path.',
                      on: true,
                    },
                    // A third tier used to sit here describing a legacy
                    // plaintext entry that is purged on boot. It documented a
                    // mistake that has already been fixed, and raised a
                    // question in the reader's mind rather than answering one.
                    // It belongs in the docs, where someone upgrading might
                    // actually wonder about it.
                  ].map((t, i) => (
                    <div
                      key={t.h}
                      className={`flex items-start gap-[15px] px-[22px] py-[18px] ${
                        i ? 'border-t border-outline-variant' : ''
                      } ${!t.on ? 'bg-surface-container-low' : ''}`}
                    >
                      <span
                        className={`mt-[2px] grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full ${
                          t.on
                            ? 'bg-[color:var(--accent-wash)] text-secondary'
                            : 'bg-surface-container text-[color:var(--ink-faint)]'
                        }`}
                      >
                        <t.Icon size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="font-code-sm text-[9.5px] leading-[1.62] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                            {t.h}
                          </span>
                          <span
                            className={`font-code-sm text-[11px] leading-[1.62] font-medium ${
                              t.on ? 'text-secondary' : 'text-[color:var(--ink-faint)] line-through'
                            }`}
                          >
                            {t.w}
                          </span>
                        </div>
                        <p className="mt-[6px] font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">
                          {t.d}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>

              <div>
                <Reveal>
                  <h3 className="font-display-lg text-[24px] font-bold leading-[1.18] tracking-[-0.026em] text-on-surface">
                    Saved projects follow the same rule.
                  </h3>
                </Reveal>
                <Reveal delay={0.06}>
                  <p className={`mt-[15px] max-w-[60ch] ${BODY}`}>
                    Signed in, a project is written to your own account and appears on every device you sign in from.
                    Signed out, it stays in this browser — reload the page and it is still there. Either way the API
                    key is never part of what gets saved.
                  </p>
                </Reveal>
                <Reveal delay={0.12}>
                  <ul className="mt-[17px] grid gap-2">
                    {[
                      'Uploads travel inside the transcript, so a large design can outgrow a cloud record — Forma re-saves it without the thumbnails and tells you, rather than losing the spec and the XML.',
                      'Signing out clears the workspace as well as the credential: the design, the extracted text and the generated report all go.',
                      'A session ended in another tab clears this one too.',
                    ].map((p) => (
                      <li
                        key={p}
                        className="relative pl-[18px] font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant"
                      >
                        <span className="absolute left-0 top-[9px] h-[1.5px] w-2 bg-secondary-container" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal delay={0.18}>
                  <div className="mt-6 rounded-[10px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] px-[17px] py-[15px] font-body-lg text-[13.5px] leading-[1.6] text-on-surface-variant">
                    <b className="font-bold text-on-surface">Only you can decrypt the stored key.</b> A reset path would
                    mean whoever runs Forma could read it, so there is not one. Keep your passphrase somewhere safe.
                  </div>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- COST */}
        <section id="cost" className="py-[108px]">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <SectionHead
              eyebrow="Cost"
              title="Free, and there is no upgrade to sell you."
              lede="Forma is open source. There is no licence, no seat count, no plan above the one you are on — because there are no plans."
            />
            <RevealGroup className="grid gap-px overflow-hidden rounded-xl border border-outline-variant bg-outline-variant sm:grid-cols-3" stagger={0.09}>
              {[
                {
                  k: 'The application',
                  v: 'free',
                  d: 'Open source and yours to read, run and change. Nothing is held back behind a paid tier.',
                },
                {
                  k: 'The generation',
                  v: 'billed by Google',
                  d: 'You bring your own key, so Google bills you directly for your own usage. Forma takes no cut and adds no markup — it never sees the transaction.',
                },
                {
                  k: 'Your queue',
                  v: 'yours alone',
                  d: 'No shared quota means nobody else’s traffic slows you down, and nothing runs out halfway through a busy afternoon.',
                },
              ].map((c) => (
                <RevealItem
                  key={c.k}
                  className="u-transition bg-surface-container-lowest dark:bg-card px-[22px] py-6 hover:bg-surface-container-low"
                >
                  <div className="font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                    {c.k}
                  </div>
                  <div className="mt-[9px] font-code-sm text-[21px] font-medium leading-[1.2] tracking-[-0.03em] text-secondary">
                    {c.v}
                  </div>
                  <p className="mt-[9px] font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">{c.d}</p>
                </RevealItem>
              ))}
            </RevealGroup>
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
              <div className="font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-white/[0.46]">
                Nothing to configure
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="mt-5 font-display-lg text-[clamp(29px,3.5vw,45px)] font-extrabold leading-[1.08] tracking-[-0.032em] text-white text-balance">
                Read the claims. Then go and test them.
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mx-auto mt-[18px] max-w-[56ch] font-body-lg text-[16px] leading-[1.62] text-white/[0.64]">
                Bring a design and your own Gemini key. Everything on this page is something you can check in a few
                minutes, on your own file.
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
          ['Intake', '#intake'],
          ['Setup', '#setup'],
          ['Fidelity', '#fidelity'],
          ['Control', '#control'],
          ['Output', '#output'],
          ['Custody', '#custody'],
          ['Cost', '#cost'],
        ]}
      />
    </div>
  );
}
