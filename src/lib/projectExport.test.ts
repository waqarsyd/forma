/**
 * Every saved project in one .zip, items 59 and 66 (2026-11-08, the site audit's batch SI).
 */
import { describe, expect, it } from 'vitest';
import { exportFileName, projectExportEntries } from './projectExport';

describe('projectExportEntries', () => {
  it('writes each project as JSON, its .repx beside it when it has one, and a README', () => {
    const at = new Date('2026-11-08T10:00:00Z');
    const entries = projectExportEntries(
      [
        { id: '1', name: 'Invoice', timestamp: '2026-11-07T00:00:00.000Z', messages: [{ role: 'user', text: 'hi' }], result: { repxContent: '<x/>' } },
        { id: '2', name: '', timestamp: '2026-11-06T00:00:00.000Z', messages: [], result: null },
      ],
      at,
    );
    expect(entries.map((e) => e.name)).toEqual(['README.txt', 'Invoice.json', 'Invoice.repx', 'Untitled report.json']);
    expect(JSON.parse(entries[1].content as string)).toMatchObject({ id: '1', name: 'Invoice', messages: [{ role: 'user', text: 'hi' }] });
    expect(entries[2].content).toBe('<x/>');
    expect(entries[0].content).toContain('2 of them');
    expect(exportFileName(at)).toBe('forma-projects-2026-11-08.zip');
  });
});
