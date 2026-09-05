/**
 * The report's history, and what each step did to it.
 *
 * Two questions, and the second is the one that was missing. "Take me back" is
 * a restore button. "What did that refinement actually change?" needs a diff,
 * and without one a refinement is a black box: the report comes back different
 * and the only way to find out how is to read two REPX files side by side.
 *
 * The diff is structural and by control name — added, removed, moved, resized,
 * retyped — rather than a text diff of the XML, because the model rewrites
 * whitespace and attribute order freely between generations and a line diff of
 * two REPX files is almost entirely noise. See `lib/revisions.ts`.
 */
import { useMemo } from 'react';
import { diffReports, describeDiff, type Revision } from '../lib/revisions';
import { formatSessionStamp } from '../lib/datetime';

interface Props {
  revisions: readonly Revision[];
  /** The REPX on screen, so the newest row can say whether it is still current. */
  current?: string;
  onRestore: (revision: Revision) => void;
}

export default function RevisionsPanel({ revisions, current, onRestore }: Props) {
  /*
   * Each row is compared with the one BELOW it — the state it replaced — which
   * is what "what did this step do" means. The last row has nothing below it
   * and so has no diff, which is correct: the first generation did not change
   * anything, it created it.
   */
  const rows = useMemo(
    () => revisions.map((revision, i) => {
      const previous = revisions[i + 1];
      return {
        revision,
        change: previous
          ? describeDiff(diffReports(previous.snapshot.repxContent, revision.snapshot.repxContent))
          : '',
        first: !previous,
      };
    }),
    [revisions],
  );

  const currentIsNewest = revisions[0] && current === revisions[0].snapshot.repxContent;

  return (
    <div className="rv-root">
      <style>{`
        .rv-root { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
        .rv-empty { font-size: 12.5px; line-height: 1.6; opacity: .75; }
        .rv-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; flex: 1; }
        .rv-row {
          display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px;
          padding: 10px 0; border-bottom: 1px solid var(--rule-soft, #eceff3);
        }
        .rv-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; }
        .rv-meta {
          grid-column: 1 / -1; font-family: var(--font-code, monospace);
          font-size: 10.5px; letter-spacing: .04em; opacity: .6;
        }
        .rv-change { grid-column: 1 / -1; font-size: 11.5px; opacity: .8; }
        .rv-current {
          font-family: var(--font-code, monospace); font-size: 9.5px; letter-spacing: .09em;
          text-transform: uppercase; color: var(--ok-ink, #1f6f49);
        }
        .rv-mini {
          font-family: var(--font-code, monospace); font-size: 10px; letter-spacing: .06em;
          text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--rule-strong, #d7dee7); background: transparent;
          color: inherit; cursor: pointer;
        }
      `}</style>

      {revisions.length === 0 ? (
        <p className="rv-empty">
          Every generation, refinement and binding pass is kept here, with what it changed —
          so a refinement that made the report worse is one click from being undone.
          <br /><br />
          Nudging a control is not a revision; the Preview pane has its own undo for that.
          Revisions live for this session and are not saved with the project.
        </p>
      ) : (
        <ul className="rv-list">
          {rows.map(({ revision, change, first }, i) => (
            <li className="rv-row" key={revision.id}>
              <span className="rv-label">{revision.label}</span>
              <span>
                {i === 0 && currentIsNewest
                  ? <span className="rv-current">current</span>
                  : <button className="rv-mini" onClick={() => onRestore(revision)}>Restore</button>}
              </span>
              <span className="rv-meta">
                {formatSessionStamp(revision.at)}
                {' · '}
                {revision.snapshot.repxContent.length.toLocaleString()} chars
              </span>
              {(change || first) && (
                <span className="rv-change">{first ? 'the first version of this report' : change}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
