import { describe, it, expect } from 'vitest';
import {
  AFFIRMATIVE,
  answeredBy,
  branchesForResend,
  showBranch,
  messageTime,
  conversationMarkdown,
  buildChatHistory,
  isGenerationTurn,
  markAskError,
  markInterrupted,
  INTERRUPTED,
  markMessageError,
  nextMessageId,
  messageMatches,
  noteCountLabel,
  projectMatches,
  requestMatches,
  requestState,
  requestTitle,
  requestsOf,
  searchParts,
  truncateFrom,
  withdrawTurn,
  type ChatMessage,
} from './chatSession';

/* The conversation a request at a time (2026-11-05), as Stitch's agent card shows it. */
describe('requestsOf', () => {
  it('groups each message of the person with the replies that follow it, oldest first', () => {
    const m = (id: string, role: 'user' | 'assistant', text = id) => ({ id, role, text }) as ChatMessage;
    const requests = requestsOf([m('a', 'assistant'), m('b', 'user'), m('c', 'assistant'), m('d', 'assistant'), m('e', 'user')]);
    expect(requests.map((r) => [r.id, r.ask?.id ?? null, r.replies.map((x) => x.id)])).toEqual([
      ['a', null, ['a']],
      ['b', 'b', ['c', 'd']],
      ['e', 'e', []],
    ]);
    expect(requestsOf([])).toEqual([]);
  });

  it("names a request by its first line, its pictures or Forma, and says where it stands", () => {
    const ask = (over: Partial<ChatMessage>) => ({ id: 'q', ask: { id: 'q', role: 'user' as const, text: '', ...over }, replies: [] as ChatMessage[] });
    expect(requestTitle(ask({ text: '\n  Make the total bold\nand more' }))).toBe('Make the total bold');
    expect(requestTitle(ask({ images: ['x', 'y'] }))).toBe('2 pictures');
    expect(requestTitle({ id: 'a', ask: null, replies: [] })).toBe('Forma');
    const r = (reply: Partial<ChatMessage>) => ({ id: 'q', ask: null, replies: [{ id: 'r', role: 'assistant' as const, text: 'x', ...reply }] });
    expect(requestState(r({}))).toBe('done');
    expect(requestState(r({ error: 'no' }))).toBe('failed');
    expect(requestState(r({ clarify: { questions: [{ id: '1', question: 'Paper?' }], answered: false } }))).toBe('waiting');
    expect(requestState(r({ confirm: { prompt: 'p', answered: 'yes' } }))).toBe('done');
    expect(requestMatches(r({ text: 'The Total is bold' }), 'total')).toBe(true);
    expect(requestMatches(r({ text: 'nothing' }), 'total')).toBe(false);
  });
});

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

/* Agent audit item 5: a failed generation is marked on the request that asked for it. */
describe('markAskError', () => {
  const m = (id: string, role: 'user' | 'assistant') => ({ id, role, text: id }) as ChatMessage;
  const thread = [m('u1', 'user'), m('a1', 'assistant'), m('u2', 'user'), m('a2', 'assistant')];

  it('marks the message named', () => {
    const marked = markAskError(thread, 'Google was busy.', 'u1');
    expect(marked.map((x) => x.error ?? null)).toEqual(['Google was busy.', null, null, null]);
  });

  it("marks the person's latest message when none is named, or the one named is gone or Forma's", () => {
    for (const id of [undefined, 'gone', 'a1']) {
      expect(markAskError(thread, 'Failed.', id).map((x) => x.error ?? null)).toEqual([null, null, 'Failed.', null]);
    }
  });

  it('leaves a transcript with no message of the person as it was', () => {
    const forma = [m('a', 'assistant')];
    expect(markAskError(forma, 'Failed.')).toEqual(forma);
  });
});

