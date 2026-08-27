/**
 * Turning what the user attached into what the model is sent.
 *
 * Seventeen lines, duplicated character-for-character in `handleGenerate` and
 * `handleResume` (audit ARC-001). Two copies of a data-URL parser is the sort
 * of duplication that stays correct right up until one of them is fixed.
 *
 * The ordering is the part worth pinning: text lifted out of the files goes
 * **before** the page images, so the exact strings and coordinates are in
 * context before the model looks at a picture of them. Reversing it produces a
 * worse report and no error.
 */
import { describe, it, expect } from 'vitest';
import { toAttachmentParts } from './attachmentParts';

const png = (data = 'AAAA') => `data:image/png;base64,${data}`;
const jpeg = (data = 'BBBB') => `data:image/jpeg;base64,${data}`;

describe('toAttachmentParts', () => {
  it('sends nothing when nothing was attached', () => {
    expect(toAttachmentParts([], [])).toEqual([]);
  });

  it('splits a data URL into its mime type and payload', () => {
    expect(toAttachmentParts([png('Zm9v')], [])).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'Zm9v' } },
    ]);
  });

  it('keeps each image distinct, in order', () => {
    const parts = toAttachmentParts([png('one'), jpeg('two')], []);
    expect(parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'one' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'two' } },
    ]);
  });

  it('puts extracted text before the page images', () => {
    // The reason this ordering exists: the model should read the real strings
    // and coordinates before it looks at a picture of them.
    const parts = toAttachmentParts([png()], [{ text: 'INVOICE 001' }]);
    expect(parts[0]).toEqual({ text: 'INVOICE 001' });
    expect(parts[1]).toHaveProperty('inlineData');
  });

  it('keeps multiple text attachments in order, ahead of every image', () => {
    const parts = toAttachmentParts([png(), jpeg()], [{ text: 'page 1' }, { text: 'page 2' }]);
    expect(parts.map((p) => ('text' in p ? p.text : 'IMAGE'))).toEqual([
      'page 1',
      'page 2',
      'IMAGE',
      'IMAGE',
    ]);
  });

  describe('malformed input is dropped, not thrown on', () => {
    /**
     * The original split the string blind: `mimeInfo.split(':')[1].split(';')[0]`
     * throws a TypeError on anything without a colon. Previews normally come
     * from the intake, which produces well-formed URLs — but a project restored
     * from localStorage carries whatever was stored, and a crash here takes out
     * the whole generation rather than one attachment.
     */
    for (const [label, value] of [
      ['empty string', ''],
      ['no comma', 'data:image/png;base64'],
      ['no colon', 'image/png;base64,AAAA'],
      ['not a data url', 'https://example.com/a.png'],
      ['just a comma', ','],
      ['no mime type', 'data:,AAAA'],
    ] as Array<[string, string]>) {
      it(`drops a preview with ${label}`, () => {
        expect(() => toAttachmentParts([value], [])).not.toThrow();
        expect(toAttachmentParts([value], [])).toEqual([]);
      });
    }

    it('keeps the good attachments when one is bad', () => {
      // One unreadable thumbnail must not cost the user the whole report.
      const parts = toAttachmentParts(['broken', png('ok')], [{ text: 'kept' }]);
      expect(parts).toEqual([
        { text: 'kept' },
        { inlineData: { mimeType: 'image/png', data: 'ok' } },
      ]);
    });

    it('drops an empty text attachment rather than sending a blank part', () => {
      expect(toAttachmentParts([], [{ text: '' }, { text: '   ' }])).toEqual([]);
    });
  });

  it('handles a base64 payload containing commas in its own right', () => {
    // Only the first comma separates the header; the rest belong to the data.
    const parts = toAttachmentParts(['data:image/png;base64,AA,BB'], []);
    expect(parts).toEqual([{ inlineData: { mimeType: 'image/png', data: 'AA,BB' } }]);
  });
});
