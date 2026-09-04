/**
 * The case that matters is the empty one. Two live runs on 2026-09-04 both sent
 * `Prompt: ""` and the same source image produced a Detail band with twelve
 * bound columns on one and no Detail band at all on the other — an empty
 * instruction is an ambiguous input, not a neutral one, and it used to be
 * replaced with an invented sentence before it ever reached the model.
 */
import { describe, it, expect } from 'vitest';
import { instructionBlock } from './userInstructions';

describe('instructionBlock with no instruction', () => {
  it('says there is none rather than inventing one', () => {
    const block = instructionBlock('');
    expect(block).toContain('USER INSTRUCTIONS: NONE');
    expect(block).not.toContain('Generate a professional DevExpress report layout');
  });

  it('treats whitespace as empty, so a stray space cannot flip the mode', () => {
    for (const value of ['', '   ', '\n', '\t ', null, undefined]) {
      expect(instructionBlock(value)).toContain('USER INSTRUCTIONS: NONE');
    }
  });

  it('does not ask for modifications when nothing was requested', () => {
    // Step 2 of the old block said "apply the USER INSTRUCTIONS as specific
    // modifications", which is an invitation to invent a change.
    const block = instructionBlock('');
    expect(block).not.toMatch(/apply the USER INSTRUCTIONS as specific modifications/i);
    expect(block).toMatch(/do NOT invent a modification/i);
  });

  it('tells the model to reproduce the source instead', () => {
    expect(instructionBlock('')).toMatch(/Reproduce the attachment\(s\) as faithfully/i);
  });
});

describe('instructionBlock with an instruction', () => {
  it('quotes what the user actually wrote', () => {
    const block = instructionBlock('Make the totals bold.');
    expect(block).toContain('USER INSTRUCTIONS / CHAT REQUEST:');
    expect(block).toContain('"Make the totals bold."');
  });

  it('keeps the two-step ordering, which only makes sense when there is a request', () => {
    const block = instructionBlock('Add a logo.');
    expect(block).toMatch(/FIRST, build the complete, pixel-perfect base layout/);
    expect(block).toMatch(/THEN, apply the USER INSTRUCTIONS as specific modifications/);
    expect(block).toMatch(/NEVER discard the rest of the report structure/);
  });

  it('trims the instruction without altering it', () => {
    expect(instructionBlock('  Add a footer.  ')).toContain('"Add a footer."');
  });
});

describe('instructionBlock and the previous report state', () => {
  it('names the attachments as the source for a first run', () => {
    expect(instructionBlock('Add a logo.')).toContain('from the attachment(s)');
    expect(instructionBlock('')).toContain('Reproduce the attachment(s)');
  });

  it('names the previous report when one is being modified', () => {
    const opts = { hasPreviousState: true };
    expect(instructionBlock('Add a logo.', opts)).toContain('from the PREVIOUS REPORT STATE');
    expect(instructionBlock('', opts)).toContain('Reproduce the PREVIOUS REPORT STATE');
  });
});