/* Agent audit item 33: a message is saved as soon as it is sent, and a reload mid-turn says so. */
describe('markInterrupted', () => {
  const m = (id: string, role: 'user' | 'assistant', error?: string) => ({ id, role, text: id, ...(error ? { error } : {}) }) as ChatMessage;

  it('marks a last message of the person left with no answer', () => {
    const marked = markInterrupted([m('u1', 'user'), m('a1', 'assistant'), m('u2', 'user')]);
    expect(marked[2].error).toBe(INTERRUPTED);
    expect(marked[0].error).toBeUndefined();
  });

  it('leaves an answered conversation, an empty one and one already marked failed alone', () => {
    expect(markInterrupted([m('u1', 'user'), m('a1', 'assistant')]).every((x) => !x.error)).toBe(true);
    expect(markInterrupted([])).toEqual([]);
    expect(markInterrupted([m('u1', 'user', 'Google was busy.')])[0].error).toBe('Google was busy.');
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

/* The conversation exported as Markdown (2026-11-05). */
describe('conversationMarkdown', () => {
  it('writes the title, then each message under who said it and when, the person\'s words quoted and pictures counted', () => {
    const md = conversationMarkdown(
      [
        msg({ id: '1793893080918-1', text: '# not a heading\nan invoice', images: ['a', 'b'] }),
        msg({ id: '1793893080918-2', role: 'assistant', text: 'Built it.\n\n- with totals' }),
        msg({ id: 'x', role: 'assistant', text: '' }),
      ],
      'Invoice',
      () => 'Today, 10:42',
    );
    expect(md).toBe(
      '# Invoice\n\n**You** · Today, 10:42\n\n> # not a heading\n> an invoice\n_(2 pictures attached)_\n\n**Forma** · Today, 10:42\n\nBuilt it.\n\n- with totals\n\n**Forma**\n',
    );
  });

  it('names an untitled conversation', () => {
    expect(conversationMarkdown([], '  ')).toBe('# Forma conversation\n');
  });
});

/* When a message was made, read off its id (2026-11-05). */
describe('messageTime', () => {
  it('reads the time a new id and an old bare-time id start with', () => {
    expect(messageTime('1793893080918-4')).toBe(1793893080918);
    expect(messageTime('1756000000000')).toBe(1756000000000);
    expect(messageTime(nextMessageId())).not.toBeNull();
  });

  it('answers null for an id that does not start with a time', () => {
    expect(messageTime('u1')).toBeNull();
    expect(messageTime('42-1')).toBeNull();
    expect(messageTime('')).toBeNull();
  });
});

/* The versions of a message sent again, as ChatGPT keeps them (2026-11-05). */
describe('branchesForResend and showBranch', () => {
  const thread = [
    msg({ id: 'u1', text: 'an invoice' }),
    msg({ id: 'a1', role: 'assistant', text: 'Built it.' }),
    msg({ id: 'u2', text: 'make it blue', images: ['data:image/png;base64,AA'] }),
    msg({ id: 'a2', role: 'assistant', text: 'Made it blue.' }),
  ];

  it('keeps the message replaced, with what followed it, and makes room for the new one', () => {
    const { branches, branch } = branchesForResend(thread, 2, 'make it green');
    expect(branch).toBe(1);
    expect(branches.map((b) => b.text)).toEqual(['make it blue', 'make it green']);
    expect(branches[0].tail.map((m) => m.id)).toEqual(['a2']);
    // The pictures go with the new words, as the resend sends them.
    expect(branches[1].images).toEqual(['data:image/png;base64,AA']);
  });

  it('goes back to an earlier version with its conversation, and forward again to the live one', () => {
    const { branches, branch } = branchesForResend(thread, 2, 'make it green');
    const edited = [...thread.slice(0, 2), msg({ id: 'u3', text: 'make it green', branches, branch }), msg({ id: 'a3', role: 'assistant', text: 'Made it green.' })];
    const back = showBranch(edited, 2, 0);
    expect(back.map((m) => m.text)).toEqual(['an invoice', 'Built it.', 'make it blue', 'Made it blue.']);
    expect(back[2]).toMatchObject({ id: 'u3', branch: 0, images: ['data:image/png;base64,AA'] });
    const forward = showBranch(back, 2, 1);
    expect(forward.map((m) => m.text)).toEqual(['an invoice', 'Built it.', 'make it green', 'Made it green.']);
  });

  it('adds a third version beside the two, and changes nothing for a version that is not there', () => {
    const first = branchesForResend(thread, 2, 'make it green');
    const edited = [...thread.slice(0, 2), msg({ id: 'u3', text: 'make it green', ...first }), msg({ id: 'a3', role: 'assistant', text: 'Made it green.' })];
    const second = branchesForResend(edited, 2, 'make it red');
    expect(second.branches.map((b) => b.text)).toEqual(['make it blue', 'make it green', 'make it red']);
    expect(second.branches[1].tail.map((m) => m.text)).toEqual(['Made it green.']);
    expect(showBranch(edited, 2, 7)).toEqual(edited);
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
