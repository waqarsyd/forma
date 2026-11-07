// @vitest-environment jsdom
// Real history/location, which is the whole point of this file. Must stay
// line 1; see vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ROUTES, currentPath, navigate, onRouteChange, migrateLegacyHashUrl, scrollToHash } from './router';

/**
 * Routing has no test-visible output — it moves the address bar and fires an
 * event, and every failure here looks like a page that simply rendered
 * something else. The two that matter are silent by construction: a route
 * missing from `ROUTES` sends an old link to the home page rather than erroring
 * (which is how `/terms` and `/privacy` sat outside the list unnoticed), and a
 * `pushState` where `replaceState` was meant leaves a history entry the back
 * button has to step through, which nobody notices until they press it twice.
 */

/** jsdom starts at `http://localhost:3000/`; each case sets its own URL. */
function setUrl(url: string): void {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  setUrl('/');
});

describe('ROUTES', () => {
  /* The regression this file exists for. Both shipped answered by App.tsx's
     route effect while `ROUTES` still stopped at `/workspace`. */
  it('carries the legal pages, which were absent from it for a day', () => {
    expect(ROUTES).toContain('/terms');
    expect(ROUTES).toContain('/privacy');
  });

  it('is absolute paths only, with no duplicates', () => {
    expect(ROUTES.every((r) => r.startsWith('/'))).toBe(true);
    expect(new Set(ROUTES).size).toBe(ROUTES.length);
  });
});

describe('currentPath', () => {
  it('reads the pathname', () => {
    setUrl('/features');
    expect(currentPath()).toBe('/features');
  });

  /* A trailing slash must not become a second route: `/docs/` and `/docs` are
     the same page, and the route effect matches on an exact string. */
  it('normalises a trailing slash away', () => {
    setUrl('/docs/');
    expect(currentPath()).toBe('/docs');
  });

  it('leaves the root alone, which is the one path that is a slash', () => {
    setUrl('/');
    expect(currentPath()).toBe('/');
  });
});

describe('navigate', () => {
  it('moves the URL and tells the app, since pushState fires no event', () => {
    const handler = vi.fn();
    const stop = onRouteChange(handler);

    navigate('/contact');

    expect(currentPath()).toBe('/contact');
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it('accepts a path without its leading slash', () => {
    navigate('docs');
    expect(currentPath()).toBe('/docs');
  });

  /* The login modal's cancel path replaces rather than pushes, so dismissing it
     does not leave an entry the back button walks into. */
  it('replaces instead of pushing when asked', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');

    navigate('/login', { replace: true });

    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(currentPath()).toBe('/login');

    push.mockRestore();
    replace.mockRestore();
  });
});

describe('onRouteChange', () => {
  it('hears the back button as well as a programmatic navigate', () => {
    const handler = vi.fn();
    const stop = onRouteChange(handler);

    window.dispatchEvent(new Event('popstate'));
    expect(handler).toHaveBeenCalledTimes(1);

    navigate('/features');
    expect(handler).toHaveBeenCalledTimes(2);

    stop();
  });

  it('unsubscribes from both, not just one', () => {
    const handler = vi.fn();
    onRouteChange(handler)();

    window.dispatchEvent(new Event('popstate'));
    navigate('/docs');

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('migrateLegacyHashUrl', () => {
  let push: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    push = vi.spyOn(window.history, 'pushState');
  });

  afterEach(() => {
    push.mockRestore();
  });

  it('rewrites a known fragment to its path', () => {
    setUrl('/#features');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/features');
    expect(window.location.hash).toBe('');
  });

  /* Fails before `/terms` joined ROUTES: the fragment was unknown, so this
     landed on the home page instead. */
  it('rewrites the fragments that were missing from ROUTES', () => {
    setUrl('/#terms');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/terms');

    setUrl('/#privacy');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/privacy');
  });

  /* A fragment that is not a route is a section of the page (2026-11-07). It
     was dropped until then, so /docs#faq from the Contact page landed at the
     top of Docs with the #faq gone. */
  it('keeps a fragment that is not a route, as the section it names', () => {
    // The Docs page's FAQ section, not the FAQ page that /faq is since
    // 2026-11-08: only the home page's hash links are the legacy ones.
    setUrl('/docs#faq');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/docs');
    expect(window.location.hash).toBe('#faq');
    setUrl('/#faq');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/faq');

    setUrl('/changelog#2026-11-07-settings-account-ocr');
    migrateLegacyHashUrl();
    expect(window.location.hash).toBe('#2026-11-07-settings-account-ocr');
  });

  it('keeps the query string on both paths', () => {
    setUrl('/?ref=x#features');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/features');
    expect(window.location.search).toBe('?ref=x');

    setUrl('/?ref=x#how');
    migrateLegacyHashUrl();
    expect(window.location.search).toBe('?ref=x');
    expect(window.location.hash).toBe('#how');
  });

  /* A URL ending in a bare `#` reports `location.hash === ''`, which is why the
     source reads that case off `href` instead of folding it into the check
     above. The first assertion is the precondition: if the environment
     normalises the `#` away on its own, this test proves nothing. */
  it('strips a bare trailing hash', () => {
    setUrl('/docs#');
    expect(window.location.href.endsWith('#')).toBe(true);

    migrateLegacyHashUrl();

    expect(window.location.href.endsWith('#')).toBe(false);
    expect(currentPath()).toBe('/docs');
  });

  it('leaves a clean URL untouched', () => {
    setUrl('/docs');
    migrateLegacyHashUrl();
    expect(currentPath()).toBe('/docs');
  });

  /* Migration must not cost a history entry — the back button should reach
     wherever the visitor came from, not the pre-migration URL. */
  it('never pushes a history entry', () => {
    setUrl('/#features');
    migrateLegacyHashUrl();
    expect(push).not.toHaveBeenCalled();
  });
});

/* A page renders after its lazy chunk arrives, so the section a link names is
   often not in the document yet when the route changes (2026-11-07). */
describe('scrollToHash', () => {
  let scroll: ReturnType<typeof vi.fn>;
  let raf: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll as unknown as Element['scrollIntoView'];
    let frames: FrameRequestCallback[] = [];
    raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    (window as unknown as { flushFrames: () => void }).flushFrames = () => {
      const run = frames;
      frames = [];
      run.forEach((cb) => cb(0));
    };
  });
  afterEach(() => {
    raf.mockRestore();
    document.body.innerHTML = '';
  });
  const flush = () => (window as unknown as { flushFrames: () => void }).flushFrames();

  it('scrolls to a section that is already there', () => {
    document.body.innerHTML = '<section id="faq"></section>';
    scrollToHash('#faq');
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('waits for a section that renders later', () => {
    scrollToHash('#faq');
    expect(scroll).not.toHaveBeenCalled();
    flush();
    document.body.innerHTML = '<section id="faq"></section>';
    flush();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty fragment', () => {
    scrollToHash('#');
    expect(raf).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });
});
