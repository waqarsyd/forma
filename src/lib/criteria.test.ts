/**
 * The criteria language, against what DevExpress 20.1 PRINTED for the same
 * expressions over the same six records (case s16 of
 * docs/proposals/devexpress-parity.md, `RepxProbe render`, 2026-10-30). The
 * records go in as strings, as the Preview's test data does, and are typed by
 * typeRows; the calculated field Total is [Qty] * [Price]. Every expectation is
 * a string DevExpress drew, written out literally.
 */
import { describe, it, expect } from 'vitest';
import { parseCriteria, evaluate, evaluateText, valueText, type Value } from './criteria';
import { typeRows, withCalculatedFields, rowEnv, aggregate } from './reportData';
import { formatComposite } from './netFormat';

const RAW = [{"Name":"Alpha","Qty":"1","Price":"12.5","When":"2026-01-15T09:30:00","Paid":"true"},{"Name":"beta","Qty":"4","Price":"9.99","When":"2026-02-28T00:00:00","Paid":"false"},{"Name":"Gamma","Qty":"6","Price":"100","When":"2026-03-31T23:59:00","Paid":"true"},{"Name":"delta","Qty":"8","Price":"0.5","When":"2026-12-25T12:00:00","Paid":"false"},{"Name":"Epsilon","Qty":"3","Price":"33.333","When":"2026-07-04T08:15:00","Paid":"true"},{"Name":"zeta","Qty":"10","Price":"7","When":"2026-10-30T17:45:00","Paid":"true"}];
const params = (): Value => null;
const rows = withCalculatedFields(typeRows(RAW), [{ name: 'Total', expression: '[Qty] * [Price]' }], params);
const envAt = (i: number) => rowEnv(rows[i], params, (name, args) => aggregate(name, args, rows, i, params));
const printAt = (expression: string, i: number) => valueText(evaluateText(expression, envAt(i)));

const PRINTED: Record<string, string[]> = {
  "[Qty] * [Price]": ["12.5","39.96","600","4.0","99.999","70"],
  "[Qty] / 4": ["0","1","1","2","0","2"],
  "[Price] / 3": ["4.1666666666666666666666666667","3.33","33.333333333333333333333333333","0.1666666666666666666666666667","11.111","2.3333333333333333333333333333"],
  "'Q' + [Qty]": ["Q1","Q4","Q6","Q8","Q3","Q10"],
  "'P' + [Price]": ["P12.5","P9.99","P100","P0.5","P33.333","P7"],
  "Iif([Qty] > 5, 'many', 'few')": ["few","few","many","many","few","many"],
  "Round([Price] * 1.175, 2)": ["14.69","11.74","117.5","0.59","39.17","8.22"],
  "Upper([Name])": ["ALPHA","BETA","GAMMA","DELTA","EPSILON","ZETA"],
  "Len([Name])": ["5","4","5","5","7","4"],
  "Substring([Name], 1, 2)": ["lp","et","am","el","ps","et"],
  "FormatString('{0:c2}', [Price])": ["$12.50","$9.99","$100.00","$0.50","$33.33","$7.00"],
  "GetYear([When])": ["2026","2026","2026","2026","2026","2026"],
  "AddDays([When], 10)": ["1/25/2026 9:30:00 AM","3/10/2026 12:00:00 AM","4/10/2026 11:59:00 PM","1/4/2027 12:00:00 PM","7/14/2026 8:15:00 AM","11/9/2026 5:45:00 PM"],
  "[Paid]": ["True","False","True","False","True","True"],
  "Iif([Paid], 'Y', 'N')": ["Y","N","Y","N","Y","Y"],
  "[Qty] % 4": ["1","0","2","0","3","2"],
  "Concat([Name], '-', [Qty])": ["Alpha-1","beta-4","Gamma-6","delta-8","Epsilon-3","zeta-10"],
  "IsNullOrEmpty([Name])": ["False","False","False","False","False","False"],
  "[Price] > 10 And [Qty] < 5": ["True","False","False","False","True","False"],
  "Abs(-[Price])": ["12.5","9.99","100","0.5","33.333","7"],
  "ToStr([Price])": ["12.5","9.99","100","0.5","33.333","7"],
  "[Total]": ["12.5","39.96","600","4.0","99.999","70"],
  "Floor([Price])": ["12","9","100","0","33","7"],
  "Ceiling([Price])": ["13","10","100","1","34","7"],
  "Max([Qty], 3)": ["3","4","6","8","3","10"],
  "[Qty] + [Price]": ["13.5","13.99","106","8.5","36.333","17"],
  "[Name] + [Qty]": ["Alpha1","beta4","Gamma6","delta8","Epsilon3","zeta10"],
  "Iif([Qty] > 8, 'high', [Qty] > 3, 'mid', 'low')": ["low","mid","mid","mid","low","high"],
  "[When]": ["1/15/2026 9:30:00 AM","2/28/2026 12:00:00 AM","3/31/2026 11:59:00 PM","12/25/2026 12:00:00 PM","7/4/2026 8:15:00 AM","10/30/2026 5:45:00 PM"],
  "Lower([Name]) + '!'": ["alpha!","beta!","gamma!","delta!","epsilon!","zeta!"],
  "[Qty] = 4": ["False","True","False","False","False","False"],
  "Not [Paid]": ["False","True","False","True","False","False"],
  "[Qty] In (1, 4, 10)": ["True","True","False","False","False","True"],
  "Trim('  x  ')": ["x","x","x","x","x","x"],
  "[Price] * 2 / 4": ["6.25","4.995","50","0.25","16.6665","3.5"],
  "[Qty] / 4.0": ["0.25","1","1.5","2","0.75","2.5"],
  "Round([Price])": ["12","10","100","0","33","7"],
  "Round(2.5)": ["2","2","2","2","2","2"],
  "Round(3.5)": ["4","4","4","4","4","4"],
  "Round(-2.5)": ["-2","-2","-2","-2","-2","-2"],
  "[Missing]": ["","","","","",""],
};
const PRINTED_TOTALS: Record<string, string> = {
  "sumSum([Price])": "163.323",
  "sumAvg([Price])": "27.2205",
  "sumCount([Price])": "6",
  "sumMin([Price])": "0.5",
  "sumMax([Price])": "100",
  "sumSum([Qty] * [Price])": "826.459",
  "sumAvg([Qty])": "5.3333333333333333333333333333",
  "sumSum([Total])": "826.459",
  "sumCount()": "6",
  "sumDCount([Paid])": "2",
  "sumMedian([Qty])": "5",
};

