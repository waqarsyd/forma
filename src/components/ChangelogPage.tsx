import { useState } from 'react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import { Eyebrow } from './landing/sections';
import { copyText } from '../lib/clipboard';
import {
  AREA_LABELS,
  AREAS,
  changesByKind,
  filterFromSearch,
  filterReleases,
  KIND_LABELS,
  KINDS,
  readableDate,
  RELEASES,
  releasesByMonth,
  REPO_URL,
  searchForFilter,
  type ChangeArea,
  type ChangeKind,
  type ReleaseFilter,
} from '../lib/releases';

/**
 * What's new in Forma (2026-11-07): every release, newest first, the public
 * page the owner asked for "as other sites have". Shaped by the research for
 * it (Linear, Vercel, GitHub, Notion, Figma, Raycast, Telerik, DevExpress):
 *
 * - **Entries grouped by month**, each an `<article>` with its own anchor,
 *   `/changelog#<id>`, a `<time>`, a version where a GitHub release carries
 *   one, a summary, and its changes grouped as New, Improved, Changed, Fixed,
 *   Removed and Security (Keep a Changelog's kinds, as Raycast and Telerik
 *   label theirs), the label written as text, never a colour alone.
 * - **Filters by kind and area, kept in the address** (`?kind=fixed&area=preview`,
 *   as GitHub's `?label=`), so a filtered view can be linked, and an empty
 *   result says so with a way back, as Telerik's hub does.
 * - **Following it is free**: the Atom feed written at build, GitHub's "Watch,
 *   Releases" email and the repository's Discussions. No email form, which
 *   would need a paid service.
 *
 * The data is lib/releases.ts, the one list the in-app What's new, the
 * landing page's dock and the feed also read.
 */
