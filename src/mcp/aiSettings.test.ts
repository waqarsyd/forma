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
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { AI_ENV_NAMES, FOREIGN_AI_ENV, HOW_TO_SET_UP, howToSetUp, localUrlProblem, notReadyMessage, readAiSettings, takeAiEnv } from './aiSettings';

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

  it('names the half of an AI set up that is missing when none is ready, in both voices, never a value (the CLI work\'s wave-4 review, U15)', () => {
    for (const voice of ['mcp', 'cli'] as const) {
      const noAi = voice === 'mcp' ? 'No AI is set up for this server.' : 'No AI is set up.';
      expect(readAiSettings({ FORMA_OPENROUTER_KEY: openRouterKey }, { voice }).problems).toEqual([noAi, 'FORMA_OPENROUTER_KEY is set; OpenRouter also needs FORMA_OPENROUTER_MODEL, the model it answers with.']);
      expect(readAiSettings({ FORMA_OPENROUTER_MODEL: 'm:free' }, { voice }).problems).toEqual([noAi, 'FORMA_OPENROUTER_MODEL is set; OpenRouter also needs FORMA_OPENROUTER_KEY.']);
      expect(readAiSettings({ FORMA_LOCAL_URL: 'http://127.0.0.1:1234/v1' }, { voice }).problems).toEqual([noAi, 'FORMA_LOCAL_URL is set; Local AI also needs FORMA_LOCAL_MODEL, the model your server answers with.']);
      expect(notReadyMessage(readAiSettings({ FORMA_OPENROUTER_KEY: openRouterKey }, { voice }))).not.toContain(openRouterKey.slice(0, 12));
    }
    // A working AI beside a half-set one is ready: the other half only answers on a limit.
    expect(readAiSettings({ FORMA_GEMINI_KEY: geminiKey, FORMA_OPENROUTER_KEY: openRouterKey }).ready).toBe(true);
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

describe('takeAiEnv, what an entry takes out of its environment (CLI-9, TEST-2)', () => {
  const newer = ['A', 'Q.'].join('') + 'n'.repeat(40);
  const full = {
    FORMA_GEMINI_KEY: ` ${geminiKey} `,
    FORMA_OPENROUTER_KEY: openRouterKey,
    FORMA_OPENROUTER_MODEL: 'm',
    FORMA_PROVIDER: 'gemini',
    FORMA_MCP_MOCK: '1',
    GEMINI_API_KEY: newer,
    GOOGLE_API_KEY: '',
    GOOGLE_GENAI_USE_VERTEXAI: 'true',
    FORMA_MCP_ROOTS: '/home/me/reports',
    CLAUDE_PROJECT_DIR: '/home/me/project',
    PATH: '/usr/bin',
  };

  it('reads only the names it lists, never the rest of the environment, and changes nothing', () => {
    for (const voice of ['mcp', 'cli'] as const) {
      const read: string[] = [];
      const source = new Proxy({ ...full }, {
        get: (target, name) => {
          read.push(String(name));
          return Reflect.get(target, name);
        },
        ownKeys: () => {
          throw new Error('takeAiEnv must not walk the environment');
        },
        set: () => {
          throw new Error('takeAiEnv must not write to the environment');
        },
        deleteProperty: () => {
          throw new Error('takeAiEnv must not delete from the environment; the entry does');
        },
      });
      takeAiEnv(source, voice);
      expect([...new Set(read)].sort(), voice).toEqual([...new Set([...AI_ENV_NAMES.filter((n) => voice === 'mcp' || n !== 'FORMA_MCP_MOCK'), 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])].sort());
      expect(read, voice).not.toContain('FORMA_MCP_ROOTS');
      expect(read, voice).not.toContain('CLAUDE_PROJECT_DIR');
    }
  });

  it("gives the AI's values by name, every key for the scrubber, and the names to delete: the Gemini SDK's own fallbacks, then Forma's two key variables", () => {
    const taken = takeAiEnv(full, 'mcp');
    expect(taken.aiEnv).toEqual({
      FORMA_PROVIDER: 'gemini',
      FORMA_GEMINI_KEY: ` ${geminiKey} `,
      FORMA_OPENROUTER_KEY: openRouterKey,
      FORMA_OPENROUTER_MODEL: 'm',
      FORMA_LOCAL_URL: undefined,
      FORMA_LOCAL_MODEL: undefined,
      FORMA_MODEL: undefined,
      FORMA_LOCALE: undefined,
      FORMA_MCP_MOCK: '1',
    });
    // As they were set: the scrubber trims them itself. A blank one is none.
    expect(taken.secrets).toEqual([` ${geminiKey} `, openRouterKey, newer]);
    expect(taken.remove).toEqual([...FOREIGN_AI_ENV, 'FORMA_GEMINI_KEY', 'FORMA_OPENROUTER_KEY']);
    expect([...FOREIGN_AI_ENV]).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION']);
    expect(takeAiEnv({}, 'mcp')).toEqual({ aiEnv: expect.any(Object), secrets: [], remove: taken.remove });
  });

  it('hands the scrubber no reference nothing expanded, which is no key, so the refusal shows what to set (the CLI work\'s wave-4 review, U15)', () => {
    for (const voice of ['mcp', 'cli'] as const) {
      const taken = takeAiEnv({ FORMA_GEMINI_KEY: '${GEMINI_KEY}', FORMA_OPENROUTER_KEY: '%OPENROUTER%', GEMINI_API_KEY: newer }, voice);
      expect(taken.secrets, voice).toEqual([newer]);
      const said = notReadyMessage(readAiSettings(taken.aiEnv, { voice }));
      expect(redactorFor(taken.secrets, FORMA_KEYS)(said), voice).toContain('FORMA_GEMINI_KEY arrived as ${GEMINI_KEY}, a reference');
    }
  });

  it("leaves the server's mock switch out for the command line, whose mock is its --mock flag, and takes and deletes the rest alike", () => {
    const cli = takeAiEnv(full, 'cli');
    expect(Object.keys(cli.aiEnv)).not.toContain('FORMA_MCP_MOCK');
    expect(cli.secrets).toEqual(takeAiEnv(full, 'mcp').secrets);
    expect(cli.remove).toEqual(takeAiEnv(full, 'mcp').remove);
    // A FORMA_MCP_MOCK the command line is handed anyway is never read: the flag alone turns the mock on.
    expect(readAiSettings({ ...cli.aiEnv, FORMA_MCP_MOCK: '1' }, { voice: 'cli' }).mock).toBe(false);
    expect(readAiSettings(cli.aiEnv, { voice: 'cli', mock: true })).toMatchObject({ ready: true, mock: true, voice: 'cli' });
    // The server's reading is what it was.
    expect(readAiSettings(takeAiEnv(full, 'mcp').aiEnv)).toMatchObject({ ready: true, mock: true, voice: 'mcp' });
  });
});

describe("the command line's words (CLI-10)", () => {
  it('says where the settings go and how to start again in its own words, and the same names to set', () => {
    const said = notReadyMessage(readAiSettings({}, { voice: 'cli' }));
    expect(said.startsWith(SET_UP_AI)).toBe(true);
    expect(said).toContain('No AI is set up.');
    expect(said).toContain(howToSetUp('cli'));
    expect(said).toContain('the environment the command runs in');
    for (const name of ['FORMA_GEMINI_KEY', 'FORMA_OPENROUTER_KEY', 'FORMA_OPENROUTER_MODEL', 'FORMA_LOCAL_MODEL', 'FORMA_LOCAL_URL', 'FORMA_PROVIDER']) expect(said, name).toContain(name);
    expect(said).toMatch(/^[\x20-\x7e]+$/);
    // The server's message is the server's, word for word.
    expect(notReadyMessage(readAiSettings({}))).toBe([SET_UP_AI, 'No AI is set up for this server.', HOW_TO_SET_UP].join(' '));
    expect(howToSetUp('mcp')).toBe(HOW_TO_SET_UP);
  });

  it('says a reference was left unexpanded, and a Local AI address refused, without the server, the assistant or a restart of either', () => {
    expect(readAiSettings({ FORMA_GEMINI_KEY: '%FORMA_GEMINI_KEY%' }, { voice: 'cli' }).problems).toEqual([
      'FORMA_GEMINI_KEY arrived as %FORMA_GEMINI_KEY%, a reference nothing expanded, so it is not set: set the variable it names in the environment the command runs in, then run the command again.',
    ]);
    expect(localUrlProblem('http://user:pw@localhost:1234/v1', 'cli')).toBe('FORMA_LOCAL_URL holds a user name or password, which Forma never sends; give the address alone.');
    expect(localUrlProblem('http://192.168.1.20:11434/v1', 'cli')).toMatch(/; Forma refuses any other address\.$/);
    expect(readAiSettings({ FORMA_LOCAL_URL: 'http://192.168.1.20:11434/v1', FORMA_LOCAL_MODEL: 'q' }, { voice: 'cli' }).problems[0]).toMatch(/; Forma refuses any other address\.$/);
    expect(localUrlProblem('http://192.168.1.20:11434/v1')).toMatch(/; this server refuses any other address\.$/);
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
