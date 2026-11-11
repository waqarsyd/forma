/**
 * What an export asked of the Preview becomes (2026-11-11, the full audit's
 * PX-13, CV-17, PX-17 and PX-20, batch PXB): which formats are written, which
 * PDF path each takes, what the workspace says while it is written, and what
 * the chat's reply says once it is saved. The Preview runs the job; this
 * module holds the decisions, so they are tested without a page.
 *
 * - Several formats asked in one turn are written in one go and saved as one
 *   .zip: started 1.5 s apart, each after the first met the browser's "this
 *   site is trying to download multiple files", and a Word file still being
 *   written when the RTF arrived was dropped without a word.
 * - "PDF" is the browser's print, which keeps every script the Preview draws,
 *   only when it was chosen in the Export panel or the command menu for a
 *   report with no password and no PDF/A: printing can neither encrypt nor
 *   embed (parity rows 72 and 73), and a PDF asked for in the chat is a file
 *   saved to the downloads, not a print dialog to work through.
 * - Forma's own PDF refusing a script it cannot hold (PX-14) falls back to the
 *   print when that was the one thing asked, and says so.
 */
import { exportFileName } from './csvExport';

/** What the Preview can be asked to export; 'pdf-outline' is the PDF Forma writes itself. */
export type PrintFormat = 'pdf' | 'pdf-outline' | 'csv' | 'xlsx' | 'docx' | 'rtf' | 'html' | 'png';

/** One export asked for: its formats in the order asked, and the chat's reply that said so, if the chat asked. */
export interface ExportJob {
  formats: readonly PrintFormat[];
  /** The chat's reply that said it was exporting, which says what was saved once it is. */
  reply?: string | null;
}

/**
 * The formats, each once, in the order asked. "PDF" and "PDF with outline"
 * are one file in a set of several: both are written by Forma then, so the
 * outlined one stands for both.
 */
export function jobFormats(formats: readonly PrintFormat[]): PrintFormat[] {
  const once = [...new Set(formats)];
  return once.includes('pdf-outline') && once.includes('pdf') && once.length > 1 ? once.filter((f) => f !== 'pdf') : once;
}

/**
 * Whether the job is the browser's print: one "PDF", not asked in the chat,
 * for a report with no password and no PDF/A of its own.
 */
export function printsInBrowser(job: ExportJob, secured: boolean): boolean {
  const formats = jobFormats(job.formats);
  return formats.length === 1 && formats[0] === 'pdf' && !job.reply && !secured;
}

/** The pages laid out as they print: Forma's PDF, Word and RTF read them. */
export const readsPages = (f: PrintFormat) => f === 'pdf' || f === 'pdf-outline' || f === 'docx' || f === 'rtf';
/** The one continuous page CSV and XLSX use too: HTML and the picture read it. */
export const readsContinuous = (f: PrintFormat) => f === 'html' || f === 'png';

const WORDS: Record<PrintFormat, string> = {
  pdf: 'the PDF',
  'pdf-outline': 'the PDF',
  csv: 'the CSV file',
  xlsx: 'the Excel workbook',
  docx: 'the Word document',
  rtf: 'the RTF file',
  html: 'the web page',
  png: 'the picture',
};

/** "the Word document and the RTF file", in the order given, each once. */
function listed(formats: readonly PrintFormat[]): string {
  const words = [...new Set(formats.map((f) => WORDS[f]))];
  return words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * What the workspace says while files are written (PX-20): its Export panel
 * draws no button to say "Writing PDF…", and a long PDF or Word file left the
 * pane still with nothing said. Null for a job that is written at once.
 */
export function writingNotice(formats: readonly PrintFormat[]): string | null {
  const slow = jobFormats(formats).filter((f) => readsPages(f) || readsContinuous(f));
  if (!slow.length) return null;
  const s = listed(slow);
  return `Writing ${s}…`;
}

/** The name the job's one download takes: its one file's, or a .zip after the report when there are several. */
export function bundleName(title: string | null | undefined, files: readonly string[]): string | null {
  if (!files.length) return null;
  return files.length === 1 ? files[0] : exportFileName(title, 'zip');
}

/** The sentence a reply says once the job is saved. */
export function savedSentence(saved: string, files: readonly string[]): string {
  if (files.length <= 1 || saved === files[0]) return `Saved ${saved} to your downloads.`;
  const inside = files.length === 2 ? files.join(' and ') : `${files.slice(0, -1).join(', ')} and ${files[files.length - 1]}`;
  return `Saved ${saved} to your downloads, with ${inside} in it.`;
}

/*
 * The sentences agentEdit's toolSentence writes for an export through the
 * Preview: "Exporting it as a PDF.", "Exporting it as a Word document.". The
 * .repx is downloaded by App, never through here, so its sentence stays.
 */
const EXPORTING = /Exporting it as (?!a \.repx)[^.]*\./g;

/**
 * The chat's reply with its "Exporting it as …" sentences replaced by what
 * was done: the first by `sentence`, the rest dropped, since one download now
 * carries them all. A reply that said none gains the sentence at its end.
 * A replacer function, so a `$` in the sentence is never read as a pattern.
 */
export function replyAfterExport(text: string, sentence: string): string {
  let found = 0;
  const replaced = text.replace(EXPORTING, () => (found++ === 0 ? sentence : ''));
  if (!found) return text.trim() ? `${text.trim()}\n\n${sentence}` : sentence;
  // The spaces a dropped sentence leaves, within a line and at its end.
  return replaced.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+(?=\n|$)/g, '').trim();
}

/**
 * Whether Forma's own PDF refused because of a script its faces do not hold
 * (PX-14, pdfWriter.ts's `unprintableReason`), which the print path draws.
 */
export function isScriptRefusal(message: string): boolean {
  return /cannot hold; PDF keeps it as shown\.$/.test(message);
}

/**
 * What is said when such a PDF is printed instead: the script named as the
 * refusal named it, and that a password does not come with a print.
 */
export function printFallbackNote(message: string, secured: boolean): string {
  const script = /^This report has (\S+) text/.exec(message)?.[1];
  const what = script && script !== 'text' ? `${script} text` : 'text';
  return `This report has ${what} that a PDF file from Forma can't hold, so it opened to print instead: choose Save as PDF there.${secured ? ' The printed copy has no password.' : ''}`;
}
