/**
 * The Preview's data, against what DevExpress 20.1 PRINTED: case s17 of
 * docs/proposals/devexpress-parity.md (`RepxProbe render`, 2026-10-30) put a
 * summary of every scope in every band of a report of 50 records in three groups
 * over three pages. The scopes below are DevExpress's own pages and groups, so
 * this checks what each band reads -- the text, not the pagination, which the
 * layout tests check end to end.
 */
import { describe, it, expect } from 'vitest';
import { ReportData, groupRuns, sortCompare, sortedOrder, typeRows, type TextData, type TextScope } from './reportData';

type Spec = [name: string, expression: string, x: number, y: number, running?: string, format?: string];
const SPEC: Record<string, Spec[]> = {
  ReportHeader: [
    ["rh_report","sumSum([Qty])",0,0,"Report"],
    ["rh_page","sumSum([Qty])",125,0,"Page"],
    ["rh_group","sumSum([Qty])",250,0,"Group"],
    ["rh_none","sumSum([Qty])",375,0,""],
    ["rh_count","sumCount()",500,0,"Report"],
    ["rh_rrep","sumRunningSum([Qty])",625,0,"Report"],
    ["rh_qty","[Qty]",0,18],
  ],
  PageHeader: [
    ["ph_page","sumSum([Qty])",0,0,"Page"],
    ["ph_report","sumSum([Qty])",125,0,"Report"],
    ["ph_group","sumSum([Qty])",250,0,"Group"],
    ["ph_pcount","sumCount()",375,0,"Page"],
    ["ph_rrep","sumRunningSum([Qty])",500,0,"Report"],
    ["ph_rpage","sumRunningSum([Qty])",625,0,"Page"],
    ["ph_qty","[Qty]",0,18],
  ],
  GroupHeader: [
    ["gh_region","[Region]",0,0],
    ["gh_group","sumSum([Qty])",125,0,"Group"],
    ["gh_report","sumSum([Qty])",250,0,"Report"],
    ["gh_page","sumSum([Qty])",375,0,"Page"],
    ["gh_count","sumCount()",500,0,"Group"],
    ["gh_rsum","sumRunningSum([Qty])",625,0,"Group"],
    ["gh_qty","[Qty]",0,18],
  ],
  Detail: [
    ["d_qty","[Qty]",0,0],
    ["d_group","sumSum([Qty])",60,0,"Group"],
    ["d_report","sumSum([Qty])",185,0,"Report"],
    ["d_page","sumSum([Qty])",310,0,"Page"],
    ["d_none","sumSum([Qty])",435,0,""],
    ["d_rgroup","sumRunningSum([Qty])",560,0,"Group"],
    ["d_recgroup","sumRecordNumber()",0,18,"Group"],
    ["d_recpage","sumRecordNumber()",125,18,"Page"],
    ["d_recreport","sumRecordNumber()",250,18,"Report"],
    ["d_rpage","sumRunningSum([Qty])",375,18,"Page"],
    ["d_avg","sumAvg([Qty])",500,18,"Group"],
    ["d_nullfmt","[Missing]",625,18,undefined,"Total: {0:c2}"],
  ],
  GroupFooter: [
    ["gf_group","sumSum([Qty])",0,0,"Group"],
    ["gf_page","sumSum([Qty])",125,0,"Page"],
    ["gf_report","sumSum([Qty])",250,0,"Report"],
    ["gf_rsum","sumRunningSum([Qty])",375,0,"Group"],
    ["gf_rec","sumRecordNumber()",500,0,"Group"],
    ["gf_qty","[Qty]",0,18],
    ["gf_region","[Region]",125,18],
  ],
  PageFooter: [
    ["pf_page","sumSum([Qty])",0,0,"Page"],
    ["pf_report","sumSum([Qty])",125,0,"Report"],
    ["pf_group","sumSum([Qty])",250,0,"Group"],
    ["pf_none","sumSum([Qty])",375,0,""],
    ["pf_rrep","sumRunningSum([Qty])",500,0,"Report"],
    ["pf_qty","[Qty]",0,18],
    ["pf_groupfmt","sumSum([Qty])",125,18,"Group","{0:c2}"],
  ],
  ReportFooter: [
    ["rf_report","sumSum([Qty])",0,0,"Report"],
    ["rf_page","sumSum([Qty])",125,0,"Page"],
    ["rf_rrep","sumRunningSum([Qty])",250,0,"Report"],
    ["rf_qty","[Qty]",0,18],
  ],
};
const ROWS = [{"Region":"North","Qty":"1"},{"Region":"North","Qty":"2"},{"Region":"North","Qty":"3"},{"Region":"North","Qty":"4"},{"Region":"North","Qty":"5"},{"Region":"North","Qty":"6"},{"Region":"North","Qty":"7"},{"Region":"North","Qty":"8"},{"Region":"North","Qty":"9"},{"Region":"North","Qty":"10"},{"Region":"North","Qty":"11"},{"Region":"North","Qty":"12"},{"Region":"North","Qty":"13"},{"Region":"North","Qty":"14"},{"Region":"North","Qty":"15"},{"Region":"South","Qty":"16"},{"Region":"South","Qty":"17"},{"Region":"South","Qty":"18"},{"Region":"South","Qty":"19"},{"Region":"South","Qty":"20"},{"Region":"South","Qty":"21"},{"Region":"South","Qty":"22"},{"Region":"South","Qty":"23"},{"Region":"South","Qty":"24"},{"Region":"South","Qty":"25"},{"Region":"South","Qty":"26"},{"Region":"South","Qty":"27"},{"Region":"South","Qty":"28"},{"Region":"South","Qty":"29"},{"Region":"South","Qty":"30"},{"Region":"South","Qty":"31"},{"Region":"South","Qty":"32"},{"Region":"South","Qty":"33"},{"Region":"South","Qty":"34"},{"Region":"South","Qty":"35"},{"Region":"West","Qty":"36"},{"Region":"West","Qty":"37"},{"Region":"West","Qty":"38"},{"Region":"West","Qty":"39"},{"Region":"West","Qty":"40"},{"Region":"West","Qty":"41"},{"Region":"West","Qty":"42"},{"Region":"West","Qty":"43"},{"Region":"West","Qty":"44"},{"Region":"West","Qty":"45"},{"Region":"West","Qty":"46"},{"Region":"West","Qty":"47"},{"Region":"West","Qty":"48"},{"Region":"West","Qty":"49"},{"Region":"West","Qty":"50"}];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ALL = range(0, ROWS.length - 1);
/** Every record with any part on the page, as DevExpress paginated it: record 21 was split across pages 1 and 2. */
const PAGES = [range(0, 20), range(20, 42), range(43, 49)];
const GROUPS = [range(0, 14), range(15, 34), range(35, 49)];

