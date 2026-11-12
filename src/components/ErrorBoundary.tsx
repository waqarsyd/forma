import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isStaleChunkError, reloadForStaleChunk } from '../lib/staleChunks';
import { problemReportUrl } from '../lib/problemReport';
import { versionLabel } from '../lib/buildInfo';
import { reportError } from '../lib/errorSink';

/**
 * An error boundary for one part of the app (2026-11-08, site audit item 64).
 * There was one, around everything, which replaced the whole page with the
 * raw error message: a fault in the Preview took the conversation, the
 * report and the sidebar down with it. Now each area has its own, so the
 * rest keeps working, and the fallback says what failed in plain words, with
 * Try again (draw the area afresh), Reload, and Report this problem, a GitHub
 * issue prefilled with the error, the area and the build (lib/problemReport.ts).
 *
 * `page` fills the screen, for the boundary around everything; `pane` fits
 * the area it stands in for.
 */
interface Props {
  /** What the area is called, to the person: "the Preview", "the conversation". */
  area: string;
  layout?: 'page' | 'pane';
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A lazy chunk a deploy removed: reload once for the new build rather
    // than show this (site audit item 1, lib/staleChunks.ts).
    if (isStaleChunkError(error) && reloadForStaleChunk()) return;
    console.error(`Something failed in ${this.props.area}:`, error, info.componentStack);
    // To the owner, scrubbed, only when the person turned on "Send error reports" (2026-11-12, lib/errorSink.ts).
    reportError(this.props.area, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const page = this.props.layout === 'page';
    const report = problemReportUrl({
      area: this.props.area,
      message: error.message || String(error),
      stack: error.stack,
      version: versionLabel(),
      path: typeof location === 'undefined' ? undefined : location.pathname,
      browser: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    });
    return (
      <div role="alert" className={page ? 'wb-fault wb-fault--page' : 'wb-fault'}>
        <h2>Something went wrong in {this.props.area}.</h2>
        <p>
          {page
            ? 'Forma stopped drawing this page. Your saved projects are safe.'
            : 'This part stopped working; the rest of Forma still does, and nothing you saved was lost.'}
        </p>
        <div className="wb-fault-actions">
          {!page && (
            <button type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href={report} target="_blank" rel="noopener noreferrer">
            Report this problem
          </a>
        </div>
      </div>
    );
  }
}