describe('expressions, as DevExpress printed them', () => {
  it('prints every detail expression on every record the way DevExpress did', () => {
    for (const [expression, expected] of Object.entries(PRINTED)) {
      expect([expression, rows.map((_, i) => printAt(expression, i))]).toEqual([expression, expected]);
    }
  });

  it('computes every report total the way DevExpress did', () => {
    for (const [expression, expected] of Object.entries(PRINTED_TOTALS)) {
      expect([expression, printAt(expression, rows.length - 1)]).toEqual([expression, expected]);
    }
  });

  it('runs a running sum and a record number down the records', () => {
    expect(rows.map((_, i) => printAt('sumRunningSum([Qty])', i))).toEqual(["1","5","11","19","22","32"]);
    expect(rows.map((_, i) => printAt('sumRecordNumber()', i))).toEqual(["1","2","3","4","5","6"]);
  });

  it('formats a value through TextFormatString exactly as DevExpress did', () => {
    expect(rows.map((_, i) => formatComposite('{0:yyyy-MM-dd}', [evaluateText('AddDays([When], 10)', envAt(i))]))).toEqual(["2026-01-25","2026-03-10","2026-04-10","2027-01-04","2026-07-14","2026-11-09"]);
  });
});

describe('the language itself', () => {
  const at = (expression: string) => valueText(evaluateText(expression, envAt(0)));

  it('parses operators with the usual precedence', () => {
    expect(at('1 + 2 * 3')).toBe('7');
    expect(at('(1 + 2) * 3')).toBe('9');
    expect(at('-2 * -3')).toBe('6');
    expect(at('1 < 2 And 2 < 3 Or False')).toBe('True');
    expect(at('Not (1 = 1)')).toBe('False');
  });

  it('reads both parameter forms and treats a missing one as null', () => {
    const env = rowEnv(rows[0], (name) => (name === 'Region' ? 'North' : null));
    expect(evaluateText('[Parameters.Region]', env)).toBe('North');
    expect(evaluateText('?Region', env)).toBe('North');
    expect(evaluateText('?Other', env)).toBeNull();
  });

  it('compares, matches and tests for null', () => {
    expect(at("[Name] Like 'Al%'")).toBe('True');
    expect(at('[Qty] Between(0, 1)')).toBe('True');
    expect(at('[Missing] Is Null')).toBe('True');
    expect(at('[Name] Is Not Null')).toBe('True');
    expect(at("'b' > 'a'")).toBe('True');
  });

  it('reads dates, decimals and doubles as literals', () => {
    expect(at('GetMonth(#2026-03-05#)')).toBe('3');
    expect(at('1.5m + 1')).toBe('2.5');
    expect(at('1 / 4.0')).toBe('0.25');
    expect(at('7 / 2')).toBe('3');
  });

  it('prints nothing, rather than throwing, for an expression it cannot read', () => {
    expect(evaluateText('[Qty] +', envAt(0))).toBeNull();
    expect(evaluateText('Unknown([Qty])', envAt(0))).toBeNull();
    expect(() => parseCriteria("'open")).not.toThrow();
    expect(evaluateText('1 / 0', envAt(0))).toBeNull();
  });

  it('returns typed values a caller can format', () => {
    expect(typeof evaluate(parseCriteria('[Qty]'), envAt(0))).toBe('bigint');
    expect(formatComposite('{0:c2}', [evaluate(parseCriteria('[Price] / 3'), envAt(0))])).toBe('$4.17');
  });
});
