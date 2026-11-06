import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('copyText', () => {
  it('uses the clipboard when the page has one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('labelTitle')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('labelTitle');
  });

  it('falls back to a hidden field and execCommand where there is none, as on plain HTTP', async () => {
    vi.stubGlobal('navigator', {});
    const field = { value: '', style: {} as Record<string, string>, select: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      createElement: () => field,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    });
    expect(await copyText('a, b')).toBe(true);
    expect(field.value).toBe('a, b');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('says false when neither works', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('document', undefined);
    expect(await copyText('x')).toBe(false);
  });
});
