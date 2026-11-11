/**
 * A shared report opened from its link, `/s/{id}` (2026-11-06): its name,
 * the report as it prints (the Preview, read-only) and its .repx to download.
 * Anyone may open a link share, signed in or not; a restricted one opens for
 * its owner and the verified addresses added to it, and firestore.rules is
 * what decides. A share that does not exist and one this person may not open
 * look the same from here, because the rules refuse both, so the page says
 * what to try rather than which it was. See lib/shares.ts.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { loadFirebase } from '../lib/firebaseClient';
import { APP_CHECK_SITE_KEY } from '../lib/appCheck';
import { hasReportScripts, readSharedReport, type SharedReport } from '../lib/shares';
import type { ReportLayout } from '../lib/reportTypes';
import { IconDownload } from './landing/icons';
import Logo from './Logo';
import './overlays.css';

const ReportPreview = lazy(() => import('./ReportPreview'));

interface Props {
  id: string;
  /** Who is signed in, if anyone: a restricted share opens only for them. */
  user: { uid: string; email: string | null } | null;
  onSignIn: () => void;
  onHome: () => void;
}

type State = { kind: 'loading' } | { kind: 'shown'; name: string; report: SharedReport } | { kind: 'closed' } | { kind: 'failed' };

export default function SharedReportPage({ id, user, onSignIn, onHome }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Try again re-reads the share (2026-11-08, site audit item 84): a failed
  // read used to say "reload the page" and offer nothing to press.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let gone = false;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const { sdk, paths, db } = await loadFirebase();
        const snap = await sdk.getDoc(paths.shareDocRef(db, id));
        if (gone) return;
        const data = snap.data() as { name?: string; result?: unknown } | undefined;
        const report = data ? readSharedReport(data.result) : null;
        if (!data || !report) setState({ kind: 'closed' });
        else {
          setState({ kind: 'shown', name: data.name || report.title || 'Shared report', report });
          document.title = `${data.name || report.title || 'Shared report'} — Forma`;
        }
      } catch (err) {
        if (gone) return;
        // The rules refuse a share that does not exist exactly as one this
        // person may not open, so both are "closed" here.
        setState((err as { code?: string })?.code === 'permission-denied' ? { kind: 'closed' } : { kind: 'failed' });
      }
    })();
    return () => {
      gone = true;
    };
  }, [id, user?.uid, attempt]);

  const download = (name: string, xml: string) => {
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'report'}.repx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Not at once (item 84): a browser that starts the download after the
    // click returns finds the address already gone and saves nothing.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // A shared report that carries code says so before it is downloaded
  // (2026-11-11, the full audit, SE-02): anyone with a verified account can
  // share one, and DevExpress runs that code when the report is previewed in
  // a designer, Forma Designer included. Forma never writes it; nothing is
  // stripped here, since the viewer may trust the sender and need the report
  // as it is. The notice sits above the download, so for such a report the
  // button moves from the bar to beneath the notice: in the bar it would be
  // read, and pressed, before the warning.
  const shown = state.kind === 'shown' ? state : null;
  const repx = shown?.report.repxContent ?? '';
  const scripted = !!repx && hasReportScripts(repx);
  const downloadButton =
    shown && repx ? (
      <button type="button" className="wb-pill wb-pill--accent" onClick={() => download(shown.name, repx)}>
        <IconDownload size={14} />
        Download .repx
      </button>
    ) : null;

  return (
    // `sheet` supplies the palette and `wb-root` the type and ground, as on the workspace's shell.
    <div className="sheet wb-root wb-shared">
      <header className="wb-shared-bar">
        {/* The skip link every public page opens with, as the accessibility
            statement says (2026-11-11, full audit PS-31): this page draws no
            SiteHeader, which is where the others get theirs. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-secondary-container focus:px-4 focus:py-2 focus:font-body-lg focus:text-[14px] focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <button type="button" className="wb-shared-home" onClick={onHome} aria-label="Forma home">
          <Logo />
        </button>
        {shown && (
          <>
            <h1>{shown.name}</h1>
            {!scripted && downloadButton}
          </>
        )}
      </header>
      <main id="main" tabIndex={-1} className="wb-shared-body outline-none">
        {/* A heading in every state (item 84): until the report arrived the
            page had none, so a screen reader landed on an untitled page. */}
        {(state.kind === 'loading' || state.kind === 'failed') && <h1 className="sr-only">Shared report</h1>}
        {state.kind === 'loading' && <p className="wb-shared-say" role="status">Opening the shared report…</p>}
        {state.kind === 'failed' && (
          <div className="wb-shared-say" role="alert">
            <p>Forma could not reach the report just now. Check the connection, then try again.</p>
            <button type="button" className="wb-pill wb-pill--accent" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}
        {scripted && (
          <div className="wb-shared-say">
            <p role="note">This report contains code that runs when it is previewed. Open it only if you trust whoever shared it.</p>
            {downloadButton}
          </div>
        )}
        {state.kind === 'shown' && !state.report.repxContent && (
          <p className="wb-shared-say">
            This share holds no report file to show. Ask whoever sent the link to share the report again from Forma.
          </p>
        )}
        {state.kind === 'closed' && (
          <div className="wb-shared-say">
            <h1>This link does not open a report for you</h1>
            {user ? (
              <p>
                You are signed in as {user.email ?? 'an account'}. Ask whoever sent the link to add that address, or to let anyone with the link open it.
                It may also have stopped being shared.
              </p>
            ) : (
              <p>If it was shared with you, sign in with the address it was shared with. It may also have stopped being shared.</p>
            )}
            {!user && <button type="button" className="wb-pill wb-pill--accent" onClick={onSignIn}>Sign in</button>}
          </div>
        )}
        {state.kind === 'shown' && state.report.repxContent && (
          <Suspense fallback={<p className="wb-shared-say">Drawing the report…</p>}>
            <ReportPreview repxContent={state.report.repxContent} layout={(state.report.layout ?? null) as ReportLayout | null} title={state.name} />
          </Suspense>
        )}
      </main>
      {/* Where a viewer turns (item 84): what Forma is, its policies, and
          how to report a link that shares something it should not. */}
      <footer className="wb-shared-foot">
        <span>Shared with Forma, a report designer for DevExpress.</span>
        <nav aria-label="About this page">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          {/* With its topic chosen on the form (2026-11-11, full audit PS-27). */}
          <a href="/contact?topic=shared#form">Report this link</a>
        </nav>
        {/* reCAPTCHA's notice in place of its hidden badge (2026-11-08): App
            Check runs when a shared report is read, as LoginPage says. */}
        {APP_CHECK_SITE_KEY && (
          <small className="wb-shared-recaptcha">
            Protected by reCAPTCHA: Google&apos;s <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Privacy Policy</a> and{' '}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Terms of Service</a> apply.
          </small>
        )}
      </footer>
    </div>
  );
}
