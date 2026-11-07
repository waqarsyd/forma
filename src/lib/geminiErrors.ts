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

/**
 * A server out of capacity: the one test, for the retries and for the message
 * (2026-11-07, agent audit item 93). geminiService.ts had its own, which read
 * "high demand" and a lower-case "unavailable" where this one did not, so an
 * error could be retried as an overload and then described as something else.
 */
export function isOverloadedError(error: any): boolean {
  const status = error?.status;
  const text = `${error?.message || ''}`.toLowerCase();
  return (
    status === 503 ||
    status === 'UNAVAILABLE' ||
    text.includes('503') ||
    text.includes('unavailable') ||
    text.includes('overloaded') ||
    text.includes('high demand')
  );
}

/**
 * Whether the browser says it is offline (2026-11-07, agent audit item 44).
 * A request made offline fails as "Failed to fetch", which read as a stream
 * cut short: every model was retried, and the user was told the connection
 * to Google had closed, as though Google had closed it.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** What failed, for a message that names it (2026-11-07, agent audit items 15 and 83). */
export interface FailureContext {
  /** Gemini when absent. */
  provider?: 'gemini' | 'local' | 'openrouter';
  /** The local server's address, for a message about reaching it. */
  where?: string;
  model?: string;
  /** False when one model was pinned and no other was tried. True when absent. */
  triedOthers?: boolean;
}

/** An Error carrying the one it explains, so a later reader can still see what the provider said. */
function explained(message: string, cause: unknown): Error {
  return Object.assign(new Error(message), { cause });
}

/**
 * A failure of Local AI or OpenRouter, in their own terms (2026-11-07,
 * agent audit item 15). Every message below this one names Google, Gemini
 * and its key, which is wrong for a model on the user's own computer.
 */
function classifyCompatError(error: any, context: FailureContext): Error {
  const message: string = error?.message || '';
  const status = error?.status;
  const local = context.provider === 'local';
  const name = local ? 'The local AI' : 'OpenRouter';
  const model = context.model ? ` ${context.model}` : '';
  if (isOffline()) return explained('You are offline. Forma needs a connection to reach OpenRouter; what you wrote is kept, so send it again once you are back online.', error);
  if (isTruncatedStreamMessage(message) && !/answered \d{3}/.test(message)) {
    return explained(
      local
        ? `Forma could not reach the local AI at ${context.where ?? 'its address'}. Is Ollama or LM Studio running, and does it allow this site? For Ollama set OLLAMA_ORIGINS to this address; in LM Studio turn on CORS.`
        : 'Forma could not reach OpenRouter. Check your connection and try again in a minute.',
      error,
    );
  }
  if (isQuotaExhausted(error)) {
    const waitMs = parseRetryDelayMs(error);
    return explained(
      `${name} refused the request for its rate limit${waitMs ? `; try again in about ${Math.max(1, Math.ceil(waitMs / 1000))}s` : ''}. ` +
        (local ? '' : "OpenRouter's free models allow a few requests a minute and a number a day; another free model has a limit of its own."),
      error,
    );
  }
  if (status === 401 || status === 403) {
    return explained(local ? `The local AI refused the request (${status}): ${readableMessage(message)}` : 'OpenRouter rejected the key. Check it in Settings, under AI.', error);
  }
  if (status === 404) return explained(`${name} has no model${model}. Choose one it offers in Settings, under AI.`, error);
  if (isOverloadedError(error)) return explained(`${name}${model} is busy and could not take the request, even after retrying. Wait a minute and send it again.`, error);
  return explained(`${name}${model}: ${readableMessage(message) || 'the request failed'}`, error);
}

/**
 * A stream that stopped mid-object rather than a request that was refused.
 *
 * `Incomplete JSON segment at the end` comes from the SDK's SSE reader: the
 * body ended holding text it could not split into events, a connection closed
 * between two chunks or an error Google wrote into the stream out of step.
 * Nothing about the request was wrong. Here since 2026-11-05, beside the other
 * classifications, so the message a user reads once the retries and the other
 * models are spent can be the readable one rather than the SDK's.
 */
