/**
 * Sending a message from the contact page.
 *
 * Extracted from `ContactPage.tsx` on 2026-08-27 so it could be given a timeout
 * and a test at the same time (audit REL-001). The component still owns the
 * form, the validation and the honeypot; this owns the one network call.
 *
 * The bug it fixes is narrow and worth stating exactly. A *rejected* request
 * was already handled — an earlier version of the component fell through to the
 * success state on error and silently lost the message, and someone had already
 * fixed that. What remained was the case where nothing rejects: FormSubmit
 * accepts the connection and never answers. `fetch` does not time out on its
 * own in any useful timeframe, so the promise stayed pending, the form stayed
 * in `sending`, the button stayed disabled, and the only escape was a reload
 * that threw away what the visitor had typed.
 *
 * FormSubmit is a free third-party relay with no SLA — see the disclosure this
 * call obliges in `LegalPage.tsx` — so "accepted but unanswered" is a realistic
 * state rather than a theoretical one.
 */

/**
 * Ten seconds. Long enough for a slow relay on a poor connection, short enough
 * that a visitor has not concluded the page is broken and left.
 */
export const CONTACT_TIMEOUT_MS = 10000;

/** The payload FormSubmit's JSON endpoint expects. */
export interface ContactMessage {
  name: string;
  email: string;
  subject: string;
  message: string;
  /** FormSubmit's own field: the subject line of the email it sends on. */
  _subject: string;
}

/**
 * POST the message, or throw.
 *
 * Resolves only when FormSubmit says it took the message: a 2xx whose JSON
 * carries `success: "true"`. Every other outcome — a non-2xx, a refused
 * connection, the timeout, or a 2xx that says `success: "false"` — rejects,
 * so the caller cannot mistake any of them for a send.
 *
 * The last of those is the 2026-11-08 fix (site audit item 45). FormSubmit
 * answers 200 to a submission it will not deliver, the first one to an
 * address not yet activated among them, and says so only in the body; any
 * 2xx used to count, so the page said "Message sent" over a message nobody
 * would receive.
 */
export async function submitContactMessage(url: string, message: ContactMessage): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTACT_TIMEOUT_MS);

  let response: Response;
  let body = '';
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    // Read inside the timeout too: a relay can send its headers and stall.
    if (response.ok) body = await response.text();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      // The wording is the point. What the visitor needs to know is not that a
      // network call failed but that their text is still in the box and worth
      // keeping — they are one reload away from losing it.
      throw new Error(
        'The contact service did not respond, so your message has not been sent. ' +
          'Your text is still here — try again in a moment.'
      );
    }
    throw error;
  } finally {
    // Always, including on the success path: a surviving timer would abort a
    // request that had already completed.
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`send failed: ${response.status}`);
  }
  let answer: { success?: unknown; message?: unknown } = {};
  try {
    answer = JSON.parse(body) as typeof answer;
  } catch {
    throw new Error('The contact service gave an answer it could not read, so your message may not have been sent.');
  }
  if (String(answer?.success) !== 'true') {
    const said = typeof answer?.message === 'string' && answer.message ? ` It said: ${answer.message}` : '';
    throw new Error(`The contact service did not accept the message.${said}`);
  }
}
