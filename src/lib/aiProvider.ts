/**
 * Which AI designs a report, and how to reach it (2026-11-02, milestone 3 of
 * docs/proposals/own-model.md).
 *
 * The owner asked for provider setup in the manner of Hermes Agent, and
 * chose Gemini with the user's free key, Local AI (Ollama or LM Studio on the
 * user's own computer, through their OpenAI-compatible endpoint) and
 * OpenRouter's free models, beside Forma Offline, Forma's own model with no
 * key at all.
 *
 * **On 2026-11-05 the owner merged Automatic and Forma Offline and made the
 * key the entry point again**: with no AI set up, Forma does no work, as it
 * was before 2026-11-02. So the choices are three: Automatic, which is Gemini
 * with the key in Settings; Local AI; OpenRouter. A browser that kept
 * "gemini" or "offline" from before reads as Automatic. Forma's own model is
 * still there behind the scenes, as the draft that stands in when the AI
 * set up fails to answer (lib/formaTeam.ts).
 *
 * **On 2026-11-23 the owner widened the entry point from the Gemini key to
 * any AI of the person's own** (`workspaceOpen`): a Gemini key, an OpenRouter
 * key and model, or a Local AI server and model each open the workspace, and
 * with none set up the composer stays locked and asks for one. There is
 * still never a mode with no AI. A Local AI model has no key, which is why
 * the rule is "an AI set up", not "an API key". What still asks Gemini
 * itself steps aside without its key: the report library's search
 * (services/library.ts, through `librarySearchable`, which also keeps it shut
 * while Local AI designs), model detection and the key vault.
 *
 * The choice, the local endpoint and the model names are preferences, kept in
 * localStorage. The OpenRouter key is not: like the Gemini key it lives in
 * sessionStorage and goes when the tab closes.
 */
import type { ReportConfig } from '../services/geminiService';

/** What the settings offer. */
export type AiProvider = 'auto' | 'local' | 'openrouter';
/** What answers: Automatic is Gemini. */
export type EffectiveProvider = 'gemini' | 'local' | 'openrouter';

export const PROVIDERS: AiProvider[] = ['auto', 'local', 'openrouter'];

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
  /**
   * Forma's vision model on the Local AI server, as a helper beside whichever
   * AI designs (2026-11-03, lib/formaTeam.ts). Empty, no helper.
   */
  visionModel: string;
  /**
   * A page reader on the Local AI server, such as glm-ocr, whose reading of a
   * picture's text goes to the AI beside OCR's (2026-11-10, lib/localModels.ts).
   * Empty, none.
   */
  pageReader: string;
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
    visionModel: typeof stored.visionModel === 'string' ? stored.visionModel : '',
    pageReader: typeof stored.pageReader === 'string' ? stored.pageReader : '',
  };
}

/** Keep the settings: the key in this tab's sessionStorage, the rest in localStorage. */
export function writeProviderSettings(s: Partial<ProviderSettings>): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        provider: s.provider ?? 'auto',
        localUrl: s.localUrl ?? DEFAULT_LOCAL_URL,
        localModel: s.localModel ?? '',
        openRouterModel: s.openRouterModel ?? '',
        visionModel: s.visionModel ?? '',
        pageReader: s.pageReader ?? '',
      }),
    );
    if (s.openRouterKey) sessionStorage.setItem(OPENROUTER_KEY_SESSION, s.openRouterKey);
    else sessionStorage.removeItem(OPENROUTER_KEY_SESSION);
  } catch {
    /* storage disabled: the settings hold for this session */
  }
}

/** The provider a config actually uses: Automatic, and anything a browser kept from before, is Gemini. */
export function effectiveProvider(config: Pick<ReportConfig, 'provider'>): EffectiveProvider {
  return config.provider === 'local' || config.provider === 'openrouter' ? config.provider : 'gemini';
}

/**
 * Whether the workspace opens: the AI chosen is ready to answer. The owner's
 * rule since 2026-11-23: any AI of the person's own opens it, Gemini with its
 * key, OpenRouter with its key and model, or Local AI with its server and
 * model, and none other is needed beside it; with the AI chosen not set up,
 * the composer is locked and asks for one. From 2026-11-05 until then the
 * Gemini key was required as well, whichever AI was chosen.
 *
 * The AI chosen, not any AI set up: a Local AI or OpenRouter with no model
 * falls through to Gemini in services/geminiService.ts (`compatEndpoint` is
 * null), so opening on a Gemini key beside it would send the first request to
 * Google from someone who picked an AI on their own computer.
 */
export function workspaceOpen(config: ReportConfig): boolean {
  return aiReady(config);
}

/**
 * Whether the chosen AI is set up to answer: for Gemini its key, for
 * OpenRouter its key and a model, for Local AI its server and a model.
 */
