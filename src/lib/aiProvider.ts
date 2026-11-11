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
 * Whether the workspace opens: the Gemini key is in, whichever AI is chosen,
 * and that AI is ready to answer. The owner's rule (2026-11-05): the key is
 * the entry point to any work, Local AI and OpenRouter included; with no key
 * the composer is locked and asks for one.
 */
export function workspaceOpen(config: ReportConfig): boolean {
  return Boolean(config.customApiKey?.trim()) && aiReady(config);
}

/** Whether the chosen AI is set up to answer: its key, or for Local AI its server and model. */
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
