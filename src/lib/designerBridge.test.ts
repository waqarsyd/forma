import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  designerFileName,
  sendToDesigner,
  pingDesigner,
  launchDesigner,
  waitForDesigner,
  DESIGNER_CLIENT_HEADER,
  DESIGNER_PROTOCOL,
  designerReachableFrom,
  readDesignerHealth,
  designerStep,
  onWindows,
  DesignerRefused,
  type DesignerFacts,
  designerLocalOrigin,
  loopbackPermission,
  DESIGNER_SITE_ORIGINS,
  askDesigner,
  healthTimeout,
} from './designerBridge';
import { readFileSync } from 'node:fs';

/*
 * The website may hand a report to the designer since 2026-11-09 (the owner's
 * download programme, batch WE), and only after a click: the page never looks
 * for the companion on its own, and the SQL routes stay a local page's.
 */
describe('the website and the companion (2026-11-09)', () => {
  it('reaches it from Forma\'s own sites, not a preview channel or anything else', () => {
    expect(designerReachableFrom('https://openforma.web.app')).toBe(true);
    expect(designerReachableFrom('https://forma-201ba.web.app')).toBe(true);
    expect(designerReachableFrom('https://forma-201ba--preview-abc123.web.app')).toBe(false);
    expect(designerReachableFrom('http://openforma.web.app')).toBe(false);
    expect(designerReachableFrom('https://openforma.web.app.evil.example')).toBe(false);
  });

  it('counts only a page served from this PC as local, the SQL routes\' one', () => {
    expect(designerLocalOrigin('http://localhost:3000')).toBe(true);
    expect(designerLocalOrigin('https://openforma.web.app')).toBe(false);
  });

  it('names the same sites as the companion, which answers them on /health, /open and the read-only /inspect and /render, never /sql/', () => {
    const program = readFileSync('tools/RepxDesigner/Program.cs', 'utf8');
    const list = /SiteOrigins = \{([^}]*)\}/.exec(program)![1];
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...DESIGNER_SITE_ORIGINS]);
    expect(program).toContain('route == "/health" || route == "/open" || route == "/inspect" || route == "/render"');
    expect(program).toContain('HandleSql(stream, method, target, headers, body, IsLocalOrigin(origin) ? origin : null)');
  });

  it('reads the browser\'s answer without asking, the newer permission name first', async () => {
    const asked: string[] = [];
    vi.stubGlobal('navigator', {
      permissions: {
        query: async ({ name }: { name: string }) => {
          asked.push(name);
          if (name === 'loopback-network') throw new TypeError('unknown permission');
          return { state: 'denied' };
        },
      },
    });
    expect(await loopbackPermission()).toBe('denied');
    expect(asked).toEqual(['loopback-network', 'local-network-access']);
    vi.stubGlobal('navigator', {});
    expect(await loopbackPermission()).toBe('unknown');
    vi.unstubAllGlobals();
  });
});

describe('designerReachableFrom (site audit item 95)', () => {
  // Since 2026-11-09 Forma's website is reachable too (above); a page served from
  // this machine over http is still the only one the SQL routes answer.
  it('counts a page served from this machine over http as local, as the companion does', () => {
    expect(designerReachableFrom('http://localhost:3000')).toBe(true);
    expect(designerLocalOrigin('http://localhost:3000')).toBe(true);
    expect(designerLocalOrigin('http://127.0.0.1:3001')).toBe(true);
    expect(designerLocalOrigin('http://localhost')).toBe(true);
    expect(designerLocalOrigin('https://openforma.web.app')).toBe(false);
    expect(designerReachableFrom('https://localhost:3000')).toBe(false);
    expect(designerReachableFrom('http://localhost.evil.example')).toBe(false);
  });

  it('matches the companion\'s own allowlist', async () => {
    const { readFileSync } = await import('node:fs');
    const program = readFileSync('tools/RepxDesigner/Program.cs', 'utf8');
    expect(program).toContain('@"^http://(localhost|127\\.0\\.0\\.1)(:\\d+)?$"');
  });
});

