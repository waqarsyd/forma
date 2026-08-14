import { describe, it, expect } from 'vitest';
import {
  clampReviewWidth,
  readReviewWidth,
  REVIEW_DEFAULT_WIDTH,
  REVIEW_MIN_WIDTH,
  REVIEW_MAX_WIDTH,
} from './panelSize';

/**
 * Every case here is a workspace the user cannot get out of by hand. The width
 * is written back from the same state it is read into, so a bad value is not a
 * one-off bad render — it is the layout from then on, including the one where
 * the column is too narrow to contain the handle that would widen it again.
 */
describe('clampReviewWidth', () => {
  it('leaves a reasonable width alone', () => {
    expect(clampReviewWidth(420)).toBe(420);
  });

  it('never returns a column too narrow to grab', () => {
    expect(clampReviewWidth(4)).toBe(REVIEW_MIN_WIDTH);
    expect(clampReviewWidth(-800)).toBe(REVIEW_MIN_WIDTH);
    expect(clampReviewWidth(0)).toBe(REVIEW_MIN_WIDTH);
  });

  it('never returns a column that would swallow the bench', () => {
    expect(clampReviewWidth(9999)).toBe(REVIEW_MAX_WIDTH);
  });

  /* What End on the resize handle asks for. On a wide screen it reaches the
     ceiling; on a narrower one it stops at what is left after the bench's
     reserve, which is why the handle asks this function for its bound rather
     than assigning the constant. */
  it('reaches the ceiling only when the window can pay for it', () => {
    expect(clampReviewWidth(REVIEW_MAX_WIDTH, 1920)).toBe(REVIEW_MAX_WIDTH);
    expect(clampReviewWidth(REVIEW_MAX_WIDTH, 1000)).toBe(524);
    expect(clampReviewWidth(REVIEW_MAX_WIDTH, 900)).toBe(424);
  });

  it('falls back rather than propagating a non-number', () => {
    expect(clampReviewWidth(Number.NaN)).toBe(REVIEW_DEFAULT_WIDTH);
    expect(clampReviewWidth(Number.POSITIVE_INFINITY)).toBe(REVIEW_DEFAULT_WIDTH);
  });

  it('rounds, because the value becomes a CSS pixel length', () => {
    expect(clampReviewWidth(413.6)).toBe(414);
  });

  it('leaves the width alone on a window that can still afford it', () => {
    expect(clampReviewWidth(520, 1200)).toBe(520);
  });

  /* The case that motivated the second argument: a column dragged out on a wide
     monitor, reopened on a laptop. Without the viewport the stored 700 stands
     and the bench is left with 224px of a 1000px window. */
  it('shrinks the column when the window cannot afford it', () => {
    expect(clampReviewWidth(700, 1000)).toBe(524);
    expect(clampReviewWidth(700, 900)).toBe(424);
  });

  /* Below ~736px the two bounds contradict each other. The minimum wins: that
     window is already in the stacked single-column layout, where the width is
     not applied at all. */
  it('keeps the minimum when the viewport cannot satisfy both bounds', () => {
    expect(clampReviewWidth(500, 600)).toBe(REVIEW_MIN_WIDTH);
    expect(clampReviewWidth(200, 400)).toBe(REVIEW_MIN_WIDTH);
  });
});

describe('readReviewWidth', () => {
  it('reads back what was stored', () => {
    expect(readReviewWidth('512')).toBe(512);
  });

  it('uses the default when nothing is stored', () => {
    expect(readReviewWidth(null)).toBe(REVIEW_DEFAULT_WIDTH);
    expect(readReviewWidth('')).toBe(REVIEW_DEFAULT_WIDTH);
    expect(readReviewWidth('   ')).toBe(REVIEW_DEFAULT_WIDTH);
  });

  it('does not trust the string it is handed', () => {
    expect(readReviewWidth('wide')).toBe(REVIEW_DEFAULT_WIDTH);
    expect(readReviewWidth('340px')).toBe(REVIEW_DEFAULT_WIDTH);
    expect(readReviewWidth('-340')).toBe(REVIEW_DEFAULT_WIDTH);
    expect(readReviewWidth('[]')).toBe(REVIEW_DEFAULT_WIDTH);
  });

  it('clamps a stored value that is out of range', () => {
    expect(readReviewWidth('20000')).toBe(REVIEW_MAX_WIDTH);
    expect(readReviewWidth('12')).toBe(REVIEW_MIN_WIDTH);
  });
});
