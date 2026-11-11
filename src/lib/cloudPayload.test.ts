/**
 * A project as its account document, inside the budget (moved out of App.tsx
 * on 2026-11-11, batch PXB, where nothing tested it): whole when it fits,
 * without its pictures, its earlier versions' too, when only that fits, and
 * nothing when even that is too large.
 */
import { describe, expect, it } from 'vitest';
import { CLOUD_SAVE_BUDGET_BYTES, cloudPayload } from './cloudPayload';

const project = (picture: number, words = 10) => ({
  id: 'p1',
  name: 'Invoice',
  timestamp: '2026-11-11T10:00:00.000Z',
  messages: [
    {
      id: 'm1',
      role: 'user',
      text: 'x'.repeat(words),
      images: ['data:image/png;base64,' + 'A'.repeat(picture)],
      branches: [{ text: 'earlier', images: ['data:image/png;base64,' + 'B'.repeat(picture)], tail: [{ id: 'm2', role: 'assistant', text: 'ok', images: ['data:image/png;base64,' + 'C'.repeat(picture)] }] }],
    },
  ],
  result: { repxContent: '<XtraReportsLayoutSerializer />' },
});

describe('cloudPayload', () => {
  it('keeps a project that fits whole, pictures and all', () => {
    const out = cloudPayload(project(100), 'u1')!;
    expect(out.imagesDropped).toBe(false);
    expect(out.payload.messages).toContain('AAAA');
    expect(out.payload.userId).toBe('u1');
  });

  it('leaves out every picture, its earlier versions\' too, when only that fits', () => {
    const out = cloudPayload(project(CLOUD_SAVE_BUDGET_BYTES / 2), 'u1')!;
    expect(out.imagesDropped).toBe(true);
    expect(out.payload.messages).not.toMatch(/AAAA|BBBB|CCCC/);
    // The words and the report stay.
    expect(out.payload.messages).toContain('earlier');
    expect(out.payload.result).toContain('XtraReportsLayoutSerializer');
  });

  it('writes nothing when the words alone are over the budget', () => {
    expect(cloudPayload(project(10, CLOUD_SAVE_BUDGET_BYTES + 1), 'u1')).toBeNull();
  });
});
