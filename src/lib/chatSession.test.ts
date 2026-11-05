import { describe, it, expect } from 'vitest';
import {
  AFFIRMATIVE,
  answeredBy,
  buildChatHistory,
  isGenerationTurn,
  markMessageError,
  nextMessageId,
  messageMatches,
  noteCountLabel,
  projectMatches,
  searchParts,
  truncateFrom,
  withdrawTurn,
  type ChatMessage,
} from './chatSession';

/** A transcript entry with only the fields a given test cares about. */
const msg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  role: 'user',
  text: '',
  ...over,
});

describe('nextMessageId', () => {
  // The whole point. Date.now() twice in one tick returned one id, and the
  // `(Date.now() + 1)` at the sites that appended two messages was the previous
  // answer to it.
  it('never repeats, even called in a tight loop within one millisecond', () => {
    const ids = Array.from({ length: 500 }, () => nextMessageId());
    expect(new Set(ids).size).toBe(500);
  });

  it('keeps the timestamp in front, so ids still sort chronologically', () => {
    const id = nextMessageId();
    expect(id).toMatch(/^\d{13}-\d+$/);
    expect(Number(id.split('-')[0])).toBeGreaterThan(1_600_000_000_000);
  });
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

describe('withdrawTurn', () => {
  const thread = [
    msg({ id: 'u1', role: 'user', text: 'first' }),
    msg({ id: 'a1', role: 'assistant', text: 'answer one' }),
    msg({ id: 'a1b', role: 'assistant', text: 'and a report' }),
    msg({ id: 'u2', role: 'user', text: 'second' }),
    msg({ id: 'a2', role: 'assistant', text: 'answer two' }),
  ];

  it('takes the message and every answer to it, up to the next message of the person', () => {
    expect(withdrawTurn(thread, 'u1').map((m) => m.id)).toEqual(['u2', 'a2']);
  });

  it('takes the last turn to the end', () => {
    expect(withdrawTurn(thread, 'u2').map((m) => m.id)).toEqual(['u1', 'a1', 'a1b']);
  });

  it("leaves Forma's own messages, and an unknown id, alone", () => {
    expect(withdrawTurn(thread, 'a1')).toEqual(thread);
    expect(withdrawTurn(thread, 'gone')).toEqual(thread);
  });

  it('does not mutate the transcript it is given', () => {
    withdrawTurn(thread, 'u1');
    expect(thread).toHaveLength(5);
  });
});

describe('searchParts', () => {
  it('marks every match, whatever its case', () => {
    expect(searchParts('Total by Region, total by month', 'total')).toEqual([
      { text: 'Total', hit: true },
      { text: ' by Region, ', hit: false },
      { text: 'total', hit: true },
      { text: ' by month', hit: false },
    ]);
  });

  it('takes the query as text, not as a pattern', () => {
    expect(searchParts('a (b) a.b', '(b)')).toEqual([
      { text: 'a ', hit: false },
      { text: '(b)', hit: true },
      { text: ' a.b', hit: false },
    ]);
    expect(searchParts('axb', 'a.b')).toEqual([{ text: 'axb', hit: false }]);
  });

  it('returns the text whole for an empty or blank query', () => {
    expect(searchParts('anything', '  ')).toEqual([{ text: 'anything', hit: false }]);
  });

  it('cuts in the right places where lower-casing changes a length', () => {
    const parts = searchParts('İstanbul total', 'total');
    expect(parts.map((p) => p.text).join('')).toBe('İstanbul total');
    expect(parts.find((p) => p.hit)?.text).toBe('total');
  });
});

describe('messageMatches', () => {
  it('finds the query in the text or in the questions a message asks', () => {
    const asks = msg({ id: '1', role: 'assistant', text: 'A few questions', clarify: { questions: [{ id: 'q', question: 'Which paper size?' }], answered: false } });
    expect(messageMatches(asks, 'PAPER')).toBe(true);
    expect(messageMatches(asks, 'few')).toBe(true);
    expect(messageMatches(asks, 'landscape')).toBe(false);
  });

  it('matches everything while nothing is typed', () => {
    expect(messageMatches(msg({ id: '1', text: 'x' }), '')).toBe(true);
  });
});

/* A typed answer to a redesign Forma asked about (2026-11-05). */
describe('AFFIRMATIVE', () => {
  it('reads a short yes as yes, and anything that says more as a message of its own', () => {
    for (const yes of ['yes', 'Yes!', 'ok', 'okay.', 'go ahead', 'do it', 'redesign it', 'sure']) expect(AFFIRMATIVE.test(yes)).toBe(true);
    for (const other of ['yes but keep the logo', 'no', 'not now', 'make it bold', 'okay so what about the totals']) expect(AFFIRMATIVE.test(other)).toBe(false);
  });
});

/* Try again on a reply sends the message it answered (2026-11-05). */
describe('answeredBy', () => {
  const thread = [
    msg({ id: 'u1', text: 'hello' }),
    msg({ id: 'a1', role: 'assistant', text: 'Hi' }),
    msg({ id: 'a2', role: 'assistant', text: 'Anything else?' }),
    msg({ id: 'u2', text: 'an invoice' }),
    msg({ id: 'a3', role: 'assistant', text: 'Built it' }),
  ];

  it('finds the nearest of the person\'s messages before a reply, past other replies', () => {
    expect(answeredBy(thread, 'a3')?.id).toBe('u2');
    expect(answeredBy(thread, 'a2')?.id).toBe('u1');
  });

  it('answers null for a person\'s message, an unknown id, or a reply with nothing before it', () => {
    expect(answeredBy(thread, 'u2')).toBeNull();
    expect(answeredBy(thread, 'nope')).toBeNull();
    expect(answeredBy([msg({ id: 'a', role: 'assistant', text: 'Welcome' })], 'a')).toBeNull();
  });
});

/* The sidebar's Search over the saved projects (2026-11-05). */
describe('projectMatches', () => {
  const project = { name: 'Q3 invoice', messages: [msg({ id: '1', text: 'Group it by region' }), msg({ id: '2', role: 'assistant', text: 'Done', clarify: { questions: [{ id: 'q', question: 'Which paper size?' }], answered: true } })] };

  it('finds the query in the name, in what was said, or in the questions asked, as typed', () => {
    expect(projectMatches(project, 'q3')).toBe(true);
    expect(projectMatches(project, 'REGION')).toBe(true);
    expect(projectMatches(project, 'paper')).toBe(true);
    expect(projectMatches(project, 'landscape')).toBe(false);
    // Taken as text, never as a pattern.
    expect(projectMatches({ name: 'Totals (USD)', messages: [] }, '(USD')).toBe(true);
  });

  it('matches every project while nothing is typed', () => {
    expect(projectMatches({ name: 'x', messages: [] }, '  ')).toBe(true);
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