/** What DevExpress printed, per control, in print order, prefixed by its page. */
const PRINTED: Record<string, string[]> = {
  d_avg: ["p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:8","p1:25.5","p1:25.5","p1:25.5","p1:25.5","p1:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:25.5","p2:43","p2:43","p2:43","p2:43","p2:43","p2:43","p2:43","p2:43","p3:43","p3:43","p3:43","p3:43","p3:43","p3:43","p3:43"],
  d_group: ["p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:120","p1:510","p1:510","p1:510","p1:510","p1:510","p1:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:510","p2:645","p2:645","p2:645","p2:645","p2:645","p2:645","p2:645","p2:645","p3:645","p3:645","p3:645","p3:645","p3:645","p3:645","p3:645"],
  d_none: ["p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)"],
  d_nullfmt: ["p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p1:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p2:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)","p3:(blank)"],
  d_page: ["p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:231","p1:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p2:736","p3:329","p3:329","p3:329","p3:329","p3:329","p3:329","p3:329"],
  d_qty: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p1:21","p2:22","p2:23","p2:24","p2:25","p2:26","p2:27","p2:28","p2:29","p2:30","p2:31","p2:32","p2:33","p2:34","p2:35","p2:36","p2:37","p2:38","p2:39","p2:40","p2:41","p2:42","p2:43","p3:44","p3:45","p3:46","p3:47","p3:48","p3:49","p3:50"],
  d_recgroup: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:1","p1:2","p1:3","p1:4","p1:5","p2:6","p2:7","p2:8","p2:9","p2:10","p2:11","p2:12","p2:13","p2:14","p2:15","p2:16","p2:17","p2:18","p2:19","p2:20","p2:1","p2:2","p2:3","p2:4","p2:5","p2:6","p2:7","p2:8","p3:9","p3:10","p3:11","p3:12","p3:13","p3:14","p3:15"],
  d_recpage: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p2:1","p2:2","p2:3","p2:4","p2:5","p2:6","p2:7","p2:8","p2:9","p2:10","p2:11","p2:12","p2:13","p2:14","p2:15","p2:16","p2:17","p2:18","p2:19","p2:20","p2:21","p2:22","p2:23","p3:1","p3:2","p3:3","p3:4","p3:5","p3:6","p3:7"],
  d_recreport: ["p1:1","p1:2","p1:3","p1:4","p1:5","p1:6","p1:7","p1:8","p1:9","p1:10","p1:11","p1:12","p1:13","p1:14","p1:15","p1:16","p1:17","p1:18","p1:19","p1:20","p2:21","p2:22","p2:23","p2:24","p2:25","p2:26","p2:27","p2:28","p2:29","p2:30","p2:31","p2:32","p2:33","p2:34","p2:35","p2:36","p2:37","p2:38","p2:39","p2:40","p2:41","p2:42","p2:43","p3:44","p3:45","p3:46","p3:47","p3:48","p3:49","p3:50"],
  d_report: ["p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p1:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p2:1275","p3:1275","p3:1275","p3:1275","p3:1275","p3:1275","p3:1275","p3:1275"],
  d_rgroup: ["p1:1","p1:3","p1:6","p1:10","p1:15","p1:21","p1:28","p1:36","p1:45","p1:55","p1:66","p1:78","p1:91","p1:105","p1:120","p1:16","p1:33","p1:51","p1:70","p1:90","p1:111","p2:133","p2:156","p2:180","p2:205","p2:231","p2:258","p2:286","p2:315","p2:345","p2:376","p2:408","p2:441","p2:475","p2:510","p2:36","p2:73","p2:111","p2:150","p2:190","p2:231","p2:273","p2:316","p3:360","p3:405","p3:451","p3:498","p3:546","p3:595","p3:645"],
  d_rpage: ["p1:1","p1:3","p1:6","p1:10","p1:15","p1:21","p1:28","p1:36","p1:45","p1:55","p1:66","p1:78","p1:91","p1:105","p1:120","p1:136","p1:153","p1:171","p1:190","p1:210","p2:21","p2:43","p2:66","p2:90","p2:115","p2:141","p2:168","p2:196","p2:225","p2:255","p2:286","p2:318","p2:351","p2:385","p2:420","p2:456","p2:493","p2:531","p2:570","p2:610","p2:651","p2:693","p2:736","p3:44","p3:89","p3:135","p3:182","p3:230","p3:279","p3:329"],
  gf_group: ["p1:120","p2:510","p3:645"],
  gf_page: ["p1:231","p2:736","p3:329"],
  gf_qty: ["p1:15","p2:35","p3:50"],
  gf_rec: ["p1:15","p2:20","p3:15"],
  gf_region: ["p1:North","p2:South","p3:West"],
  gf_report: ["p1:1275","p2:1275","p3:1275"],
  gf_rsum: ["p1:120","p2:510","p3:645"],
  gh_count: ["p1:15","p1:20","p2:15"],
  gh_group: ["p1:120","p1:510","p2:645"],
  gh_page: ["p1:231","p1:231","p2:736"],
  gh_qty: ["p1:1","p1:16","p2:36"],
  gh_region: ["p1:North","p1:South","p2:West"],
  gh_report: ["p1:1275","p1:1275","p2:1275"],
  gh_rsum: ["p1:120","p1:510","p2:645"],
  pf_group: ["p1:?","p2:?","p3:?"],
  pf_groupfmt: ["p1:?","p2:?","p3:?"],
  pf_none: ["p1:(blank)","p2:(blank)","p3:(blank)"],
  pf_page: ["p1:231","p2:736","p3:329"],
  pf_qty: ["p1:21","p2:43","p3:50"],
  pf_report: ["p1:1275","p2:1275","p3:1275"],
  pf_rrep: ["p1:231","p2:946","p3:1275"],
  ph_group: ["p1:?","p2:?","p3:?"],
  ph_page: ["p1:231","p2:736","p3:329"],
  ph_pcount: ["p1:21","p2:23","p3:7"],
  ph_qty: ["p1:1","p2:21","p3:44"],
  ph_report: ["p1:1275","p2:1275","p3:1275"],
  ph_rpage: ["p1:231","p2:736","p3:329"],
  ph_rrep: ["p1:231","p2:946","p3:1275"],
  rf_page: ["p3:329"],
  rf_qty: ["p3:50"],
  rf_report: ["p3:1275"],
  rf_rrep: ["p3:1275"],
  rh_count: ["p1:50"],
  rh_group: ["p1:?"],
  rh_none: ["p1:(blank)"],
  rh_page: ["p1:231"],
  rh_qty: ["p1:1"],
  rh_report: ["p1:1275"],
  rh_rrep: ["p1:1275"],
};

