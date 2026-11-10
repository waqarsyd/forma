/**
 * The models Forma suggests for Local AI, and the page reader (2026-11-10,
 * the owner's AI accuracy programme, batch AF, item 18).
 *
 * The owner asked for a pair on Ollama: a writer that designs, and a page
 * reader that reads a picture's text beside Forma's own OCR. Both are
 * suggestions, filled in with one click in Settings; "Find models" still
 * lists whatever the server has. Chosen on 2026-11-10 from Ollama's own
 * library, never a community upload:
 * - **The writer, qwen3.5:9b or qwen3.5:4b.** Both read images and take a
 *   256K context, so a long report request fits once the server is started
 *   with a context of 32,768 (ProviderSettings says how). The 9b downloads
 *   6.6 GB and the 4b 3.3 GB.
 * - **The page reader, glm-ocr.** A document OCR model of 2.7 GB, 1.8 GB as
 *   q8_0, that reads text, tables and formulas. PaddleOCR-VL scores higher on
 *   OmniDocBench but is on Ollama only as community uploads, so it is not
 *   suggested; any model can still be typed into the field.
 *
 * The memory guidance is by the computer's memory, since a model needs its
 * download and its context's cache beside it, and the pair is loaded
 * together. It has not been measured on this project's machines: the
 * measurement is prepared for the owner's own computer
 * (`scripts/fidelity/run.ts --local-model`, `--page-reader`).
 *
 * The page reader has no positions, so its text never replaces what OCR
 * read: it goes to the AI as a second reading, whose header tells the AI to
 * take positions from OCR and to read a string that the two readings
 * disagree on from the image. A disagreement is where a misread hides.
 */

/** A model Forma suggests, with what it needs. */
export interface LocalPreset {
  /** The name to pull and to use: `ollama pull <model>`. */
  model: string;
  role: 'writer' | 'reader';
  /** What Ollama downloads. */
  download: string;
  /** The smallest computer it is suggested for, by its memory. */
  forMemory: string;
}

export const LOCAL_PRESETS: readonly LocalPreset[] = [
  { model: 'qwen3.5:9b', role: 'writer', download: '6.6 GB', forMemory: '16 GB or more' },
  { model: 'qwen3.5:4b', role: 'writer', download: '3.3 GB', forMemory: '8 GB' },
  { model: 'glm-ocr', role: 'reader', download: '2.7 GB', forMemory: '16 GB or more' },
  { model: 'glm-ocr:q8_0', role: 'reader', download: '1.8 GB', forMemory: '8 GB' },
];

/** The pair suggested for a computer of this much memory: '8 GB' or '16 GB or more'. */
export function presetPair(forMemory: string): { writer: LocalPreset; reader: LocalPreset } {
  const of = (role: LocalPreset['role']) => LOCAL_PRESETS.find((p) => p.role === role && p.forMemory === forMemory) ?? LOCAL_PRESETS.find((p) => p.role === role)!;
  return { writer: of('writer'), reader: of('reader') };
}

/** The commands that fetch a pair, to copy into a terminal. */
export function pullCommands(pair: { writer: LocalPreset; reader: LocalPreset }): string {
  return `ollama pull ${pair.writer.model}\nollama pull ${pair.reader.model}`;
}

/** The most of a page reader's answer that is sent on: a page's text, with room for its tables. */
export const PAGE_READER_MAX_CHARS = 12_000;

/**
 * The question a page reader is asked, by its name. glm-ocr is trained on
 * "Text Recognition:" (its Ollama page), PaddleOCR-VL on "OCR:"; any other
 * model is asked in words.
 */
export function pageReaderPrompt(model: string): string {
  if (/glm-ocr/i.test(model)) return 'Text Recognition:';
  if (/paddleocr-vl/i.test(model)) return 'OCR:';
  return 'Read all the text on this page, in reading order, as Markdown, with each table as a Markdown table. Write nothing else.';
}

/** A page reader's answer as an attachment's text: a header that says what it is, then the text. */
export function pageReaderText(file: string, page: number, model: string, text: string): string | null {
  const read = text
    .replace(/^```[a-z]*\n?|\n?```\s*$/gi, '')
    .trim();
  if (!read) return null;
  const cut = read.length > PAGE_READER_MAX_CHARS ? `${read.slice(0, PAGE_READER_MAX_CHARS)}\n[the rest of the page reader's answer was cut]` : read;
  return (
    `${file}, page ${page}: the page's text READ BY A PAGE READER, ${model}, a model on this computer that reads a page's text from its picture. ` +
    'It has no positions: take every position and size from the text READ BY OCR. ' +
    'Where a string here and the same string READ BY OCR differ, read that string from the image; where they agree, it is right.\n' +
    cut
  );
}
