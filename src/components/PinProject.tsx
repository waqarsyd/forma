/**
 * The pin beside the report's title: the open project held at the top of the
 * projects list, kept on this device, the same pin as the list's own.
 *
 * It was a star and two thumbs until 2026-11-06 (RateReport.tsx, as Stitch
 * shows on a screen). The workspace audit found both doubled: the star was the
 * list's Pin under another name and icon, and the thumbs rated the same reply
 * as the thumbs under that reply. The owner chose the reply's thumbs, as
 * ChatGPT and Gemini have them, and the title kept the pin. Drawn only for a
 * saved project, there being nothing to pin before.
 */
import { IconPin } from './landing/icons';
import './overlays.css';

interface Props {
  pinned: boolean;
  onPin: () => void;
}

export default function PinProject({ pinned, onPin }: Props) {
  return (
    <span className="wb-rate">
      <button
        type="button"
        className={pinned ? 'is-on' : undefined}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin this project' : 'Pin this project'}
        title={pinned ? 'Pinned: kept at the top of your projects (on this device)' : 'Pin to the top of your projects (on this device)'}
        onClick={onPin}
      >
        <IconPin size={14} />
      </button>
    </span>
  );
}
