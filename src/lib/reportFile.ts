/**
 * Whether an attachment is a report Forma builds on, rather than a page or a
 * document to design one from (2026-11-11, the re-audit's R3-08).
 *
 * One predicate for App and Batch. App had its own, which took an SSRS
 * (.rdl, .rdlc) or FastReport (.frx) file as a report, since one arrives
 * converted to a .repx (CP-08), while Batch tested `.repx` alone: a Batch
 * .rdl was turned round as a picture's report would be, and counted as no
 * source at all.
 *
 * With its text, the text must hold a DevExpress report too. An RDL that
 * would not convert goes to the AI as its definition, for the AI to
 * reproduce (`rdlAttachment`): that is a source to design from, and App's
 * name-only test called it a report to keep. Without a text (a file's name
 * alone), the name decides.
 */
export function isReportFile(t: { file?: string; text?: string }): boolean {
  return /\.(repx|rdlc?|frx)$/i.test(t.file ?? '') && (t.text === undefined || /<XtraReportsLayoutSerializer\b/.test(t.text));
}
