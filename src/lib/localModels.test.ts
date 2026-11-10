/**
 * The models Forma suggests for Local AI, and the page reader's text
 * (2026-11-10, the AI accuracy programme, batch AF, item 18).
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_PRESETS, PAGE_READER_MAX_CHARS, pageReaderPrompt, pageReaderText, presetPair, pullCommands } from './localModels';

describe('the suggested pair', () => {
  it('suggests a writer and a page reader for each size of computer', () => {
    const small = presetPair('8 GB');
    expect([small.writer.model, small.reader.model]).toEqual(['qwen3.5:4b', 'glm-ocr:q8_0']);
    const large = presetPair('16 GB or more');
    expect([large.writer.model, large.reader.model]).toEqual(['qwen3.5:9b', 'glm-ocr']);
    expect(pullCommands(small)).toBe('ollama pull qwen3.5:4b\nollama pull glm-ocr:q8_0');
  });

  it('suggests only models from Ollama’s own library, never a community upload', () => {
    for (const p of LOCAL_PRESETS) expect(p.model).not.toContain('/');
  });
});

describe('the page reader', () => {
  it('asks each model the question it was trained on', () => {
    expect(pageReaderPrompt('glm-ocr:q8_0')).toBe('Text Recognition:');
    expect(pageReaderPrompt('MedAIBase/PaddleOCR-VL')).toBe('OCR:');
    expect(pageReaderPrompt('qwen3.5:4b')).toMatch(/^Read all the text on this page/);
  });

  it('says what its text is and that OCR has the positions', () => {
    const text = pageReaderText('invoice.png', 2, 'glm-ocr', '```markdown\nINVOICE\n| Item | Qty |\n```')!;
    expect(text.split('\n')[0]).toMatch(/^invoice\.png, page 2: the page's text READ BY A PAGE READER, glm-ocr,/);
    expect(text).toMatch(/take every position and size from the text READ BY OCR/);
    expect(text).toMatch(/differ, read that string from the image/);
    // The fence the model wrapped its answer in is not part of the page.
    expect(text.endsWith('INVOICE\n| Item | Qty |')).toBe(true);
  });

  it('sends nothing for an empty answer, and cuts a runaway one', () => {
    expect(pageReaderText('a.png', 1, 'glm-ocr', '  \n ')).toBeNull();
    const long = pageReaderText('a.png', 1, 'glm-ocr', 'x'.repeat(PAGE_READER_MAX_CHARS + 500))!;
    expect(long).toMatch(/the rest of the page reader's answer was cut\]$/);
    expect(long.length).toBeLessThan(PAGE_READER_MAX_CHARS + 600);
  });
});
