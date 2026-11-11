/**
 * How the chat box routes a message before any AI is asked (2026-11-07, the
 * agent audit's batch B). Each case is a message that was routed wrongly
 * before, or one the change must not break.
 */
import { describe, expect, it } from 'vitest';
import { firstReply, isPlainBuild, isRememberMessage, isVagueReportAsk, needsRowsConsent, NOT_FOLLOWED, pendingQuestions, pendingReplyKind, queueStep, resumed, steered, turnBase, turnEnding, vagueReportReply, vagueReportWord, withSelection, type TurnMessage, type TurnQueued } from './chatTurn';
import { languageAsked } from './repxTranslate';

// The full audit (2026-11-11, WS-01, CV-03 and CV-19): the Preview's rows are asked about once per project.
describe('needsRowsConsent', () => {
  it('asks only while nothing has been said, and never again after a yes or a no', () => {
    expect(needsRowsConsent(null)).toBe(true);
    expect(needsRowsConsent('yes')).toBe(false);
    expect(needsRowsConsent('no')).toBe(false);
    // The question sent again with the answer, before the state has caught up with it.
    expect(needsRowsConsent(null, { consented: true })).toBe(false);
    expect(needsRowsConsent(null, { declined: true })).toBe(false);
    expect(needsRowsConsent(null, {})).toBe(true);
  });
});

// The full audit (2026-11-11, UI2, CV-13 and PL-24): the first reply names what happened, never the ask.
describe('firstReply', () => {
  it('says what was made, and from what', () => {
    expect(firstReply('open', true)).toBe("Done. I've changed the report as you asked.");
    expect(firstReply('picture', true)).toBe("Here's the report from your page, with what you asked for.");
    expect(firstReply('picture', false)).toBe("Here's the report from your page.");
    expect(firstReply('pdf', false)).toBe("Here's the report from your PDF.");
    expect(firstReply('repx', true)).toBe("Here's your report again, with what you asked for.");
    expect(firstReply('repx', false)).toBe("Here's your report again.");
    expect(firstReply('repx', true, 'French')).toBe("Here's your report again, in French.");
    for (const words of [true, false]) expect(firstReply('repx', words)).not.toMatch(/from your report/);
    expect(firstReply('description', true)).toBe("Here's the report you described.");
    expect(firstReply('picture', true, 'German')).toBe("Here's the report from your page, in German.");
    for (const kind of ['open', 'picture', 'pdf', 'repx', 'description'] as const) expect(firstReply(kind, true)).not.toMatch(/updated|instructions/);
  });
});

// The full audit (2026-11-11, CV-14): "the report" with nothing open names no report.
describe('a report named only as "the report"', () => {
  // The language as App names it, from the lazy language table.
  const isLanguage = (word: string) => languageAsked(`in ${word}`) !== null;

  it('is vague with only a language or a format said of it, and asks which', () => {
    for (const m of ['generate the report in German', 'Make my report in French please', 'translate this report into Spanish', 'export the report as a PDF', 'give me the report in Excel']) {
      expect(isVagueReportAsk(m, isLanguage), m).toBe(true);
      expect(isPlainBuild(m, isLanguage), m).toBe(false);
    }
    // A format is vague without the table; a language needs it.
    expect(isVagueReportAsk('export the report as a PDF')).toBe(true);
    expect(vagueReportWord('generate the report in German')).toBe('German');
    for (const m of ['Create a sales report in German', 'make an invoice', 'Build a report of orders by region', 'make the title bold']) {
      expect(isVagueReportAsk(m, isLanguage), m).toBe(false);
    }
    expect(vagueReportReply('German')).toBe("Which report? Attach a picture or a PDF of it, or tell me what it should list, and I'll make it in German.");
    expect(vagueReportReply(null)).toBe("Which report? Attach a picture or a PDF of it, or tell me what it should list, and I'll make it.");
  });

  // The review of CV-14 (2026-11-11): a word that says what to design is not vague, and is designed.
  it('designs "the report as an invoice": only a language or a format is vague', () => {
    for (const m of ['create the report as an invoice', 'make the report as a payslip', 'build the report in landscape', 'make the report in bold']) {
      expect(isVagueReportAsk(m, isLanguage), m).toBe(false);
    }
    expect(isPlainBuild('create the report as an invoice', isLanguage)).toBe(true);
    expect(isPlainBuild('make the report as a payslip', isLanguage)).toBe(true);
  });

  it('says it did not follow an empty answer in a person’s words', () => {
    expect(NOT_FOLLOWED).toBe("I didn't follow that. Could you say it another way?");
  });
});

