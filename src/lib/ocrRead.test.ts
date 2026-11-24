import { describe, expect, it, vi } from 'vitest';
import type { OcrPage } from './ocr';
import { readWithEngines, type OcrEngines } from './ocrRead';

/*
 * Which engine reads a page, and in which language (2026-11-24, the MCP
 * work's wave 7): the browser's rule, moved out of lib/ocr.ts so the MCP
 * server's Node reader follows it too. The engines are stood in for; what is
 * checked is what each is asked, in what order, and which reading is kept.
 */
const line = (text: string, confidence: number, x0 = 0) => ({ text, confidence, box: { x0, y0: 0, x1: x0 + 400, y1: 30 }, words: [{ text, confidence, box: { x0, y0: 0, x1: x0 + 400, y1: 30 } }] });
const pageOf = (lines: ReturnType<typeof line>[]): OcrPage => ({ width: 1000, height: 800, dpi: null, lines });
const FRENCH = 'Facture le montant des frais pour la date du paiement est dans le total avec les taxes';

/** Engines that answer as given, and record what each was asked. */
function engines(answers: { paddle?: OcrPage | null; tesseract?: Record<string, OcrPage>; probes?: Record<string, number[]> }): OcrEngines & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    paddle: vi.fn(async () => (asked.push('paddle'), answers.paddle ?? null)),
    tesseract: vi.fn(async (languages: string) => (asked.push(languages), answers.tesseract?.[languages] ?? pageOf([]))),
    probes: vi.fn(async () => (asked.push('probes'), async (languages: string) => (asked.push(`probe ${languages}`), answers.probes?.[languages] ?? []))),
    stopped: vi.fn(),
    stage: vi.fn(),
  };
}

describe('which engine reads a page, and in which language', () => {
  it("keeps PaddleOCR's reading of an English page, and asks Tesseract nothing", async () => {
    const english = pageOf([line('INVOICE 1001 Total 47.00', 99)]);
    const e = engines({ paddle: english });
    expect(await readWithEngines(e)).toEqual({ page: english, language: 'eng', byPaddle: english });
    expect(e.asked).toEqual(['paddle']);
  });

  it('reads with Tesseract in English where PaddleOCR does not read', async () => {
    const english = pageOf([line('INVOICE 1001 Total 47.00', 91)]);
    const e = engines({ tesseract: { eng: english } });
    expect(await readWithEngines(e)).toEqual({ page: english, language: 'eng', byPaddle: null });
    expect(e.asked).toEqual(['paddle', 'eng']);
  });

  it('reads a French page again with French, over PaddleOCR only when Tesseract is sure of its own', async () => {
    const byPaddle = pageOf([line(FRENCH, 99)]);
    const unsure = engines({ paddle: byPaddle, tesseract: { 'fra+eng': pageOf([line(FRENCH, 65)]) } });
    expect(await readWithEngines(unsure)).toMatchObject({ page: byPaddle, language: 'eng' });
    expect(unsure.asked).toEqual(['paddle', 'fra+eng']);
    const sure = pageOf([line(FRENCH, 88)]);
    expect(await readWithEngines(engines({ paddle: byPaddle, tesseract: { 'fra+eng': sure } }))).toMatchObject({ page: sure, language: 'fra' });
    // Over Tesseract's own English reading, French is kept when it reads within two points of it.
    expect(await readWithEngines(engines({ tesseract: { eng: pageOf([line(FRENCH, 80)]), 'fra+eng': pageOf([line(FRENCH, 79)]) } }))).toMatchObject({ language: 'fra' });
  });

  it("probes a page English garbled in each other script, once encoded, and reads it again in the one that leads", async () => {
    const garbled = pageOf([line('l1 ~|', 20), line('|} ,1', 25, 500)]);
    const arabic = pageOf([line('المبلغ', 80)]);
    const e = engines({ tesseract: { eng: garbled, 'ara+eng': arabic }, probes: { eng: [30, 28], ara: [58, 60], urd: [40, 41], hin: [20, 22] } });
    expect(await readWithEngines(e)).toMatchObject({ page: arabic, language: 'ara' });
    expect(e.asked).toEqual(['paddle', 'eng', 'probes', 'probe eng', 'probe ara', 'probe urd', 'probe hin', 'ara+eng']);
    expect(e.stage).toHaveBeenCalledWith('working out the language');
    // No script leading by the margin: English stays.
    const none = engines({ tesseract: { eng: garbled }, probes: { eng: [30, 28], ara: [35, 33], urd: [31, 30], hin: [20, 22] } });
    expect(await readWithEngines(none)).toMatchObject({ page: garbled, language: 'eng' });
  });

  it('goes no further once stopped: not to Tesseract after PaddleOCR, nor to the next probe', async () => {
    const e = engines({});
    vi.mocked(e.stopped).mockImplementation(() => {
      throw new Error('OCR was stopped.');
    });
    await expect(readWithEngines(e)).rejects.toThrow('OCR was stopped.');
    expect(e.asked).toEqual(['paddle']);
  });
});
