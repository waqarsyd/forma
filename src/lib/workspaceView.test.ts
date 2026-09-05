/**
 * The bench's pane state machine — the first piece of `App.tsx`'s own stateful
 * logic under test.
 *
 * The headline is the round trip. Five plates are stored in two pieces of
 * state, so every plate needs an entry in the derivation AND a branch in the
 * setter, forty lines apart. A plate with the first and not the second
 * highlights its button and never opens its pane, and the type checker cannot
 * see it: the setter's parameter union already contains the name, and the
 * missing branch falls through to `spec`.
 */
import { describe, it, expect } from 'vitest';
import {
  PLATES, plateFor, stateForPlate, platesThatDoNotRoundTrip,
  type PaneState, type Plate,
} from './workspaceView';

const mockup: PaneState = { activeTab: 'ui', specView: 'spec' };

describe('every plate survives a round trip', () => {
  it('has no plate that can be set but not read back', () => {
    // The one assertion this module exists for. A new plate added to PLATES and
    // to plateFor but not to stateForPlate fails here and nowhere else.
    expect(platesThatDoNotRoundTrip()).toEqual([]);
  });

  it('round-trips from every starting state, not just the default', () => {
    const starts: PaneState[] = [
      { activeTab: 'ui', specView: 'spec' },
      { activeTab: 'spec', specView: 'repx' },
      { activeTab: 'print', specView: 'spec' },
      { activeTab: 'data', specView: 'repx' },
    ];
    for (const start of starts) {
      for (const plate of PLATES) {
        expect(plateFor(stateForPlate(plate, start))).toBe(plate);
      }
    }
  });

  it('lists all five plates in switcher order', () => {
    expect(PLATES).toEqual(['proof', 'print', 'data', 'spec', 'xml']);
  });
});

describe('reading the plate out of the state', () => {
  it('maps each tab to its plate', () => {
    expect(plateFor({ activeTab: 'ui', specView: 'spec' })).toBe('proof');
    expect(plateFor({ activeTab: 'print', specView: 'spec' })).toBe('print');
    expect(plateFor({ activeTab: 'data', specView: 'spec' })).toBe('data');
  });

  it('splits the spec tab by its sub-view', () => {
    expect(plateFor({ activeTab: 'spec', specView: 'spec' })).toBe('spec');
    expect(plateFor({ activeTab: 'spec', specView: 'repx' })).toBe('xml');
  });

  it('ignores specView entirely for the three tab plates', () => {
    // Otherwise "open the mockup" would depend on what was last read in the
    // spec tab, which is a coupling nobody would expect.
    for (const tab of ['ui', 'print', 'data'] as const) {
      expect(plateFor({ activeTab: tab, specView: 'spec' }))
        .toBe(plateFor({ activeTab: tab, specView: 'repx' }));
    }
  });
});

describe('choosing a plate', () => {
  it('carries the sub-view forward when switching to a tab plate', () => {
    // Someone reading the REPX who glances at the mockup and comes back
    // expects the REPX, not the spec.
    const reading: PaneState = { activeTab: 'spec', specView: 'repx' };
    const glanced = stateForPlate('proof', reading);
    expect(glanced.specView).toBe('repx');
    expect(plateFor(stateForPlate('spec', glanced))).toBe('spec');
    expect(plateFor({ ...glanced, activeTab: 'spec' })).toBe('xml');
  });

  it('sets the sub-view for the two plates that own it', () => {
    expect(stateForPlate('spec', mockup)).toEqual({ activeTab: 'spec', specView: 'spec' });
    expect(stateForPlate('xml', mockup)).toEqual({ activeTab: 'spec', specView: 'repx' });
  });

  it('never mutates the state it was given', () => {
    const before = JSON.stringify(mockup);
    for (const plate of PLATES) stateForPlate(plate, mockup);
    expect(JSON.stringify(mockup)).toBe(before);
  });

  it('is idempotent: choosing the plate you are on changes nothing', () => {
    for (const plate of PLATES) {
      const state = stateForPlate(plate, mockup);
      expect(stateForPlate(plate, state)).toEqual(state);
    }
  });
});

describe('the failure this module was extracted to catch', () => {
  it('a plate with no setter branch is detectable', () => {
    // Simulating the mistake rather than trusting the description of it: a
    // setter that falls through to `spec` for one plate, exactly as an
    // unhandled case would.
    const broken = (next: Plate, current: PaneState): PaneState =>
      next === 'data'
        ? { activeTab: 'spec', specView: 'spec' }
        : stateForPlate(next, current);

    const survivors = PLATES.filter((p) => plateFor(broken(p, mockup)) !== p);
    expect(survivors).toEqual(['data']);
    // ...and the real implementation has none, which is the point.
    expect(platesThatDoNotRoundTrip()).toEqual([]);
  });
});
