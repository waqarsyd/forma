/**
 * Turning a Gemini SDK error into something a user can act on.
 *
 * Found by testing against the live API with a **valid** key on 2026-08-27: a
 * malformed request came back as HTTP 400 INVALID_ARGUMENT, and the app told
 * the user *"That Gemini API key is not valid. Check for a typo or paste it
 * again in Settings."*
 *
 * The mapping was `status === 400 || message.includes("API_KEY_INVALID") || …`.
 * The two message checks are the correct discriminators; the bare status was
 * over-reach. Google returns 400 INVALID_ARGUMENT for an unsupported mime type,
 * an oversized payload, a bad generationConfig — `geminiService.ts` already
 * documents one such case, a model rejecting `thinkingBudget: 0` with a bare
 * 400 — and for a genuinely malformed key. Only the last is a key problem.
 *
 * The cost of getting this wrong is not a bad error string. It is a diagnostic
 * dead end: the user is told to fix the one thing that is not broken, replaces
 * a working key with another working key, and hits the same wall.
 */
import { describe, it, expect } from 'vitest';
import { classifyGeminiError } from './geminiErrors';

/** Shaped like what @google/genai throws. */
const sdkError = (status: number | string | undefined, message: string) =>
  Object.assign(new Error(message), { status });

describe('classifyGeminiError', () => {
  describe('400 — only a key problem when it says so', () => {
    it('reports a genuinely invalid key from the message, not the status', () => {
      const e = classifyGeminiError(sdkError(400, 'API key not valid. Please pass a valid API key.'));
      expect(e.message).toMatch(/key is not valid/i);
    });

    it('recognises API_KEY_INVALID', () => {
      const e = classifyGeminiError(sdkError(400, '{"error":{"status":"API_KEY_INVALID"}}'));
      expect(e.message).toMatch(/key is not valid/i);
    });

    /**
     * "Does not blame the key" is the property, and it is not the same as "does
     * not contain the word key" — the message deliberately says the key is
     * fine, which is the reassurance that stops someone re-pasting a working
     * one. What must never appear is the instruction to go and change it.
     */
    const BLAMES_THE_KEY = /key is not valid|check for a typo|paste it again|key was rejected/i;

    it('does NOT blame the key for a malformed request', () => {
      // The exact error observed against the live API with a valid key.
      const e = classifyGeminiError(
        sdkError(400, "* GenerateContentRequest.contents[0].parts[1].data: required oneof field 'data' must have one initialized field")
      );
      expect(e.message).not.toMatch(BLAMES_THE_KEY);
      expect(e.message).toMatch(/rejected the request/i);
      expect(e.message).toMatch(/API key is fine/i);
    });

    it('does NOT blame the key for an unsupported file type', () => {
      const e = classifyGeminiError(sdkError(400, 'Unsupported MIME type: application/x-msdownload'));
      expect(e.message).not.toMatch(BLAMES_THE_KEY);
      expect(e.message).toMatch(/uploaded file/i);
    });

    it('does NOT blame the key for an oversized request', () => {
      const e = classifyGeminiError(sdkError(400, 'The request payload size exceeds the limit.'));
      expect(e.message).not.toMatch(BLAMES_THE_KEY);
    });

    it('surfaces the provider\'s own wording so the real cause is visible', () => {
      const e = classifyGeminiError(sdkError(400, 'Unsupported MIME type: image/tiff'));
      expect(e.message).toContain('Unsupported MIME type: image/tiff');
    });
  });

  describe('the branches that were already right', () => {
    it('429 is a quota problem', () => {
      expect(classifyGeminiError(sdkError(429, 'RESOURCE_EXHAUSTED')).message).toMatch(/quota/i);
    });

    it('403 is a rejected key', () => {
      expect(classifyGeminiError(sdkError(403, 'PERMISSION_DENIED')).message).toMatch(/rejected/i);
    });

    it('403 with "leaked" says so specifically', () => {
      const e = classifyGeminiError(sdkError(403, 'API key was reported as leaked'));
      expect(e.message).toMatch(/published somewhere public/i);
    });

    it('404 means no model this key can reach', () => {
      expect(classifyGeminiError(sdkError(404, 'NOT_FOUND')).message).toMatch(/no gemini model/i);
    });

    it('503 says the fault is Google\'s, not the user\'s', () => {
      const e = classifyGeminiError(sdkError(503, 'The model is overloaded. UNAVAILABLE'));
      expect(e.message).toMatch(/busy/i);
      expect(e.message).toMatch(/nothing is wrong with your API key/i);
    });
  });

  describe('unwrapping', () => {
    it('pulls the human-readable part out of the provider\'s raw JSON', () => {
      const raw = '{"error":{"code":500,"message":"Internal error encountered.","status":"INTERNAL"}}';
      const e = classifyGeminiError(sdkError(500, raw));
      expect(e.message).toContain('Internal error encountered.');
      expect(e.message).not.toContain('{');
    });

    it('falls back to the message as given when it is not JSON', () => {
      expect(classifyGeminiError(sdkError(500, 'something broke')).message).toContain('something broke');
    });

    it('never produces an empty message', () => {
      for (const e of [sdkError(undefined, ''), sdkError(500, ''), new Error('')]) {
        expect(classifyGeminiError(e).message.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
