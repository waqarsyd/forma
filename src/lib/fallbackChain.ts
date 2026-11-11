/**
 * When the AI chosen has reached its limit, the next free one the person has
 * set up (2026-11-10, the owner's AI accuracy programme, batch AF, item 20).
 *
 * The owner's decision that day: on a limit, a free chain, each switch said in
 * the chat, and Forma's own draft at the end. Gemini already moves to its next
 * model inside the service when one model's allowance is spent
 * (services/geminiService.ts); this is the step after it, across providers:
 * OpenRouter with the person's own key and model, then Local AI with theirs,
 * in that order, and Gemini when another AI was chosen and gave out. Only an
 * AI the person set up is asked, and only on a limit: a wrong key, a refused
 * request or a bad answer is the person's to see, not something another AI
 * should quietly paper over. When every one gives out, App's own fallback
 * stands in, Forma's draft of the page (lib/formaTeam.ts).
 *
 * **Never away from Local AI.** A person who chose an AI on their own computer
 * chose that nothing leaves it, so a request to it is never sent on to Gemini
 * or OpenRouter, whatever it answers; a local server has no allowance to
 * spend in any case.
 */
import { isQuotaExhausted } from './geminiErrors';
import { effectiveProvider, PROVIDER_NAMES, type EffectiveProvider } from './aiProvider';
import type { ReportConfig } from '../services/geminiService';

/** The order the chain tries, after the AI chosen. */
const ORDER: readonly EffectiveProvider[] = ['gemini', 'openrouter', 'local'];

/**
 * Whether an error is a limit: the allowance spent, today's or this minute's
 * (429, RESOURCE_EXHAUSTED). The service hands App a classified error with
 * the provider's own as its cause, so both are read.
 */
export function isLimit(err: unknown): boolean {
  const e = err as { status?: unknown; message?: string; cause?: unknown } | null | undefined;
  if (!e) return false;
  if (isQuotaExhausted(e)) return true;
  if (/rate limit|quota|too many requests/i.test(e.message ?? '')) return true;
  return e.cause !== undefined && e.cause !== e ? isLimit(e.cause) : false;
}

/** Whether `provider` is set up in `config`: its key or its server, and a model. */
export function readyFor(provider: EffectiveProvider, config: ReportConfig): boolean {
  switch (provider) {
    case 'gemini':
      return Boolean(config.customApiKey?.trim());
    case 'openrouter':
      return Boolean(config.openRouterKey?.trim() && config.openRouterModel?.trim());
    case 'local':
      return Boolean(config.localUrl?.trim() && config.localModel?.trim());
  }
}

/** The other AIs set up beside the one chosen, in the order they are asked; none after Local AI. */
export function fallbacksFor(config: ReportConfig): EffectiveProvider[] {
  const chosen = effectiveProvider(config);
  if (chosen === 'local') return [];
  return ORDER.filter((p) => p !== chosen && readyFor(p, config));
}

/** The config that asks `provider` instead of the AI chosen. */
export function configFor(config: ReportConfig, provider: EffectiveProvider): ReportConfig {
  return { ...config, provider: provider === 'gemini' ? 'auto' : provider };
}

/** An AI as the console names it: "OpenRouter (gemma-4-31b-it)", "Local AI (qwen3.5:9b)", "Gemini". */
export function aiLabel(provider: EffectiveProvider, config: ReportConfig): string {
  const model = provider === 'openrouter' ? config.openRouterModel : provider === 'local' ? config.localModel : '';
  const short = (model ?? '').trim().replace(/^[^/]+\//, '').replace(/:free$/, '');
  return short ? `${PROVIDER_NAMES[provider]} (${short})` : PROVIDER_NAMES[provider];
}

/**
 * The line a reply carries when another AI answered. It names the two
 * providers and no model (2026-11-11, the full audit's WS-07, CV-09 and PL-29):
 * where the person's words went is a privacy fact they are owed, which model
 * read them is machinery. Whether to say it at all is the owner's decision 2
 * of that audit; this is its recommended interim.
 */
export function switchNote(from: EffectiveProvider, to: EffectiveProvider): string {
  return `${PROVIDER_NAMES[from]}'s free limit is used up for now, so ${PROVIDER_NAMES[to]} answered this one.`;
}

/** What answered: the value, the config that asked it, and the switch to say ('' when the AI chosen did). */
export interface Answered<T> {
  value: T;
  config: ReportConfig;
  by: EffectiveProvider;
  note: string;
}

/**
 * Ask the AI chosen, and on a limit each other AI set up in turn. Anything
 * but a limit from the AI chosen is thrown as it was, and an abort stops the
 * chain at once. When none answers, the limit that started the chain is
 * thrown, not the last AI's failure (2026-11-11, the full audit's PL-27): an
 * OpenRouter model refusing a picture with a 400 used to replace "Gemini's
 * free limit is used up" in the reply, which sent the person after the wrong
 * cause. The last failure goes to the console. A generation and a chat turn
 * both ask through it (App.tsx).
 */
export async function askWithChain<T>(config: ReportConfig, ask: (asked: ReportConfig) => Promise<T>, signal?: AbortSignal): Promise<Answered<T>> {
  const chosen = effectiveProvider(config);
  try {
    return { value: await ask(config), config, by: chosen, note: '' };
  } catch (limited) {
    const others = !signal?.aborted && isLimit(limited) ? fallbacksFor(config) : [];
    if (!others.length) throw limited;
    for (const next of others) {
      const asked = configFor(config, next);
      console.warn(`${aiLabel(chosen, config)} reached its limit; asking ${aiLabel(next, config)} instead.`);
      try {
        return { value: await ask(asked), config: asked, by: next, note: switchNote(chosen, next) };
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn(`${aiLabel(next, config)} did not answer either:`, err);
      }
    }
    // Thrown as it was, its cause untouched: that cause is the provider's own
    // error, which is how isLimit, and the batch's pause, know it is a limit.
    throw limited;
  }
}
