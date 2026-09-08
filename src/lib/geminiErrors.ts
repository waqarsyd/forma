/**
 * Turning a Gemini SDK error into something the user can act on.
 *
 * Extracted from `analyzeReportDesign`'s nested `toFriendlyError` so it can be
 * tested: the classification is pure, while the cancellation check around it
 * needs the request's `AbortSignal` and stays at the call site.
 *
 * ## The 400 case, which is why this file exists
 *
 * The mapping used to read:
 *
 *     if (status === 400 || message.includes("API_KEY_INVALID") || …)
 *         return new Error("That Gemini API key is not valid. …")
 *
 * Found on 2026-08-27 by driving the real API with a **valid** key: a malformed
 * request returns 400 INVALID_ARGUMENT, and the user was told their key was
 * bad. Google uses 400 for an unsupported mime type, an oversized payload, a
 * bad `generationConfig` — this file's own neighbour documents a model
 * rejecting `thinkingBudget: 0` with a bare 400 — and, yes, for a malformed
 * key. Only the last is a key problem, and it says so in the message.
 *
 * The damage is not a poor error string. It is a dead end: the user is sent to
 * fix the one thing that is not broken, swaps a working key for another working
 * key, and hits the same wall with no new information.
 *
 * So the two message checks decide, and a 400 that does not match them reports
 * what Google actually said.
 */

/** Google's own words are more use than ours when we do not recognise the failure. */
function readableMessage(message: string): string {
  try {
    const jsonStart = message.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(message.slice(jsonStart));
      // Providers nest this one or two deep depending on the endpoint.
      const inner = parsed?.error?.message ?? parsed?.message;
      if (typeof inner === 'string' && inner.trim()) return readableMessage(inner);
    }
  } catch {
    /* not JSON after all — fall through to the message as given */
  }
  return message;
}

/** Does the error actually say the key is bad, rather than merely being a 400? */
function saysKeyIsInvalid(message: string): boolean {
  return message.includes('API_KEY_INVALID') || /api key not valid/i.test(message);
}

function isOverloadedMessage(status: unknown, message: string): boolean {
  return (
    status === 503 ||
    message.includes('503') ||
    message.includes('UNAVAILABLE') ||
    /overloaded/i.test(message)
  );
}

/** Is this the per-model rate limit rather than anything wrong with the key? */
export function isQuotaExhausted(error: any): boolean {
  const message: string = error?.message || '';
  const status = error?.status;
  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED')
  );
}

/**
 * How long Google says to wait, in milliseconds, or `null` if it did not say.
 *
 * A 429 carries the answer and the app was throwing it away. The free tier is
 * **five requests per minute per model** — observed 2026-09-08, where one chat
 * turn could spend four of them — so re-sending a moment later is not merely
 * unhelpful, it deepens the hole. Both spellings appear in the wild: the prose
 * "Please retry in 2.049434999s." in the message, and a `retryDelay: "54s"`
 * field on the structured error.
 *
 * Fractional seconds are kept: `2.049s` is 2049ms, not 2000. Anything absurd is
 * rejected rather than clamped, because a nonsense value here would park a model
 * for the rest of the session and look like the fallback had stopped working.
 */
const MAX_SANE_RETRY_MS = 10 * 60 * 1000;

export function parseRetryDelayMs(error: any): number | null {
  const message = `${error?.message || ''}`;
  const structured = error?.retryDelay ?? error?.details?.retryDelay;
  const source = typeof structured === 'string' ? structured : message;

  const match =
    /retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i.exec(source) ??
    /^\s*(\d+(?:\.\d+)?)\s*s\s*$/i.exec(source) ??
    /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/i.exec(source);
  if (!match) return null;

  const ms = Math.round(Number(match[1]) * 1000);
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_SANE_RETRY_MS ? ms : null;
}

/**
 * Map an SDK error onto a user-facing one.
 *
 * Cancellation is **not** handled here — an aborted request is not a failure,
 * and the caller rethrows it unwrapped so "the user pressed stop" stays
 * distinguishable from "the model errored".
 */
export function classifyGeminiError(error: any): Error {
  const message: string = error?.message || '';
  const status = error?.status;

  if (isQuotaExhausted(error)) {
    /*
     * Say when, if Google said when.
     *
     * This used to be "check your plan and billing details, or try again
     * later", over the provider's own multi-paragraph text — accurate and
     * unusable. The number that makes it actionable was in the error the whole
     * time. The rate limit is *per model per minute*, so it is worth
     * distinguishing from a spent billing allowance: the free tier is five
     * requests a minute, which one chat turn with retries can reach on its own.
     */
    const waitMs = parseRetryDelayMs(error);
    const when = waitMs ? ` Try again in about ${Math.max(1, Math.ceil(waitMs / 1000))}s.` : '';
    return new Error(
      `You have reached the request quota for this Gemini model.${when} ` +
      'This is a limit on how often the key may call that model, not a problem with your design or your report — ' +
      'the free tier allows only a few requests per minute per model.'
    );
  }

  // A revoked or leaked key comes back as 403 PERMISSION_DENIED.
  if (status === 403 || message.includes('403') || message.includes('PERMISSION_DENIED')) {
    if (message.toLowerCase().includes('leaked')) {
      return new Error(
        'Google has disabled this API key because it was published somewhere public. Create a new key in Google AI Studio and paste it in Settings.'
      );
    }
    return new Error(
      'Your Gemini API key was rejected. Check that it is correct and that the Generative Language API is enabled for its project.'
    );
  }

  // The message decides, not the status. See the note at the top of this file.
  if (saysKeyIsInvalid(message)) {
    return new Error('That Gemini API key is not valid. Check for a typo or paste it again in Settings.');
  }

  if (status === 404 || message.includes('NOT_FOUND')) {
    return new Error(
      'No Gemini model available to this API key could complete the request. Your key may be too new, or every model may be over quota.'
    );
  }

  // Reached only after the automatic retries have already been spent.
  if (isOverloadedMessage(status, message)) {
    return new Error(
      "Google's servers are busy and could not take this request, even after retrying. Nothing is wrong with your API key or your design — wait a minute and generate again."
    );
  }

  const readable = readableMessage(message);

  // A 400 that reaches here is a request Google would not accept — the wrong
  // file type, too large, an unsupported option. Name it as such and quote the
  // provider, because that is the only part that identifies which.
  if (status === 400 || message.includes('INVALID_ARGUMENT')) {
    return new Error(
      `Gemini rejected the request: ${readable || 'the request was not valid'}. ` +
        'This is usually the uploaded file — an unsupported type, or too large. Your API key is fine.'
    );
  }

  return new Error(`AI model error: ${readable || 'Unknown error'}`);
}
