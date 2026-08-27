import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  designerFileName,
  sendToDesigner,
  pingDesigner,
  launchDesigner,
  waitForDesigner,
  DESIGNER_CLIENT_HEADER,
  DESIGNER_PROTOCOL,
} from './designerBridge';

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
    const assertion = expect(pending).rejects.toThrow(/did not respond|timed out/i);

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

  it('reports a refusal from the companion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 415 })));
    await expect(sendToDesigner('<x/>', 'a.repx')).rejects.toThrow(/415/);
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