describe('isRememberMessage', () => {
  it('keeps only "remember" and "from now on" (items 2 and 92)', () => {
    for (const m of ['Remember: always use A4', 'remember that our reports are landscape', 'From now on use Tahoma', 'Please remember to use 9pt captions']) {
      expect(isRememberMessage(m), m).toBe(true);
    }
    for (const m of ['Never mind, make the title red', 'Always put the logo left', 'Note that the total is wrong', 'I prefer A4', 'By default use Letter', 'Do you remember the invoice?', 'remember what I said?']) {
      expect(isRememberMessage(m), m).toBe(false);
    }
  });
});

describe('isPlainBuild', () => {
  it('takes a report asked for with something to design from (item 80)', () => {
    for (const m of ['Create a sales report', 'make an invoice', 'Build a report of orders by region', 'please draft a stock register', 'Generate a customer list with phone numbers', 'create me a payslip']) {
      expect(isPlainBuild(m), m).toBe(true);
    }
  });

  it('leaves a report asked for with nothing to say what it shows to the chat, and anything else', () => {
    for (const m of ['create a report', 'Make a new report please', 'build me a simple list', 'create a report for me', 'make the title bold', 'hello', 'what is a report?']) {
      expect(isPlainBuild(m), m).toBe(false);
    }
  });
});

describe('pendingReplyKind', () => {
  it('reads a reply to the questions as the answer, a question of its own, or a new request (item 87)', () => {
    expect(pendingReplyKind('Group by region, with a total per region')).toBe('answer');
    expect(pendingReplyKind('the amounts, in euros')).toBe('answer');
    expect(pendingReplyKind('What does grouping do?')).toBe('question');
    expect(pendingReplyKind('yes, is that fine?')).toBe('answer');
    expect(pendingReplyKind('Create a payslip for our staff')).toBe('new');
  });
});

describe('withSelection', () => {
  it('names the selected controls for a redesign, and leaves the words alone with none (item 19)', () => {
    expect(withSelection('make these a table', [])).toBe('make these a table');
    const words = withSelection('make these a table', ['labelQty', 'labelPrice']);
    expect(words.startsWith('make these a table')).toBe(true);
    expect(words).toContain('labelQty, labelPrice');
  });
});

/*
 * The turn's control flow, out of App.tsx (2026-11-07, agent audit item 36).
 * Each case is a way it went wrong before, or a rule a change must keep.
 */
const you = (id: string, text: string, extra: Partial<TurnMessage> = {}): TurnMessage => ({ id, role: 'user', text, ...extra });
const forma = (id: string, text: string, extra: Partial<TurnMessage> = {}): TurnMessage => ({ id, role: 'assistant', text, ...extra });

describe('queueStep', () => {
  const queue = [{ id: 'q1', text: 'make it bold' }, { id: 'q2', text: 'and red' }];

  it('sends the next message when nothing waits on the person, and nothing from an empty queue', () => {
    expect(queueStep(queue, [you('u', 'an invoice'), forma('a', 'Built it.')])).toEqual({ send: queue[0], rest: [queue[1]] });
    expect(queueStep([], [])).toBeNull();
  });

  it('pauses rather than take a queued message as the answer to a question it predates (item 28)', () => {
    const asked = [you('u', 'a report'), forma('a', 'Two questions.', { clarify: { answered: false } })];
    expect(queueStep(queue, asked)).toBe('pause');
    const redesign = [you('u', 'add a chart'), forma('a', 'Redesign?', { confirm: {} })];
    expect(queueStep(queue, redesign)).toBe('pause');
    expect(queueStep(queue, [you('u', 'add a chart'), forma('a', 'Done.', { confirm: { answered: 'no' } })])).not.toBe('pause');
  });

  it('pauses after a request that failed, so the queue does not carry on as if nothing happened', () => {
    expect(queueStep(queue, [you('u', 'an invoice', { error: 'Google was busy.' })])).toBe('pause');
  });

  it('sends a steer, and a message Resume released, whatever waits', () => {
    const asked = [you('u', 'a report', { error: 'failed' })];
    expect(queueStep([{ ...queue[0], steer: true as const }], asked)).toEqual({ send: { ...queue[0], steer: true }, rest: [] });
    expect(queueStep(resumed(queue), asked)).toEqual({ send: { ...queue[0], go: true }, rest: [queue[1]] });
  });
});

