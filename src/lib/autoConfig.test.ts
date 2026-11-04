import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UNIT,
  detectSettings,
  isRightToLeftText,
  paperForLocale,
  paperFromPoints,
  paperFromWords,
  procedureFromWords,
  repxFacts,
} from './autoConfig';

const repx = (attrs: string, body = '') =>
  `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer ${attrs} Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport">${body}</XtraReportsLayoutSerializer>`;

describe('what a report says about itself', () => {
  it('reads its version, unit, paper, orientation and direction from the root', () => {
    expect(
      repxFacts(repx('SerializerVersion="20.1.3.0" ReportUnit="TenthsOfAMillimeter" PaperKind="A4" Landscape="true" RightToLeft="Yes" PageWidth="2970" PageHeight="2100"')),
    ).toEqual({ version: '20.1', unit: 'TenthsOfAMillimeter', pageSize: 'A4', landscape: true, rtl: true });
  });

  it('takes a report with a size and no PaperKind for Letter, as DevExpress prints it', () => {
    expect(repxFacts(repx('SerializerVersion="23.2.3.0" PageWidth="850" PageHeight="1100"')).pageSize).toBe('Letter');
  });

  it('finds a stored procedure in the data source DevExpress keeps base64-encoded', () => {
    const source = btoa('<SqlDataSource><Query Type="StoredProcQuery" Name="Sales"><ProcName>dbo.usp_Sales</ProcName></Query></SqlDataSource>');
    const xml = repx('SerializerVersion="20.1.3.0"', `<ComponentStorage><Item1 Ref="1" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource" Base64="${source}" /></ComponentStorage>`);
    expect(repxFacts(xml).spName).toBe('dbo.usp_Sales');
  });

  it('says nothing about what is not there', () => {
    expect(repxFacts('')).toEqual({});
    expect(repxFacts('not a report')).toEqual({});
  });
});

describe('the paper, from a PDF page, the words and the region', () => {
  it('knows a PDF page by its size in points, either way up', () => {
    expect(paperFromPoints({ width: 595.3, height: 841.9 })).toBe('A4');
    expect(paperFromPoints({ width: 792, height: 612 })).toBe('Letter');
    expect(paperFromPoints({ width: 612, height: 1008 })).toBe('Legal');
    expect(paperFromPoints({ width: 400, height: 400 })).toBeNull();
  });

  it('takes A4 and tabloid as paper always, and letter and legal only beside a paper word', () => {
    expect(paperFromWords('a sales report on A4, landscape')).toBe('A4');
    expect(paperFromWords('print it on US Letter')).toBe('Letter');
    expect(paperFromWords('legal-size paper please')).toBe('Legal');
    expect(paperFromWords('a cover letter for each customer')).toBeNull();
    expect(paperFromWords('the legal department report')).toBeNull();
  });

  it("uses the region's paper when nothing else says: Letter in the Americas that use it, A4 elsewhere", () => {
    expect(paperForLocale('en-US')).toBe('Letter');
    expect(paperForLocale('es-MX')).toBe('Letter');
    expect(paperForLocale('ar-AE')).toBe('A4');
    expect(paperForLocale('en-IN')).toBe('A4');
    expect(paperForLocale('en-GB')).toBe('A4');
  });
});

describe('direction and data source, from the words', () => {
  it('calls a text right to left when most of its letters are Arabic or Hebrew', () => {
    expect(isRightToLeftText('شهادة جودة المنتج رقم ١٢٣ Quality certificate')).toBe(true);
    expect(isRightToLeftText('Quality certificate for product 123, issued in Dubai')).toBe(false);
    expect(isRightToLeftText('سلام')).toBe(false); // too short to judge
  });

  it('finds a stored procedure in EXEC, CREATE PROCEDURE or the words', () => {
    expect(procedureFromWords('EXEC dbo.GetMonthlySales @Year = 2026')).toBe('dbo.GetMonthlySales');
    expect(procedureFromWords('CREATE PROCEDURE [dbo].[usp_Invoices] AS')).toBe('dbo.usp_Invoices');
    expect(procedureFromWords('the data comes from the stored procedure usp_Orders')).toBe('usp_Orders');
    expect(procedureFromWords('a customer list grouped by country')).toBeUndefined();
  });
});

describe('every setting, worked out', () => {
  it('takes all of it from an uploaded report first', () => {
    const d = detectSettings({
      repx: [repx('SerializerVersion="20.1.3.0" ReportUnit="TenthsOfAMillimeter" PaperKind="Legal"')],
      pages: [{ width: 1240, height: 1754 }],
      text: 'on A4',
      locale: 'en-US',
    });
    expect([d.version, d.unit, d.pageSize]).toEqual(['20.1', 'TenthsOfAMillimeter', 'Legal']);
  });

  it('reads the paper off a whole-page picture, then the words, then the region', () => {
    expect(detectSettings({ pages: [{ width: 1240, height: 1754 }], locale: 'en-US' }).pageSize).toBe('A4');
    expect(detectSettings({ pages: [{ width: 1280, height: 720 }], text: 'on legal paper', locale: 'en-US' }).pageSize).toBe('Legal');
    expect(detectSettings({ pages: [{ width: 1280, height: 720 }], locale: 'en-US' }).pageSize).toBe('Letter');
    expect(detectSettings({ locale: 'ar-AE' }).pageSize).toBe('A4');
  });

  it('keeps the version and unit learned from the last report when this request brings none', () => {
    const d = detectSettings({ learned: { version: '20.1', unit: 'TenthsOfAMillimeter' } });
    expect([d.version, d.unit]).toEqual(['20.1', 'TenthsOfAMillimeter']);
    expect(detectSettings({}).unit).toBe(DEFAULT_UNIT);
  });

  it('turns right to left for an Arabic page, and says why', () => {
    const d = detectSettings({ text: 'شهادة جودة المنتج رقم ١٢٣ تاريخ الإصدار' });
    expect(d.rtl).toBe(true);
    expect(d.reasons.join(' ')).toMatch(/right-to-left script/);
  });
});
