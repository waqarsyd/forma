/**
 * The keys reaching a new tab, item 105 (2026-11-08, the site audit's batch SI).
 */
import { describe, expect, it, vi } from 'vitest';
import { keysAcrossTabs, setKeysAcrossTabs, startKeyHandoff, type ChannelLike } from './keyHandoff';

describe('startKeyHandoff', () => {
  /** Two tabs on one channel, as BroadcastChannel delivers to every other listener. */
  function bus() {
    const tabs: ChannelLike[] = [];
    const open = (): ChannelLike => {
      const tab: ChannelLike = {
        onmessage: null,
        postMessage: (data) => tabs.filter((t) => t !== tab).forEach((t) => t.onmessage?.({ data })),
        close: () => tabs.splice(tabs.indexOf(tab), 1),
      };
      tabs.push(tab);
      return tab;
    };
    return { open };
  }

  it('gives a new tab the keys of a tab already open, and only when it asks', () => {
    const { open } = bus();
    const first = { gemini: 'AIza-first', openRouter: 'sk-or-1' };
    startKeyHandoff({ getKeys: () => first, onKeys: () => { throw new Error('a tab with a key never takes one'); }, enabled: () => true, open });
    const received = vi.fn();
    startKeyHandoff({ getKeys: () => ({}), onKeys: received, enabled: () => true, open });
    expect(received).toHaveBeenCalledWith({ gemini: 'AIza-first', openRouter: 'sk-or-1' });
  });

  it('neither asks nor answers when turned off', () => {
    const { open } = bus();
    startKeyHandoff({ getKeys: () => ({ gemini: 'AIza-first' }), onKeys: vi.fn(), enabled: () => false, open });
    const received = vi.fn();
    startKeyHandoff({ getKeys: () => ({}), onKeys: received, enabled: () => true, open });
    expect(received).not.toHaveBeenCalled();
  });

  it('is on until turned off, and remembers', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(keysAcrossTabs(storage)).toBe(true);
    setKeysAcrossTabs(false, storage);
    expect(keysAcrossTabs(storage)).toBe(false);
    setKeysAcrossTabs(true, storage);
    expect(keysAcrossTabs(storage)).toBe(true);
  });
});
