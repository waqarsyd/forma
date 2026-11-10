// @vitest-environment jsdom
/**
 * Which AI answers (milestone 3 of docs/proposals/own-model.md). jsdom for
 * localStorage and sessionStorage; this must stay line 1.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { aiReady, answeringModel, DEFAULT_LOCAL_URL, effectiveProvider, isVisionOnly, pageReaderOf, readProviderSettings, visionModelOf, workspaceOpen, writeProviderSettings } from './aiProvider';
import type { ReportConfig } from '../services/geminiService';

const base: ReportConfig = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'A4' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('which provider answers', () => {
  it('resolves Automatic to Gemini, key or no key, since Forma Offline went into it (2026-11-05)', () => {
    expect(effectiveProvider({})).toBe('gemini');
    expect(effectiveProvider({ provider: 'auto' })).toBe('gemini');
    expect(effectiveProvider({ provider: 'local' })).toBe('local');
  });

  it('is ready only with what the provider needs, and never with no key or server at all', () => {
    expect(aiReady({ ...base, customApiKey: 'AIza' })).toBe(true);
    expect(aiReady({ ...base })).toBe(false);
    expect(aiReady({ ...base, customApiKey: '  ' })).toBe(false);
    expect(aiReady({ ...base, provider: 'local', localUrl: DEFAULT_LOCAL_URL })).toBe(false);
    expect(aiReady({ ...base, provider: 'local', localUrl: DEFAULT_LOCAL_URL, localModel: 'gemma3' })).toBe(true);
    expect(aiReady({ ...base, provider: 'openrouter', openRouterModel: 'x:free' })).toBe(false);
    expect(aiReady({ ...base, provider: 'openrouter', openRouterModel: 'x:free', openRouterKey: 'k' })).toBe(true);
  });

  it('opens the workspace only with the Gemini key in, whichever AI is chosen, and that AI ready (2026-11-05)', () => {
    const local = { ...base, provider: 'local' as const, localUrl: DEFAULT_LOCAL_URL, localModel: 'gemma3' };
    const openRouter = { ...base, provider: 'openrouter' as const, openRouterModel: 'x:free', openRouterKey: 'k' };
    expect(workspaceOpen({ ...base, customApiKey: 'AIza' })).toBe(true);
    expect(workspaceOpen(local)).toBe(false);
    expect(workspaceOpen({ ...local, customApiKey: 'AIza' })).toBe(true);
    expect(workspaceOpen({ ...local, localModel: '', customApiKey: 'AIza' })).toBe(false);
    expect(workspaceOpen(openRouter)).toBe(false);
    expect(workspaceOpen({ ...openRouter, customApiKey: 'AIza' })).toBe(true);
  });

  it("finds Forma's vision model as a helper beside any AI, or as the Local AI model itself", () => {
    expect(visionModelOf({ ...base, provider: 'auto' })).toBeNull();
    expect(visionModelOf({ ...base, provider: 'auto', visionModel: ' forma-vision ' })).toEqual({ baseUrl: DEFAULT_LOCAL_URL, model: 'forma-vision' });
    expect(visionModelOf({ ...base, provider: 'local', localUrl: 'http://localhost:1234/v1', localModel: 'gemma3', visionModel: 'forma-vision:q8' })).toEqual({
      baseUrl: 'http://localhost:1234/v1',
      model: 'forma-vision:q8',
    });
    expect(visionModelOf({ ...base, provider: 'local', localModel: 'forma-vision' })).toEqual({ baseUrl: DEFAULT_LOCAL_URL, model: 'forma-vision' });
    // Alone only when the AI that designs is the vision model; a helper beside another AI is not.
    expect(isVisionOnly({ provider: 'local', localModel: 'forma-vision' })).toBe(true);
    expect(isVisionOnly({ provider: 'local', localModel: 'gemma3' })).toBe(false);
    expect(isVisionOnly({ provider: 'auto', localModel: 'forma-vision' })).toBe(false);
  });

  // Batch AF, item 18 (2026-11-10): a page reader beside whichever AI designs.
  it('finds the page reader on the Local AI server, whichever AI designs', () => {
    expect(pageReaderOf({ pageReader: '  ' })).toBeNull();
    expect(pageReaderOf({ pageReader: ' glm-ocr ' })).toEqual({ baseUrl: DEFAULT_LOCAL_URL, model: 'glm-ocr' });
    expect(pageReaderOf({ localUrl: 'http://localhost:1234/v1', pageReader: 'glm-ocr:q8_0' })).toEqual({ baseUrl: 'http://localhost:1234/v1', model: 'glm-ocr:q8_0' });
  });
});

describe('the kept settings', () => {
  it('defaults to Automatic and Ollama’s address', () => {
    expect(readProviderSettings()).toEqual({ provider: 'auto', localUrl: DEFAULT_LOCAL_URL, localModel: '', openRouterModel: '', openRouterKey: '', visionModel: '', pageReader: '' });
  });

  it('keeps the choice in localStorage and the OpenRouter key only in this tab', () => {
    writeProviderSettings({ provider: 'openrouter', localUrl: 'http://localhost:1234/v1', localModel: 'm', openRouterModel: 'x:free', openRouterKey: 'sk-or-secret', visionModel: 'forma-vision', pageReader: 'glm-ocr' });
    expect(localStorage.getItem('forma.aiProvider')).not.toContain('sk-or-secret');
    expect(sessionStorage.getItem('openRouterKey:session')).toBe('sk-or-secret');
    expect(readProviderSettings()).toEqual({ provider: 'openrouter', localUrl: 'http://localhost:1234/v1', localModel: 'm', openRouterModel: 'x:free', openRouterKey: 'sk-or-secret', visionModel: 'forma-vision', pageReader: 'glm-ocr' });
    writeProviderSettings({ provider: 'auto' });
    expect(sessionStorage.getItem('openRouterKey:session')).toBeNull();
  });

  it('ignores a provider it does not know, and reads the retired Gemini and Forma Offline choices as Automatic', () => {
    for (const provider of ['skynet', 'gemini', 'offline']) {
      localStorage.setItem('forma.aiProvider', JSON.stringify({ provider }));
      expect(readProviderSettings().provider).toBe('auto');
    }
  });
});

/* Which model answers when it is not Gemini's, for the box (2026-11-07, agent audit item 74). */
describe('answeringModel', () => {
  it('names Local AI and OpenRouter by their model, short, and Gemini by nothing', () => {
    expect(answeringModel({ provider: 'auto' })).toBeNull();
    expect(answeringModel({ provider: 'local', localModel: 'llama3.1:8b' })).toEqual({ provider: 'Local AI', model: 'llama3.1:8b', label: 'llama3.1:8b' });
    expect(answeringModel({ provider: 'openrouter', openRouterModel: 'meta-llama/llama-3.3-70b-instruct:free' })).toEqual({ provider: 'OpenRouter', model: 'meta-llama/llama-3.3-70b-instruct:free', label: 'llama-3.3-70b-instruct' });
    expect(answeringModel({ provider: 'local', localModel: '  ' })).toEqual({ provider: 'Local AI', model: '', label: 'Local AI' });
  });
});