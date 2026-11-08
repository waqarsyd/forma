/**
 * The box's model menu as tiers (2026-11-05), as Stitch names its two. A bad
 * pick here sends a report to an image model, or calls Flash-Lite "Balanced".
 */
import { describe, it, expect } from 'vitest';
import { autoNote, displayModel, modelTiers } from './modelTiers';

describe('displayModel', () => {
  it('reads a model id as a person would', () => {
    expect(displayModel('gemini-3.6-flash')).toBe('Gemini 3.6 Flash');
    expect(displayModel('models/gemini-2.5-flash-lite')).toBe('Gemini 2.5 Flash-Lite');
    expect(displayModel('gemini-flash-lite-latest')).toBe('Gemini Flash-Lite (latest)');
  });
});

describe('modelTiers', () => {
  it("offers Fast as the first Flash-Lite and Balanced as the first Flash, in the probe's order, each naming its model", () => {
    const tiers = modelTiers([
      { id: 'gemini-3.1-flash-image', used: 0 },
      { id: 'gemini-3.6-flash', used: 4 },
      { id: 'gemini-3.5-flash', used: 1 },
      { id: 'gemini-flash-lite-latest', used: 9 },
    ]);
    expect(tiers.map((t) => [t.label, t.id, t.used])).toEqual([
      ['Fast', 'gemini-flash-lite-latest', 9],
      ['Balanced', 'gemini-3.6-flash', 4],
    ]);
    expect(tiers[1].note).toBe('Gemini 3.6 Flash for new reports and redesigns.');
    expect(tiers[0].note).toBe('Gemini Flash-Lite (latest) for quick answers and edits.');
  });

  // 2026-11-08: Auto names the model it runs on, once the key's first request has found it.
  it("names Auto's model once it is known", () => {
    expect(autoNote('gemini-3.6-flash')).toBe('Gemini 3.6 Flash for now. Forma picks the best model your key can use.');
    expect(autoNote(null)).toBe('Forma picks the best model your key can use.');
  });

  it('leaves out a tier the key has no model for', () => {
    expect(modelTiers([{ id: 'gemini-flash-lite-latest', used: 0 }]).map((t) => t.label)).toEqual(['Fast']);
    expect(modelTiers([])).toEqual([]);
  });
});