export default function ChangelogPage({
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
}) {
  const [filter, setFilter] = useState<ReleaseFilter>(() => filterFromSearch(typeof window === 'undefined' ? '' : window.location.search));
  const [copied, setCopied] = useState<string | null>(null);

  const change = (next: ReleaseFilter) => {
    setFilter(next);
    // In the address, so the view can be linked; replaced, not pushed, so the
    // back button leaves the page rather than stepping through filters.
    window.history.replaceState({}, '', `/changelog${searchForFilter(next)}`);
  };

  const shown = filterReleases(RELEASES, filter);
  const months = releasesByMonth(shown);
  const kindsInUse = KINDS.filter((k) => RELEASES.some((r) => r.changes.some((c) => c.kind === k)));
  const filtered = !!(filter.kind || filter.area);

  const copyLink = async (id: string) => {
    if (await copyText(`${window.location.origin}/changelog#${id}`)) {
      setCopied(id);
      window.setTimeout(() => setCopied((now) => (now === id ? null : now)), 2000);
    }
  };

  const chip = (pressed: boolean) =>
    `u-transition u-press u-focus-ring cursor-pointer rounded-full border px-3.5 py-1.5 font-body-lg text-[13px] leading-[1.4] ${
      pressed
        ? 'border-on-surface bg-on-surface text-surface'
        : 'border-outline-variant bg-surface-container-lowest dark:bg-card text-on-surface-variant hover:text-on-surface'
    }`;

  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="none"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />

      <main className="flex-grow sheet-grid pt-[76px] pb-[104px]">
        <div className="max-w-container-max mx-auto px-margin-desktop">
          <Eyebrow>Changelog</Eyebrow>
          <h1 className="mt-[22px] font-display-lg text-display-lg md:text-[56px] font-extrabold leading-[1.04] tracking-[-0.038em] text-on-surface">
            What’s new in Forma
          </h1>
          <p className="mt-5 max-w-[60ch] font-body-lg text-[17px] leading-[1.6] text-on-surface-variant">
            Every release, newest first: what changed, and where. Forma is free and open source, and so is following it.
          </p>

          {/* Following it, at no cost: a feed reader, GitHub's own release
              email, or the Discussions. target=_blank keeps the feed out of
              the app's own link handling, which would route it as a page. */}
          <ul className="mt-6 flex flex-wrap gap-2.5" aria-label="Follow Forma's releases">
            <li>
              <a className={chip(false)} href="/changelog.xml" target="_blank" rel="noopener" type="application/atom+xml">
                Atom feed
              </a>
            </li>
            <li>
              <a className={chip(false)} href={REPO_URL} target="_blank" rel="noopener" title="On GitHub: Watch, Custom, Releases emails you each release">
                Watch releases on GitHub
              </a>
            </li>
            <li>
              <a className={chip(false)} href={`${REPO_URL}/discussions`} target="_blank" rel="noopener">
                Discussions
              </a>
            </li>
          </ul>

          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-outline-variant py-4">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show changes of a kind">
              <button type="button" className={chip(!filter.kind)} aria-pressed={!filter.kind} onClick={() => change({ ...filter, kind: null })}>
                All
              </button>
              {kindsInUse.map((k) => (
                <button key={k} type="button" className={chip(filter.kind === k)} aria-pressed={filter.kind === k} onClick={() => change({ ...filter, kind: filter.kind === k ? null : (k as ChangeKind) })}>
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 font-body-lg text-[13px] text-on-surface-variant">
              Area
              <select
                className="u-focus-ring rounded-full border border-outline-variant bg-surface-container-lowest dark:bg-card px-3 py-1.5 font-body-lg text-[13px] text-on-surface"
                value={filter.area ?? ''}
                onChange={(e) => change({ ...filter, area: (e.target.value || null) as ChangeArea | null })}
              >
                <option value="">All areas</option>
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {AREA_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
            <p className="sr-only" role="status">
              {filtered ? `${shown.length} ${shown.length === 1 ? 'release' : 'releases'} shown` : ''}
            </p>
          </div>

          {months.length === 0 ? (
            <div className="mt-10 max-w-[60ch]">
              <p className="font-body-lg text-[15.5px] leading-[1.6] text-on-surface-variant">No changes match these filters.</p>
              <button type="button" className={`mt-4 ${chip(false)}`} onClick={() => change({ kind: null, area: null })}>
                Clear filters
              </button>
            </div>
          ) : (
            months.map((month) => (
              <section key={month.id} aria-labelledby={`m-${month.id}`} className="mt-12">
                <h2 id={`m-${month.id}`} className="font-display-lg text-[24px] font-extrabold leading-[1.25] tracking-[-0.02em] text-on-surface">
                  {month.label}
                </h2>
                {month.releases.map((r) => (
                  <article
                    key={r.id}
                    id={r.id}
                    className="mt-6 grid scroll-mt-24 gap-x-10 gap-y-3 border-t border-outline-variant pt-6 md:grid-cols-[170px_minmax(0,1fr)]"
                  >
                    <div className="flex flex-wrap items-baseline gap-2.5 md:flex-col md:gap-1.5">
                      <time dateTime={r.date} className="font-body-lg text-[14px] font-semibold text-on-surface">
                        {readableDate(r.date)}
                      </time>
                      {r.version && (
                        <a
                          className="u-focus-ring rounded-full border border-outline-variant px-2.5 py-0.5 font-code-sm text-[11.5px] text-on-surface-variant hover:text-on-surface"
                          href={`${REPO_URL}/releases/tag/v${r.version}`}
                          target="_blank"
                          rel="noopener"
                        >
                          v{r.version}
                        </a>
                      )}
                    </div>
                    <div className="max-w-[72ch]">
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="font-display-lg text-[20px] font-extrabold leading-[1.3] tracking-[-0.015em] text-on-surface">{r.title}</h3>
                        <button
                          type="button"
                          className="u-transition u-focus-ring shrink-0 cursor-pointer rounded-full px-2.5 py-1 font-body-lg text-[12.5px] text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                          aria-label={`Copy link to ${r.title}`}
                          onClick={() => void copyLink(r.id)}
                        >
                          {copied === r.id ? 'Copied' : 'Copy link'}
                        </button>
                      </div>
                      <p className="mt-2 font-body-lg text-[15.5px] leading-[1.65] text-on-surface-variant">{r.summary}</p>
                      {changesByKind(r).map((group) => (
                        <div key={group.kind} className="mt-4">
                          <h4 className="inline-block rounded-full border border-outline-variant px-2.5 py-0.5 font-body-lg text-[12px] font-semibold text-on-surface">
                            {KIND_LABELS[group.kind]}
                          </h4>
                          <ul className="mt-2 list-disc space-y-1.5 pl-5 font-body-lg text-[15px] leading-[1.6] text-on-surface-variant marker:text-outline-variant">
                            {group.changes.map((c, i) => (
                              <li key={i}>
                                {c.text} <span className="whitespace-nowrap text-[12.5px] text-on-surface-variant">· {AREA_LABELS[c.area]}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            ))
          )}

          <p className="mt-14 max-w-[60ch] font-body-lg text-[13.5px] leading-[1.6] text-on-surface-variant">
            Earlier work, from the first commit to 1.0.0, is in the repository’s history on{' '}
            <a className="underline hover:text-on-surface" href={REPO_URL} target="_blank" rel="noopener">
              GitHub
            </a>
            .
          </p>
        </div>
      </main>

      <SiteFooter onThisPage={releasesByMonth(RELEASES).map((m) => [m.label, `#m-${m.id}`] as [string, string])} />
    </div>
  );
}
