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
import { MAX_PERSISTED_REVISIONS } from '../lib/revisionStore';
import { formatSessionStamp } from '../lib/datetime';

/**
 * The labels revisions were given by the part of Forma that made them, until
 * 2026-11-11 (the full audit's WS-05), as the person reads them now. A saved
 * project keeps its revisions' labels, so the old ones are read here rather
 * than left to say "Forma's box reader" in a list of versions.
 */
const OLD_LABELS: readonly [RegExp, string][] = [
  [/Forma's box reader|Forma's vision model/g, 'From your page'],
  [/Forma's own draft/g, 'First version'],
  [/Read from the page/g, 'Your page as printed'],
];

/**
 * A revision's label as shown. Not exported, so this module exports its
 * component alone and React's fast refresh can swap it in place; the mapping
 * is tested through the rendered panel (workspaceVoice.test.ts).
 */
function shownLabel(label: string): string {
  return OLD_LABELS.reduce((said, [old, now]) => said.replace(old, now), label);
}

interface Props {
  revisions: readonly Revision[];
  /** The REPX on screen, so the newest row can say whether it is still current. */
  current?: string;
  /**
   * Whether saving this project will keep its history — true when signed in.
   *
   * The panel says which, because the difference is invisible and only shows up
   * when someone comes back tomorrow to a report whose history is gone. Signed
   * out is session-only on purpose; see the header of `lib/revisionStore.ts`.
   */
  persisted?: boolean;
  onRestore: (revision: Revision) => void;
  /**
   * While Forma works (2026-11-06, the workspace audit), as the corner's Undo
   * and Redo are then: a version restored during a run was written over when
   * the run landed.
   */
  busy?: boolean;
}

export default function RevisionsPanel({ revisions, current, persisted, onRestore, busy = false }: Props) {
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
        .rv-foot { margin: 0; font-size: 11px; line-height: 1.5; opacity: .6; flex: 0 0 auto; }
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
          Every report, redesign and data binding is kept here, with what it changed —
          so a refinement that made the report worse is one click from being undone.
          <br /><br />
          Nudging a control is not a revision; Undo at the corner of the report takes it back.
          {' '}
          {persisted
            ? `Saving the project keeps the last ${MAX_PERSISTED_REVISIONS}.`
            : 'Revisions live for this session; sign in to keep them with the project.'}
        </p>
      ) : (
        <ul className="rv-list">
          {rows.map(({ revision, change, first }, i) => (
            <li className="rv-row" key={revision.id}>
              <span className="rv-label">{shownLabel(revision.label)}</span>
              <span>
                {i === 0 && currentIsNewest
                  ? <span className="rv-current">current</span>
                  : <button className="rv-mini" disabled={busy} title={busy ? 'After Forma finishes' : undefined} onClick={() => onRestore(revision)}>Restore</button>}
              </span>
              {/* The time alone: the file's length in characters followed it
                  until 2026-11-11 (the full audit's WS-33), a readout of the
                  file, not of the report. */}
              <span className="rv-meta">{formatSessionStamp(revision.at)}</span>
              {(change || first) && (
                <span className="rv-change">{first ? 'the first version of this report' : change}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {revisions.length > 0 && (
        <p className="rv-foot">
          {persisted
            ? `Saving keeps the newest ${MAX_PERSISTED_REVISIONS} with the project.`
            : 'Kept for this session only — sign in to save them with the project.'}
        </p>
      )}
    </div>
  );
}
