/**
 * A star and two thumbs beside the report's title (2026-11-06), as Google
 * Stitch shows on each screen. The star is the project's pin, kept on this
 * device, which holds it at the top of the projects list: Forma's favourite.
 * The thumbs rate the reply that made the open report, the same rating as
 * the thumbs under that reply, and like it the rating stays with the message
 * and goes nowhere else. Each control is drawn only when it has something to
 * act on: the star for a saved project, the thumbs for a reply that made the
 * report.
 */
import { IconStar, IconThumbDown, IconThumbUp } from './landing/icons';
import './overlays.css';

interface Props {
  starred: boolean;
  onStar?: () => void;
  rating?: 'good' | 'bad';
  onRate?: (rating: 'good' | 'bad' | undefined) => void;
}

export default function RateReport({ starred, onStar, rating, onRate }: Props) {
  return (
    <span className="wb-rate" role="group" aria-label="Rate this report">
      {onStar && (
        <button
          type="button"
          className={starred ? 'is-on' : undefined}
          aria-pressed={starred}
          aria-label={starred ? 'Unstar this project' : 'Star this project'}
          title={starred ? 'Starred: kept at the top of your projects' : 'Star this project, to keep it at the top of your projects'}
          onClick={onStar}
        >
          <IconStar size={15} />
        </button>
      )}
      {onRate && (
        <>
          <button
            type="button"
            className={rating === 'good' ? 'is-on' : undefined}
            aria-pressed={rating === 'good'}
            aria-label="Good report"
            title="Good report"
            onClick={() => onRate(rating === 'good' ? undefined : 'good')}
          >
            <IconThumbUp size={15} />
          </button>
          <button
            type="button"
            className={rating === 'bad' ? 'is-on' : undefined}
            aria-pressed={rating === 'bad'}
            aria-label="Bad report"
            title="Bad report"
            onClick={() => onRate(rating === 'bad' ? undefined : 'bad')}
          >
            <IconThumbDown size={15} />
          </button>
        </>
      )}
    </span>
  );
}
