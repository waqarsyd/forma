/**
 * The attachment budget, which had a real off-by-eight before it was countable.
 *
 * `MAX_ATTACHMENTS` counts FILES. Counting the rows a file produces instead —
 * one preview and one text record per PDF page — made an eight-page PDF spend
 * sixteen of twelve slots and refused the next drop with "you can attach up to
 * 12 items" to someone who had attached one. That is the case this file pins.
 */
import { describe, it, expect } from 'vitest';
import { countStagedUploads, admitFiles } from './attachmentBudget';

const rows = (uploadId: string, count: number) =>
  Array.from({ length: count }, () => ({ uploadId }));

describe('counting what is staged', () => {
  it('counts a multi-page PDF once, not once per page', () => {
    // The regression: eight pages give eight previews and eight text records,
    // and the answer is still one file.
    expect(countStagedUploads(rows('pdf-1', 8), rows('pdf-1', 8))).toBe(1);
  });

  it('counts distinct files separately', () => {
    expect(countStagedUploads(
      [...rows('a', 3), ...rows('b', 1)],
      [...rows('a', 3), ...rows('c', 2)],
    )).toBe(3);
  });

  it('counts a file present in only one of the two lists', () => {
    // An image has previews and no text; a scanned PDF can be the reverse.
    expect(countStagedUploads(rows('image', 1), [])).toBe(1);
    expect(countStagedUploads([], rows('text-only', 4))).toBe(1);
  });

  it('is zero for nothing staged', () => {
    expect(countStagedUploads([], [])).toBe(0);
  });
});

describe('admitting a drop', () => {
  const files = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);

  it('takes everything when there is room', () => {
    const result = admitFiles(files(3), 0, 12);
    expect(result.accepted).toHaveLength(3);
    expect(result.notices).toEqual([]);
    expect(result.full).toBe(false);
  });

  it('takes exactly the remaining room and says what it dropped', () => {
    const result = admitFiles(files(5), 10, 12);
    expect(result.accepted).toEqual(['f0', 'f1']);
    expect(result.notices).toEqual(['Only the first 2 of 5 files were added (limit 12).']);
  });

  it('fills the last slot exactly, with nothing to report', () => {
    // The off-by-one worth pinning: 11 staged and one dropped must succeed
    // silently, not refuse and not warn.
    const result = admitFiles(files(1), 11, 12);
    expect(result.accepted).toHaveLength(1);
    expect(result.notices).toEqual([]);
    expect(result.full).toBe(false);
  });

  it('refuses once full, and says how to proceed', () => {
    const result = admitFiles(files(1), 12, 12);
    expect(result.accepted).toEqual([]);
    expect(result.full).toBe(true);
    expect(result.notices).toEqual(['You can attach up to 12 items. Remove one to add another.']);
  });

  it('refuses when somehow over the limit, rather than computing negative room', () => {
    const result = admitFiles(files(1), 20, 12);
    expect(result.accepted).toEqual([]);
    expect(result.full).toBe(true);
  });

  it('truncates rather than throwing the whole drop away', () => {
    // Fifteen files at a twelve limit: the user wants the twelve.
    const result = admitFiles(files(15), 0, 12);
    expect(result.accepted).toHaveLength(12);
    expect(result.notices[0]).toContain('Only the first 12 of 15');
  });

  it('handles an empty drop without inventing a notice', () => {
    expect(admitFiles([], 0, 12)).toEqual({ accepted: [], notices: [], full: false });
  });

  it('keeps the order of the drop', () => {
    expect(admitFiles(files(4), 10, 12).accepted).toEqual(['f0', 'f1']);
  });
});
