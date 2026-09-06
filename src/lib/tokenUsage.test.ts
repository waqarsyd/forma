import { describe, it, expect } from 'vitest';
import { readTokenUsage, formatTokenCount, summariseUsage, describeUsage } from './tokenUsage';

/**
 * The status-bar readout for what a generation cost.
 *
 * The numbers were logged to the console from the day streaming landed, and that
 * turned out not to count as having them -- three attempts to check the effect
 * of a change made to reduce them all failed, because an offline run returns
 * before the API call and the line never appears. These tests pin the two things
 * that made it unreachable: a missing measurement must render as nothing rather
 * than as a confident zero, and the parts must stay separable.
 */
describe('readTokenUsage', () => {
  it('reads the four counts off the SDK shape', () => {
    expect(
      readTokenUsage({
        promptTokenCount: 15294,
        candidatesTokenCount: 6390,
        thoughtsTokenCount: 0,
        totalTokenCount: 21684,
      }),
    ).toEqual({ input: 15294, output: 6390, thinking: 0, total: 21684 });
  });

  it('returns null when there is no metadata at all', () => {
    // The mock path and any response that arrived without it. Null is what makes
    // the readout hide rather than claim the request was free.
    expect(readTokenUsage(null)).toBeNull();
    expect(readTokenUsage(undefined)).toBeNull();
    expect(readTokenUsage({})).toBeNull();
  });

  it('treats a missing count as zero rather than NaN', () => {
    // The SDK has renamed these fields before. A missing one must not propagate
    // NaN into the bar, where it would render as "NaN tokens".
    const usage = readTokenUsage({ promptTokenCount: 100, totalTokenCount: 100 })!;
    expect(usage.output).toBe(0);
    expect(usage.thinking).toBe(0);
    expect(Number.isNaN(usage.total)).toBe(false);
  });

  it('prefers the reported total over the sum of the parts', () => {
    // Google counts the total itself and it has not always been the simple sum.
    const usage = readTokenUsage({
      promptTokenCount: 10,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 10,
      totalTokenCount: 45,
    })!;
    expect(usage.total).toBe(45);
  });

  it('falls back to the sum when no total is reported', () => {
    const usage = readTokenUsage({ promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 })!;
    expect(usage.total).toBe(35);
  });
});

describe('formatTokenCount', () => {
  it('shows small counts exactly', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(847)).toBe('847');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('switches to one decimal at a thousand', () => {
    // 12.9k against 13.4k is the size of a prompt section and worth seeing;
    // 12,914 against 12,937 is jitter.
    expect(formatTokenCount(1000)).toBe('1.0k');
    expect(formatTokenCount(12914)).toBe('12.9k');
    expect(formatTokenCount(21684)).toBe('21.7k');
  });

  it('switches again at a million', () => {
    expect(formatTokenCount(1_400_000)).toBe('1.4M');
  });

  it('never renders a negative or a NaN into the bar', () => {
    expect(formatTokenCount(-5)).toBe('0');
    expect(formatTokenCount(Number.NaN)).toBe('0');
  });
});

describe('summariseUsage', () => {
  it('is the total, because the bar has room for one number', () => {
    expect(summariseUsage({ input: 15294, output: 6390, thinking: 0, total: 21684 })).toBe('21.7k tokens');
  });

  it('is null when there is nothing to report', () => {
    expect(summariseUsage(null)).toBeNull();
    expect(summariseUsage(undefined)).toBeNull();
  });
});

describe('describeUsage', () => {
  it('separates input from output, which move for different reasons', () => {
    const text = describeUsage({ input: 15294, output: 6390, thinking: 0, total: 21684 })!;
    expect(text).toContain('Input 15,294');
    expect(text).toContain('Output 6,390');
    expect(text).toContain('Total 21,684');
  });

  it('omits thinking when there was none', () => {
    // It is zero on every model this app currently selects, and a permanent
    // "Thinking 0" teaches the reader to ignore the line that would matter most
    // if it ever stopped being zero.
    expect(describeUsage({ input: 10, output: 10, thinking: 0, total: 20 })).not.toMatch(/Thinking/);
  });

  it('names thinking when it happened, and says it is billed', () => {
    const text = describeUsage({ input: 10, output: 10, thinking: 500, total: 520 })!;
    expect(text).toContain('Thinking 500');
    expect(text).toMatch(/billed like output/i);
  });

  it('is null when there is nothing to describe', () => {
    expect(describeUsage(null)).toBeNull();
  });
});