/**
 * `designerFileName` was the only thing covered here, on the reasoning that the
 * fetch helpers beside it are thin wrappers whose real behaviour lives in
 * another process, so a mocked test of them would assert the mock.
 *
 * That reasoning is right about the companion and wrong about us. A stub cannot
 * tell you what RepxDesigner does with the XML — but *giving up* is this side's
 * behaviour, decided here, and until the 2026-08-27 audit (REL-002)
 * `sendToDesigner` had no timeout at all while `pingDesigner` nine lines above
 * it did. That asymmetry is exactly the kind a stub can catch, so the cases
 * below assert only what this module is responsible for: the request it sends,
 * and when it stops waiting.
 *
 * This function is worth pinning because its output becomes a *path* on the
 * other side. The companion re-sanitises — a browser is not a trust boundary —
 * but a name that escapes here would be the first half of a path traversal, and
 * that fails silently rather than loudly: the report opens under a name nobody
 * looks at, or lands somewhere nobody looks for it.
 */
describe('designerFileName', () => {
  it('turns a report title into a .repx filename', () => {
    expect(designerFileName('Sales Invoice')).toBe('Sales_Invoice.repx');
  });

  it('collapses runs of whitespace the way the download name does', () => {
    // Must match downloadDesign's `replace(/\s+/g, '_')`, or one report reaches
    // the disk under two different names depending on which button was used.
    expect(designerFileName('Monthly   Diamond\tReport')).toBe('Monthly_Diamond_Report.repx');
  });

  it('falls back when the title is missing or empty', () => {
    expect(designerFileName()).toBe('report-design.repx');
    expect(designerFileName('')).toBe('report-design.repx');
  });

  it('drops path separators rather than encoding them', () => {
    expect(designerFileName('..\\..\\Windows\\System32\\evil')).toBe('....WindowsSystem32evil.repx');
    expect(designerFileName('reports/2026/august')).toBe('reports2026august.repx');
  });

  it('strips characters Windows will not accept in a filename', () => {
    expect(designerFileName('Q3: "final" <draft>|v2?')).toBe('Q3_final_draftv2.repx');
  });

  it('never returns a bare extension when everything is stripped', () => {
    // A title of only punctuation would otherwise produce ".repx", a hidden file
    // with no name.
    expect(designerFileName('***')).toBe('report-design.repx');
    expect(designerFileName('/\\:*?"<>|')).toBe('report-design.repx');
  });
});

describe('sendToDesigner', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * A fetch that never answers, but honours the abort signal the way a real one
   * does. This is the case that matters: a refused connection rejects
   * immediately and was always handled, whereas a companion that accepts the
   * socket and then stops responding — modal dialog open, mid-crash, or paused
   * by a debugger — leaves the promise pending forever.
   */
  const hangingFetch = () =>
    vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      })
    );

  it('gives up instead of hanging when the companion never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = sendToDesigner('<XtraReportsLayoutSerializer/>', 'a.repx');
    // Assert the rejection before advancing, so an unhandled rejection cannot
    // escape between the two statements.
    const assertion = expect(pending).rejects.toThrow('Forma Designer did not answer. If a window of it is open, close it and try again.');

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it('waits longer than the health probe does', async () => {
    // pingDesigner allows 1200ms because a bound port answers instantly.
    // Opening a report is a file write plus a designer launch, so a budget
    // copied from the ping would abort work that was going to succeed.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = sendToDesigner('<XtraReportsLayoutSerializer/>', 'a.repx');
    const assertion = expect(pending).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(2_000);
    // Still waiting well past the ping's budget.
    let settled = false;
    void pending.catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('sends the header that forces a CORS preflight', async () => {
    // Not a safelisted header, on purpose: the preflight is what lets the
    // companion reject an unknown origin before the XML is sent. Renaming it
    // here without renaming it in Program.cs disables that check silently.
    // Parameters are declared so `mock.calls[0]` is a typed tuple rather than
    // an empty one needing a cast. `init` is not optional: sendToDesigner
    // always passes one, and saying so lets the assertions read it directly.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(null, { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendToDesigner('<XtraReportsLayoutSerializer/>', 'report.repx');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers[DESIGNER_CLIENT_HEADER]).toBe('1');
    expect(headers['x-forma-filename']).toBe('report.repx');
    expect(init.method).toBe('POST');
  });

  it('reports a refusal from the companion, its status kept and its words plain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 415 })));
    const error = await sendToDesigner('<x/>', 'a.repx').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DesignerRefused);
    expect((error as DesignerRefused).status).toBe(415);
    // SD-18 (2026-11-11): no HTTP status and no "companion" in what the dialog shows.
    expect((error as Error).message).toBe('Forma Designer could not open this report.');
  });

  it('says in words when it stopped answering, never the browser\'s "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = (await sendToDesigner('<x/>', 'a.repx').catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('Forma Designer stopped answering before it took the report. Start it from the Start menu, then try again.');
  });

  it('resolves when the companion accepts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(sendToDesigner('<x/>', 'a.repx')).resolves.toBeUndefined();
  });
});

