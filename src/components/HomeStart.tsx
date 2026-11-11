/**
 * The empty workspace as a home (2026-11-06), as Google Stitch's: the recent
 * projects on the left, and in the middle a heading and the starting points
 * (lib/startingPoints.ts), each putting its whole description in the box to
 * be edited before it is sent. The box itself stays where it always is, at
 * the foot of the bench. Shown only while nothing has been said and nothing
 * built; a conversation without a report keeps the bench's sheet. See *The
 * conversation floats over the report* in docs/notes/app-shell.md.
 */
import { formatSessionStamp } from '../lib/datetime';
import { STARTING_POINTS, recentProjects, type StartingPoint } from '../lib/startingPoints';
import './overlays.css';

interface Project {
  id: string;
  name: string;
  timestamp: string;
}

interface Props<P extends Project> {
  /** Every saved project; the newest few that are not archived are listed. */
  projects: readonly P[];
  archived: readonly string[];
  onOpen: (project: P) => void;
  onAllProjects: () => void;
  onPick: (point: StartingPoint) => void;
  /**
   * False while the Projects panel is open beside it (2026-11-06, the
   * workspace audit): the two lists of the same projects stood side by side.
   */
  showRecent?: boolean;
}

export default function HomeStart<P extends Project>({ projects, archived, onOpen, onAllProjects, onPick, showRecent = true }: Props<P>) {
  const recent = showRecent ? recentProjects(projects, archived) : [];
  return (
    <section className={`wb-home${recent.length ? ' has-recent' : ''}`} aria-label="Start a report">
      {recent.length > 0 && (
        <nav className="wb-home-recent" aria-label="Recent projects">
          <h3>Recent projects</h3>
          <ul>
            {recent.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p)}>
                  <span>{p.name}</span>
                  <small>{formatSessionStamp(p.timestamp)}</small>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="wb-home-all" onClick={onAllProjects}>All projects</button>
        </nav>
      )}
      <div className="wb-home-main">
        <h2>What report shall we make?</h2>
        {/* "In the box below" was wrong on a desktop, where the box sits at the
            foot of the left panel (the full audit's WS-44, 2026-11-11). */}
        <p>Attach a screenshot, a scan, a PDF or a .repx in the message box, or describe the report you want. Or start from one of these:</p>
        <div className="wb-home-points">
          {STARTING_POINTS.map((point) => (
            <button key={point.id} type="button" onClick={() => onPick(point)} title={point.text}>
              <b>{point.title}</b>
              <span>{point.gist}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
