/**
 * The app's icon set.
 *
 * Deliberately inline SVG rather than a ligature font: these surfaces are
 * drafting sheets, and these are hairline drawings at the same weight as their
 * rules. Material Symbols' filled glyphs read as a different family beside them.
 *
 * This was the *landing page's* set until the workspace was rebuilt on the same
 * design language; it is now the default for new work anywhere in the app. Add
 * icons here rather than starting a second set, and match the 1.8 default
 * stroke — a heavier icon in a toolbar is visible immediately next to a lighter
 * one in the same row.
 *
 * Two consumers still use Material Symbols: `SiteHeader` and `MobileNav`, which
 * is why the Google Fonts <link> in index.html has to stay. See CLAUDE.md.
 */

type Props = { size?: number; className?: string; strokeWidth?: number };

const Svg = ({
  size = 17,
  className = '',
  strokeWidth = 1.8,
  children,
}: Props & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/* ---- the three artifacts ---- */
export const IconSpec = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </Svg>
);
export const IconLayout = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 9v12" />
  </Svg>
);
export const IconCode = (p: Props) => (
  <Svg {...p}>
    <path d="m9 8-5 4 5 4M15 8l5 4-5 4" />
  </Svg>
);

/* ---- use cases ---- */
export const IconInvoice = (p: Props) => (
  <Svg {...p}>
    <path d="M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2z" />
    <path d="M8 8h8M8 12h8M8 16h4" />
  </Svg>
);
export const IconGrid = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10M15 10v10" />
  </Svg>
);
export const IconPayslip = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v18M5 8h14M5 16h14" />
    <circle cx="12" cy="12" r="9" />
  </Svg>
);
export const IconSeal = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="5" />
    <path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" />
  </Svg>
);
export const IconScan = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M8 12h8" />
  </Svg>
);
export const IconRedo = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </Svg>
);

/* ---- intake formats ---- */
export const IconImage = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 17 4.5-4.5 3 3L15 12l5 5" />
  </Svg>
);
export const IconDoc = (p: Props) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const IconStack = (p: Props) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5M3 16.5 12 21l9-4.5" />
  </Svg>
);

/* ---- what the layout carries ---- */
export const IconText = (p: Props) => (
  <Svg {...p}>
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  </Svg>
);
export const IconBorder = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="1.5" strokeDasharray="3 3" />
    <path d="M3 4.5v15" strokeWidth={3.2} />
  </Svg>
);
export const IconChart = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 20v-6M13 20V8M18 20v-9" />
  </Svg>
);
export const IconGauge = (p: Props) => (
  <Svg {...p}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="m12 18 4.5-5.5" />
  </Svg>
);

/* ---- running a request ---- */
export const IconPulse = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12h4l3-8 4 16 3-8h6" />
  </Svg>
);
export const IconPause = (p: Props) => (
  <Svg {...p}>
    <path d="M9 4v16M15 4v16" strokeWidth={2.4} />
  </Svg>
);
export const IconChat = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z" />
  </Svg>
);

/* ---- output and custody ---- */
export const IconDownload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
);
export const IconShieldCheck = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3 5 6v6c0 4.4 2.9 7.9 7 9 4.1-1.1 7-4.6 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const IconKey = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8-8M17 6l2 2M15 8l2 2" />
  </Svg>
);

/* ---- docs, contact and auth ---- */
export const IconSearch = (p: Props) => (
  <Svg strokeWidth={2} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const IconChevronDown = (p: Props) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconThumbUp = (p: Props) => (
  <Svg {...p}>
    <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    <path d="M7 11l4.5-8a2.2 2.2 0 0 1 3 2.8L13 9h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 20H7" />
  </Svg>
);
export const IconThumbDown = (p: Props) => (
  <Svg {...p}>
    <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1z" />
    <path d="M17 13l-4.5 8a2.2 2.2 0 0 1-3-2.8L11 15H5.5a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 7 4h10" />
  </Svg>
);
export const IconMail = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Svg>
);
export const IconWarn = (p: Props) => (
  <Svg strokeWidth={2.2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.5" />
  </Svg>
);
export const IconInfo = (p: Props) => (
  <Svg strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </Svg>
);
export const IconExternal = (p: Props) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Svg>
);
export const IconEye = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);
export const IconEyeOff = (p: Props) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.3 8.1A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1.3 0 2.5-.2 3.5-.6" />
  </Svg>
);
export const IconClose = (p: Props) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

/* ---- brand marks, for the maker's profile links ---- */
const Brand = ({ size = 19, className = '', d }: Props & { d: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d={d} />
  </svg>
);
export const IconGitHub = (p: Props) => (
  <Brand
    {...p}
    d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
  />
);
export const IconLinkedIn = (p: Props) => (
  <Brand
    {...p}
    d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
  />
);
export const IconDiscord = (p: Props) => (
  <Brand
    {...p}
    d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.009c.12.099.246.198.373.292a.077.077 0 01-.007.128 12.3 12.3 0 01-1.873.891.077.077 0 00-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.029 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.333-.946 2.419-2.157 2.419z"
  />
);
export const IconPortfolio = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 4v5" />
    <path d="M11 13h6M11 16h4" />
  </Svg>
);