/**
 * The two Windows filename traps neither sanitiser knew about (audit BUG-002,
 * BUG-003). Both sides were fixed -- this pins the browser half; the companion
 * re-sanitises independently, because a value from the browser is a value an
 * attacker could send.
 */
describe('designerFileName and Windows', () => {
  for (const reserved of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'con', 'Nul']) {
    it(`does not hand Windows the reserved device name ${reserved}`, () => {
      // %TEMP%\Forma\CON.repx addresses the console, not a file, whatever the
      // directory. Prefixed rather than replaced so the chosen name survives.
      const out = designerFileName(reserved);
      expect(out).toBe(`_${reserved}.repx`);
      expect(out).toContain(reserved);
    });
  }

  it('leaves a name that merely contains a device name alone', () => {
    // Only the whole stem is reserved. CONTRACT is a perfectly good filename.
    expect(designerFileName('CONTRACT')).toBe('CONTRACT.repx');
    expect(designerFileName('my-con')).toBe('my-con.repx');
  });

  it('caps a title the rules would happily store', () => {
    // firestore.rules permits 256 characters; %TEMP%\Forma\ is ~45 here, so an
    // untruncated name produced a path over MAX_PATH and threw.
    const out = designerFileName('A'.repeat(256));
    expect(out.length).toBeLessThanOrEqual(65);
    expect(out.endsWith('.repx')).toBe(true);
  });

  it('still produces something usable at the cap', () => {
    expect(designerFileName('B'.repeat(500))).toMatch(/^B+\.repx$/);
  });

  it('has not changed for ordinary titles', () => {
    expect(designerFileName('Sales Invoice')).toBe('Sales_Invoice.repx');
    expect(designerFileName()).toBe('report-design.repx');
  });
});
/**
 * The three helpers coverage named as the gap in lib/ (audit TEST-003).
 *
 * pingDesigner and waitForDesigner are what stand between "the companion is not
 * installed" and "the button is broken", and launchDesigner is the one route by
 * which a web page may cause a local program to run. None of them was reachable
 * by a test.
 */
describe('pingDesigner', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('says yes when the companion answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(pingDesigner()).resolves.toBe(true);
  });

  it('resolves false rather than throwing when nothing is listening', async () => {
    // Not installed is the *normal* case, not an error. A throw here would
    // surface as a broken page for the majority of users.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(pingDesigner()).resolves.toBe(false);
  });

  it('says no when the companion answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    await expect(pingDesigner()).resolves.toBe(false);
  });

  it('gives up on a firewall that drops rather than refuses', async () => {
    // The documented reason the timeout exists: a dropped connection would
    // otherwise leave this pending, and the button missing, for as long as the
    // tab is open.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      })));
    const pending = pingDesigner(1200);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(false);
  });
});

