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
import { readSharedReport, type SharedReport } from '../lib/shares';
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

  return (
    // `sheet` supplies the palette and `wb-root` the type and ground, as on the workspace's shell.
    <div className="sheet wb-root wb-shared">
      <header className="wb-shared-bar">
        <button type="button" className="wb-shared-home" onClick={onHome} aria-label="Forma home">
          <Logo />
        </button>
        {state.kind === 'shown' && (
          <>
            <h1>{state.name}</h1>
            {state.report.repxContent && (
              <button type="button" className="wb-pill wb-pill--accent" onClick={() => download(state.name, state.report.repxContent!)}>
                <IconDownload size={14} />
                Download .repx
              </button>
            )}
          </>
        )}
      </header>
      <main id="main" className="wb-shared-body">
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
          <a href="/contact#form">Report this link</a>
        </nav>
      </footer>
    </div>
  );
}
