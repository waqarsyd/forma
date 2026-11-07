// @vitest-environment jsdom
/**
 * The changelog page (2026-11-07): every release drawn, newest first, each with
 * its anchor; filters by kind and area kept in the address; an empty result
 * that says so with a way back; a link copied per entry; and following it,
 * free, from the feed and GitHub.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

// The ruler down the page edge is decoration; its unit helper is kept, since the eyebrow uses it.
vi.mock('./landing/SheetRuler', async (actual) => ({ ...(await actual<typeof import('./landing/SheetRuler')>()), default: () => null }));
vi.mock('./SiteHeader', () => ({ default: () => <header /> }));
const copyText = vi.fn().mockResolvedValue(true);
vi.mock('../lib/clipboard', () => ({ copyText: (t: string) => copyText(t) }));

import ChangelogPage from './ChangelogPage';
import { RELEASES } from '../lib/releases';

const draw = () =>
  render(
    <ChangelogPage onEnterWorkspace={vi.fn()} onSignIn={vi.fn()} onSignUp={vi.fn()} user={null} logOut={vi.fn()} isDarkMode={false} setIsDarkMode={vi.fn()} />,
  );

beforeEach(() => {
  window.history.replaceState({}, '', '/changelog');
  copyText.mockClear();
  // The section eyebrow measures the page with one; jsdom has none.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(cleanup);

describe('ChangelogPage', () => {
  it('draws every release, newest first, each an article with its anchor and date', () => {
    const { container } = draw();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What’s new in Forma');
    const articles = [...container.querySelectorAll('article')];
    expect(articles.map((a) => a.id)).toEqual(RELEASES.map((r) => r.id));
    expect(articles[0].querySelector('time')?.getAttribute('datetime')).toBe(RELEASES[0].date);
  });

  it('links the version to its GitHub release', () => {
    draw();
    expect(screen.getByRole('link', { name: 'v1.0.0' }).getAttribute('href')).toBe('https://github.com/waqarsyd/forma/releases/tag/v1.0.0');
  });

  it('filters by kind, keeps the filter in the address, and clears it', () => {
    const { container } = draw();
    const fixed = screen.getByRole('button', { name: 'Fixed' });
    fireEvent.click(fixed);
    expect(fixed.getAttribute('aria-pressed')).toBe('true');
    expect(window.location.search).toBe('?kind=fixed');
    const withFixes = RELEASES.filter((r) => r.changes.some((c) => c.kind === 'fixed')).map((r) => r.id);
    expect([...container.querySelectorAll('article')].map((a) => a.id)).toEqual(withFixes);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(window.location.search).toBe('');
    expect(container.querySelectorAll('article')).toHaveLength(RELEASES.length);
  });

  it('reads a filter from the address it was opened with', () => {
    window.history.replaceState({}, '', '/changelog?area=sharing');
    const { container } = draw();
    expect((screen.getByRole('combobox', { name: 'Area' }) as HTMLSelectElement).value).toBe('sharing');
    const ids = [...container.querySelectorAll('article')].map((a) => a.id);
    expect(ids).toEqual(RELEASES.filter((r) => r.changes.some((c) => c.area === 'sharing')).map((r) => r.id));
  });

  it('says when nothing matches, and offers the way back', () => {
    draw();
    fireEvent.change(screen.getByRole('combobox', { name: 'Area' }), { target: { value: 'sharing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Removed' }));
    expect(screen.getByText('No changes match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('No changes match these filters.')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('copies a link to an entry, and says so', async () => {
    const { container } = draw();
    const first = container.querySelector('article')!;
    fireEvent.click(within(first as HTMLElement).getByRole('button', { name: `Copy link to ${RELEASES[0].title}` }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/changelog#${RELEASES[0].id}`));
    expect(await within(first as HTMLElement).findByText('Copied')).toBeTruthy();
  });

  /* The feed is a file beside the page; target=_blank keeps the app's own
     link handling from routing it as a page, which would show the 404. */
  it('offers the feed and GitHub to follow it, free', () => {
    draw();
    const feed = screen.getByRole('link', { name: 'Atom feed' });
    expect(feed.getAttribute('href')).toBe('/changelog.xml');
    expect(feed.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Watch releases on GitHub' }).getAttribute('href')).toBe('https://github.com/waqarsyd/forma');
  });
});
