/**
 * Which AI the MCP server's AI tools ask, from the values set in the server's
 * entry in a host's MCP configuration (2026-11-24, the MCP work's wave 8;
 * findings NODE-12, SEC-9, SEC-11, DOC-4 and PROTO-8 of the 2026-11-23 design
 * audit, and the owner's decision OD6), and since the CLI and Forma Designer
 * work's wave 2 which AI the command line asks, from the environment it runs
 * in (findings CLI-9, CLI-10, SEC-3 and TEST-2 of that work's design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`).
 *
 * An entry (stdio.ts, and since that work's wave 4 the command line's
 * cliEntry.ts) is the only kind of file in src/mcp that touches the
 * environment, which boundaries.test.ts holds. Nothing loads a .env file (no
 * dotenv): a .env in the folder a host starts the server in, or a command
 * runs in, is never Forma's business, and a GEMINI_API_KEY or GOOGLE_API_KEY
 * meant for some other tool is never spent here, which is why the key's name
 * is Forma's own (SEC-9).
 *
 * ## What an entry takes out of its environment, and the one act it does
 *
 * `takeAiEnv` is the whole of the reading, pure and one copy for both
 * entries, so neither can drift from the other (CLI-9: until wave 2 the list
 * of foreign names was a literal in stdio.ts alone). Handed the environment,
 * it reads the names it lists and no other, and gives back three things:
 * the AI's values copied by name (`aiEnv`, for `readAiSettings`, which reads
 * nothing itself, so its tests hand it whatever they like); the keys' values
 * for the scrubber (`secrets`: Forma's two, and GEMINI_API_KEY's and
 * GOOGLE_API_KEY's, which a crash could otherwise print); and the names to
 * delete (`remove`: `FOREIGN_AI_ENV`, the Gemini SDK's own fallbacks, which
 * it would take a key or a Vertex AI endpoint from by itself, DOC-4, and
 * Forma's two key variables, which a worker thread would otherwise copy,
 * since a Worker's environment is the process's by default; each job
 * carries its settings instead). Applying it is the entry's alone, and is
 * two statements, in this order, before its first lazy import of anything
 * that can load the Gemini SDK or start a worker or a child (this file loads
 * neither: boundaries.test.ts walks it, and holds each entry to the order):
 * `secrets` handed to the stdout guard's `addSecrets`, then each name in
 * `remove` deleted from the entry's own environment. The names are this
 * file's alone; an entry deletes nothing else.
 *
 * ## The command line's environment, decided for its wave 4 (CLI-9)
 *
 * - The AI's names are the same `FORMA_*` names, so a person sets an AI up
 *   once for both, and a CI step sets the key from its secrets, in the
 *   step's environment, never in its command (SEC-3).
 * - The mock is a flag, `--mock`, never FORMA_MCP_MOCK: `takeAiEnv(source,
 *   'cli')` does not copy that name, and `readAiSettings` takes the flag as
 *   its `mock` option. A server has no command line, so its switch has to be
 *   a variable in the host's entry; a command has one, and a variable left
 *   set in a CI environment would turn every report the command makes into
 *   the mock invoice with nothing on the command to say so, where a flag is
 *   read on the line that ran it. It still replaces only the AI's answer: an
 *   AI must be set up (OD6), so a test sets a stand-in key.
 * - FORMA_MCP_ROOTS and CLAUDE_PROJECT_DIR are never read: they name the
 *   server's roots, and the command line has none, its paths judged against
 *   the folder it runs in (paths.ts, *The command line's mode*). A command
 *   run from a Claude Code session inherits CLAUDE_PROJECT_DIR, and taking
 *   it would let a variable the person never set decide which files a
 *   command may read.
 * - A child it starts (Forma Designer's verbs, that work's wave 6) is handed
 *   an environment the entry builds after `remove` is applied, so no key
 *   reaches it, and the module that starts it never reads the environment
 *   itself (CLI-9's skeptic: a child inherits whatever is still set).
 *
 * ## Whose words
 *
 * The settings remember the caller they were read for (`voice`, caller.ts):
 * the few phrases that say where the settings go and how to start again
 * name the host's MCP configuration for the server and the environment the
 * command runs in for a person (`WORDS`, CLI-10); every other refusal here
 * says the same to both. The server's words are exactly what they were.
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
 *   tests and a run with no quota to spend; the server's alone (the command
 *   line's is `--mock`, above). It replaces the AI's answer only: an AI must
 *   still be set up (OD6, "there is no mode without an AI"), so a test sets
 *   a stand-in key.
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
 * result, error and log line by value; never a reference nothing expanded,
 * which is no key and which the refusal above must show (the CLI work's
 * wave-4 review, U15: taken as a secret, it was said as "(a key)").
 *
 * Pure ASCII.
 */
import { DEFAULT_LOCAL_URL, PROVIDER_NAMES, SET_UP_AI, aiReady, effectiveProvider, type EffectiveProvider } from '../lib/aiProvider';
import type { ReportConfig } from '../services/geminiService';
import type { Voice } from './caller';