describe('launchDesigner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('navigates to the registered scheme', () => {
    const location = { href: '' };
    vi.stubGlobal('window', { location });
    launchDesigner();
    expect(location.href).toBe(`${DESIGNER_PROTOCOL}://serve`);
  });

  it('pins the scheme, which Program.cs registers by the same name', () => {
    // Renaming one side without the other breaks the launch silently: an
    // unregistered scheme does not error, it does nothing.
    expect(DESIGNER_PROTOCOL).toBe('forma-repx');
  });

  it('does not throw when the browser blocks the scheme', () => {
    // A declined prompt, an unregistered scheme and a successful launch are
    // indistinguishable from script. None of them may take the page down.
    vi.stubGlobal('window', {
      get location() { throw new Error('blocked'); },
    });
    expect(() => launchDesigner()).not.toThrow();
  });
});

describe('waitForDesigner', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('returns as soon as the companion answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(waitForDesigner(5000, 100)).resolves.toBe(true);
  });

  it('keeps polling while a cold start loads its assemblies', async () => {
    // The reason this exists: a single ping straight after launchDesigner
    // always fails, because the port is not bound yet.
    vi.useFakeTimers();
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++;
      if (attempts < 4) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 200 });
    }));

    const pending = waitForDesigner(10_000, 100);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(4);
  });

  it('gives up so the caller can say the companion did not start', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const pending = waitForDesigner(1000, 100);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(false);
  });
});

/*
 * Two describes stood here until 2026-09-06, covering `probeDesigner` and
 * `designerVersionWarning`. Both were removed with the feature, one day after
 * it was added, because the hazard they warned about does not exist: a
 * generated 24.1 report loads through the installed 20.1 assemblies with
 * nothing lost, measured with `RepxProbe inspect`.
 *
 * Worth knowing before writing their replacement. One of those tests asserted
 * the warning text matched /mangled|does not open/, and it passed for exactly
 * as long as the belief went unchecked -- a test can pin an assumption as
 * firmly as it pins a fact, and reads the same either way. If a version check
 * is ever justified again, it will be about a specific control the older
 * assembly lacks, and the test should name that control.
 */

/*
 * The Open in designer dialog's steps (2026-11-09, batch WF): one pure function
 * of what was found, drawn by components/OpenInDesigner.tsx.
 */
describe('what the companion says on /health', () => {
  it('reads today\'s answer, and an older companion\'s, which ran on 20.1', () => {
    expect(readDesignerHealth({ app: 'RepxDesigner', version: '1.0.0', designerVersion: '20.1.3.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1', compiled: '20.1' })).toEqual({
      version: '1.0.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1',
    });
    expect(readDesignerHealth({ app: 'RepxDesigner', version: '1.0.0', designerVersion: null, devexpress: null, found: ['19.2'], oldest: '20.1' })).toEqual({
      version: '1.0.0', devexpress: null, found: ['19.2'], oldest: '20.1',
    });
    expect(readDesignerHealth({ app: 'RepxDesigner', designerVersion: '20.1.3.0' })).toEqual({
      version: null, devexpress: { version: '20.1', build: null }, found: ['20.1'], oldest: '20.1',
    });
    expect(readDesignerHealth({ app: 'Something else' })).toBeNull();
    expect(readDesignerHealth('nope')).toBeNull();
    // Only a companion with /inspect says so, and only true counts.
    expect(readDesignerHealth({ app: 'RepxDesigner', designerVersion: '20.1.3.0', inspects: true })?.inspects).toBe(true);
    expect(readDesignerHealth({ app: 'RepxDesigner', designerVersion: '20.1.3.0', inspects: 'yes' })).not.toHaveProperty('inspects');
    expect(readFileSync('tools/RepxDesigner/Program.cs', 'utf8')).toContain('b.Append(",\\"inspects\\":true");');
  });
});

