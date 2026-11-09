/**
 * Open in designer, as a dialog that says what is missing (2026-11-09, the
 * owner's download programme, batch WF). Until then a failed open was one line
 * of error text, and from the website it told people about npm.
 *
 * The steps are `designerStep` in lib/designerBridge.ts; this draws them and
 * runs the asking, in order: the browser's answer about this site reaching
 * apps on the PC (read without asking), the companion's /health (from the
 * website, the request the browser asks about, sent because the person
 * clicked), a forma-repx:// launch and a wait when nothing answered, and then
 * the report. Every step offers Export .repx, which needs nothing installed.
 *
 * DevExpress is a commercial product of Developer Express Inc. and nothing of
 * it comes with Forma: the only link for it is devexpress.com's trial.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  askDesigner,
  DesignerRefused,
  designerStep,
  launchDesigner,
  loopbackPermission,
  onWindows,
  sendToDesigner,
  waitForDesigner,
  type DesignerFacts,
} from '../lib/designerBridge';
import { DESIGNER_RELEASE } from '../lib/designerRelease';
import { IconClose } from './landing/icons';
import './overlays.css';
import { useFocusTrap } from './useFocusTrap';

/** DevExpress's own trial page: 30 days, no registration, the current version. */
export const DEVEXPRESS_TRIAL_URL = 'https://www.devexpress.com/products/try/';

interface Props {
  repxContent: string;
  fileName: string;
  /** Export .repx, the way that always works. */
  onExport: () => void;
  /** Handed over with nothing more to say: App closes this and says so. */
  onOpened: (fileName: string) => void;
  onClose: () => void;
  /** How long to wait for a started companion; shorter in tests. */
  launchWaitMs?: number;
}

