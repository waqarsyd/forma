import { describe, it, expect } from 'vitest';
import { designerFileName } from './designerBridge';

/**
 * Only `designerFileName` is covered here, and deliberately so: the two fetch
 * helpers beside it are thin wrappers whose real behaviour lives in another
 * process, so a mocked test of them would assert the mock.
 *
 * This function is worth pinning because its output becomes a *path* on the
 * other side. The companion re-sanitises — a browser is not a trust boundary —
 * but a name that escapes here would be the first half of a path traversal, and
 * that fails silently rather than loudly: the report opens under a name nobody
 * looks at, or lands somewhere nobody looks for it.
 */
describe('designerFileName', () => {
  it('turns a report title into a .repx filename', () => {
    expect(designerFileName('Sales Invoice')).toBe('Sales_Invoice.repx');
  });

  it('collapses runs of whitespace the way the download name does', () => {
    // Must match downloadDesign's `replace(/\s+/g, '_')`, or one report reaches
    // the disk under two different names depending on which button was used.
    expect(designerFileName('Monthly   Diamond\tReport')).toBe('Monthly_Diamond_Report.repx');
  });

  it('falls back when the title is missing or empty', () => {
    expect(designerFileName()).toBe('report-design.repx');
    expect(designerFileName('')).toBe('report-design.repx');
  });

  it('drops path separators rather than encoding them', () => {
    expect(designerFileName('..\\..\\Windows\\System32\\evil')).toBe('....WindowsSystem32evil.repx');
    expect(designerFileName('reports/2026/august')).toBe('reports2026august.repx');
  });

  it('strips characters Windows will not accept in a filename', () => {
    expect(designerFileName('Q3: "final" <draft>|v2?')).toBe('Q3_final_draftv2.repx');
  });

  it('never returns a bare extension when everything is stripped', () => {
    // A title of only punctuation would otherwise produce ".repx", a hidden file
    // with no name.
    expect(designerFileName('***')).toBe('report-design.repx');
    expect(designerFileName('/\\:*?"<>|')).toBe('report-design.repx');
  });
});
