import Logo from './Logo';

/**
 * The footer shared by all four marketing pages, extracted for the same reason
 * as SiteHeader: four hand-maintained copies had drifted into two different
 * footers (a four-column block on the home page, a single 120px strip on the
 * other three).
 *
 * The "On this page" column is the one genuinely page-specific part, so it is a
 * prop. A page with nothing worth anchoring to omits it and the grid drops to
 * three columns rather than showing an empty heading.
 *
 * The sign-off is deliberately inside the container's measure, under a rule
 * that spans it — not a full-bleed bar.
 *
 * Every surface that has a footer now renders *this* component, LoginPage
 * included as of 2026-09-08 — it was the last hand-maintained copy, a compact
 * 107px bar that disagreed with this one on height, link count, headings and
 * type size. There is no second copy of the sign-off or the year left to keep
 * in step.
 */

type Link = [label: string, href: string];

const PRODUCT: Link[] = [
  ['Features', '/features'],
  ['Documentation', '/docs'],
  ['Contact', '/contact'],
  ['Open the workspace', '/workspace'],
];

const ELSEWHERE: Link[] = [
  ['Get a Gemini key', 'https://aistudio.google.com/apikey'],
  ['DevExpress Reporting', 'https://www.devexpress.com/products/net/reporting/'],
  // Real pages since 2026-08-15. These pointed at '/' — a link that silently
  // goes home rather than admitting it has nowhere to go, which is the failure
  // mode `data-needs-url` exists to prevent and this pair slipped past.
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
];

const HEADING =
  'mb-3.5 font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]';
const LINK =
  'u-transition block py-[5px] font-body-lg text-[14px] leading-[1.62] text-on-surface-variant hover:translate-x-[3px] hover:text-secondary';
const NOTE = 'font-body-lg text-[13.5px] leading-[1.55] text-[color:var(--ink-faint)]';

/**
 * Read once when the module loads rather than hardcoded, so the sign-off rolls
 * over on its own and nobody has to remember it every January. It follows the
 * visitor's clock, which is the right source here — a copyright line is for
 * whoever is reading it.
 *
 * This is now the only copy in the app; LoginPage had a second one until it
 * started rendering this component.
 */
const YEAR = new Date().getFullYear();

/**
 * `h2`, not `h4`. The footer is a landmark of its own, so its column headings
 * sit alongside the page's own sections rather than under them — and at `h4`
 * they skipped a level on every single page, because page content stops at
 * `h2`: "Let's build something precise." (h2) straight to "Product" (h4), and
 * on the 404 it was worse, h1 to h4 with two levels missed. Assistive
 * technology reads that as a missing subsection rather than a new region.
 *
 * `h2` is the level that holds on every page including the 404, where the only
 * preceding heading is the h1. Purely semantic — `HEADING` carries the styling,
 * so nothing moves on screen.
 */
function Column({ heading, links }: { heading: string; links: Link[] }) {
  return (
    <div>
      <h2 className={HEADING}>{heading}</h2>
      {links.map(([label, href]) => (
        <a
          key={label}
          href={href}
          {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
          // A bare "#" is a placeholder waiting for a real destination. Tagging
          // it here keeps `grep data-needs-url src/` honest — the maker column's
          // links were placeholders that the grep could not see, which is worse
          // than not having the convention at all.
          {...(href === '#' ? { 'data-needs-url': true } : {})}
          className={LINK}
        >
          {label}
        </a>
      ))}
    </div>
  );
}

/**
 * `maker` is the second optional column, added for the contact page, which
 * carries the maintainer's profile links. It sits after Product, and takes the
 * 1.6fr brand ratio rather than 1.7fr — both values come from the approved
 * designs for those two pages. A page that passes neither optional column
 * still gets exactly the three-column footer it had before.
 */
export default function SiteFooter({
  onThisPage,
  maker,
  className = '',
}: {
  onThisPage?: Link[];
  maker?: Link[];
  /**
   * Appended, never substituted — the five marketing pages pass nothing and
   * must keep the exact footer they have. It exists for the login overlay,
   * which needs `shrink-0` because it is the one caller whose parent is a
   * scrolling flex column rather than a page.
   */
  className?: string;
}) {
  const columns = maker
    ? 'lg:grid-cols-[1.6fr_1fr_1fr_1fr]'
    : onThisPage
      ? 'lg:grid-cols-[1.7fr_1fr_1fr_1fr]'
      : 'lg:grid-cols-[1.7fr_1fr_1fr]';

  return (
    <footer
      className={`w-full bg-surface-container-lowest dark:bg-card border-t border-outline-variant pt-12 mt-auto ${className}`}
    >
      <div className="max-w-container-max mx-auto px-margin-desktop">
        <div className={`grid grid-cols-2 gap-10 pb-[42px] ${columns}`}>
          <div>
            <a href="/" className="mb-3.5 flex items-center gap-[11px] select-none">
              <Logo size={30} />
              <span className="font-display-lg text-[20px] leading-[1.05] font-extrabold tracking-[-0.03em] text-on-surface">
                Forma
              </span>
            </a>
            <p className={`max-w-[36ch] ${NOTE}`}>
              An AI report designer for DevExpress. Open source, bring your own key.
            </p>
            {/* No max-width here, deliberately. The sign-off runs the full
                width of the brand column so "built by Waqar Sayyed" stays on
                one line. A 36ch cap was tried to match the docs and contact
                designs and reverted: the landing page is the approved
                reference for this chrome, so the designs follow it, not the
                other way round. */}
            <p className={`mt-2.5 ${NOTE}`}>
              © {YEAR} Forma. Designed &amp; built by{' '}
              <strong className="font-bold text-secondary">Waqar Sayyed</strong>.
            </p>
          </div>

          <Column heading="Product" links={PRODUCT} />
          {maker && <Column heading="The maker" links={maker} />}
          {onThisPage && <Column heading="On this page" links={onThisPage} />}
          <Column heading="Elsewhere" links={ELSEWHERE} />
        </div>

        <div className="flex justify-center border-t border-outline-variant py-5 text-center select-none">
          <span className="font-code-sm text-[10.5px] leading-[1.62] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-faint)]">
            Crafting the future of report generation.
          </span>
        </div>
      </div>
    </footer>
  );
}