const dataOf = ([, expression, , , running, format]: Spec): TextData => ({
  expression, running: running === undefined ? null : running === '' ? 'None' : running, format: format ?? null,
});

/** The scope of the n-th printed instance of a control in `band`, on page `p` (0-based). */
function scopeOf(band: string, n: number, p: number): TextScope {
  const page = PAGES[p];
  const last = (list: number[]) => list[list.length - 1];
  switch (band) {
    // A split record reads the page it finishes on, in every part: record 21 printed
    // page 2's total in the part that sits on page 1.
    case 'Detail': {
      const finish = PAGES.map((pg, i) => (pg.includes(n) ? i : -1)).filter((i) => i >= 0).pop()!;
      return { row: n, anchor: n, report: ALL, group: GROUPS.find((g) => g.includes(n))!, page: PAGES[finish] };
    }
    case 'GroupHeader': return { row: GROUPS[n][0], anchor: last(GROUPS[n]), report: ALL, group: GROUPS[n], page };
    case 'GroupFooter': return { row: last(GROUPS[n]), anchor: last(GROUPS[n]), report: ALL, group: GROUPS[n], page };
    case 'PageHeader': return { row: page[0], anchor: last(page), report: ALL, group: null, page };
    case 'PageFooter': return { row: last(page), anchor: last(page), report: ALL, group: null, page };
    case 'ReportHeader': return { row: 0, anchor: last(ALL), report: ALL, group: null, page };
    default: return { row: last(ALL), anchor: last(ALL), report: ALL, group: null, page };
  }
}

