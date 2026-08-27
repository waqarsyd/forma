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

  if (status === 429 || message.includes('429') || status === 'RESOURCE_EXHAUSTED' || message.includes('RESOURCE_EXHAUSTED')) {
    return new Error(
      'You have exceeded your Gemini API quota. Please check your plan and billing details, or try again later.'
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
