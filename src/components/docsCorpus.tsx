/**
 * The Docs page's articles as text, for the chat (2026-11-10, batch AG item
 * 25, lib/docsKnowledge.ts): the page drawn once into a detached element,
 * its articles read, and the element dropped. Drawn rather than copied, so
 * the chat answers from what the site says today. Loaded on demand, the
 * first time a question about Forma is asked; the Docs page's own chunk is
 * the one the site already has.
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import DocsPage from './DocsPage';
import { sectionsFromPage, type DocsSection } from '../lib/docsKnowledge';

let read: Promise<DocsSection[]> | null = null;

const nothing = () => {};

/** The Docs page's articles, drawn once and kept. */
export function loadDocsSections(): Promise<DocsSection[]> {
  read ??= Promise.resolve().then(() => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      flushSync(() =>
        root.render(<DocsPage onEnterWorkspace={nothing} onSignIn={nothing} onSignUp={nothing} user={null} logOut={nothing} isDarkMode={false} setIsDarkMode={nothing} />),
      );
      return sectionsFromPage(host);
    } finally {
      root.unmount();
    }
  });
  // A page that would not draw is tried again next time rather than kept as a failure.
  read.catch(() => {
    read = null;
  });
  return read;
}
