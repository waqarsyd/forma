/**
 * Which AI the MCP server's AI tools ask, from the values set in the server's
 * entry in a host's MCP configuration (2026-11-24, the MCP work's wave 8;
 * findings NODE-12, SEC-9, SEC-11, DOC-4 and PROTO-8 of the 2026-11-23 design
 * audit, and the owner's decision OD6).
 *
 * The entry (stdio.ts) is the only file in src/mcp that touches the
 * environment, which boundaries.test.ts holds: it copies these values out by
 * name and hands them here, so this file reads nothing itself and its tests
 * hand it whatever they like. Nothing loads a .env file (no dotenv): a .env
 * in the folder a host starts the server in is never this server's business,
 * and a GEMINI_API_KEY or GOOGLE_API_KEY meant for some other tool is never
 * spent here, which is why the key's name is Forma's own (SEC-9). The entry
 * also deletes those two and Google's Vertex AI switches from its own
 * environment before anything loads the Gemini SDK, which would otherwise
 * fall back on them by itself (DOC-4).
 *
 * The names, each optional:
 *
 * - FORMA_GEMINI_KEY: a Gemini key.
 * - FORMA_OPENROUTER_KEY and FORMA_OPENROUTER_MODEL: an OpenRouter key and
 *   the model it answers with.
 * - FORMA_LOCAL_MODEL, and FORMA_LOCAL_URL (Ollama's address by default,
 *   aiProvider.ts's DEFAULT_LOCAL_URL): a model on the user's own computer,
 *   through Ollama's or LM Studio's OpenAI-compatible endpoint.
 * - FORMA_PROVIDER: gemini, openrouter or local, which one designs. Left
 *   out, the one set up is chosen; with more than one set up and none
 *   chosen, nothing is guessed, because guessing Gemini or OpenRouter for
 *   someone who also set up a model on their own computer would send their
 *   report off it.
 * - FORMA_MODEL: a Gemini model to answer with, never probed (NODE-7).
 * - FORMA_LOCALE: the locale the paper follows when nothing in the request
 *   says it (never the operating system's: nodeGeneration.ts).
 * - FORMA_MCP_MOCK: 1 or true for the mock invoice instead of an AI, for
 *   tests and a run with no quota to spend. It replaces the AI's answer
 *   only: an AI must still be set up (OD6, "there is no mode without an
 *   AI"), so a test sets a stand-in key.
 *
 * The gate is the web app's (OD6, aiProvider.ts `aiReady`): the AI chosen
 * must be ready to answer, Gemini with its key, OpenRouter with its key and
 * model, Local AI with its server and model, and none other is needed beside
 * it. Without one the AI tools stay listed and refuse with SET_UP_AI's words
 * and the names to set (`notReadyMessage`, PROTO-8). Another AI set up beside
 * the one chosen is the free chain's next on a limit, as in the app
 * (lib/fallbackChain.ts), and never away from Local AI.
 *
 * A Local AI address must be this computer's (SEC-11): localhost, 127.0.0.1
 * or [::1], any port, over http or https, with no user name or password in
 * it. In the browser only the site's CSP keeps Local AI on this computer; a
 * Node process has none, so an address elsewhere would send a report off the
 * computer, in clear text, while the result still said "Local AI". Anything
 * else is refused in plain words, and with it every AI tool, until it is
 * corrected; allowing an address on the network is the owner's decision.
 *
 * A value that is only a reference, such as `${FORMA_GEMINI_KEY}`, is taken
 * as not set and refuses every AI tool, saying so (`UNEXPANDED`): a host
 * passes the reference on as it is when the variable is not set where the
 * host started, and taken as a key it went to Google and failed as an
 * invalid one. No refusal echoes any other value it judged (W8C-4), since a
 * key pasted under the wrong name would be repeated back.
 *
 * `secrets` are the literal values of the keys given, for the scrubber
 * (lib/keyRedact.ts `redactorFor`, SEC-7), which takes them out of every
 * result, error and log line by value.
 *
 * Pure ASCII.
 */
import { DEFAULT_LOCAL_URL, PROVIDER_NAMES, SET_UP_AI, aiReady, effectiveProvider, type EffectiveProvider } from '../lib/aiProvider';
import type { ReportConfig } from '../services/geminiService';

