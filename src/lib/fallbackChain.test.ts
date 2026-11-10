/**
 * The free chain across providers on a limit (2026-11-10, the AI accuracy
 * programme, batch AF, item 20).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiLabel, askWithChain, configFor, fallbacksFor, isLimit, readyFor, switchNote } from './fallbackChain';
import type { ReportConfig } from '../services/geminiService';

const base: ReportConfig = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4', customApiKey: 'k' };
const router = { openRouterKey: 'sk-or', openRouterModel: 'google/gemma-4-31b-it:free' };
const local = { localUrl: 'http://localhost:11434/v1', localModel: 'qwen3.5:9b' };

describe('what counts as a limit', () => {
  it('takes a 429 and a spent allowance, on the error or on its cause', () => {
    expect(isLimit(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isLimit(new Error('RESOURCE_EXHAUSTED: quota'))).toBe(true);
    expect(isLimit(new Error('OpenRouter refused the request for its rate limit.'))).toBe(true);
    // The service's classified error carries the provider's own as its cause.
    expect(isLimit(Object.assign(new Error('This key is used up.'), { cause: { status: 429 } }))).toBe(true);
  });

  it('leaves everything else to the person to see', () => {
    expect(isLimit(new Error('That Gemini API key is not valid.'))).toBe(false);
    expect(isLimit(Object.assign(new Error('OpenRouter rejected the key.'), { status: 401 }))).toBe(false);
    expect(isLimit(Object.assign(new Error('Busy'), { status: 503 }))).toBe(false);
    expect(isLimit(null)).toBe(false);
  });
});

describe('who is asked next', () => {
  it('asks OpenRouter, then Local AI, after Gemini, each only when it is set up', () => {
    expect(fallbacksFor(base)).toEqual([]);
    expect(fallbacksFor({ ...base, ...router })).toEqual(['openrouter']);
    expect(fallbacksFor({ ...base, ...router, ...local })).toEqual(['openrouter', 'local']);
    expect(fallbacksFor({ ...base, ...router, openRouterKey: '' })).toEqual([]);
  });

  it('asks Gemini after OpenRouter, with the key that opens the workspace', () => {
    expect(fallbacksFor({ ...base, ...router, ...local, provider: 'openrouter' })).toEqual(['gemini', 'local']);
  });

  it('never sends a request to Local AI on to another provider', () => {
    expect(fallbacksFor({ ...base, ...router, ...local, provider: 'local' })).toEqual([]);
  });

  it('reads whether each provider is set up as the settings do', () => {
    expect(readyFor('gemini', { ...base, customApiKey: ' ' })).toBe(false);
    expect(readyFor('local', { ...base, localUrl: 'http://x/v1' })).toBe(false);
    expect(readyFor('local', { ...base, ...local })).toBe(true);
  });
});

describe('asking down the chain', () => {
  const limit = () => Object.assign(new Error('quota'), { status: 429 });
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  afterEach(() => vi.restoreAllMocks());

  it('answers with the AI chosen, and says nothing, when it answers', async () => {
    const answered = await askWithChain({ ...base, ...router }, async (c) => c.provider ?? 'auto');
    expect(answered).toEqual({ value: 'auto', config: { ...base, ...router }, by: 'gemini', note: '' });
  });

  it('asks the next AI set up on a limit, and says which answered', async () => {
    quiet();
    const asked: string[] = [];
    const answered = await askWithChain({ ...base, ...router, ...local }, async (c) => {
      asked.push(c.provider ?? 'auto');
      if (c.provider !== 'local') throw limit();
      return 'designed';
    });
    expect(asked).toEqual(['auto', 'openrouter', 'local']);
    expect(answered.value).toBe('designed');
    expect(answered.by).toBe('local');
    expect(answered.config.provider).toBe('local');
    expect(answered.note).toBe('Gemini had reached its limit, so Local AI (qwen3.5:9b) answered instead.');
  });

  it('throws anything but a limit as it was, asking no one else', async () => {
    const wrongKey = new Error('That Gemini API key is not valid.');
    const ask = vi.fn(async () => {
      throw wrongKey;
    });
    await expect(askWithChain({ ...base, ...router }, ask)).rejects.toBe(wrongKey);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('throws the last AI’s error when none answers, for Forma’s draft to stand in', async () => {
    quiet();
    const last = new Error('OpenRouter is busy');
    await expect(
      askWithChain({ ...base, ...router }, async (c) => {
        throw c.provider === 'openrouter' ? last : limit();
      }),
    ).rejects.toBe(last);
  });

  it('stops at once when the person stops', async () => {
    const stop = new AbortController();
    stop.abort();
    const ask = vi.fn(async () => {
      throw limit();
    });
    await expect(askWithChain({ ...base, ...router }, ask, stop.signal)).rejects.toMatchObject({ status: 429 });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('the switch, as the reply says it', () => {
  it('asks the next AI with the config it needs, Automatic for Gemini', () => {
    expect(configFor({ ...base, provider: 'openrouter' }, 'gemini').provider).toBe('auto');
    expect(configFor(base, 'local').provider).toBe('local');
  });

  it('names both AIs, with their models short', () => {
    const config = { ...base, ...router, ...local };
    expect(aiLabel('openrouter', config)).toBe('OpenRouter (gemma-4-31b-it)');
    expect(aiLabel('local', config)).toBe('Local AI (qwen3.5:9b)');
    expect(aiLabel('gemini', config)).toBe('Gemini');
    expect(switchNote('gemini', 'openrouter', config)).toBe('Gemini had reached its limit, so OpenRouter (gemma-4-31b-it) answered instead.');
  });
});
