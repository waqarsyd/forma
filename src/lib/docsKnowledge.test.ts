/**
 * The Docs articles as the chat is given them (2026-11-11, the full audit's
 * CV-29). Which articles are picked is tested over the real corpus in
 * components/docsCorpus.test.tsx; this is the form each one takes.
 */
import { describe, expect, it } from 'vitest';
import { docsBlock } from './docsKnowledge';

describe('docsBlock', () => {
  it('heads each article with the link a reply points to, never a reference nobody can follow', () => {
    const block = docsBlock([
      { id: 'share', title: 'Sharing a report', text: 'Share sends a copy.' },
      { id: 'export', title: 'Exporting', text: 'Export makes a file.' },
    ]);
    expect(block).toBe('## Sharing a report (/docs#share)\nShare sends a copy.\n\n## Exporting (/docs#export)\nExport makes a file.');
    expect(block).not.toContain('forma docs');
  });
});