describe('whether this browser is on Windows', () => {
  it('reads the platform it states, else its user agent, else says nothing', () => {
    expect(onWindows({ userAgentData: { platform: 'Windows' } })).toBe(true);
    expect(onWindows({ userAgentData: { platform: 'macOS' } })).toBe(false);
    expect(onWindows({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(true);
    expect(onWindows({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })).toBe(false);
    expect(onWindows({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
    expect(onWindows({ userAgent: 'SomeBrowser/1.0' })).toBeNull();
  });
});

/*
 * SD-08 (2026-11-11): Chrome holds the request to 127.0.0.1 while it asks the
 * person about it, so the first /health from the website waits long enough
 * for an answer instead of 1.5 s, after which the dialog used to start Forma
 * Designer (a second question) and call it not installed.
 */
describe('how long /health is waited for', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('waits for the person while the browser asks, and briefly otherwise', () => {
    expect(healthTimeout('prompt')).toBe(30_000);
    expect(healthTimeout('granted')).toBe(1500);
    expect(healthTimeout('unknown')).toBe(1500);
    expect(healthTimeout('denied')).toBe(1500);
  });

  it('gets the answer that arrives after the person allowed it', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        // The person answers the browser's question after ten seconds.
        const timer = setTimeout(() => resolve(new Response(JSON.stringify({ app: 'RepxDesigner', designerVersion: '20.1.3.0' }), { status: 200 })), 10_000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      })));
    const waited = askDesigner(healthTimeout('prompt'));
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await waited)?.devexpress?.version).toBe('20.1');
    const cut = askDesigner(healthTimeout('granted'));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await cut).toBeNull();
  });
});

describe('a refusal with no DevExpress to open it in', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('carries the 424 the companion answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"devexpress":null}', { status: 424 })));
    const error = await sendToDesigner('<x/>', 'r.repx').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DesignerRefused);
    expect((error as DesignerRefused).status).toBe(424);
  });
});

describe('the Open in designer steps', () => {
  const healthy = { version: '1.0.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1' };
  const base: DesignerFacts = { origin: 'https://openforma.web.app', windows: true, permission: 'prompt', health: undefined, started: false, latest: '1.0.0' };
  it('says, in order, what stands in the way', () => {
    expect(designerStep({ ...base, origin: 'https://forma-201ba--preview-x.web.app' }).kind).toBe('unreachable');
    expect(designerStep({ ...base, windows: false }).kind).toBe('not-windows');
    expect(designerStep({ ...base, permission: 'denied' }).kind).toBe('blocked');
    expect(designerStep(base).kind).toBe('checking');
    expect(designerStep({ ...base, health: null }).kind).toBe('starting');
    expect(designerStep({ ...base, health: null, started: true }).kind).toBe('no-companion');
    expect(designerStep({ ...base, health: { ...healthy, devexpress: null, found: ['19.2'] } })).toEqual({ kind: 'no-devexpress', found: ['19.2'], oldest: '20.1' });
    expect(designerStep({ ...base, health: healthy }).kind).toBe('sending');
    expect(designerStep({ ...base, health: healthy, sent: { ok: false, status: 424, message: 'x' } }).kind).toBe('no-devexpress');
    expect(designerStep({ ...base, health: healthy, sent: { ok: false, status: 500, message: 'boom' } })).toEqual({ kind: 'error', message: 'boom' });
  });

  it('opens, and names a newer download when there is one', () => {
    expect(designerStep({ ...base, health: healthy, sent: { ok: true } })).toEqual({ kind: 'opened', version: '1.0.0', newer: null });
    expect(designerStep({ ...base, health: healthy, sent: { ok: true }, latest: '1.1.0' })).toEqual({ kind: 'opened', version: '1.0.0', newer: '1.1.0' });
    expect(designerStep({ ...base, health: { ...healthy, version: null }, sent: { ok: true } })).toEqual({ kind: 'opened', version: null, newer: '1.0.0' });
  });
});

/*
 * CC-10 (2026-11-11): the installed DevExpress asked what it makes of a report.
 * The answers below are Forma Designer's own, from its /inspect and /render on
 * the Claude Code reference's FastReport v1 (fractional margins) with its 20
 * records: DevExpress kept sides of 100 and printed 4 pages.
 */