describe('ReportData, as DevExpress printed every scope in every band', () => {
  const data = ReportData.from(ROWS, ROWS.length, [], []);

  for (const [band, controls] of Object.entries(SPEC)) {
    it(`prints the ${band} band's summaries and fields`, () => {
      for (const spec of controls) {
        const expected = PRINTED[spec[0]];
        const actual = expected.map((entry, n) => {
          const page = Number(/^p(\d+):/.exec(entry)![1]) - 1;
          const text = data.text(dataOf(spec), scopeOf(band, n, page));
          return `p${page + 1}:${text === '' ? '(blank)' : text}`;
        });
        expect([spec[0], actual]).toEqual([spec[0], expected]);
      }
    });
  }
});

describe('ReportData', () => {
  const at = (data: ReportData, expression: string, scope: Partial<TextScope> = {}, running: string | null = 'Report', format: string | null = null) =>
    data.text({ expression, running, format }, { row: 0, anchor: 0, report: ALL.slice(0, data.records.length), group: null, page: null, ...scope });

  it('types parameters by their declared type, and a lifted one by its look', () => {
    const data = ReportData.from([{ Qty: '3' }], 1, [], [
      { name: 'Limit', type: 'System.Int32', value: '7' },
      { name: 'Rate', type: 'System.Decimal', value: '0.50' },
      { name: 'Region', type: 'System.String', value: '7' },
      { name: 'Lifted', type: '#Ref-9', value: '2.5' },
    ]);
    expect(at(data, '[Qty] * ?Limit', {}, null)).toBe('21');
    expect(at(data, '[Qty] * ?Rate', {}, null)).toBe('1.50');
    expect(at(data, "?Region + 'x'", {}, null)).toBe('7x');
    expect(at(data, '?Lifted * 2', {}, null)).toBe('5.0');
    expect(at(data, '?Missing', {}, null)).toBe('');
  });

  it('adds calculated fields in declaration order, so one may use another', () => {
    const data = ReportData.from([{ Qty: '2', Price: '1.25' }], 1, [
      { name: 'Line', expression: '[Qty] * [Price]' },
      { name: 'Taxed', expression: '[Line] * 2' },
    ], []);
    expect(at(data, '[Taxed]', {}, null, '{0:c2}')).toBe('$5.00');
  });

  it('repeats the rows when there are more records than rows, as the Preview always has', () => {
    const data = ReportData.from([{ Qty: '1' }, { Qty: '2' }], 5, [], []);
    expect(at(data, 'sumSum([Qty])')).toBe('7');
  });

  it('prints a total over no records as nothing, not zero, as DevExpress printed an empty report', () => {
    const data = ReportData.from([], 0, [], []);
    expect(data.text({ expression: 'sumSum([Qty])', running: 'Report', format: '{0:c2}' }, { row: null, anchor: null, report: [], group: null, page: null })).toBe('');
    expect(data.text({ expression: 'sumCount()', running: 'Report', format: null }, { row: null, anchor: null, report: [], group: null, page: null })).toBe('0');
  });

  it('answers the same from its cache as from a fresh pass', () => {
    const data = ReportData.from(ROWS, ROWS.length, [], []);
    const runs = ALL.map((i) => at(data, 'sumRunningSum([Qty])', { row: i, anchor: i }));
    expect(runs.slice(0, 4)).toEqual(['1', '3', '6', '10']);
    expect(ALL.map((i) => at(data, 'sumRunningSum([Qty])', { row: i, anchor: i }))).toEqual(runs);
    expect(at(data, 'sumSum([Qty])')).toBe('1275');
  });

  it('returns null for a control with no binding, so the caller keeps its own text', () => {
    const data = ReportData.from([{ Qty: '1' }], 1, [], []);
    expect(data.text({ expression: null, running: null, format: null }, { row: 0, anchor: 0, report: [0], group: null, page: null })).toBeNull();
  });

  it('types test-data columns from all of their values', () => {
    const [row] = typeRows([{ n: '1', d: '1.50', when: '2026-03-01', ok: 'true', s: '007x' }, { n: '20', d: '2', when: '2026-03-02T10:00', ok: 'False', s: 'y' }]);
    expect(typeof row.n).toBe('bigint');
    expect(String(row.d)).toBe('1.50');
    expect(row.when).toBeInstanceOf(Date);
    expect(row.ok).toBe(true);
    expect(row.s).toBe('007x');
  });
});

