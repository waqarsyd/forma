import { describe, it, expect } from 'vitest';
import {
  pushRevision, diffReports, describeDiff, MAX_REVISIONS,
  type Revision, type RevisionSnapshot,
} from './revisions';

const snapshot = (repx: string, title = 'Report'): RevisionSnapshot => ({
  content: '# spec', repxContent: repx, title,
});

const control = (name: string, loc = '10,10', size = '100,20', text = 'x') =>
  `<Item1 Ref="9" ControlType="XRLabel" Name="${name}" Text="${text}" LocationFloat="${loc}" SizeF="${size}" />`;

const report = (controls: string, bands = 1) =>
  '<XtraReportsLayoutSerializer><Bands>' +
  '<Item1 ControlType="TopMarginBand" Name="TopMargin" />' +
  Array.from({ length: bands }, (_, i) =>
    `<Item${i + 2} ControlType="DetailBand" Name="Detail${i}"><Controls>${i === 0 ? controls : ''}</Controls></Item${i + 2}>`,
  ).join('') +
  '<Item9 ControlType="BottomMarginBand" Name="BottomMargin" />' +
  '</Bands></XtraReportsLayoutSerializer>';

describe('keeping revisions', () => {
  it('adds the first one', () => {
    const list = pushRevision([], 'Generated', snapshot('<a/>'), { now: 1 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 1, label: 'Generated', at: 1 });
  });

  it('puts the newest first, because that is the end worth reading', () => {
    let list = pushRevision([], 'Generated', snapshot('<a/>'));
    list = pushRevision(list, 'Refined', snapshot('<b/>'));
    expect(list.map((r) => r.label)).toEqual(['Refined', 'Generated']);
  });

  it('numbers revisions monotonically', () => {
    let list = pushRevision([], 'a', snapshot('<1/>'));
    list = pushRevision(list, 'b', snapshot('<2/>'));
    list = pushRevision(list, 'c', snapshot('<3/>'));
    expect(list.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('ignores a change that left the REPX identical', () => {
    // A refinement that reworded only the markdown has not changed the report,
    // and a list half full of identical files is a list nobody reads.
    const list = pushRevision([], 'Generated', snapshot('<a/>', 'One'));
    const same = pushRevision(list, 'Refined', snapshot('<a/>', 'Two'));
    expect(same).toHaveLength(1);
    expect(same[0].label).toBe('Generated');
  });

  it('keeps a later revision that returns to an earlier REPX', () => {
    // Only the NEWEST is compared: going back to a previous state is a real
    // event worth recording, not a duplicate.
    let list = pushRevision([], 'a', snapshot('<1/>'));
    list = pushRevision(list, 'b', snapshot('<2/>'));
    list = pushRevision(list, 'c', snapshot('<1/>'));
    expect(list.map((r) => r.label)).toEqual(['c', 'b', 'a']);
  });

  it('drops the oldest once it is full', () => {
    let list: Revision[] = [];
    for (let i = 0; i < MAX_REVISIONS + 5; i++) {
      list = pushRevision(list, `r${i}`, snapshot(`<${i}/>`));
    }
    expect(list).toHaveLength(MAX_REVISIONS);
    expect(list[0].label).toBe(`r${MAX_REVISIONS + 4}`);
    expect(list.at(-1)!.label).toBe('r5');
  });

  it('honours a smaller cap', () => {
    let list: Revision[] = [];
    for (let i = 0; i < 5; i++) list = pushRevision(list, `r${i}`, snapshot(`<${i}/>`), { max: 3 });
    expect(list.map((r) => r.label)).toEqual(['r4', 'r3', 'r2']);
  });

  it('never mutates the list it was given', () => {
    const list = pushRevision([], 'a', snapshot('<1/>'));
    const before = JSON.stringify(list);
    pushRevision(list, 'b', snapshot('<2/>'));
    pushRevision(list, 'dup', snapshot('<1/>'));
    expect(JSON.stringify(list)).toBe(before);
  });

  it('carries the whole snapshot, so a restore is complete', () => {
    const list = pushRevision([], 'a', { content: '# spec', repxContent: '<x/>', title: 'T', layout: { sections: [] } });
    expect(list[0].snapshot).toMatchObject({ content: '# spec', repxContent: '<x/>', title: 'T' });
    expect(list[0].snapshot.layout).toEqual({ sections: [] });
  });
});

describe('what changed between two reports', () => {
  it('names an added control', () => {
    const diff = diffReports(report(control('a')), report(control('a') + control('b')));
    expect(diff.added).toEqual(['b']);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('names a removed control', () => {
    const diff = diffReports(report(control('a') + control('b')), report(control('a')));
    expect(diff.removed).toEqual(['b']);
  });

  it('notices a move, a resize and a retype', () => {
    for (const [before, after] of [
      [control('a', '10,10'), control('a', '90,10')],
      [control('a', '10,10', '100,20'), control('a', '10,10', '400,20')],
      [control('a', '10,10', '100,20', 'x'), control('a', '10,10', '100,20', 'y')],
    ]) {
      expect(diffReports(report(before), report(after)).changed).toEqual(['a']);
    }
  });

  it('matches by name, not by position', () => {
    // The trap: inserting a control at the top makes a positional diff report
    // every control below it as changed.
    const before = report(control('a') + control('b'));
    const after = report(control('z') + control('a') + control('b'));
    const diff = diffReports(before, after);
    expect(diff.added).toEqual(['z']);
    expect(diff.changed).toEqual([]);
  });

  it('ignores a restyle, which is not a structural change', () => {
    const before = report('<Item1 ControlType="XRLabel" Name="a" Text="x" LocationFloat="1,1" SizeF="2,2" Font="Arial, 9pt" />');
    const after = before.replace('Arial, 9pt', 'Arial, 14pt, style=Bold');
    expect(diffReports(before, after).changed).toEqual([]);
  });

  it('counts content bands on both sides, margins excluded', () => {
    const diff = diffReports(report(control('a'), 1), report(control('a'), 3));
    expect(diff.bands).toEqual({ from: 1, to: 3 });
  });

  it('reports the size either side', () => {
    const diff = diffReports('<a/>', '<abcdef/>');
    expect(diff.bytes).toEqual({ from: 4, to: 9 });
  });

  it('finds nothing between a report and itself', () => {
    const same = report(control('a') + control('b'));
    const diff = diffReports(same, same);
    expect([diff.added, diff.removed, diff.changed]).toEqual([[], [], []]);
  });

  it('treats an empty previous as everything added', () => {
    const diff = diffReports('', report(control('a')));
    expect(diff.added).toEqual(['a']);
  });
});

describe('describing the diff in one line', () => {
  it('says nothing when nothing structural moved', () => {
    const same = report(control('a'));
    expect(describeDiff(diffReports(same, same))).toBe('');
  });

  it('leads with a band change, which is the biggest thing that can happen', () => {
    const line = describeDiff(diffReports(report(control('a'), 1), report(control('b'), 3)));
    expect(line.startsWith('1 → 3 bands')).toBe(true);
  });

  it('counts each kind', () => {
    const before = report(control('a') + control('b', '1,1'));
    const after = report(control('b', '9,9') + control('c'));
    expect(describeDiff(diffReports(before, after))).toBe('1 added · 1 removed · 1 changed');
  });
});
