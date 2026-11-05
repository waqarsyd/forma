/** Requests sent to each model today, by the Pacific day (2026-11-05). */
import { describe, it, expect } from 'vitest';
import { noteRequest, pacificDay, requestsToday } from './requestCount';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('pacificDay', () => {
  it('is the calendar day in Pacific time, which changes eight hours after UTC midnight', () => {
    expect(pacificDay(new Date('2026-11-05T07:59:00Z'))).toBe('2026-11-04');
    expect(pacificDay(new Date('2026-11-05T08:01:00Z'))).toBe('2026-11-05');
  });
});

describe('requestsToday and noteRequest', () => {
  it('counts each model, and starts again at zero on the next Pacific day', () => {
    const store = memory();
    const morning = new Date('2026-11-05T12:00:00Z');
    noteRequest('gemini-2.5-flash', store, morning);
    noteRequest('gemini-2.5-flash', store, morning);
    noteRequest('gemini-2.5-flash-lite', store, morning);
    expect(requestsToday(store, morning)).toEqual({ 'gemini-2.5-flash': 2, 'gemini-2.5-flash-lite': 1 });
    expect(requestsToday(store, new Date('2026-11-06T09:00:00Z'))).toEqual({});
  });

  it('ignores a request with no model, and storage that will not read or write', () => {
    const store = memory();
    noteRequest(undefined, store);
    expect(requestsToday(store)).toEqual({});
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
    expect(() => noteRequest('m', broken)).not.toThrow();
    expect(requestsToday(broken)).toEqual({});
  });
});
