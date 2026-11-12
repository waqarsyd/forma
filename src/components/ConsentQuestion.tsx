/**
 * A question asked before something runs on the person's own database or
 * leaves this browser (2026-11-12, the owner's decision 3 of the 2026-11-11
 * audit): the Data tab's SQL from a sentence, and the Preview's Live rows on a
 * report that runs a stored procedure. Both were a disabled button or a line
 * with a button beside it; they are asked now as the chat asks before the
 * Preview's rows go (ChatThread's rows question, `consentReply` in
 * lib/previewRows.ts): what would happen, in Forma's words, that nothing has
 * happened yet, and two buttons, the yes filled and the no outlined.
 *
 * The pane that asks remembers a yes for the project through its props (App
 * keeps it, and forgets it when the project is left, as it forgets the rows
 * answer); a no runs nothing and sends nothing, and the question comes back
 * only when the person asks for the thing again.
 */
interface Props {
  /** The question, as a screen reader names the group. */
  label: string;
  /** What would happen, that nothing has yet, and how long a yes holds. */
  text: string;
  yes: string;
  no: string;
  onAnswer: (yes: boolean) => void;
}

export default function ConsentQuestion({ label, text, yes, no, onAnswer }: Props) {
  return (
    <div role="group" aria-label={label} style={{ flexBasis: '100%', display: 'grid', gap: 2, fontSize: 13, lineHeight: 1.5 }}>
      <p role="status" style={{ margin: 0 }}>{text}</p>
      <div className="wb-note-actions">
        <button type="button" className="wb-pill wb-pill--accent" onClick={() => onAnswer(true)}>{yes}</button>
        <button type="button" className="wb-pill wb-pill--outline" onClick={() => onAnswer(false)}>{no}</button>
      </div>
    </div>
  );
}
