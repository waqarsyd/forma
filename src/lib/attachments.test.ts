import { describe, it, expect } from 'vitest';
import { groupAttachments, groupLabel, type PreviewMeta } from './attachments';

const page = (uploadId: string, file: string, n: number): PreviewMeta => ({ uploadId, file, page: n });
const image = (uploadId: string, file: string): PreviewMeta => ({ uploadId, file });

/**
 * The invariant here fails plausibly rather than loudly: a mis-grouped list
 * still renders, still sends the right images, and simply tells the user
 * something untrue about their own upload — five thumbnails for one file, or
 * two files hidden behind one chip. Nothing throws, so only these cases catch it.
 */
describe('groupAttachments', () => {
  it('collapses a multi-page PDF into one group', () => {
    const meta = [page('u1', 'invoice.pdf', 1), page('u1', 'invoice.pdf', 2), page('u1', 'invoice.pdf', 3)];
    const groups = groupAttachments(meta, 3);

    expect(groups).toHaveLength(1);
    expect(groups[0].file).toBe('invoice.pdf');
    expect(groups[0].pages).toBe(3);
    expect(groups[0].indices).toEqual([0, 1, 2]);
  });

  it('keeps separate uploads apart even when the filenames are identical', () => {
    // Two scans both called scan.pdf is ordinary. Grouping by name would hide
    // the second upload entirely behind the first one's thumbnail.
    const meta = [page('u1', 'scan.pdf', 1), page('u1', 'scan.pdf', 2), page('u2', 'scan.pdf', 1)];
    const groups = groupAttachments(meta, 3);

    expect(groups).toHaveLength(2);
    expect(groups[0].indices).toEqual([0, 1]);
    expect(groups[1].indices).toEqual([2]);
  });

  it('gives every plain image its own group', () => {
    // Five images really are five attachments; only pages collapse.
    const meta = [image('u1', 'a.png'), image('u2', 'b.png'), image('u3', 'c.png')];
    const groups = groupAttachments(meta, 3);

    expect(groups.map((g) => g.file)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(groups.every((g) => g.pages === 1)).toBe(true);
  });

  it('handles a PDF followed by an image followed by another PDF', () => {
    const meta = [
      page('u1', 'first.pdf', 1),
      page('u1', 'first.pdf', 2),
      image('u2', 'logo.png'),
      page('u3', 'second.pdf', 1),
      page('u3', 'second.pdf', 2),
    ];
    const groups = groupAttachments(meta, 5);

    expect(groups.map((g) => [g.file, g.pages])).toEqual([
      ['first.pdf', 2],
      ['logo.png', 1],
      ['second.pdf', 2],
    ]);
  });

  it('renders every image when metadata is missing or short', () => {
    // Defensive: previews and meta are written together, but a future edit that
    // updates one and not the other must not make images disappear.
    const groups = groupAttachments([page('u1', 'invoice.pdf', 1)], 3);

    expect(groups).toHaveLength(3);
    expect(groups.flatMap((g) => g.indices)).toEqual([0, 1, 2]);
    expect(groups[1].file).toBe('image 2');
  });

  it('never merges entries whose provenance is unknown', () => {
    const groups = groupAttachments([undefined, undefined], 2);
    expect(groups).toHaveLength(2);
  });

  it('returns nothing for an empty list', () => {
    expect(groupAttachments([], 0)).toEqual([]);
  });
});

describe('groupLabel', () => {
  it('names a single file plainly', () => {
    expect(groupLabel({ file: 'logo.png', indices: [0], pages: 1 })).toBe('logo.png');
  });

  it('says how many pages a multi-page upload produced', () => {
    expect(groupLabel({ file: 'invoice.pdf', indices: [0, 1, 2], pages: 3 })).toBe('invoice.pdf · 3 pages');
  });
});