describe('what DevExpress makes of a report (CC-10)', () => {
  const INSPECT = {
    declared: 14,
    loaded: 14,
    lost: [],
    dropped: [
      { attribute: 'Margins', declared: '39.37, 39.37, 39.37, 39.37', loaded: '100, 100, 39, 39' },
      { attribute: 'PageWidth', declared: '826.77', loaded: '827' },
    ],
    margins: [100, 100, 39, 39],
  };
  const RENDER = { pages: 4, records: 20, margins: [100, 100, 39, 39] };
  const HEALTH = { app: 'RepxDesigner', version: '1.1.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1', inspects: true };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  /** A fresh copy of the module, which has not heard from Forma Designer yet. */
  const fresh = async () => {
    vi.resetModules();
    return import('./designerBridge');
  };
  afterEach(() => vi.unstubAllGlobals());

  it('asks nothing until Forma Designer has answered in this page', async () => {
    const bridge = await fresh();
    const fetchMock = vi.fn(async () => json(INSPECT));
    vi.stubGlobal('fetch', fetchMock);
    expect(bridge.designerAnswered()).toBe(false);
    expect(await bridge.inspectInDesigner('<XtraReportsLayoutSerializer />', [])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('then sends the report to /inspect and, with the records, to /render, behind the client header', async () => {
    const bridge = await fresh();
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) return json(HEALTH);
      return json(url.endsWith('/inspect') ? INSPECT : RENDER);
    }));
    expect(await bridge.askDesigner()).not.toBeNull();
    expect(bridge.designerAnswered()).toBe(true);
    const seen = await bridge.inspectInDesigner('<XtraReportsLayoutSerializer />', [{ ProductName: 'Chai' }]);
    expect(seen).toEqual({ lost: [], dropped: INSPECT.dropped, margins: [100, 100, 39, 39], pages: 4 });
    const [inspect, render] = calls.slice(1);
    expect(inspect.url).toBe(`${bridge.DESIGNER_ORIGIN}/inspect`);
    expect(new Headers(inspect.init?.headers).get(DESIGNER_CLIENT_HEADER)).toBe('1');
    expect(inspect.init?.body).toBe('<XtraReportsLayoutSerializer />');
    expect(render.url).toBe(`${bridge.DESIGNER_ORIGIN}/render`);
    expect(JSON.parse(String(render.init?.body))).toEqual({ repx: '<XtraReportsLayoutSerializer />', rows: [{ ProductName: 'Chai' }] });
  });

  it('stops asking once Forma Designer has gone, until it answers again', async () => {
    const bridge = await fresh();
    vi.stubGlobal('fetch', vi.fn(async () => json(HEALTH)));
    expect(await bridge.askDesigner()).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await bridge.inspectInDesigner('<x />', null)).toBeNull();
    expect(bridge.designerAnswered()).toBe(false);
  });

  it('never asks a Forma Designer released before /inspect, which the website cannot reach', async () => {
    // 1.0.0, the one in the 1.4.x zips: its /health says nothing of /inspect.
    const bridge = await fresh();
    const fetchMock = vi.fn(async () => json({ ...HEALTH, version: '1.0.0', inspects: undefined }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await bridge.askDesigner()).not.toBeNull();
    expect(await bridge.pingDesigner()).toBe(true);
    expect(bridge.designerAnswered()).toBe(false);
    expect(await bridge.inspectInDesigner('<x />', [{ A: '1' }])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('takes an answer that is not JSON as unreadable, not as Forma Designer gone', async () => {
    const bridge = await fresh();
    vi.stubGlobal('fetch', vi.fn(async () => json(HEALTH)));
    await bridge.askDesigner();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect(await bridge.inspectInDesigner('<x />', null)).toBeNull();
    expect(bridge.designerAnswered()).toBe(true);
  });

  it('prints only when the page gave records to print with', async () => {
    const bridge = await fresh();
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return json(url.endsWith('/health') ? HEALTH : INSPECT);
    }));
    await bridge.askDesigner();
    expect(await bridge.inspectInDesigner('<x />', [])).toEqual({ lost: [], dropped: INSPECT.dropped, margins: [100, 100, 39, 39], pages: null });
    expect(urls.map((u) => u.slice(bridge.DESIGNER_ORIGIN.length))).toEqual(['/health', '/inspect']);
  });

  it('says what DevExpress did not keep and printed, in plain words', async () => {
    const bridge = await fresh();
    const seen = bridge.readInspection(INSPECT, RENDER)!;
    const found = bridge.inspectionFindings(seen, { pagesShown: 2 });
    expect(found.map((f) => [f.severity, f.code])).toEqual([
      ['warning', 'designer-dropped'],
      ['error', 'designer-extra-pages'],
    ]);
    expect(found[0].message).toBe('DevExpress did not keep the margins as 39.37, 39.37, 39.37, 39.37 (it uses 100, 100, 39, 39), the page width as 826.77 (it uses 827).');
    expect(found[1].message).toBe("Printed in DevExpress with the page's records, the report runs to 4 pages where the page has 2.");
    // A part it could not build is an error; nothing else is said when all is kept.
    expect(bridge.inspectionFindings({ lost: ['tableHead'], dropped: [], margins: null, pages: null })[0]).toMatchObject({ severity: 'error', code: 'designer-lost-controls' });
    expect(bridge.inspectionFindings({ lost: [], dropped: [], margins: [39, 39, 39, 39], pages: 2 }, { pagesShown: 2 })).toEqual([]);
    expect(bridge.readInspection({ nothing: true }, null)).toBeNull();
  });

  it('is answered by the companion behind the same guards as /open', () => {
    const program = readFileSync('tools/RepxDesigner/Program.cs', 'utf8');
    const block = program.slice(program.indexOf('route == "/inspect" || route == "/render"))'));
    expect(block).toMatch(/if \(allowed == null\)[\s\S]*ClientHeader[\s\S]*Installed == null/);
    expect(readFileSync('tools/RepxDesigner/RepxDesigner.csproj', 'utf8')).toContain('<Compile Include="Probe.cs" />');
  });
});