export function isTruncatedStreamMessage(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('incomplete json') ||
    text.includes('unexpected end') ||
    text.includes('network error') ||
    text.includes('failed to fetch')
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
 * Which limit a 429 is (2026-11-02): the day's allowance or the minute's, by
 * the quota Google names in it ("GenerateRequestsPerDayPerProjectPerModel").
 * Until then every quota error said "per minute", which on a spent daily
 * allowance sent the owner back to try again a minute later, and again.
 */
export function quotaKind(error: any): 'daily' | 'per-minute' | 'unknown' {
  const text = `${error?.message || ''} ${JSON.stringify(error?.details ?? '')}`;
  if (/PerDay|per day|requests?_per_day|\bdaily\b/i.test(text)) return 'daily';
  if (/PerMinute|per minute|requests?_per_minute/i.test(text)) return 'per-minute';
  return parseRetryDelayMs(error) ? 'per-minute' : 'unknown';
}

/** Milliseconds until midnight Pacific time, when Google resets daily quotas. */
/**
 * The day's request limit Google named in a spent daily quota, as in
 * "GenerateRequestsPerDayPerProjectPerModel-FreeTier, limit: 20", or null
 * (2026-11-05). Settings' Usage today draws a bar against it once known:
 * Forma does not guess a free tier's limits, it learns each one when Google
 * states it.
 */
export function dailyLimitOf(error: any): number | null {
  if (quotaKind(error) !== 'daily') return null;
  const limit = /\blimit:\s*(\d+)/i.exec(`${error?.message || ''} ${JSON.stringify(error?.details ?? '')}`)?.[1];
  const n = limit ? Number(limit) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function msUntilPacificMidnight(now: Date = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const elapsed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000;
  return 24 * 3600 * 1000 - elapsed;
}

/** How long a model whose quota is spent should be left alone: Google's stated wait, or until the daily reset. */
export function quotaWaitMs(error: any, now: Date = new Date()): number | undefined {
  if (quotaKind(error) === 'daily') return msUntilPacificMidnight(now);
  return parseRetryDelayMs(error) ?? undefined;
}

/**
 * Map an SDK error onto a user-facing one.
 *
 * Cancellation is **not** handled here — an aborted request is not a failure,
 * and the caller rethrows it unwrapped so "the user pressed stop" stays
 * distinguishable from "the model errored".
 */
export function classifyGeminiError(error: any, context: FailureContext = {}): Error {
  if (context.provider === 'local' || context.provider === 'openrouter') return classifyCompatError(error, context);
  return withCause(classifyGemini(error, context), error);
}

/** The classified error, holding the provider's own as its cause (2026-11-07, `failureReason` reads it). */
function withCause(classified: Error, cause: unknown): Error {
  return Object.assign(classified, { cause });
}

function classifyGemini(error: any, context: FailureContext): Error {
  const message: string = error?.message || '';
  const status = error?.status;

  // Offline is not a cut stream (agent audit item 44): say so, before anything else.
  if (isOffline()) {
    return new Error("You are offline. Forma needs a connection to reach Gemini; what you wrote is kept, so send it again once you are back online.");
  }

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
    if (quotaKind(error) === 'daily') {
      const hours = Math.max(1, Math.round(msUntilPacificMidnight() / 3600000));
      const model = /model:\s*([\w.-]+)/i.exec(message)?.[1];
      // A model chosen in the box is the only one tried (agent audit item 83).
      const others = context.triedOthers === false ? ' The model chosen in the box is the only one Forma tries; choose Auto to let it use the others.' : ', and Forma tried the other models it can use.';
      return new Error(
        `This key's free daily allowance${model ? ` for ${model}` : ''} is used up${context.triedOthers === false ? '.' : ''}${others} ` +
          `It resets at midnight Pacific time, in about ${hours} hour${hours === 1 ? '' : 's'}. ` +
          // Forma Offline went on 2026-11-05; the other AIs Settings offers are what works meanwhile.
          'Meanwhile a local AI or OpenRouter can design instead: choose one in Settings.',
      );
    }
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
  if (isOverloadedError(error)) {
    return new Error(
      "Google's servers are busy and could not take this request, even after retrying. Nothing is wrong with your API key or your design — wait a minute and generate again."
    );
  }

  /*
   * Also reached only after the retries, and since 2026-11-05 after every
   * other model the key can call. Found with the owner's new key, which could
   * call one model, whose streams kept ending early: the user read "AI model
   * error: Incomplete JSON segment at the end", which names a parser.
   */
  if (isTruncatedStreamMessage(message)) {
    return new Error(
      "The connection to Google closed before the answer finished, even after retrying. Nothing is wrong with your API key or your design — check your connection and try again in a minute."
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
