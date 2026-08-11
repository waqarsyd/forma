/**
 * The landing page's icon set.
 *
 * Deliberately inline SVG rather than the Material Symbols ligature font the
 * rest of the app uses: this page is a drafting sheet, and these are hairline
 * drawings at the same weight as its rules. Material's filled glyphs read as a
 * different family beside them. Everywhere else in the app, keep using Material
 * Symbols — see the note in CLAUDE.md.
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
