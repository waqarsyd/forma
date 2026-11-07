import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import SiteHeader, { type NavItem } from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import { Eyebrow } from './landing/sections';

/**
 * The frame of the pages the site audit found missing (2026-11-08, batch SJ):
 * security, pricing, examples, comparison, about, self-hosting and the FAQ.
 * The legal pages' measure and type, with sections that can hold more than
 * paragraphs (a table, a list, links), so each page's words live in
 * `infoPages.tsx` and this stays one frame.
 */
export interface InfoSection {
  /** An anchor, so a section can be linked to. */
  id?: string;
  heading: string;
  body: ReactNode;
}

export interface InfoDoc {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  sections: InfoSection[];
  /** Which header link is lit, if the page is in the header. */
  nav?: NavItem;
  /** "Last reviewed" for a page whose claims age. */
  reviewed?: string;
}

export interface PageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

/** Shared prose classes for the pages' bodies. */
export const P = 'mt-3.5 font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant';
export const A = 'font-semibold text-secondary hover:underline';
export const UL = 'mt-3.5 grid gap-2 pl-5 list-disc font-body-lg text-[15.5px] leading-[1.6] text-on-surface-variant marker:text-[color:var(--ink-faint)]';
export const STRONG = 'font-semibold text-on-surface';

export default function InfoPage({ doc, ...page }: PageProps & { doc: InfoDoc }) {
  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader active={doc.nav ?? 'none'} {...page} />

      <main id="main" tabIndex={-1} className="outline-none flex-grow sheet-grid pt-[76px] pb-[104px]">
        <div className="max-w-container-max mx-auto px-margin-desktop">
          <Eyebrow>{doc.eyebrow}</Eyebrow>
          <h1 className="mt-[22px] font-display-lg text-display-lg md:text-[56px] font-extrabold leading-[1.04] tracking-[-0.038em] text-on-surface text-balance">
            {doc.title}
          </h1>
          <div className="mt-5 max-w-[62ch] font-body-lg text-[clamp(16.5px,1.3vw,18.5px)] leading-[1.58] text-on-surface-variant">{doc.lede}</div>
          {doc.reviewed && (
            <p className="mt-4 font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.12em] uppercase text-[color:var(--ink-faint)]">
              Last reviewed {doc.reviewed}
            </p>
          )}

          <div className="mt-11 max-w-[72ch]">
            {doc.sections.map((section, i) => (
              <section key={section.heading} id={section.id} className={`scroll-mt-24 ${i > 0 ? 'mt-11' : ''}`}>
                <h2 className="font-display-lg text-[22px] font-extrabold leading-[1.25] tracking-[-0.02em] text-on-surface">
                  {section.heading}
                </h2>
                {section.body}
              </section>
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
