import { useEffect } from 'react';
import { currentPath, navigate, scrollToHash } from '../lib/router';

/**
 * One delegated handler turns every in-app `<a href="/...">` into a
 * client-side navigation, so the pages keep using plain anchors, which stay
 * right-clickable, middle-clickable and readable on hover, unlike a button
 * pretending to be a link. Modified clicks, new-tab targets and downloads are
 * left to the browser.
 *
 * Where a click lands (2026-11-07, the site audit): at the section a fragment
 * names, else at the top of a new page. pushState kept the old scroll, so a
 * footer link opened the next page near its bottom, and a link to /docs#faq
 * never reached the FAQ. The sign-in routes are a dialog over the page, which
 * must keep its place behind it.
 *
 * Moved out of App.tsx on 2026-11-08 (the site audit's batch SG, item 42) for
 * the public site, which draws the public pages without App since then.
 */
export function useLinkNavigation(): void {
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      // A file the site serves rather than a route: the browser opens it.
      if (/\.(txt|xml|json|webmanifest|ico|png|svg)$/i.test(href.split(/[?#]/)[0])) return;

      event.preventDefault();
      const from = currentPath();
      navigate(href);
      const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
      if (hash.length > 1) scrollToHash(hash);
      else if (currentPath() !== from && !['/login', '/signup'].includes(currentPath())) window.scrollTo(0, 0);
    };

    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, []);
}