/** The names the entry copies out of its environment, in the order a message lists them. */
export const AI_ENV_NAMES = [
  'FORMA_PROVIDER',
  'FORMA_GEMINI_KEY',
  'FORMA_OPENROUTER_KEY',
  'FORMA_OPENROUTER_MODEL',
  'FORMA_LOCAL_URL',
  'FORMA_LOCAL_MODEL',
  'FORMA_MODEL',
  'FORMA_LOCALE',
  'FORMA_MCP_MOCK',
] as const;

export type AiEnvName = (typeof AI_ENV_NAMES)[number];
/** The values, as the entry copied them: absent or blank when not set. */
export type AiEnv = Partial<Record<AiEnvName, string | undefined>>;

/** The names that hold a key, whose values the scrubber takes out. */
export const AI_KEY_NAMES: readonly AiEnvName[] = ['FORMA_GEMINI_KEY', 'FORMA_OPENROUTER_KEY'];

/** What the AI tools are made with. */
export interface AiSettings {
  /** The stored settings a request starts from: the provider fields, and nothing learned. */
  config: ReportConfig;
  /** The AI chosen, as the free chain names it. */
  provider: EffectiveProvider;
  /** The AI chosen is ready to answer, and nothing set is refused. */
  ready: boolean;
  /** Why not, in plain words, each naming what to set; empty when ready. */
  problems: string[];
  /** The mock invoice instead of an AI. */
  mock: boolean;
  /** A Gemini model to answer with. */
  model?: string;
  /** The locale the paper follows. */
  locale?: string;
  /** The literal values of the keys given. */
  secrets: string[];
}

