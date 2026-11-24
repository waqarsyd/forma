/**
 * Which AI the MCP server's AI tools ask (2026-11-24, the MCP work's wave 8;
 * NODE-12, SEC-9, SEC-11, PROTO-8 and the owner's OD6): the settings built
 * from the values the entry copies out of its environment, the gate the web
 * app's (`aiReady`), the free chain over them as the app has it, a Local AI
 * address held to this computer, and the refusal that names what to set.
 * Keys are built at run time (TST-10).
 */
import { describe, expect, it } from 'vitest';
import { SET_UP_AI } from '../lib/aiProvider';
import { fallbacksFor } from '../lib/fallbackChain';
import { AI_ENV_NAMES, HOW_TO_SET_UP, localUrlProblem, notReadyMessage, readAiSettings } from './aiSettings';

const geminiKey = ['AI', 'za', 'Sy'].join('') + 'C'.repeat(33);
const openRouterKey = ['sk', 'or', 'v1'].join('-') + '-' + 'cd34'.repeat(16);

describe('readAiSettings', () => {
  it('refuses with nothing set up, naming every variable to set, and holds no key', () => {
    const s = readAiSettings({});
    expect(s.ready).toBe(false);
    expect(s.secrets).toEqual([]);
    const said = notReadyMessage(s);
    expect(said.startsWith(SET_UP_AI)).toBe(true);
    for (const name of ['FORMA_GEMINI_KEY', 'FORMA_OPENROUTER_KEY', 'FORMA_OPENROUTER_MODEL', 'FORMA_LOCAL_MODEL', 'FORMA_LOCAL_URL', 'FORMA_PROVIDER']) expect(said, name).toContain(name);
    expect(said).toContain(HOW_TO_SET_UP);
    expect(said.length).toBeLessThan(2000);
    expect(said).toMatch(/^[\x20-\x7e]+$/);
  });

  it('opens on any one AI of the person\'s own, as the workspace does, and chooses the one set up', () => {
    const gemini = readAiSettings({ FORMA_GEMINI_KEY: ` ${geminiKey} ` });
    expect(gemini).toMatchObject({ ready: true, provider: 'gemini', secrets: [geminiKey], problems: [] });
    expect(gemini.config).toMatchObject({ provider: 'auto', customApiKey: geminiKey });

    const openrouter = readAiSettings({ FORMA_OPENROUTER_KEY: openRouterKey, FORMA_OPENROUTER_MODEL: 'meta/llama:free' });
    expect(openrouter).toMatchObject({ ready: true, provider: 'openrouter', secrets: [openRouterKey] });
    expect(openrouter.config).toMatchObject({ provider: 'openrouter', openRouterKey, openRouterModel: 'meta/llama:free', customApiKey: '' });

    const local = readAiSettings({ FORMA_LOCAL_MODEL: 'qwen3.5:9b' });
    expect(local).toMatchObject({ ready: true, provider: 'local', secrets: [] });
    expect(local.config).toMatchObject({ provider: 'local', localModel: 'qwen3.5:9b', localUrl: 'http://localhost:11434/v1' });
  });

  it('guesses nothing when more than one AI is set up and none is chosen, since a guess could send a report off the computer', () => {
    const s = readAiSettings({ FORMA_GEMINI_KEY: geminiKey, FORMA_LOCAL_MODEL: 'qwen3.5:9b' });
    expect(s.ready).toBe(false);
    expect(s.problems.join(' ')).toMatch(/More than one AI is set up \(Gemini, Local AI\); set FORMA_PROVIDER/);
    // Both keys are still taken out of anything the server prints.
    expect(s.secrets).toEqual([geminiKey]);
  });

  it('keeps the free chain the app has: the next AI set up answers on a limit, and never after Local AI', () => {
    const fromGemini = readAiSettings({ FORMA_PROVIDER: 'gemini', FORMA_GEMINI_KEY: geminiKey, FORMA_OPENROUTER_KEY: openRouterKey, FORMA_OPENROUTER_MODEL: 'm', FORMA_LOCAL_MODEL: 'q' });
    expect(fromGemini.ready).toBe(true);
    expect(fallbacksFor(fromGemini.config)).toEqual(['openrouter', 'local']);
    const fromLocal = readAiSettings({ FORMA_PROVIDER: 'local', FORMA_GEMINI_KEY: geminiKey, FORMA_LOCAL_MODEL: 'q' });
    expect(fromLocal).toMatchObject({ ready: true, provider: 'local' });
    expect(fallbacksFor(fromLocal.config)).toEqual([]);
  });

  it('names what the AI chosen still needs', () => {
    expect(readAiSettings({ FORMA_PROVIDER: 'openrouter', FORMA_OPENROUTER_KEY: openRouterKey }).problems).toEqual(['FORMA_PROVIDER chooses OpenRouter, which needs FORMA_OPENROUTER_MODEL.']);
    expect(readAiSettings({ FORMA_PROVIDER: 'local' }).problems).toEqual(['FORMA_PROVIDER chooses Local AI, which needs FORMA_LOCAL_MODEL, the model your server answers with.']);
    expect(readAiSettings({ FORMA_PROVIDER: 'gemini' }).problems).toEqual(['FORMA_PROVIDER chooses Gemini, which needs FORMA_GEMINI_KEY.']);
    expect(readAiSettings({ FORMA_PROVIDER: 'claude', FORMA_GEMINI_KEY: geminiKey }).problems).toEqual(['FORMA_PROVIDER is not one of gemini, openrouter or local.']);
  });

  it('never repeats a value it refuses, so a key put under the wrong name is not said back (W8C-4)', () => {
    const shapeless = ['tok', 'en'].join('') + '-' + 'q7'.repeat(12);
    for (const env of [{ FORMA_PROVIDER: geminiKey, FORMA_GEMINI_KEY: geminiKey }, { FORMA_LOCAL_URL: shapeless, FORMA_LOCAL_MODEL: 'm' }, { FORMA_LOCAL_URL: geminiKey, FORMA_LOCAL_MODEL: 'm' }]) {
      const said = notReadyMessage(readAiSettings(env));
      expect(said, JSON.stringify(Object.keys(env))).not.toMatch(new RegExp(`${geminiKey.slice(4, 16)}|${shapeless.slice(0, 10)}`, 'i'));
    }
  });

  it('takes a reference a host passed on unexpanded as not set, and says so rather than spend it as a key (D2)', () => {
    for (const ref of ['${FORMA_GEMINI_KEY}', '${env:FORMA_GEMINI_KEY}', '$FORMA_GEMINI_KEY', '%FORMA_GEMINI_KEY%']) {
      const s = readAiSettings({ FORMA_GEMINI_KEY: ref });
      expect(s.ready, ref).toBe(false);
      expect(s.config.customApiKey).toBe('');
      expect(s.secrets).toEqual([]);
      expect(s.problems, ref).toEqual([`FORMA_GEMINI_KEY arrived as ${ref}, a reference your assistant did not expand, so it is not set: set the variable it names in your user environment, then restart your assistant so that it starts this server again.`]);
    }
    // One left unexpanded refuses even beside an AI that is set up: the configuration is not what the user wrote.
    expect(readAiSettings({ FORMA_LOCAL_MODEL: 'q', FORMA_OPENROUTER_KEY: '${FORMA_OPENROUTER_KEY}' }).ready).toBe(false);
    // A value that merely holds a dollar sign is a value.
    expect(readAiSettings({ FORMA_GEMINI_KEY: `${geminiKey}$x` }).ready).toBe(true);
  });

  it('refuses a Local AI address off this computer, and with it every AI tool, whatever else is set', () => {
    const s = readAiSettings({ FORMA_PROVIDER: 'gemini', FORMA_GEMINI_KEY: geminiKey, FORMA_LOCAL_URL: 'http://192.168.1.20:11434/v1', FORMA_LOCAL_MODEL: 'q' });
    expect(s.ready).toBe(false);
    expect(s.problems[0]).toMatch(/^FORMA_LOCAL_URL names "192\.168\.1\.20", which is not this computer\./);
  });

  it('takes the mock switch, the model pin and the locale, and names exactly the variables the entry copies', () => {
    const s = readAiSettings({ FORMA_GEMINI_KEY: geminiKey, FORMA_MCP_MOCK: 'TRUE', FORMA_MODEL: 'gemini-3-flash', FORMA_LOCALE: 'de-DE' });
    expect(s).toMatchObject({ ready: true, mock: true, model: 'gemini-3-flash', locale: 'de-DE' });
    expect(readAiSettings({ FORMA_GEMINI_KEY: geminiKey, FORMA_MCP_MOCK: '0' }).mock).toBe(false);
    expect([...AI_ENV_NAMES].sort()).toEqual(['FORMA_GEMINI_KEY', 'FORMA_LOCALE', 'FORMA_LOCAL_MODEL', 'FORMA_LOCAL_URL', 'FORMA_MCP_MOCK', 'FORMA_MODEL', 'FORMA_OPENROUTER_KEY', 'FORMA_OPENROUTER_MODEL', 'FORMA_PROVIDER']);
  });
});

describe('localUrlProblem', () => {
  it.each(['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1', 'https://LOCALHOST/v1', 'http://localhost'])('admits %s, an address on this computer at any port', (url) => {
    expect(localUrlProblem(url)).toBeNull();
  });

  it.each([
    ['http://192.168.1.20:11434/v1', /not this computer/],
    ['http://ollama.example.com/v1', /not this computer/],
    ['http://localhost.example.com/v1', /not this computer/],
    ['http://127.0.0.2:1234/v1', /not this computer/],
    ['http://0.0.0.0:11434/v1', /not this computer/],
    ['http://user:pw@localhost:1234/v1', /user name or password/],
    ['file:///etc/passwd', /http or https/],
    ['localhost:11434', /http or https|not an address/],
    ['not a url', /not an address/],
  ])('refuses %s', (url, why) => {
    expect(localUrlProblem(url)).toMatch(why);
  });
});