export default function OpenInDesigner({ repxContent, fileName, onExport, onOpened, onClose, launchWaitMs = 12_000 }: Props) {
  const dialog = useRef<HTMLElement>(null);
  useFocusTrap(dialog, onClose);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const [facts, setFacts] = useState<DesignerFacts>({ origin, windows: onWindows(), permission: 'unknown', health: undefined, started: false });
  const [tryAnyway, setTryAnyway] = useState(false);
  const run = useRef(0);

  const ask = useCallback(async () => {
    const id = ++run.current;
    const live = () => run.current === id;
    const base: DesignerFacts = { origin, windows: tryAnyway ? true : onWindows(), permission: await loopbackPermission(), health: undefined, started: false };
    if (!live()) return;
    setFacts(base);
    const first = designerStep(base);
    if (first.kind !== 'checking') return;

    let health = await askDesigner();
    if (!live()) return;
    let started = false;
    if (!health) {
      // Blocked on the question just asked: say so rather than starting anything.
      const permission = await loopbackPermission();
      if (!live()) return;
      if (permission === 'denied') { setFacts({ ...base, permission, health: null }); return; }
      setFacts({ ...base, health: null, started: false });
      launchDesigner();
      const up = await waitForDesigner(launchWaitMs, 500);
      if (!live()) return;
      started = true;
      health = up ? await askDesigner() : null;
      if (!live()) return;
      if (!health) { setFacts({ ...base, permission: await loopbackPermission(), health: null, started: true }); return; }
    }
    setFacts({ ...base, health, started });
    if (!health.devexpress) return;

    let sent: DesignerFacts['sent'];
    try {
      await sendToDesigner(repxContent, fileName);
      sent = { ok: true };
    } catch (error) {
      sent = { ok: false, status: error instanceof DesignerRefused ? error.status : undefined, message: error instanceof Error ? error.message : String(error) };
    }
    if (!live()) return;
    const done = { ...base, health, started, sent };
    setFacts(done);
    const step = designerStep(done);
    if (step.kind === 'opened' && !step.newer) onOpened(fileName);
  }, [origin, tryAnyway, repxContent, fileName, onOpened, launchWaitMs]);

  useEffect(() => {
    void ask();
    return () => {
      run.current += 1;
    };
  }, [ask]);

  const step = designerStep(facts);
  const exportInstead = (
    <button type="button" className="wb-pill wb-pill--outline" onClick={() => { onExport(); onClose(); }}>
      Export .repx instead
    </button>
  );
  const again = (
    <button type="button" className="wb-pill wb-pill--outline" onClick={() => void ask()}>
      Try again
    </button>
  );
  const trial = (
    <a className="wb-pill wb-pill--accent" href={DEVEXPRESS_TRIAL_URL} target="_blank" rel="noopener noreferrer">
      Get the DevExpress trial
    </a>
  );

  let title = 'Open in the DevExpress designer';
  let body: ReactNode;
  switch (step.kind) {
    case 'checking':
    case 'sending':
      body = (
        <>
          <p role="status">{step.kind === 'checking' ? 'Looking for Forma Designer on this PC…' : 'Handing the report to the designer…'}</p>
          {step.kind === 'checking' && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(origin) && (
            <p className="wb-share-note">Your browser may ask whether this site may reach apps on your device. Allow it to open reports in the designer.</p>
          )}
          <div className="wb-designer-actions">{exportInstead}</div>
        </>
      );
      break;
    case 'starting':
      body = (
        <>
          <p role="status">Starting Forma Designer… If your browser asks to open RepxDesigner, choose Open.</p>
          <div className="wb-designer-actions">{exportInstead}</div>
        </>
      );
      break;
    case 'no-companion':
      title = 'Get Forma Designer';
      body = (
        <>
          <p>
            Forma Designer is not running on this PC, or is not installed. It is a free Windows app that hands your report
            to the DevExpress report designer, and it installs for you alone, with no administrator.
          </p>
          <p className="wb-share-note">Installed already? Start Forma Designer from the Start menu, then try again.</p>
          <div className="wb-designer-actions">
            <a className="wb-pill wb-pill--accent" href="/download" target="_blank" rel="noopener">
              Download Forma Designer
            </a>
            {again}
            {exportInstead}
          </div>
        </>
      );
      break;
    case 'no-devexpress': {
      const old = step.found.filter((v) => v.localeCompare(step.oldest, 'en', { numeric: true }) < 0);
      title = old.length ? `DevExpress ${old.join(', ')} is too old` : 'DevExpress is not installed';
      body = (
        <>
          <p>
            {old.length
              ? `Forma Designer is running, and this PC has DevExpress ${old.join(', ')}. It needs DevExpress Reporting ${step.oldest} or later.`
              : 'Forma Designer is running, but DevExpress Reporting is not installed on this PC, and the designer is part of it.'}
          </p>
          <p className="wb-share-note">
            DevExpress is a separate commercial product of Developer Express Inc. Its free 30-day trial needs no registration.
            Install it, then try again.
          </p>
          <div className="wb-designer-actions">
            {trial}
            {again}
            {exportInstead}
          </div>
        </>
      );
      break;
    }
    case 'blocked':
      title = 'Your browser blocked it';
      body = (
        <>
          <p>This browser was told not to let this site reach apps on your device, so it cannot hand the report to Forma Designer.</p>
          <p className="wb-share-note">
            To allow it: click the icon at the left of the address bar, open Site settings, and set Apps on device (or Local
            network access) to Allow. Then try again.
          </p>
          <div className="wb-designer-actions">
            {again}
            {exportInstead}
          </div>
        </>
      );
      break;
    case 'not-windows':
      title = 'The designer runs on Windows';
      body = (
        <>
          <p>The DevExpress report designer runs on Windows. Export the .repx and open it in the designer on a Windows PC.</p>
          <div className="wb-designer-actions">
            <button type="button" className="wb-pill wb-pill--accent" onClick={() => { onExport(); onClose(); }}>
              Export .repx
            </button>
            <button type="button" className="wb-pill wb-pill--outline" onClick={() => setTryAnyway(true)}>
              This is Windows: try anyway
            </button>
          </div>
        </>
      );
      break;
    case 'unreachable':
      body = (
        <>
          <p>Open in designer works on openforma.web.app and in a Forma running on your PC, not from this address.</p>
          <div className="wb-designer-actions">{exportInstead}</div>
        </>
      );
      break;
    case 'opened':
      title = 'Opened in the designer';
      body = (
        <>
          <p role="status">The designer window is on your desktop.</p>
          {step.newer && (
            <p className="wb-share-note">
              Forma Designer {step.newer} is available{step.version ? `; this PC has ${step.version}` : ''}.{' '}
              <a href="/download" target="_blank" rel="noopener">Download it</a>, and it updates the one you have.
            </p>
          )}
          <div className="wb-designer-actions">
            <button type="button" className="wb-pill wb-pill--accent" onClick={onClose}>Close</button>
          </div>
        </>
      );
      break;
    case 'error':
      title = 'Could not open it';
      body = (
        <>
          <p className="wb-share-problem" role="alert">{step.message}</p>
          <div className="wb-designer-actions">
            {again}
            {exportInstead}
          </div>
        </>
      );
      break;
  }

  return (
    <div className="wb-cmd-backdrop wb-cmd-backdrop--centre" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="wb-share wb-designer" role="dialog" aria-modal="true" aria-labelledby="wb-designer-title" ref={dialog} tabIndex={-1}>
        <div className="wb-share-head">
          <h2 id="wb-designer-title">{title}</h2>
          <button type="button" className="wb-share-close" aria-label="Close" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>
        <div className="wb-share-body">{body}</div>
        <p className="wb-share-note wb-designer-foot">
          Forma Designer {DESIGNER_RELEASE.version} for Windows · <a href="/download" target="_blank" rel="noopener">About the download</a>
        </p>
      </section>
    </div>
  );
}
