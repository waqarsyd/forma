// @vitest-environment jsdom
/**
 * Every download in Forma goes through `saveBlob` (2026-11-11, the full
 * audit's PR-17 and WS-42): the link is in the page when it is clicked, and
 * the blob's address outlives the click by a minute, so a browser that starts
 * the download after the click returns still finds it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_AFTER_MS, safeFileName, saveBlob, saveText } from './download';

describe('a download', () => {
  const create = vi.fn(() => 'blob:forma/1');
  const revoke = vi.fn();
  let clicked: { name: string; href: string; inPage: boolean }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    create.mockClear();
    revoke.mockClear();
    clicked = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: create, revokeObjectURL: revoke }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ name: this.download, href: this.getAttribute('href') ?? '', inPage: document.body.contains(this) });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicks a link that is in the page, then takes it out', () => {
    saveBlob('Invoice.repx', new Blob(['<x/>'], { type: 'application/xml' }));
    expect(clicked).toEqual([{ name: 'Invoice.repx', href: 'blob:forma/1', inPage: true }]);
    expect(document.querySelectorAll('a[download]').length).toBe(0);
  });

  it('lets the address go a minute after the click, not at once', () => {
    saveText('notes.txt', 'hello');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:forma/1');
  });

  it('saves text with its type', () => {
    saveText('chat.md', '# Hi', 'text/markdown;charset=utf-8');
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('text/markdown;charset=utf-8');
  });

  it('makes a name a file system takes', () => {
    expect(safeFileName('Sales: Q1/Q2?')).toBe('Sales- Q1-Q2-');
    expect(safeFileName('  ', 'conversation')).toBe('conversation');
  });
});
