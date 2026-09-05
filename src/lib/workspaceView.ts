/**
 * Which pane the bench is showing, as a state machine instead of two ternaries.
 *
 * ## Why this left `App.tsx`
 *
 * The bench's five plates — Mockup, Preview, Data, Spec, REPX — are stored in
 * TWO pieces of state, because Spec and REPX are sub-views of one tab and the
 * other three are tabs of their own. That means every plate needs an entry in
 * the derivation *and* a branch in the setter, and the two are forty lines
 * apart.
 *
 * A plate with a derivation and no setter branch is the failure this shape
 * invites: the button highlights correctly, the pane never opens, and nothing
 * throws. Both new plates added on 2026-09-05 needed edits in both places, and
 * neither the type checker nor any test could have said so — `showPlate` took a
 * union that already included the new name, and the missing branch simply fell
 * through to `spec`.
 *
 * So the pair is one module with a round-trip test: for every plate, setting it
 * and then deriving it must give the same plate back. That single property is
 * what a missing branch fails.
 *
 * `routes.ts` does the same job for URLs and states the same reasoning — its
 * `routesWithoutABranch()` exists because a new route without a branch renders
 * the home page with a correct-looking address bar. This is that lesson applied
 * to the bench.
 */

/** What the user sees selected in the plate switcher. */
export type Plate = 'proof' | 'print' | 'data' | 'spec' | 'xml';

/** The tab piece of the state. `ui` is the mockup, for historical reasons. */
export type ActiveTab = 'ui' | 'print' | 'data' | 'spec';

/** The sub-view piece, meaningful only while `activeTab` is `spec`. */
export type SpecView = 'spec' | 'repx';

export interface PaneState {
  activeTab: ActiveTab;
  specView: SpecView;
}

/**
 * Every plate, in the order the switcher shows them.
 *
 * Exported so the round-trip test iterates the real list rather than a copy
 * that can go stale — the same reason `routes.ts` exports `ROUTES`.
 */
export const PLATES: readonly Plate[] = ['proof', 'print', 'data', 'spec', 'xml'] as const;

/** The plate a given state displays. */
export function plateFor(state: PaneState): Plate {
  switch (state.activeTab) {
    case 'ui': return 'proof';
    case 'print': return 'print';
    case 'data': return 'data';
    case 'spec': return state.specView === 'repx' ? 'xml' : 'spec';
  }
}

/**
 * The state that shows a plate.
 *
 * `specView` is carried forward rather than reset for the three tab plates,
 * because it is not theirs to change: someone reading the REPX who glances at
 * the mockup and comes back expects the REPX, not the spec. Only the two
 * sub-view plates set it.
 */
export function stateForPlate(next: Plate, current: PaneState): PaneState {
  switch (next) {
    case 'proof': return { ...current, activeTab: 'ui' };
    case 'print': return { ...current, activeTab: 'print' };
    case 'data': return { ...current, activeTab: 'data' };
    case 'spec': return { activeTab: 'spec', specView: 'spec' };
    case 'xml': return { activeTab: 'spec', specView: 'repx' };
  }
}

/**
 * Plates that do not survive a round trip.
 *
 * Must stay **empty**. A non-empty result means a plate can be selected and
 * then reads back as a different one, which on screen is a button that
 * highlights and a pane that never opens. `workspaceView.test.ts` asserts it.
 */
export function platesThatDoNotRoundTrip(): Plate[] {
  const start: PaneState = { activeTab: 'ui', specView: 'spec' };
  return PLATES.filter((plate) => plateFor(stateForPlate(plate, start)) !== plate);
}
