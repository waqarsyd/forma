/**
 * Which AI designs a report, and how to reach it (2026-11-02, milestone 3 of
 * docs/proposals/own-model.md).
 *
 * The owner asked for provider setup in the manner of Hermes Agent, and
 * chose four:
 * - **Forma Offline:** Forma's own model, no key and no service.
 * - **Gemini** with the user's free key.
 * - **Local AI:** Ollama or LM Studio on the user's own computer, through
 *   their OpenAI-compatible endpoint.
 * - **OpenRouter's free models.**
 * "Automatic" uses Gemini when a key is in, and Forma Offline otherwise.
 *
 * The choice, the local endpoint and the model names are preferences, kept in
 * localStorage. The OpenRouter key is not: like the Gemini key it lives in
 * sessionStorage and goes when the tab closes.
 */
import type { ReportConfig } from '../services/geminiService';

export type AiProvider = 'auto' | 'offline' | 'gemini' | 'local' | 'openrouter';

export const PROVIDERS: AiProvider[] = ['auto', 'offline', 'gemini', 'local', 'openrouter'];

/** Ollama's OpenAI-compatible endpoint; LM Studio's is http://localhost:1234/v1. */
export const DEFAULT_LOCAL_URL = 'http://localhost:11434/v1';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

const STORAGE_KEY = 'forma.aiProvider';
const OPENROUTER_KEY_SESSION = 'openRouterKey:session';

/** The provider fields of a config, as they are kept. */
export interface ProviderSettings {
  provider: AiProvider;
  localUrl: string;
  localModel: string;
  openRouterModel: string;
  openRouterKey: string;
}

/** The kept settings, with the defaults for anything missing or unreadable. */
export function readProviderSettings(): ProviderSettings {
  let stored: Partial<ProviderSettings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ProviderSettings>;
  } catch {
    /* storage disabled or a hand-edited value: the defaults stand */
  }
  let key = '';
  try {
    key = sessionStorage.getItem(OPENROUTER_KEY_SESSION) || '';
  } catch {
    /* storage disabled */
  }
  return {
    provider: PROVIDERS.includes(stored.provider as AiProvider) ? (stored.provider as AiProvider) : 'auto',
    localUrl: typeof stored.localUrl === 'string' && stored.localUrl ? stored.localUrl : DEFAULT_LOCAL_URL,
    localModel: typeof stored.localModel === 'string' ? stored.localModel : '',
    openRouterModel: typeof stored.openRouterModel === 'string' ? stored.openRouterModel : '',
    openRouterKey: key,
  };
}

/** Keep the settings: the key in this tab's sessionStorage, the rest in localStorage. */
export function writeProviderSettings(s: Partial<ProviderSettings>): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ provider: s.provider ?? 'auto', localUrl: s.localUrl ?? DEFAULT_LOCAL_URL, localModel: s.localModel ?? '', openRouterModel: s.openRouterModel ?? '' }),
    );
    if (s.openRouterKey) sessionStorage.setItem(OPENROUTER_KEY_SESSION, s.openRouterKey);
    else sessionStorage.removeItem(OPENROUTER_KEY_SESSION);
  } catch {
    /* storage disabled: the settings hold for this session */
  }
}

/** The provider a config actually uses: Automatic resolved to Gemini or Forma Offline. */
export function effectiveProvider(config: Pick<ReportConfig, 'provider' | 'customApiKey'>): Exclude<AiProvider, 'auto'> {
  const p = config.provider ?? 'auto';
  if (p !== 'auto') return p;
  return config.customApiKey?.trim() ? 'gemini' : 'offline';
}

/**
 * Whether an AI model is set up to answer, which is what the workspace's
 * AI features check. Forma Offline is never an AI model: with it the chat box
 * hands words to Forma's own model and images to OCR.
 */
export function aiReady(config: ReportConfig): boolean {
  switch (effectiveProvider(config)) {
    case 'gemini':
      return Boolean(config.customApiKey?.trim());
    case 'local':
      return Boolean(config.localUrl?.trim() && config.localModel?.trim());
    case 'openrouter':
      return Boolean(config.openRouterKey?.trim() && config.openRouterModel?.trim());
    default:
      return false;
  }
}

/** A provider's name as the settings and the thread say it. */
export const PROVIDER_NAMES: Record<AiProvider, string> = {
  auto: 'Automatic',
  offline: 'Forma Offline',
  gemini: 'Gemini',
  local: 'Local AI',
  openrouter: 'OpenRouter',
};
