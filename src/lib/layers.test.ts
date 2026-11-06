import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLayer, hasOpenLayer, isOutsideReport, onLayerKey, topLayer, type LayerKey } from './layers';

const key = (k: string, extra: Partial<LayerKey> = {}): LayerKey & { stopped: boolean; prevented: boolean } => {
  const e = {
    key: k,
    defaultPrevented: false,
    stopped: false,
    prevented: false,
    preventDefault() { e.prevented = true; },
    stopPropagation() { e.stopped = true; },
    ...extra,
  };
  return e;
};

let releases: (() => void)[] = [];
const open = (id: string) => {
  const close = vi.fn();
  releases.push(addLayer({ id, close }));
  return close;
};
afterEach(() => {
  releases.forEach((r) => r());
  releases = [];
});

describe('layers', () => {
  it('closes only the topmost layer on Escape, and keeps the key from what is behind', () => {
    const settings = open('settings');
    const commands = open('commands');
    const e = key('Escape');
    onLayerKey(e);
    expect(commands).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
    expect(e.prevented && e.stopped).toBe(true);
  });

  it('leaves an Escape a field already used, and every other key', () => {
    const menu = open('menu');
    onLayerKey(key('Escape', { defaultPrevented: true }));
    onLayerKey(key('Escape', { isComposing: true }));
    onLayerKey(key('ArrowDown'));
    expect(menu).not.toHaveBeenCalled();
  });

  it('does nothing with nothing open', () => {
    const e = key('Escape');
    onLayerKey(e);
    expect(e.prevented).toBe(false);
    expect(hasOpenLayer()).toBe(false);
  });

  it('says what is open and which is on top, and forgets a layer once closed', () => {
    open('help');
    const release = addLayer({ id: 'share', close: () => undefined });
    expect(hasOpenLayer()).toBe(true);
    expect(topLayer()?.id).toBe('share');
    release();
    expect(topLayer()?.id).toBe('help');
  });

  it('tells a key on a menu, a dialog or the conversation from one on the report', () => {
    const at = (selector: string | null) => ({ closest: (s: string) => (selector && s.includes(selector) ? {} : null) });
    expect(isOutsideReport(at('[role="menu"]') as unknown as EventTarget)).toBe(true);
    expect(isOutsideReport(at('.wb-float') as unknown as EventTarget)).toBe(true);
    expect(isOutsideReport(at(null) as unknown as EventTarget)).toBe(false);
    expect(isOutsideReport(null)).toBe(false);
  });
});
