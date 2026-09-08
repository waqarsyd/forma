import { describe, it, expect } from 'vitest';
import {
  buildChatHistory,
  isGenerationTurn,
  markMessageError,
  noteCountLabel,
  truncateFrom,
  type ChatMessage,
} from './chatSession';

/** A transcript entry with only the fields a given test cares about. */
const msg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  role: 'user',
  text: '',
  ...over,
});

describe('isGenerationTurn', () => {
  it('is a chat turn when nothing is attached', () => {
    expect(isGenerationTurn(0, 0)).toBe(false);
  });

  it('is a generation turn when an image is attached', () => {
    expect(isGenerationTurn(2, 0)).toBe(true);
  });

  // The plausible failure: writing this as `previewCount > 0` alone. A digital
  // PDF or an uploaded .repx contributes extracted *text* and no preview image,
  // so that version silently routes a real build request to the chat path and
  // answers it with two sentences.
  it('is a generation turn for extracted text with no image', () => {
    expect(isGenerationTurn(0, 1)).toBe(true);
  });

  it('is a generation turn when both are present', () => {
    expect(isGenerationTurn(3, 2)).toBe(true);
  });
});

describe('buildChatHistory', () => {
  it('puts the message being sent last', () => {
    const history = buildChatHistory(
      [msg({ id: '1', role: 'user', text: 'first' }), msg({ id: '2', role: 'assistant', text: 'reply' })],
      'third'
    );
    expect(history).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'reply' },
      { role: 'user', text: 'third' },
    ]);
  });

  it('sends only the new turn when the transcript is empty', () => {
    expect(buildChatHistory([], 'hello')).toEqual([{ role: 'user', text: 'hello' }]);
  });

  // The expensive failure. `images` holds base64 data URLs; passing whole
  // message objects into the history would upload every previously-attached
  // page again on every subsequent chat turn, billed each time, to say nothing
  // of the request size.
  it('carries only role and text, never images, meta or the result', () => {
    const history = buildChatHistory(
      [
        msg({
          id: '1',
          text: 'look at this',
          images: ['data:image/png;base64,AAAA'],
          imageMeta: [{ file: 'invoice.pdf', page: 1, pages: 3 }],
          result: { repxContent: '<XtraReportsLayoutSerializer />' },
        }),
      ],
      'and this'
    );
    expect(history).toEqual([
      { role: 'user', text: 'look at this' },
      { role: 'user', text: 'and this' },
    ]);
    expect(Object.keys(history[0]).sort()).toEqual(['role', 'text']);
  });

  // A failed turn is a thing that happened. Filtering it out produces an
  // assistant that answers as though the user never asked.
  it('keeps a message that carries an error', () => {
    const history = buildChatHistory(
      [msg({ id: '1', text: 'do the thing', error: 'The model is overloaded.' })],
      'try again'
    );
    expect(history).toEqual([
      { role: 'user', text: 'do the thing' },
      { role: 'user', text: 'try again' },
    ]);
  });

  it('keeps the assistant line left behind by a stopped generation', () => {
    const history = buildChatHistory(
      [msg({ id: '1', role: 'assistant', text: 'Generation stopped by user.' })],
      'what happened?'
    );
    expect(history[0]).toEqual({ role: 'assistant', text: 'Generation stopped by user.' });
  });

  it('does not mutate the transcript it is given', () => {
    const messages = [msg({ id: '1', text: 'one' })];
    buildChatHistory(messages, 'two');
    expect(messages).toHaveLength(1);
  });
});

describe('markMessageError', () => {
  it('marks the message named and no other', () => {
    const marked = markMessageError(
      [msg({ id: '1', text: 'one' }), msg({ id: '2', text: 'two' })],
      '2',
      'Could not reach the assistant.'
    );
    expect(marked[0].error).toBeUndefined();
    expect(marked[1].error).toBe('Could not reach the assistant.');
  });

  it('leaves the transcript alone when the id is unknown', () => {
    const messages = [msg({ id: '1', text: 'one' })];
    expect(markMessageError(messages, 'nope', 'boom')).toEqual(messages);
  });

  it('does not mutate the message it marks', () => {
    const messages = [msg({ id: '1', text: 'one' })];
    markMessageError(messages, '1', 'boom');
    expect(messages[0].error).toBeUndefined();
  });
});

describe('truncateFrom', () => {
  it('drops the failed message and everything after it', () => {
    const messages = [
      msg({ id: '1', text: 'kept' }),
      msg({ id: '2', text: 'failed' }),
      msg({ id: '3', text: 'after' }),
    ];
    expect(truncateFrom(messages, '2').map((m) => m.id)).toEqual(['1']);
  });

  it('empties the transcript when the first message is the failed one', () => {
    expect(truncateFrom([msg({ id: '1' }), msg({ id: '2' })], '1')).toEqual([]);
  });

  // New report clears the transcript; the retry button on a message that is no
  // longer there must not throw or wipe what replaced it.
  it('returns the transcript unchanged when the id is unknown', () => {
    const messages = [msg({ id: '1' }), msg({ id: '2' })];
    expect(truncateFrom(messages, 'gone').map((m) => m.id)).toEqual(['1', '2']);
  });

  it('does not mutate the transcript it is given', () => {
    const messages = [msg({ id: '1' }), msg({ id: '2' })];
    truncateFrom(messages, '1');
    expect(messages).toHaveLength(2);
  });
});

describe('noteCountLabel', () => {
  it('singularises exactly one', () => {
    expect(noteCountLabel(1)).toBe('1 note');
  });

  it('pluralises none and many', () => {
    expect(noteCountLabel(0)).toBe('0 notes');
    expect(noteCountLabel(2)).toBe('2 notes');
    expect(noteCountLabel(11)).toBe('11 notes');
  });
});