/* ---- status markers ---- */
export const IconMinus = (p: Props) => (
  <Svg strokeWidth={3} {...p}>
    <path d="M6 12h12" />
  </Svg>
);
export const IconDot = (p: Props) => (
  <svg
    width={p.size ?? 17}
    height={p.size ?? 17}
    viewBox="0 0 24 24"
    className={p.className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  </svg>
);

/* ---- controls ---- */
export const IconArrowRight = (p: Props) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </Svg>
);
export const IconReplay = (p: Props) => (
  <Svg strokeWidth={2.4} {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);
export const IconArrowDown = (p: Props) => (
  <Svg strokeWidth={2.4} {...p}>
    <path d="M12 4v16M6 14l6 6 6-6" />
  </Svg>
);
export const IconCheck = (p: Props) => (
  <Svg strokeWidth={3} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const IconSun = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </Svg>
);
export const IconMoon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
  </Svg>
);

/* ---- workspace ----
   Added when the workspace moved off Material Symbols. Same 1.8 default weight
   as everything above, so a workspace toolbar and a marketing page read as one
   drawing. Where a Material glyph had no counterpart the shape follows the
   glyph it replaced, not a new invention — `architecture` was a drafting
   compass, so IconRuler is a compass. */
export const IconHistory = (p: Props) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 8v4.5l3.5 2" />
  </Svg>
);
export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);
export const IconTune = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Svg>
);
export const IconSave = (p: Props) => (
  <Svg {...p}>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M8 3v6h8V3M8 21v-6h8v6" />
  </Svg>
);
export const IconPlus = (p: Props) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconPlay = (p: Props) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" />
  </Svg>
);
export const IconArrowUp = (p: Props) => (
  <Svg strokeWidth={2.4} {...p}>
    <path d="M12 20V4M6 10l6-6 6 6" />
  </Svg>
);
/* There is deliberately no IconRocket. The `rocket_launch` glyph it would have
   replaced sat in the "03 SHIP — Export Native" card, directly beside a drafting
   compass, and three attempts at a rocket all reduced to the same
   triangle-plus-crossbar silhouette as that compass at 22px. The card means
   export, so it uses IconDownload — the same icon as the Export action, which is
   the same concept. Silhouette, not detail, is what carries at toolbar sizes.
   (The compass was `IconRuler`; it and `IconUpload` were removed on 2026-08-28
   as unrendered — nothing imported either, and neither appeared in the built
   bundle, so both were already tree-shaken. Recover from `c78b943~1`. The
   reasoning above survives them because it is about the rocket, not the
   compass.) */
export const IconFolder = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
  </Svg>
);
export const IconLogout = (p: Props) => (
  <Svg {...p}>
    <path d="M15 4h4.5v16H15" />
    <path d="M11 8l-4 4 4 4M7 12h9" />
  </Svg>
);
export const IconLogin = (p: Props) => (
  <Svg {...p}>
    <path d="M9 4H4.5v16H9" />
    <path d="M14 8l4 4-4 4M18 12H9" />
  </Svg>
);
export const IconMenu = (p: Props) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
/* The workspace's side-panel toggle. Distinct from `IconLayout` — that one
   divides the frame with a header rule and reads as "a page"; this divides it
   with a full-height rule and reads as "a column beside the work". */
export const IconPanelLeft = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9.5 3v18" />
  </Svg>
);
/* The announcement dock's launcher. A bell rather than a megaphone: a
   megaphone reads as marketing, and this is a changelog. */
export const IconBell = (p: Props) => (
  <Svg {...p}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 4.2-1.4 5.6-1.4 5.6h14.8S18 12.7 18 8.5" />
    <path d="M13.7 18a2 2 0 0 1-3.4 0" />
  </Svg>
);
/* The rail's own expander. Double chevrons rather than the single one
   `IconChevronDown` carries, so it does not read as "open this section". */
export const IconChevronsRight = (p: Props) => (
  <Svg {...p}>
    <path d="m7 6 6 6-6 6M13 6l6 6-6 6" />
  </Svg>
);
export const IconChevronsLeft = (p: Props) => (
  <Svg {...p}>
    <path d="m17 6-6 6 6 6M11 6l-6 6 6 6" />
  </Svg>
);
export const IconCheckCircle = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </Svg>
);
export const IconPaperclip = (p: Props) => (
  <Svg {...p}>
    <path d="M18 7.5 9.5 16a3 3 0 0 1-4.2-4.2l8-8a4.5 4.5 0 0 1 6.4 6.4l-8.4 8.4a6 6 0 0 1-8.5-8.5l6-6" />
  </Svg>
);
export const IconCopy = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </Svg>
);
export const IconAlert = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.3" />
  </Svg>
);
