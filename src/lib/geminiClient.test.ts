/**
 * The test that matters here is the first one: it constructs a real
 * `MissingApiKeyError` and asserts the predicate recognises it.
 *
 * `isMissingApiKey` exists because the service is behind a dynamic import and
 * the three call sites are `catch` blocks, so comparing with `instanceof` would
 * mean holding the loaded module in a variable declared outside the `try`. The
 * predicate reads `.name` instead, which is only safe for as long as the class
 * keeps setting it. Binding the two together here is what makes that true: drop
 * `this.name` from the constructor, or rename the class without it, and this
 * fails rather than the settings dialog quietly ceasing to open.
 */
import { describe, it, expect } from 'vitest';
import { isMissingApiKey, loadGemini } from './geminiClient';
import { MissingApiKeyError } from '../services/geminiService';

describe('isMissingApiKey', () => {
  it('recognises a real MissingApiKeyError', () => {
    expect(isMissingApiKey(new MissingApiKeyError())).toBe(true);
  });

  it('still recognises one that has crossed a chunk boundary', () => {
    // What the predicate actually sees at a call site: an error object, not
    // necessarily one whose class identity is comparable.
    const thrown = Object.assign(new Error('Add your Gemini API key.'), {
      name: 'MissingApiKeyError',
    });
    expect(isMissingApiKey(thrown)).toBe(true);
  });

  it('rejects every other error the catch blocks actually see', () => {
    for (const err of [
      new Error('Failed to fetch'),
      new DOMException('aborted', 'AbortError'),
      Object.assign(new Error('quota'), { name: 'QuotaError' }),
    ]) {
      expect(isMissingApiKey(err)).toBe(false);
    }
  });

  it('rejects non-errors rather than throwing on them', () => {
    for (const value of [null, undefined, '', 'MissingApiKeyError', 0, [], {}]) {
      expect(isMissingApiKey(value)).toBe(false);
    }
  });
});

describe('loadGemini', () => {
  it('memoises on the promise, so two callers share one import', () => {
    // handleSend can start a chat turn and a generation back to back; both
    // must not trigger separate module loads.
    expect(loadGemini()).toBe(loadGemini());
  });

  it('resolves to the service, with the values App.tsx needs on it', async () => {
    const gemini = await loadGemini();
    expect(typeof gemini.analyzeReportDesign).toBe('function');
    expect(typeof gemini.chatReply).toBe('function');
    expect(typeof gemini.validateApiKey).toBe('function');
  });
});
