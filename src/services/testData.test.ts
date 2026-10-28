/**
 * AI-generated test data, through the real service against a stubbed network.
 *
 * Rows come back keyed by the bound fields in order, padded and trimmed, and a
 * report with no bound fields asks for nothing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { generateTestData, type ReportConfig } from './geminiService';
import { resetGenAIForTests } from '../lib/genai';
import { cacheModel, clearCachedModel } from '../lib/modelCache';

const KEY = 'test-key-not-a-real-credential';
const config: ReportConfig = { customApiKey: KEY, version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter' };

const jsonReply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (url: unknown, init?: unknown) => handler(String(url), init as RequestInit));
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeAll(async () => {
  await import('@google/genai');
}, 60_000);

beforeEach(() => {
  resetGenAIForTests();
  clearCachedModel();
  cacheModel('model-a', ['model-a']);
  for (const m of ['log', 'debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetGenAIForTests();
  clearCachedModel();
});

describe('generateTestData', () => {
  it('keys each row by the fields in order, padding short rows and trimming long ones', async () => {
    const mock = stubFetch(() =>
      jsonReply(JSON.stringify({ rows: [{ values: ['ALFKI', 'Alfreds Futterkiste', '1,240.50'] }, { values: ['ANATR'] }, { values: ['X', 'Y', 'Z', 'extra'] }] })),
    );
    const rows = await generateTestData(['CustomerId', 'Company', 'Balance'], { title: 'Customers' }, 3, config);
    expect(rows).toEqual([
      { CustomerId: 'ALFKI', Company: 'Alfreds Futterkiste', Balance: '1,240.50' },
      { CustomerId: 'ANATR', Company: '', Balance: '' },
      { CustomerId: 'X', Company: 'Y', Balance: 'Z' },
    ]);
    const body = JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));
    const text = body.contents[0].parts[0].text as string;
    expect(text).toContain('CustomerId, Company, Balance');
    expect(text).toContain('titled "Customers"');
    expect(text).toContain('exactly 3 rows');
  });

  it('asks for nothing when the report is bound to no fields', async () => {
    const mock = stubFetch(() => jsonReply('{}'));
    expect(await generateTestData([], {}, 5, config)).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  it('caps the request at fifty rows and fails readably on an empty answer', async () => {
    const mock = stubFetch(() => jsonReply(JSON.stringify({ rows: [] })));
    await expect(generateTestData(['A'], {}, 500, config)).rejects.toThrow(/no sample rows/i);
    const body = JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body));
    expect(body.contents[0].parts[0].text).toContain('exactly 50 rows');
  });

  it('refuses without a key', async () => {
    stubFetch(() => jsonReply('{}'));
    await expect(generateTestData(['A'], {}, 5, { ...config, customApiKey: '' })).rejects.toThrow(/API key/i);
  });
});