/*
 * Asked once the report is on screen (2026-11-11, the full audit's PERF
 * batch): what DevExpress found is kept by the file it was found in, for the
 * REPX pane, which hears of it when it arrives. The last four files only.
 */
describe('what DevExpress found, kept for the REPX pane', () => {
  afterEach(async () => (await import('./designerBridge')).forgetInspectionsForTests());

  it('is kept by file, heard by whoever listens, and only for the last few files', async () => {
    const { keepInspection, inspectionOf, onInspection } = await import('./designerBridge');
    const finding = (code: string) => ({ severity: 'warning' as const, code, message: code });
    const heard = vi.fn();
    const stop = onInspection(heard);
    keepInspection('<a />', [finding('a')]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(inspectionOf('<a />')).toEqual([finding('a')]);
    expect(inspectionOf('<b />')).toEqual([]);
    for (const name of ['b', 'c', 'd', 'e']) keepInspection(`<${name} />`, [finding(name)]);
    expect(inspectionOf('<a />')).toEqual([]);
    expect(inspectionOf('<e />')).toEqual([finding('e')]);
    stop();
    keepInspection('<f />', []);
    expect(heard).toHaveBeenCalledTimes(5);
  });

  it('forgets everything it kept when a test asks, so nothing leaks into the next', async () => {
    const { keepInspection, inspectionOf, forgetInspectionsForTests } = await import('./designerBridge');
    keepInspection('<g />', [{ severity: 'error', code: 'designer-lost-controls', message: 'lost' }]);
    expect(inspectionOf('<g />')).toHaveLength(1);
    forgetInspectionsForTests();
    expect(inspectionOf('<g />')).toEqual([]);
  });
});
