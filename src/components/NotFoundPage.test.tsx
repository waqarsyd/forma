// @vitest-environment jsdom
/**
 * The 404 page's `noindex`.
 *
 * Added on 2026-11-01, when the site audit found the page told a person the
 * address was wrong and told a search engine nothing. The half worth pinning
 * is the removal: the meta is added to the shared `<head>`, so a page that
 * forgot to take it away would mark the next real page noindex as well, and
 * that page would quietly drop out of search with nothing on screen to show it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import NotFoundPage from './NotFoundPage';

afterEach(cleanup);
// jsdom has no ResizeObserver; the page's Eyebrow uses one only to re-measure
// the sheet coordinate it prints as the document reflows, which nothing here
// depends on.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const robots = () => [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => (m as HTMLMetaElement).content);
const page = () => (
  <NotFoundPage
    onEnterWorkspace={() => {}}
    onSignIn={() => {}}
    onSignUp={() => {}}
    user={null}
    logOut={() => {}}
    isDarkMode={false}
    setIsDarkMode={() => {}}
  />
);

describe('NotFoundPage', () => {
  it('asks crawlers not to index it while it is shown', () => {
    expect(robots()).toEqual([]);
    render(page());
    expect(robots()).toEqual(['noindex']);
  });

  it('takes the noindex away when it goes, so the next page is not marked', () => {
    const { unmount } = render(page());
    unmount();
    expect(robots()).toEqual([]);
  });
});
