// @vitest-environment jsdom
/**
 * Open in designer as a dialog that asks for what is missing (2026-11-09, the
 * owner's download programme, batch WF). The companion is a stubbed fetch on
 * 127.0.0.1:7317 answering as the real one was measured to: /health with or
 * without DevExpress, /open 202. The forma-repx:// launch is stubbed too, since
 * jsdom cannot hand a scheme to Windows.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/designerBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/designerBridge')>()),
  launchDesigner: vi.fn(),
}));

import OpenInDesigner from './OpenInDesigner';
import { launchDesigner } from '../lib/designerBridge';

/*
 * jsdom's user agent carries the platform the tests run on: "(win32)" here,
 * which onWindows reads as nothing said, and "(linux)" on CI's runners, which
 * it reads as not Windows. Every test until the one about another platform
 * states Windows, so the steps are the same wherever the suite runs. Found on
 * 2026-11-09, when all five passed here and failed on CI.
 */
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
function platform(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}
const original = window.navigator.userAgent;
beforeEach(() => platform(WINDOWS));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(launchDesigner).mockClear();
  platform(original);
});

function companion(health: unknown | null, open = 202) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (health === null) throw new TypeError('Failed to fetch');
    if (url.endsWith('/health')) return new Response(JSON.stringify(health), { status: 200 });
    if (url.endsWith('/open')) return new Response('{"opened":"Invoice.repx"}', { status: open });
    return new Response('', { status: 404 });
  }));
}

const props = (over: Partial<React.ComponentProps<typeof OpenInDesigner>> = {}) => ({
  repxContent: '<XtraReportsLayoutSerializer />',
  fileName: 'Invoice.repx',
  onExport: vi.fn(),
  onOpened: vi.fn(),
  onClose: vi.fn(),
  launchWaitMs: 30,
  ...over,
});

describe('Open in designer', () => {
  it('starts Forma Designer when nothing answers, then offers the download', async () => {
    companion(null);
    render(<OpenInDesigner {...props()} />);
    // The first case pays the dialog's cold path (probe, launch, wait, probe):
    // 807 ms alone under coverage and 1,212 ms in the full coverage run on
    // 2026-11-11, past findBy's 1 s default, so it gets room of its own.
    expect(await screen.findByRole('heading', { name: 'Get Forma Designer' }, { timeout: 5000 })).toBeTruthy();
    expect(launchDesigner).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Download Forma Designer' }).getAttribute('href')).toBe('/download');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('asks for DevExpress, by its own trial page, when Forma Designer has none', async () => {
    companion({ app: 'RepxDesigner', version: '1.0.0', designerVersion: null, devexpress: null, found: [], oldest: '20.1' });
    render(<OpenInDesigner {...props()} />);
    expect(await screen.findByRole('heading', { name: 'DevExpress is not installed' })).toBeTruthy();
    const trial = screen.getByRole('link', { name: 'Get the DevExpress trial' });
    expect(trial.getAttribute('href')).toBe('https://www.devexpress.com/products/try/');
    expect(trial.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/separate commercial product of Developer Express Inc/)).toBeTruthy();
    expect(launchDesigner).not.toHaveBeenCalled();
  });

  it('names a DevExpress too old to use', async () => {
    companion({ app: 'RepxDesigner', version: '1.0.0', designerVersion: null, devexpress: null, found: ['19.2'], oldest: '20.1' });
    render(<OpenInDesigner {...props()} />);
    expect(await screen.findByRole('heading', { name: 'DevExpress 19.2 is too old' })).toBeTruthy();
  });

  it('hands the report over and lets App say so', async () => {
    companion({ app: 'RepxDesigner', version: '1.0.0', designerVersion: '20.1.3.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1' });
    const onOpened = vi.fn();
    render(<OpenInDesigner {...props({ onOpened })} />);
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('Invoice.repx'));
    const sent = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/open'));
    expect((sent![1] as RequestInit).body).toBe('<XtraReportsLayoutSerializer />');
  });

  it('tells a browser on another platform that the designer runs on Windows, and asks nothing', async () => {
    platform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36');
    companion(null);
    render(<OpenInDesigner {...props()} />);
    expect(await screen.findByRole('heading', { name: 'The designer runs on Windows' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(launchDesigner).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'This is Windows: try anyway' })).toBeTruthy();
  });

  /*
   * SD-07 (2026-11-11): App passes a new onOpened on every render. With it in
   * the asking's dependencies, each render while the dialog was open started
   * the asking again, and a report already on its way was sent a second time.
   */
  it('asks once and sends once, however often App renders it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({ app: 'RepxDesigner', version: '1.0.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1' }), { status: 200 });
      // The report is on its way while App renders again.
      await gate;
      return new Response('{"opened":"Invoice.repx"}', { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = vi.fn();
    const { rerender } = render(<OpenInDesigner {...props({ onOpened: first })} />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/open'))).toBe(true));
    const latest = vi.fn();
    for (let i = 0; i < 3; i++) rerender(<OpenInDesigner {...props({ onOpened: i === 2 ? latest : vi.fn(), repxContent: `<XtraReportsLayoutSerializer n="${i}" />` })} />);
    release();
    await waitFor(() => expect(latest).toHaveBeenCalledWith('Invoice.repx'));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/open'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/health'))).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('says what may be wrong when nothing answers, never only "not installed"', async () => {
    companion(null);
    render(<OpenInDesigner {...props()} />);
    expect(await screen.findByText(/^Forma Designer did not answer\. It may not be installed, may be an older version, or your browser was not allowed to reach it\./, undefined, { timeout: 5000 })).toBeTruthy();
    // The download comes first among the ways forward.
    const actions = screen.getByRole('link', { name: 'Download Forma Designer' }).parentElement!;
    expect(actions.firstElementChild!.textContent).toBe('Download Forma Designer');
  });

  it('names a DevExpress that lacks the WinForms designer, rather than calling it not installed', async () => {
    companion({ app: 'RepxDesigner', version: '1.0.0', designerVersion: null, devexpress: null, found: ['23.2'], oldest: '20.1' });
    render(<OpenInDesigner {...props()} />);
    expect(await screen.findByRole('heading', { name: 'DevExpress 23.2 has no WinForms designer' })).toBeTruthy();
    expect(screen.getByText(/this PC has DevExpress 23\.2, but not its WinForms report designer/)).toBeTruthy();
  });

  it('shows a refusal in words, with no HTTP status', async () => {
    companion({ app: 'RepxDesigner', version: '1.0.0', designerVersion: '20.1.3.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1' }, 500);
    render(<OpenInDesigner {...props()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Forma Designer could not open this report.');
  });

  it('offers Export .repx at every step, which closes it', async () => {
    companion(null);
    const onExport = vi.fn();
    const onClose = vi.fn();
    render(<OpenInDesigner {...props({ onExport, onClose })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export .repx instead' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