/** The names the server's entry copies out of its environment, in the order a message lists them. */
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

/** The names each caller copies: the command line's mock is its `--mock` flag, never the server's variable (the header). */
const NAMES_OF: Record<Voice, readonly AiEnvName[]> = { mcp: AI_ENV_NAMES, cli: AI_ENV_NAMES.filter((name) => name !== 'FORMA_MCP_MOCK') };

/**
 * Names that are never Forma's, deleted by every entry before anything loads
 * the Gemini SDK, which would take a key or a Vertex AI endpoint from them by
 * itself (SEC-9, DOC-4); listed here once, for both entries (CLI-9).
 */
export const FOREIGN_AI_ENV = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'] as const;

/** The foreign names that hold a key, whose values the scrubber takes out before they are deleted. */
const FOREIGN_KEY_NAMES: readonly (typeof FOREIGN_AI_ENV)[number][] = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];

/** What an entry takes out of its environment (the header): the AI's values, the keys for the scrubber, and the names to delete. */
export interface TakenAiEnv {
  /** The AI's values, copied by name, for `readAiSettings`. */
  aiEnv: AiEnv;
  /** The keys' values as they were set, Forma's and the foreign ones, for the scrubber (`addSecrets`); none blank. */
  secrets: string[];
  /** The names the entry deletes from its environment: the foreign ones, then Forma's two key variables. */
  remove: readonly string[];
}

/**
 * What an entry takes out of `source`, its environment, for the caller it
 * is (the header). Pure: it reads only the names it lists, never the rest of
 * `source`, and changes nothing; the entry applies it.
 */
export function takeAiEnv(source: Readonly<Record<string, string | undefined>>, voice: Voice): TakenAiEnv {
  const aiEnv: AiEnv = {};
  for (const name of NAMES_OF[voice]) aiEnv[name] = source[name];
  // A reference nothing expanded is no key, and the refusal must show it, so the person sees what to set (the wave-4 review's U15).
  const secrets = [...AI_KEY_NAMES, ...FOREIGN_KEY_NAMES]
    .map((name) => source[name])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '' && !UNEXPANDED.test(value.trim()));
  return { aiEnv, secrets, remove: [...FOREIGN_AI_ENV, ...AI_KEY_NAMES] };
}

/** The phrases of this file that a host's model and a person at a command line are told differently (CLI-10, the header). */
const WORDS = {
  mcp: {
    forma: 'this server',
    noAi: 'No AI is set up for this server.',
    unexpanded: (name: string, raw: string) =>
      `${name} arrived as ${raw}, a reference your assistant did not expand, so it is not set: set the variable it names in your user environment, then restart your assistant so that it starts this server again.`,
    howToSetUp: [
      "Here, Settings are the environment of this server's entry in your assistant's MCP configuration (its env block), and the server reads them when it starts:",
      'FORMA_GEMINI_KEY for Gemini;',
      'FORMA_OPENROUTER_KEY and FORMA_OPENROUTER_MODEL for OpenRouter;',
      `FORMA_LOCAL_MODEL, with FORMA_LOCAL_URL when your server is not at ${DEFAULT_LOCAL_URL}, for a model on your own computer (Ollama or LM Studio);`,
      'and FORMA_PROVIDER (gemini, openrouter or local) when more than one is set.',
      "Set a key through your assistant's own way of passing a value from your environment rather than writing it into a configuration file you share or commit, then restart the server.",
    ].join(' '),
  },
  cli: {
    forma: 'Forma',
    noAi: 'No AI is set up.',
    unexpanded: (name: string, raw: string) =>
      `${name} arrived as ${raw}, a reference nothing expanded, so it is not set: set the variable it names in the environment the command runs in, then run the command again.`,
    howToSetUp: [
      'Here, Settings are the environment the command runs in, which Forma reads when it starts:',
      'FORMA_GEMINI_KEY for Gemini;',
      'FORMA_OPENROUTER_KEY and FORMA_OPENROUTER_MODEL for OpenRouter;',
      `FORMA_LOCAL_MODEL, with FORMA_LOCAL_URL when your server is not at ${DEFAULT_LOCAL_URL}, for a model on your own computer (Ollama or LM Studio);`,
      'and FORMA_PROVIDER (gemini, openrouter or local) when more than one is set.',
      "Set a key in your user environment rather than typing it into a command your shell's history keeps, or in CI from the CI's own secrets into the step's environment, never into a file you commit; then run the command again.",
    ].join(' '),
  },
} as const satisfies Record<Voice, Record<string, unknown>>;

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
  /** The caller these were read for, whose words `problems` are in, and so `notReadyMessage`'s. */
  voice: Voice;
}

/** How a caller reads the settings: whose words, and, for the command line, its `--mock` flag (the header). */
export interface ReadOptions {
  /** The server's by default. */
  voice?: Voice;
  /** The mock invoice instead of the AI's answer; FORMA_MCP_MOCK when left out, which the command line never copies. */
  mock?: boolean;
}

