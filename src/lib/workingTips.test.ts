/** The tip above the box while Forma works (2026-11-06), as Stitch's. */
import { describe, it, expect } from 'vitest';
import { WORKING_TIPS, forPlatform, tipAt } from './workingTips';

describe('workingTips', () => {
  it('holds distinct sentences short enough for one line above the box', () => {
    expect(new Set(WORKING_TIPS).size).toBe(WORKING_TIPS.length);
    for (const tip of WORKING_TIPS) {
      expect(tip).toMatch(/^[A-Z"].*[.]$/);
      expect(tip.length).toBeLessThanOrEqual(90);
    }
  });

  it('walks the tips from a starting point and wraps round', () => {
    expect(tipAt(0, 0)).toBe(WORKING_TIPS[0]);
    expect(tipAt(2, 1)).toBe(WORKING_TIPS[3]);
    expect(tipAt(WORKING_TIPS.length - 1, 1)).toBe(WORKING_TIPS[0]);
    expect(tipAt(0, -1)).toBe(WORKING_TIPS[WORKING_TIPS.length - 1]);
  });

  it('writes Ctrl as the Command key on a Mac, and leaves a PC alone', () => {
    expect(forPlatform('Press Ctrl+K to find it.', true)).toBe('Press ⌘K to find it.');
    expect(forPlatform('Press Ctrl+K to find it.', false)).toBe('Press Ctrl+K to find it.');
  });
});
