import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ocrPageFrom } from './ocr';

/*
 * The engine itself, as a fake worker (2026-11-11, the full audit's TC-08a and
 * PL-01): what the page's reading makes of its blocks, and how a reading is
 * stopped. PaddleOCR is not served, so Tesseract reads every page.
 */
const recognize = vi.fn();
const terminate = vi.fn(async () => undefined);
const createWorker = vi.fn(async () => ({ recognize, terminate, reinitialize: vi.fn(async () => undefined) }));
vi.mock('tesseract.js', () => ({ createWorker: () => createWorker(), OEM: { LSTM_ONLY: 1 } }));
vi.mock('./paddle', () => ({ paddleServed: async () => false, stopPaddle: () => undefined }));

/*
 * Tesseract's blocks as an OcrPage. The engine itself runs only in a browser
 * (or, for the measurements recorded in app-shell.md, in Node with its own
 * core); what is under test here is the reading of its result.
 */
describe('ocrPageFrom', () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              text: 'Invoice  42\n',
              confidence: 91,
              bbox: { x0: 20, y0: 40, x1: 220, y1: 70 },
              words: [
                { text: 'Invoice', confidence: 95, bbox: { x0: 20, y0: 40, x1: 140, y1: 70 } },
                { text: ' ', confidence: 0, bbox: { x0: 140, y0: 40, x1: 150, y1: 70 } },
                { text: '42', confidence: 87, bbox: { x0: 160, y0: 40, x1: 220, y1: 70 } },
              ],
            },
            { text: ' ', confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [{ text: ' ', confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }] },
          ],
        },
      ],
    },
  ];

  it('keeps every word with its box and confidence, and a line as its words', () => {
    const page = ocrPageFrom(blocks, { width: 400, height: 300, dpi: 96 });
    expect(page).toMatchObject({ width: 400, height: 300, dpi: 96 });
    expect(page.lines).toHaveLength(1);
    expect(page.lines[0].text).toBe('Invoice 42');
    expect(page.lines[0].words.map((w) => `${w.text}:${w.confidence}`)).toEqual(['Invoice:95', '42:87']);
  });

  it('divides the boxes back when the image was enlarged for recognition', () => {
    const page = ocrPageFrom(blocks, { width: 200, height: 150, dpi: null }, 2);
    expect(page.lines[0].box).toEqual({ x0: 10, y0: 20, x1: 110, y1: 35 });
    expect(page.lines[0].words[1].box).toEqual({ x0: 80, y0: 20, x1: 110, y1: 35 });
  });

  it('reads no blocks as no lines', () => {
    expect(ocrPageFrom(null, { width: 1, height: 1, dpi: null }).lines).toEqual([]);
  });

  // Read in the owner's Chrome with Arabic chosen (2026-11-04): Tesseract wraps
  // a right-to-left word in U+200F and U+200E, which print as nothing.
  it('drops the direction marks Tesseract puts around right-to-left words', () => {
    const word = (text: string) => ({ text, confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } });
    const arabic = [{ paragraphs: [{ lines: [{ text: '', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 }, words: [word('‏المبلغ‎'), word('‏‎')] }] }] }];
    const page = ocrPageFrom(arabic, { width: 10, height: 10, dpi: null });
    expect(page.lines[0].words.map((w) => w.text)).toEqual(['المبلغ']);
    expect(page.lines[0].text).toBe('المبلغ');
  });
});

describe('recognizePage', () => {
  // Wide enough not to be enlarged, so no canvas is drawn in Node.
  const canvas = { width: 2000, height: 1000 } as unknown as HTMLCanvasElement;
  const line = (text: string, x0: number) => ({
    text,
    confidence: 93,
    bbox: { x0, y0: 10, x1: x0 + 200, y1: 40 },
    words: [{ text, confidence: 93, bbox: { x0, y0: 10, x1: x0 + 200, y1: 40 } }],
  });
  const answer = (texts: string[]) => ({ data: { confidence: 93, blocks: [{ paragraphs: [{ lines: texts.map((t, i) => line(t, i * 300)) }] }] } });
  const never = () => new Promise<never>(() => {});
  const fresh = async () => {
    vi.resetModules();
    return import('./ocr');
  };

  beforeEach(() => {
    recognize.mockReset();
    terminate.mockClear();
    createWorker.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps the engine's words, boxes and confidences onto the page", async () => {
    const { recognizePage } = await fresh();
    recognize.mockResolvedValue(answer(['Invoice', 'Total']));
    const page = await recognizePage(canvas, 150);
    expect(page).toMatchObject({ width: 2000, height: 1000, dpi: 150 });
    expect(page.lines.map((l) => l.text)).toEqual(['Invoice', 'Total']);
    expect(page.lines[1].words[0]).toEqual({ text: 'Total', confidence: 93, box: { x0: 300, y0: 10, x1: 500, y1: 40 } });
  });

  it('rejects as soon as it is stopped, and ends the engine it was reading with', async () => {
    const { recognizePage } = await fresh();
    recognize.mockImplementation(never);
    const stop = new AbortController();
    const reading = recognizePage(canvas, null, { signal: stop.signal });
    await vi.waitFor(() => expect(recognize).toHaveBeenCalled());
    stop.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("stopping one caller's reading leaves another's running", async () => {
    const { recognizePage } = await fresh();
    let finish: (value: unknown) => void = () => {};
    recognize.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const turn = recognizePage(canvas, null, { signal: new AbortController().signal });
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    // The OCR dialog's reading waits behind the turn's, and the dialog closes.
    const dialog = new AbortController();
    const waiting = recognizePage(canvas, null, { signal: dialog.signal });
    dialog.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).not.toHaveBeenCalled();
    finish(answer(['Kept']));
    expect((await turn).lines[0].text).toBe('Kept');
    // The closed dialog's page was never read.
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it('starts the next reading at once when the one before it is stopped', async () => {
    const { recognizePage } = await fresh();
    recognize.mockImplementationOnce(never).mockResolvedValueOnce(answer(['Next']));
    const first = new AbortController();
    const stopped = recognizePage(canvas, null, { signal: first.signal });
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    const next = recognizePage(canvas, null);
    first.abort();
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    // A terminated worker never answers, so the next reading loads a new one.
    expect((await next).lines[0].text).toBe('Next');
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('ends the engine a minute after the last reading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { recognizePage, OCR_IDLE_MS } = await fresh();
    recognize.mockResolvedValue(answer(['Once']));
    await recognizePage(canvas, null);
    await vi.advanceTimersByTimeAsync(OCR_IDLE_MS - 1);
    expect(terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('stopOcr stops every reading, waiting or under way', async () => {
    const { recognizePage, stopOcr } = await fresh();
    recognize.mockImplementation(never);
    const a = recognizePage(canvas, null);
    const b = recognizePage(canvas, null);
    await vi.waitFor(() => expect(recognize).toHaveBeenCalled());
    await stopOcr();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await expect(b).rejects.toMatchObject({ name: 'AbortError' });
  });
});
