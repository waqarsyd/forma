/**
 * Prompt-to-Expression through the real service against a stubbed network:
 * the model's expression comes back checked against the fields, and a field
 * the data does not have is a problem rather than a silent blank cell.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { promptToExpression, type ReportConfig } from './geminiService';
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

describe('promptToExpression', () => {
  it('returns the expression with its explanation and no problems when it fits the fields', async () => {
    const mock = stubFetch(() => jsonReply(JSON.stringify({ expression: "FormatString('{0:c2}', [Qty] * [Price])", explanation: 'Quantity times price, as currency.' })));
    const outcome = await promptToExpression('line total as currency', ['Qty', 'Price'], config);
    expect(outcome).toEqual({ expression: "FormatString('{0:c2}', [Qty] * [Price])", explanation: 'Quantity times price, as currency.', problems: [] });
    const text = JSON.parse(String((mock.mock.calls[0][1] as RequestInit).body)).contents[0].parts[0].text as string;
    expect(text).toContain('Available fields: [Qty], [Price]');
    expect(text).toContain('Request: "line total as currency"');
    expect(text).toContain('Iif(condition, whenTrue, whenFalse)');
  });

  it('reports a field the data does not have instead of accepting it', async () => {
    stubFetch(() => jsonReply(JSON.stringify({ expression: '[Qty] * [UnitCost]', explanation: 'x' })));
    const outcome = await promptToExpression('line total', ['Qty', 'Price'], config);
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.problems[0]).toContain('[UnitCost] is not a field');
  });

  it('refuses an empty prompt before spending a request, and an empty answer after', async () => {
    const mock = stubFetch(() => jsonReply(JSON.stringify({ expression: '', explanation: '' })));
    await expect(promptToExpression('   ', ['A'], config)).rejects.toThrow(/Describe the expression/);
    expect(mock).not.toHaveBeenCalled();
    await expect(promptToExpression('something', ['A'], config)).rejects.toThrow(/no expression/i);
  });

  it('refuses without a key', async () => {
    stubFetch(() => jsonReply('{}'));
    await expect(promptToExpression('total', ['A'], { ...config, customApiKey: '' })).rejects.toThrow(/API key/i);
  });
});
