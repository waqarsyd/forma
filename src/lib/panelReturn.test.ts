// @vitest-environment jsdom
/**
 * Where the keyboard goes when Escape closes a side panel (2026-11-11, the
 * full audit's UI7 remainder, batch BW2): back to what opened it, and to the
 * menu button where the rail is inside a closed drawer.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { panelReturnTarget } from './panelReturn';

afterEach(() => {
  document.body.innerHTML = '';
});

function rail() {
  document.body.innerHTML = `
    <button id="menu">Menu</button>
    <nav id="wb-rail">
      <button data-rail-search>Search projects</button>
      <button data-panel="projects">Saved projects</button>
    </nav>
    <main><input id="box" /></main>`;
  const q = (s: string) => document.querySelector<HTMLElement>(s)!;
  return { menu: q('#menu'), search: q('[data-rail-search]'), saved: q('[data-panel="projects"]'), box: q('#box') };
}

describe('panelReturnTarget', () => {
  it('gives nothing outside the rail the focus back: the box, the page, or nothing', () => {
    const { menu, saved, box } = rail();
    for (const opener of [box, document.body, null]) {
      expect(panelReturnTarget({ stacked: false, menuButton: menu, opener, panelButton: saved })).toBe(saved);
    }
  });

  it('gives the focus back to Search projects when it opened Projects, not to Saved projects', () => {
    const { menu, search, saved } = rail();
    expect(panelReturnTarget({ stacked: false, menuButton: menu, opener: search, panelButton: saved })).toBe(search);
  });

  it('falls back to the panel\'s rail button when nothing in the rail opened it, or the opener is gone', () => {
    const { menu, search, saved } = rail();
    expect(panelReturnTarget({ stacked: false, menuButton: menu, opener: null, panelButton: saved })).toBe(saved);
    search.remove();
    expect(panelReturnTarget({ stacked: false, menuButton: menu, opener: search, panelButton: saved })).toBe(saved);
  });

  it('goes to the menu button on the stacked layout, where the rail is in the closed drawer', () => {
    const { menu, search, saved } = rail();
    expect(panelReturnTarget({ stacked: true, menuButton: menu, opener: search, panelButton: saved })).toBe(menu);
    expect(panelReturnTarget({ stacked: true, menuButton: null, opener: search, panelButton: saved })).toBe(saved);
  });
});
