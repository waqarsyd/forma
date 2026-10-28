import { describe, it, expect } from 'vitest';
import {
  detectRunaway,
  isRunawayOutput,
  RunawayOutputError,
  RUNAWAY_MAX_PERIOD,
  RUNAWAY_WINDOW,
} from './runawayOutput';

/** A plausible stretch of a real response, long enough to fill the window. */
const PROSE =
  '{"markdown":"# Customer List\\n\\nA six-column listing.","layout":{"title":"Customer List","pageWidth":850,' +
  '"sections":[{"id":"s1","name":"PageHeader","type":"header","height":40,"elements":[]}]},"repxContent":"' +
  '<Item1 Ref=\\"3\\" ControlType=\\"XRLabel\\" Name=\\"label1\\" Text=\\"Customer ID\\" LocationFloat=\\"0,0\\" SizeF=\\"100,20\\" />' +
  '<Item2 Ref=\\"4\\" ControlType=\\"XRLabel\\" Name=\\"label2\\" Text=\\"Company\\" LocationFloat=\\"100,0\\" SizeF=\\"200,20\\" />' +
  '<Item3 Ref=\\"5\\" ControlType=\\"XRLabel\\" Name=\\"label3\\" Text=\\"Contact\\" LocationFloat=\\"300,0\\" SizeF=\\"150,20\\" />' +
  '<Item4 Ref=\\"6\\" ControlType=\\"XRLabel\\" Name=\\"label4\\" Text=\\"City\\" LocationFloat=\\"450,0\\" SizeF=\\"100,20\\" />';

describe('detectRunaway', () => {
  it('says no below the window, whatever the text', () => {
    expect(detectRunaway('0'.repeat(RUNAWAY_WINDOW - 1))).toEqual({ runaway: false });
    expect(detectRunaway('')).toEqual({ runaway: false });
  });

  it('catches the loop the benchmark found: a run of zeros', () => {
    const verdict = detectRunaway(PROSE + '"Balance":"1,240.5' + '0'.repeat(RUNAWAY_WINDOW));
    expect(verdict).toEqual({ runaway: true, fragment: '0', repeats: RUNAWAY_WINDOW });
  });

  it('catches a short repeated pattern, and reports the smallest period', () => {
    const verdict = detectRunaway(PROSE + '0.00, '.repeat(200));
    expect(verdict.runaway).toBe(true);
    if (verdict.runaway) {
      // The window starts wherever it starts, so the fragment is some rotation
      // of the pattern -- ", 0.00" is as true an answer as "0.00, ".
      expect(verdict.fragment).toHaveLength(6);
      expect('0.00, 0.00, ').toContain(verdict.fragment);
      expect(verdict.repeats).toBe(Math.floor(RUNAWAY_WINDOW / 6));
    }
  });

  it('is not fooled by a window that is periodic only in its second half', () => {
    expect(detectRunaway(PROSE.repeat(2) + '0'.repeat(RUNAWAY_WINDOW - 1))).toEqual({ runaway: false });
  });

  it('passes ordinary report output, including repeated XML items', () => {
    // Four labels that differ only in Ref, Name and coordinates: repetitive to
    // a reader, never exactly periodic to the detector.
    expect(detectRunaway(PROSE.repeat(3))).toEqual({ runaway: false });
  });

  it('passes indentation and rules, which repeat but not for 512 characters', () => {
    const indented = PROSE + '\n' + ' '.repeat(40) + '<Item5 Ref="7" ControlType="XRLine" />' + '\n' + '-'.repeat(80) + PROSE;
    expect(detectRunaway(indented)).toEqual({ runaway: false });
  });

  it('ignores a period longer than the maximum', () => {
    const fragment = 'abcdefghijklmnopq'; // 17 characters, one over RUNAWAY_MAX_PERIOD
    expect(fragment.length).toBe(RUNAWAY_MAX_PERIOD + 1);
    expect(detectRunaway(PROSE + fragment.repeat(60))).toEqual({ runaway: false });
    const atMax = fragment.slice(0, RUNAWAY_MAX_PERIOD);
    expect(detectRunaway(PROSE + atMax.repeat(60)).runaway).toBe(true);
  });

  it('honours a smaller window and period when asked', () => {
    expect(detectRunaway('ab'.repeat(10), 16, 4)).toEqual({ runaway: true, fragment: 'ab', repeats: 8 });
    expect(detectRunaway('ab'.repeat(10), 32, 4)).toEqual({ runaway: false });
  });
});

describe('RunawayOutputError', () => {
  it('says what repeated, how often and how far in', () => {
    const error = new RunawayOutputError(51813, '0', 512);
    expect(error.name).toBe('RunawayOutputError');
    expect(error.message).toContain('"0"');
    expect(error.message).toContain('512 times');
    expect(error.message).toContain('51813 characters');
    expect(error.chars).toBe(51813);
  });

  it('is recognised by name, so wrapping does not hide it', () => {
    expect(isRunawayOutput(new RunawayOutputError(1, 'x', 1))).toBe(true);
    expect(isRunawayOutput({ name: 'RunawayOutputError', message: 'rethrown' })).toBe(true);
    expect(isRunawayOutput(new Error('RunawayOutputError'))).toBe(false);
    expect(isRunawayOutput(null)).toBe(false);
    expect(isRunawayOutput(undefined)).toBe(false);
  });
});