describe('order and groups', () => {
  const rows = typeRows([
    { Region: 'West', Customer: 'C3', Qty: '2' },
    { Region: 'north', Customer: 'C1', Qty: '10' },
    { Region: 'West', Customer: 'C9', Qty: '1' },
    { Region: '', Customer: 'C5', Qty: '7' },
    { Region: 'North', Customer: 'C2', Qty: '3' },
  ]);

  it('sorts by each key in turn, outermost first, with a descending key reversed', () => {
    const order = sortedOrder(rows, [
      { field: 'Region', order: 'Ascending' },
      { field: 'Customer', order: 'Descending' },
    ]);
    // Null first; en-US collation puts "north" before "North"; Customer descending within.
    expect(order.map((i) => rows[i].Customer)).toEqual(['C5', 'C1', 'C2', 'C9', 'C3']);
  });

  it('compares numbers as numbers, not as text', () => {
    expect(sortedOrder(rows, [{ field: 'Qty', order: 'Ascending' }]).map((i) => String(rows[i].Qty))).toEqual(['1', '2', '3', '7', '10']);
  });

  it('keeps the data order for None, and between equal keys', () => {
    expect(sortedOrder(rows, [{ field: 'Region', order: 'None' }])).toEqual([0, 1, 2, 3, 4]);
    const same = typeRows([{ k: 'a', n: '1' }, { k: 'a', n: '2' }, { k: 'a', n: '3' }]);
    expect(sortedOrder(same, [{ field: 'k', order: 'Ascending' }])).toEqual([0, 1, 2]);
  });

  it('breaks consecutive records into runs that share every grouping field', () => {
    const sorted = typeRows([
      { R: 'A', C: 'X' }, { R: 'A', C: 'X' }, { R: 'A', C: 'Y' }, { R: 'B', C: 'Y' }, { R: 'B', C: 'Y' },
    ]);
    expect(groupRuns(sorted, ['R'])).toEqual([[0, 1, 2], [3, 4]]);
    expect(groupRuns(sorted, ['R', 'C'])).toEqual([[0, 1], [2], [3, 4]]);
    expect(groupRuns([], ['R'])).toEqual([]);
  });

  it('orders null before anything and equal values as equal', () => {
    expect(sortCompare(null, 'a')).toBeLessThan(0);
    expect(sortCompare(null, null)).toBe(0);
    expect(sortCompare(2n, 10n)).toBeLessThan(0);
  });

  it('reorders its records into print order', () => {
    const data = ReportData.from([{ Qty: '3' }, { Qty: '1' }, { Qty: '2' }], 3, [], []);
    const sorted = data.reordered(sortedOrder(data.records, [{ field: 'Qty', order: 'Ascending' }]));
    expect(sorted.records.map((r) => String(r.Qty))).toEqual(['1', '2', '3']);
    expect(sorted.text({ expression: 'sumRunningSum([Qty])', running: 'Report', format: null }, { row: 1, anchor: 1, report: [0, 1, 2], group: null, page: null })).toBe('3');
  });
});
