/**
 * A batch kept in this browser, the pure half (2026-11-10, the AI accuracy
 * programme, batch AG item 23). The IndexedDB half is not tested here: jsdom
 * has none, as `libraryDb.test.ts` records for its own store.
 */
import { describe, expect, it } from 'vitest';
import { keptNote, restoredQueue, resultFromKept, stopsTheBatch } from './batchCheckpoint';
import { createQueue, markDone, markRunning } from './batchQueue';

const done = { title: 'R', repxContent: '<x/>', bands: 3, errors: 0, warnings: 0 };

describe('a batch opened again', () => {
  it('does again the file that was running when the tab went, and keeps what was done', () => {
    let q = createQueue(['a.png', 'b.png', 'c.png']);
    q = markDone(markRunning(q, q[0].id), q[0].id, done);
    q = markRunning(q, q[1].id);
    expect(restoredQueue(q).map((i) => i.status)).toEqual(['done', 'pending', 'pending']);
    expect(restoredQueue(q)[0].repxContent).toBe('<x/>');
  });

  it('says what it kept and from when', () => {
    let q = createQueue(['a.png', 'b.png', 'c.png']);
    q = markDone(markRunning(q, q[0].id), q[0].id, done);
    const now = new Date(2026, 10, 10, 15, 0).getTime();
    expect(keptNote(q, new Date(2026, 10, 10, 9, 30).getTime(), now)).toMatch(/^Kept in this browser from today at .+: 1 of 3 done, 2 to go\. Retry carries on from there; Clear removes it\.$/);
    expect(keptNote(q.map((i) => ({ ...i, status: 'done' as const })), new Date(2026, 10, 9).getTime(), now)).toMatch(/^Kept in this browser from .+: all 3 done\. Clear removes it\.$/);
  });
});

describe('a failure every file would meet', () => {
  it('is a limit, or the key; anything else lets the next file try', () => {
    expect(stopsTheBatch('This key’s free daily allowance is used up.', true)).toBe('limit');
    expect(stopsTheBatch('Your Gemini API key was rejected.', false)).toBe('key');
    expect(stopsTheBatch('OpenRouter rejected the key. Check it in Settings.', false)).toBe('key');
    expect(stopsTheBatch('The PDF could not be read.', false)).toBeNull();
  });
});

describe('a finished row kept from an earlier visit', () => {
  it('opens as a report read off its REPX, and a row with none opens nothing', () => {
    const repx = '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Invoice" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100" /></Bands></XtraReportsLayoutSerializer>';
    const opened = resultFromKept({ title: 'Invoice', repxContent: repx })!;
    expect(opened.title).toBe('Invoice');
    expect(opened.repxContent).toBe(repx);
    expect(opened.layout).toBeTruthy();
    expect(typeof opened.content).toBe('string');
    expect(resultFromKept({ title: 'x', repxContent: '' })).toBeNull();
  });
});