describe('resumed and steered', () => {
  it('releases only the next message on Resume', () => {
    const out = resumed<TurnQueued>([{ id: 'q1', text: 'a' }, { id: 'q2', text: 'b' }]);
    expect(out.map((q) => q.go)).toEqual([true, undefined]);
    expect(resumed([])).toEqual([]);
  });

  it('puts a steer first, carrying the words and pictures of the request it changes (item 86)', () => {
    const queue = [{ id: 'q1', text: 'first' }, { id: 'q2', text: 'smaller font instead' }];
    const messages = [you('u', 'an invoice like this', { images: ['data:a'], imageMeta: [{ uploadId: 'x' }] })];
    expect(steered(queue, 'q2', messages)).toEqual([
      { id: 'q2', text: 'smaller font instead', steer: true, steerFrom: 'an invoice like this', images: ['data:a'], imageMeta: [{ uploadId: 'x' }] },
      { id: 'q1', text: 'first' },
    ]);
    expect(steered(queue, 'gone', messages)).toEqual(queue);
  });
});

describe('pendingQuestions', () => {
  it("finds Forma's unanswered questions with what they are about, only when they are the last word (item 24)", () => {
    const asking = forma('a', 'Two questions.', { clarify: { answered: false, request: { description: 'sales by region' } } });
    expect(pendingQuestions([you('u', 'a report'), asking])).toEqual({ request: { description: 'sales by region' }, messageId: 'a' });
    expect(pendingQuestions([you('u', 'a report'), asking, you('v', 'never mind')])).toBeNull();
    expect(pendingQuestions([you('u', 'a report'), { ...asking, clarify: { answered: true, request: {} } }])).toBeNull();
    // Saved before the description was kept with them: nothing to build from.
    expect(pendingQuestions([you('u', 'a report'), forma('a', 'Questions.', { clarify: { answered: false } })])).toBeNull();
  });
});

describe('turnBase', () => {
  const ask = you('u2', 'make it bold');
  const messages = [you('u1', 'an invoice'), forma('a1', 'Built.'), ask, forma('a2', 'Made it bold.'), you('u3', 'and red'), forma('a3', 'Red.')];

  it('starts a message sent again from the report it first found (item 3)', () => {
    expect(turnBase(ask, messages, new Map([['u2', 'v1']]), {})).toBe('v1');
    expect(turnBase(ask, messages, new Map([['u2', null]]), {})).toBeNull();
  });

  it('starts from before the change its reply made, and not a later reply\'s', () => {
    expect(turnBase(ask, messages, new Map(), { a2: { before: 'before bold' }, a3: { before: 'before red' } })).toBe('before bold');
    expect(turnBase(ask, messages, new Map(), { a3: { before: 'before red' } })).toBeUndefined();
  });

  it('starts a message that opened a project of its own from no report, and an unknown one from the report as it is', () => {
    expect(turnBase(you('n', 'a different report', { fresh: true }), messages, new Map(), {})).toBeNull();
    expect(turnBase(you('x', 'not in the transcript'), messages, new Map(), {})).toBeUndefined();
  });
});

describe('turnEnding', () => {
  it('says how a turn ended: a failure, a question, a report made or changed, or a reply (item 63)', () => {
    expect(turnEnding({ ask: you('u', 'x', { error: 'busy' }), replies: [] }, {})).toBe('Request failed');
    expect(turnEnding({ ask: you('u', 'x'), replies: [forma('a', 'Questions.', { clarify: { answered: false } })] }, {})).toBe('Question waiting');
    expect(turnEnding({ ask: you('u', 'x'), replies: [forma('a', 'Built.', { result: {} })] }, {})).toBe('Report ready');
    expect(turnEnding({ ask: you('u', 'x'), replies: [forma('a', 'Made it bold.')] }, { a: { before: 'v1' } })).toBe('Report ready');
    expect(turnEnding({ ask: you('u', 'x'), replies: [forma('a', 'Hello.')] }, {})).toBe('Reply ready');
    expect(turnEnding({ ask: null, replies: [forma('a', 'Opened.')] }, {})).toBe('Reply ready');
  });
});