export function aiReady(config: ReportConfig): boolean {
  switch (effectiveProvider(config)) {
    case 'gemini':
      return Boolean(config.customApiKey?.trim());
    case 'local':
      return Boolean(config.localUrl?.trim() && config.localModel?.trim());
    case 'openrouter':
      return Boolean(config.openRouterKey?.trim() && config.openRouterModel?.trim());
  }
}

/**
 * Whether a Gemini key is in (2026-11-23). Since the workspace opens on any
 * AI, this is no longer the gate; it is what the parts that ask Gemini
 * themselves check before they ask, the report library through
 * `librarySearchable` below.
 */
export function hasGeminiKey(config: Pick<ReportConfig, 'customApiKey'>): boolean {
  return Boolean(config.customApiKey?.trim());
}

/**
 * Whether the report library may be searched and filled (2026-11-24, the
 * wave-2 review's KEYREV-3 and W1): only Gemini finds its reports, so it
 * needs a Gemini key, and never while Local AI designs. Searching it sends
 * the words of the request and the draft's band captions to Google, and
 * adding a report sends its stripped layout; a person who chose an AI on
 * their own computer chose that nothing leaves it, the rule
 * lib/fallbackChain.ts keeps and the privacy policy states. Until then a
 * Gemini key beside Local AI was searched with on every refinement. The
 * reports a person keeps need none of this: they are matched on the device
 * (`nearestKept` in services/library.ts).
 */
export function librarySearchable(config: Pick<ReportConfig, 'provider' | 'customApiKey'>): boolean {
  return hasGeminiKey(config) && effectiveProvider(config) !== 'local';
}

/**
 * What Forma says when the AI chosen is not set up (2026-11-23), the rule in
 * the person's words: the locked workspace's errors, and the message of
 * `MissingApiKeyError` (services/geminiService.ts). A Local AI model has no
 * key, so it is not "add your API key".
 */
export const SET_UP_AI = 'Set up your AI in Settings to start: a Gemini or OpenRouter key, or a model on your own computer.';

/** A Local AI model imported as Forma's vision model (milestone 6): "forma-vision", any tag. */
const isFormaVisionName = (model: string | undefined) => /forma-vision/i.test(model ?? '');

/**
 * Whether the AI that designs is itself Forma's vision model on Local AI.
 * Then nothing else designs: a picture goes to the vision model and OCR
 * alone, since the model was trained on one question, not the mega-prompt.
 */
export function isVisionOnly(config: Pick<ReportConfig, 'provider' | 'localModel'>): boolean {
  return config.provider === 'local' && isFormaVisionName(config.localModel);
}

/**
 * Where Forma's vision model answers, when one is set up: the helper named in
 * the settings, on the Local AI server, or the Local AI model itself when that
 * is the vision model. Null when there is none.
 */
export function visionModelOf(config: Pick<ReportConfig, 'provider' | 'localUrl' | 'localModel' | 'visionModel'>): { baseUrl: string; model: string } | null {
  const baseUrl = config.localUrl?.trim() || DEFAULT_LOCAL_URL;
  const helper = config.visionModel?.trim();
  if (helper) return { baseUrl, model: helper };
  if (isVisionOnly(config)) return { baseUrl, model: config.localModel!.trim() };
  return null;
}

/** Where the page reader answers, when one is set up: on the Local AI server, whichever AI designs. */
export function pageReaderOf(config: Pick<ReportConfig, 'localUrl' | 'pageReader'>): { baseUrl: string; model: string } | null {
  const model = config.pageReader?.trim();
  return model ? { baseUrl: config.localUrl?.trim() || DEFAULT_LOCAL_URL, model } : null;
}

/** A provider's name as the settings and the thread say it. */
export const PROVIDER_NAMES: Record<AiProvider | EffectiveProvider, string> = {
  auto: 'Automatic',
  gemini: 'Gemini',
  local: 'Local AI',
  openrouter: 'OpenRouter',
};

/**
 * Which model answers when it is not Gemini's (2026-11-07, agent audit item
 * 74), for the box, where Gemini has its model picker: the box said nothing
 * with Local AI or OpenRouter, so whether the answer came from the model the
 * person chose was a question for Settings. `label` is short enough for the
 * box ("llama-3.3-70b-instruct" for "meta-llama/llama-3.3-70b-instruct:free"),
 * the provider's name when no model is set. Null for Gemini.
 */
export function answeringModel(
  config: Pick<ReportConfig, 'provider' | 'localModel' | 'openRouterModel'>,
): { provider: string; model: string; label: string } | null {
  const which = effectiveProvider(config);
  if (which === 'gemini') return null;
  const model = ((which === 'local' ? config.localModel : config.openRouterModel) ?? '').trim();
  const label = model.replace(/^[^/]+\//, '').replace(/:free$/, '');
  return { provider: PROVIDER_NAMES[which], model, label: label || PROVIDER_NAMES[which] };
}
