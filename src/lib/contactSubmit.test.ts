/**
 * Sending a contact message.
 *
 * This lived inline in `ContactPage.tsx` and had no timeout (audit REL-001). A
 * comment above it recorded that an earlier version fell through to the success
 * state on error and lost the message — someone had already fixed the harder
 * half of this bug. What remained was the case where nothing resolves at all:
 * FormSubmit accepts the socket and never answers, the button stays disabled,
 * the spinner stays up, and the only way out is a reload that discards what the
 * visitor typed.
 *
 * It is a function in `lib/` rather than a promise chain in a component for the
 * usual reason in this codebase: the component cannot be reached by a test, and
 * this behaviour is worth pinning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitContactMessage, CONTACT_TIMEOUT_MS } from './contactSubmit';

const MESSAGE = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Bug report',
  message: 'The mockup renders the logo in the wrong place.',
  _subject: 'Forma: Bug report (from Ada Lovelace)',
};

const URL = 'https://formsubmit.co/ajax/someone@example.com';

/** A fetch that accepts the connection and never answers, but honours abort. */
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

describe('submitContactMessage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts the message as JSON', async () => {
    // Parameters are declared so `mock.calls[0]` is a typed tuple rather than
    // an empty one needing a cast — see the same shape in designerBridge.test.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('{}', { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await submitContactMessage(URL, MESSAGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(MESSAGE);
  });

  it('gives up rather than leaving the form stuck sending', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = submitContactMessage(URL, MESSAGE);
    const assertion = expect(pending).rejects.toThrow(/did not respond|timed out/i);

    await vi.advanceTimersByTimeAsync(CONTACT_TIMEOUT_MS + 1000);
    await assertion;
  });

  it('says the message was not sent, so the UI can tell the visitor to keep it', async () => {
    // The wording matters more than usual here: the failure the visitor needs
    // to understand is "your text is still in the box", not "network error".
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = submitContactMessage(URL, MESSAGE);
    const assertion = expect(pending).rejects.toThrow(/not been sent/i);

    await vi.advanceTimersByTimeAsync(CONTACT_TIMEOUT_MS + 1000);
    await assertion;
  });

  it('treats a non-2xx response as a failure, never a success', async () => {
    // This is the regression the inline comment was guarding against: an
    // earlier version set 'sent' on error and dropped the message.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(submitContactMessage(URL, MESSAGE)).rejects.toThrow(/500/);
  });

  it('propagates a refused connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(submitContactMessage(URL, MESSAGE)).rejects.toThrow(/Failed to fetch/);
  });

  it('clears its timer on success, so a resolved send cannot abort later', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    await submitContactMessage(URL, MESSAGE);
    // If the timer survived, advancing past the budget would abort a completed
    // request and surface as an unhandled rejection.
    await vi.advanceTimersByTimeAsync(CONTACT_TIMEOUT_MS + 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