const PROVIDER_WORDS: Record<string, EffectiveProvider> = { gemini: 'gemini', auto: 'gemini', openrouter: 'openrouter', local: 'local' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why a Local AI address is refused, or null when it is this computer's
 * (the header). Exported for its tests.
 */
export function localUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Never echoed (the wave-8 review's W8C-4): a key pasted here by mistake would be repeated back.
    return `FORMA_LOCAL_URL is not an address; give the server's full address, such as ${DEFAULT_LOCAL_URL}.`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `FORMA_LOCAL_URL must be an http or https address on this computer, such as ${DEFAULT_LOCAL_URL}.`;
  if (url.username || url.password) return 'FORMA_LOCAL_URL holds a user name or password, which this server never sends; give the address alone.';
  if (!LOOPBACK.has(url.hostname.toLowerCase())) {
    return `FORMA_LOCAL_URL names ${JSON.stringify(url.hostname.slice(0, 120))}, which is not this computer. A model on your own computer is reached at localhost, 127.0.0.1 or [::1] (any port), so that nothing leaves it; this server refuses any other address.`;
  }
  return null;
}

/**
 * A value that is only a reference to a variable, as a host passes one on
 * when the variable is not set where it started (Claude Code's documentation:
 * it "uses the unexpanded ${VAR} text as-is"): `${NAME}`, `${env:NAME}`,
 * `$NAME` or `%NAME%`. Exported for its tests.
 */
export const UNEXPANDED = /^(?:\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;

/**
 * Each value as the entry copied it, trimmed, and an unexpanded reference
 * taken as not set and said so (the wave-8 review's D2): sent on as it was,
 * `${FORMA_GEMINI_KEY}` passed the gate as a key, went to Google, and came
 * back as an invalid key with the cause redacted from the error.
 */
function valuesOf(env: AiEnv, problems: string[]): Record<AiEnvName, string> {
  const values = {} as Record<AiEnvName, string>;
  for (const name of AI_ENV_NAMES) {
    const raw = (env[name] ?? '').trim();
    if (UNEXPANDED.test(raw)) {
      problems.push(`${name} arrived as ${raw}, a reference your assistant did not expand, so it is not set: set the variable it names in your user environment, then restart your assistant so that it starts this server again.`);
      values[name] = '';
    } else values[name] = raw;
  }
  return values;
}

/** The settings the AI tools are made with, from the values the entry copied (the header). */
export function readAiSettings(env: AiEnv): AiSettings {
  const problems: string[] = [];
  const v = valuesOf(env, problems);
  const geminiKey = v.FORMA_GEMINI_KEY;
  const openRouterKey = v.FORMA_OPENROUTER_KEY;
  const openRouterModel = v.FORMA_OPENROUTER_MODEL;
  const localModel = v.FORMA_LOCAL_MODEL;
  const localUrlGiven = v.FORMA_LOCAL_URL;
  const localUrl = localUrlGiven || DEFAULT_LOCAL_URL;
  if (localUrlGiven) {
    const wrong = localUrlProblem(localUrlGiven);
    if (wrong) problems.push(wrong);
  }
  const base: ReportConfig = { version: '', unit: '', pageSize: '', customApiKey: geminiKey, openRouterKey, openRouterModel, localUrl, localModel };
  const setUp = (['gemini', 'openrouter', 'local'] as const).filter((p) => aiReady({ ...base, provider: p === 'gemini' ? 'auto' : p }));

  const asked = v.FORMA_PROVIDER.toLowerCase();
  let provider: EffectiveProvider;
  if (asked) {
    const named = PROVIDER_WORDS[asked];
    // The value is never echoed (W8C-4): a key put under this name by mistake would be repeated back, lower case and so past the key patterns.
    if (!named) problems.push('FORMA_PROVIDER is not one of gemini, openrouter or local.');
    provider = named ?? 'gemini';
  } else if (setUp.length > 1) {
    provider = setUp[0];
    problems.push(`More than one AI is set up (${setUp.map((p) => PROVIDER_NAMES[p]).join(', ')}); set FORMA_PROVIDER to the one that designs: ${setUp.join(', ')}. The others answer only when it reaches its limit, and never after Local AI.`);
  } else provider = setUp[0] ?? 'gemini';

  const config: ReportConfig = { ...base, provider: provider === 'gemini' ? 'auto' : provider };
  if (!problems.length && !aiReady(config)) {
    if (provider === 'openrouter') problems.push(`FORMA_PROVIDER chooses OpenRouter, which needs ${[!openRouterKey && 'FORMA_OPENROUTER_KEY', !openRouterModel && 'FORMA_OPENROUTER_MODEL'].filter(Boolean).join(' and ')}.`);
    else if (provider === 'local') problems.push('FORMA_PROVIDER chooses Local AI, which needs FORMA_LOCAL_MODEL, the model your server answers with.');
    else if (asked) problems.push('FORMA_PROVIDER chooses Gemini, which needs FORMA_GEMINI_KEY.');
    else problems.push('No AI is set up for this server.');
  }
  const model = v.FORMA_MODEL;
  const locale = v.FORMA_LOCALE;
  const mock = /^(1|true|yes)$/i.test(v.FORMA_MCP_MOCK);
  return {
    config,
    provider: effectiveProvider(config),
    ready: problems.length === 0,
    problems,
    mock,
    ...(model ? { model } : {}),
    ...(locale ? { locale } : {}),
    secrets: AI_KEY_NAMES.map((name) => v[name]).filter(Boolean),
  };
}

/** How to set an AI up for this server: the names, for the host's MCP configuration. */
export const HOW_TO_SET_UP = [
  "Here, Settings are the environment of this server's entry in your assistant's MCP configuration (its env block), and the server reads them when it starts:",
  'FORMA_GEMINI_KEY for Gemini;',
  'FORMA_OPENROUTER_KEY and FORMA_OPENROUTER_MODEL for OpenRouter;',
  `FORMA_LOCAL_MODEL, with FORMA_LOCAL_URL when your server is not at ${DEFAULT_LOCAL_URL}, for a model on your own computer (Ollama or LM Studio);`,
  'and FORMA_PROVIDER (gemini, openrouter or local) when more than one is set.',
  "Set a key through your assistant's own way of passing a value from your environment rather than writing it into a configuration file you share or commit, then restart the server.",
].join(' ');

/** What an AI tool says when the AI chosen is not ready (PROTO-8): the app's words, why, and what to set. */
export function notReadyMessage(settings: Pick<AiSettings, 'problems'>): string {
  return [SET_UP_AI, ...settings.problems, HOW_TO_SET_UP].join(' ');
}
