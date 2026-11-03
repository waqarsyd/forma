// @vitest-environment jsdom
/**
 * Which AI answers (milestone 3 of docs/proposals/own-model.md). jsdom for
 * localStorage and sessionStorage; this must stay line 1.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { aiReady, DEFAULT_LOCAL_URL, effectiveProvider, isVisionOnly, readProviderSettings, visionModelOf, writeProviderSettings } from './aiProvider';
import type { ReportConfig } from '../services/geminiService';

const base: ReportConfig = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('which provider answers', () => {
  it('resolves Automatic to Gemini with a key and Forma Offline without', () => {
    expect(effectiveProvider({ customApiKey: 'AIza' })).toBe('gemini');
    expect(effectiveProvider({ customApiKey: ' ' })).toBe('offline');
    expect(effectiveProvider({ provider: 'offline', customApiKey: 'AIza' })).toBe('offline');
  });

  it('is ready only with what the provider needs', () => {
    expect(aiReady({ ...base, customApiKey: 'AIza' })).toBe(true);
    expect(aiReady({ ...base, provider: 'offline', customApiKey: 'AIza' })).toBe(false);
    expect(aiReady({ ...base, provider: 'gemini' })).toBe(false);
    expect(aiReady({ ...base, provider: 'local', localUrl: DEFAULT_LOCAL_URL })).toBe(false);
    expect(aiReady({ ...base, provider: 'local', localUrl: DEFAULT_LOCAL_URL, localModel: 'gemma3' })).toBe(true);
    expect(aiReady({ ...base, provider: 'openrouter', openRouterModel: 'x:free' })).toBe(false);
    expect(aiReady({ ...base, provider: 'openrouter', openRouterModel: 'x:free', openRouterKey: 'k' })).toBe(true);
  });

  it("finds Forma's vision model as a helper beside any AI, or as the Local AI model itself", () => {
    expect(visionModelOf({ ...base, provider: 'gemini' })).toBeNull();
    expect(visionModelOf({ ...base, provider: 'gemini', visionModel: ' forma-vision ' })).toEqual({ baseUrl: DEFAULT_LOCAL_URL, model: 'forma-vision' });
    expect(visionModelOf({ ...base, provider: 'local', localUrl: 'http://localhost:1234/v1', localModel: 'gemma3', visionModel: 'forma-vision:q8' })).toEqual({
      baseUrl: 'http://localhost:1234/v1',
      model: 'forma-vision:q8',
    });
    expect(visionModelOf({ ...base, provider: 'local', localModel: 'forma-vision' })).toEqual({ baseUrl: DEFAULT_LOCAL_URL, model: 'forma-vision' });
    // Alone only when the AI that designs is the vision model; a helper beside another AI is not.
    expect(isVisionOnly({ provider: 'local', localModel: 'forma-vision' })).toBe(true);
    expect(isVisionOnly({ provider: 'local', localModel: 'gemma3' })).toBe(false);
    expect(isVisionOnly({ provider: 'gemini', localModel: 'forma-vision' })).toBe(false);
  });
});

describe('the kept settings', () => {
  it('defaults to Automatic and Ollama’s address', () => {
    expect(readProviderSettings()).toEqual({ provider: 'auto', localUrl: DEFAULT_LOCAL_URL, localModel: '', openRouterModel: '', openRouterKey: '', visionModel: '' });
  });

  it('keeps the choice in localStorage and the OpenRouter key only in this tab', () => {
    writeProviderSettings({ provider: 'openrouter', localUrl: 'http://localhost:1234/v1', localModel: 'm', openRouterModel: 'x:free', openRouterKey: 'sk-or-secret', visionModel: 'forma-vision' });
    expect(localStorage.getItem('forma.aiProvider')).not.toContain('sk-or-secret');
    expect(sessionStorage.getItem('openRouterKey:session')).toBe('sk-or-secret');
    expect(readProviderSettings()).toEqual({ provider: 'openrouter', localUrl: 'http://localhost:1234/v1', localModel: 'm', openRouterModel: 'x:free', openRouterKey: 'sk-or-secret', visionModel: 'forma-vision' });
    writeProviderSettings({ provider: 'auto' });
    expect(sessionStorage.getItem('openRouterKey:session')).toBeNull();
  });

  it('ignores a provider it does not know', () => {
    localStorage.setItem('forma.aiProvider', JSON.stringify({ provider: 'skynet' }));
    expect(readProviderSettings().provider).toBe('auto');
  });
});