const PROVIDER_WORDS: Record<string, EffectiveProvider> = { gemini: 'gemini', auto: 'gemini', openrouter: 'openrouter', local: 'local' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why a Local AI address is refused, or null when it is this computer's
 * (the header), in the caller's words. Exported for its tests.
 */
export function localUrlProblem(raw: string, voice: Voice = 'mcp'): string | null {
  const { forma } = WORDS[voice];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Never echoed (the wave-8 review's W8C-4): a key pasted here by mistake would be repeated back.
    return `FORMA_LOCAL_URL is not an address; give the server's full address, such as ${DEFAULT_LOCAL_URL}.`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `FORMA_LOCAL_URL must be an http or https address on this computer, such as ${DEFAULT_LOCAL_URL}.`;
  if (url.username || url.password) return `FORMA_LOCAL_URL holds a user name or password, which ${forma} never sends; give the address alone.`;
  if (!LOOPBACK.has(url.hostname.toLowerCase())) {
    return `FORMA_LOCAL_URL names ${JSON.stringify(url.hostname.slice(0, 120))}, which is not this computer. A model on your own computer is reached at localhost, 127.0.0.1 or [::1] (any port), so that nothing leaves it; ${forma} refuses any other address.`;
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
function valuesOf(env: AiEnv, problems: string[], voice: Voice): Record<AiEnvName, string> {
  const values = {} as Record<AiEnvName, string>;
  for (const name of AI_ENV_NAMES) {
    // A name this caller does not copy is never read, whatever `env` holds: the command line's mock is its flag (the header).
    const raw = NAMES_OF[voice].includes(name) ? (env[name] ?? '').trim() : '';
    if (UNEXPANDED.test(raw)) {
      problems.push(WORDS[voice].unexpanded(name, raw));
      values[name] = '';
    } else values[name] = raw;
  }
  return values;
}

/**
 * An AI half set up, named, when none is ready (the CLI work's wave-4
 * review, U15): an OpenRouter key with no model, or a model with no key, and
 * a Local AI address with no model, each saying what it still needs, where
 * "No AI is set up" alone hid the one name left to set. Never a value.
 */
function halfSetUp(v: Record<AiEnvName, string>): string[] {
  const said: string[] = [];
  if (v.FORMA_OPENROUTER_KEY && !v.FORMA_OPENROUTER_MODEL) said.push('FORMA_OPENROUTER_KEY is set; OpenRouter also needs FORMA_OPENROUTER_MODEL, the model it answers with.');
  if (v.FORMA_OPENROUTER_MODEL && !v.FORMA_OPENROUTER_KEY) said.push('FORMA_OPENROUTER_MODEL is set; OpenRouter also needs FORMA_OPENROUTER_KEY.');
  if (v.FORMA_LOCAL_URL && !v.FORMA_LOCAL_MODEL) said.push('FORMA_LOCAL_URL is set; Local AI also needs FORMA_LOCAL_MODEL, the model your server answers with.');
  return said;
}

/** The settings the AI tools, or the command line, are made with, from the values the entry copied (the header). */
export function readAiSettings(env: AiEnv, options: ReadOptions = {}): AiSettings {
  const voice = options.voice ?? 'mcp';
  const problems: string[] = [];
  const v = valuesOf(env, problems, voice);
  const geminiKey = v.FORMA_GEMINI_KEY;
  const openRouterKey = v.FORMA_OPENROUTER_KEY;
  const openRouterModel = v.FORMA_OPENROUTER_MODEL;
  const localModel = v.FORMA_LOCAL_MODEL;
  const localUrlGiven = v.FORMA_LOCAL_URL;
  const localUrl = localUrlGiven || DEFAULT_LOCAL_URL;
  if (localUrlGiven) {
    const wrong = localUrlProblem(localUrlGiven, voice);
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
    else problems.push(WORDS[voice].noAi, ...halfSetUp(v));
  }
  const model = v.FORMA_MODEL;
  const locale = v.FORMA_LOCALE;
  const mock = options.mock ?? /^(1|true|yes)$/i.test(v.FORMA_MCP_MOCK);
  return {
    config,
    provider: effectiveProvider(config),
    ready: problems.length === 0,
    problems,
    mock,
    ...(model ? { model } : {}),
    ...(locale ? { locale } : {}),
    secrets: AI_KEY_NAMES.map((name) => v[name]).filter(Boolean),
    voice,
  };
}

/** How to set an AI up for this server: the names, for the host's MCP configuration. */
export const HOW_TO_SET_UP = WORDS.mcp.howToSetUp;

/** How to set an AI up, in the caller's words: the names, and where they go. */
export const howToSetUp = (voice: Voice): string => WORDS[voice].howToSetUp;

/** What an AI tool, or a command, says when the AI chosen is not ready (PROTO-8): the app's words, why, and what to set, in the words the settings were read in. */
export function notReadyMessage(settings: Pick<AiSettings, 'problems'> & { voice?: Voice }): string {
  return [SET_UP_AI, ...settings.problems, howToSetUp(settings.voice ?? 'mcp')].join(' ');
}
