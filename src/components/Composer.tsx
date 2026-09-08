/**
 * The composer: staged attachments, the notice lines, and the box you type in.
 *
 * Phase three of unpicking the chat out of `App.tsx`, and the last of the three.
 * `lib/chatSession.ts` holds the rules, `ChatThread` draws what was said, and
 * this draws what is about to be said.
 *
 * **One composer does both jobs, and that is not visible from here.** The send
 * button calls `onSend`, and `App.tsx` decides from what is attached whether
 * that becomes a conversational turn or a full generation — see
 * `isGenerationTurn` in `lib/chatSession.ts`. There is no second chat box, and
 * adding one would be the wrong fix for any problem.
 *
 * Props rather than state throughout, for the same reason as `ChatThread`: the
 * whole thing renders in a test with no Firebase, no pdf.js and no key. There
 * are a lot of them, and they are all genuinely this component's business —
 * grouping them into objects was considered and rejected as making the call site
 * harder to read for no gain in cohesion.
 *
 * `fileInputRef` is passed in rather than owned here because `App.tsx` clears
 * `.value` on it after an upload is handled, so the same file can be chosen
 * twice in a row. Owning the ref here would silently break that.
 */

import { useRef, type ChangeEventHandler, type RefObject } from 'react';
import type { AttachmentGroup, PreviewMeta } from '../lib/attachments';
import { groupLabel } from '../lib/attachments';
import {
  IconAlert,
  IconArrowUp,
  IconCheck,
  IconClose,
  IconDoc,
  IconPaperclip,
  IconWarn,
} from './landing/icons';

/** A staged text-only upload — a `.repx`, or a PDF whose pages did not render. */
export interface TextAttachmentGroup extends AttachmentGroup {
  uploadId: string;
}

export interface ComposerProps {
  /** Data URLs, one per page. */
  previews: string[];
  /** Those pages collapsed back into one entry per uploaded file. */
  previewGroups: AttachmentGroup[];
  previewMeta: PreviewMeta[];
  /** Uploads with no thumbnail of their own. */
  textGroups: TextAttachmentGroup[];
  onOpenAttachment: (indices: number[], start: number, file: string) => void;
  onRemoveFile: (indices: number[], uploadId?: string) => void;
  onRemoveText: (uploadId: string) => void;

  uploadNotices: string[];
  error: string | null;
  saveNotice: string | null;

  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  /** Gates the whole composer. Forma ships no key of its own. */
  hasApiKey: boolean;
  isAnalyzing: boolean;
  /** A chat turn is in flight. Blocks a second send — see `canSend` below. */
  isChatting: boolean;
  isIngesting: boolean;
  onAddKey: () => void;
}

export default function Composer({
  previews,
  previewGroups,
  previewMeta,
  textGroups,
  onOpenAttachment,
  onRemoveFile,
  onRemoveText,
  uploadNotices,
  error,
  saveNotice,
  prompt,
  onPromptChange,
  onSend,
  fileInputRef,
  onFileChange,
  hasApiKey,
  isAnalyzing,
  isChatting,
  isIngesting,
  onAddKey,
}: ComposerProps) {
  /*
   * One condition, read by the button *and* the keyboard.
   *
   * These were two conditions until 2026-09-08, and the second one did not
   * exist: the button carried `disabled` and the keydown handler on the input
   * beside it carried nothing, so Enter sent regardless of what was already
   * running. Pressing it during a generation re-entered `handleGenerate` — a
   * second run writing to the same progress state and the same abort refs as
   * the first — and during a chat turn it started a second turn whose history
   * was built from a `messages` closure captured before the first reply landed.
   * `handleGenerate` now refuses re-entry as well, but a disabled-looking button
   * that still fires on Enter is its own defect, so the fix is in both places.
   *
   * `isChatting` is new here for the same reason: the button never had it, so a
   * chat turn in flight left the control fully live.
   */
  const canSend = hasApiKey && !isAnalyzing && !isChatting && !isIngesting;

  /*
   * Sending puts the caret back in the field, and this is not a nicety.
   *
   * `.wb-box` draws its ring on `:focus-within`, so clicking the send button
   * lights the composer because the *button* holds focus. The moment `canSend`
   * started including `isChatting`, that button began disabling itself while
   * the request ran — and a disabled element loses focus, which no browser
   * gives back when it re-enables. The ring went out and the keyboard user was
   * dropped to the top of the document mid-conversation. Caught by a pixel diff
   * of two runs that looked identical; nothing else would have found it.
   *
   * Moving focus *before* React disables the button is what makes it stick: by
   * the time the button goes disabled it is no longer the focused element, so
   * there is nothing to steal. It is also where the next keystroke wants to be.
   */
  const promptRef = useRef<HTMLInputElement>(null);
  const sendAndKeepFocus = () => {
    onSend();
    promptRef.current?.focus();
  };

  return (
    <div className="wb-composer">
      {/* Staged intake. The artifact had no slot for these; they are absent
          at rest, so the default view is unchanged. */}
      {previews.length > 0 && (
        <div className="wb-chip-row">
          {/* One chip per file the user dropped. A 5-page PDF is five
              images underneath — the model needs a page each — but showing
              five thumbnails for one upload reads as the product having
              mangled the file. Pages are reachable inside the viewer. */}
          {previewGroups.map((group) => {
            const label = groupLabel(group);
            const first = group.indices[0];
            const uploadId = previewMeta[first]?.uploadId;
            return (
              <span key={`${group.file}-${first}`} className="wb-attach wb-attach--file">
                <button
                  type="button"
                  className="wb-attach-open"
                  onClick={() => onOpenAttachment(group.indices, 0, group.file)}
                  title={`View ${label}`}
                  aria-label={`View ${label}`}
                >
                  <img className="wb-attach-thumb" src={previews[first]} alt="" />
                  <span className="wb-attach-name">{group.file}</span>
                  {group.pages > 1 && <span className="wb-attach-count">{group.pages} pages</span>}
                </button>
                <button
                  onClick={() => onRemoveFile(group.indices, uploadId)}
                  title={`Remove ${label}`}
                  aria-label={`Remove ${label}`}
                >
                  <IconClose size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {textGroups.length > 0 && (
        <div className="wb-chip-row">
          {/* Only uploads with no thumbnail of their own reach this row —
              see `textGroups`. A PDF's text layer belongs to the chip
              above, not to a row of its own. */}
          {textGroups.map((group) => {
            const label = groupLabel(group);
            return (
              <span key={group.uploadId} className="wb-attach">
                <IconDoc size={13} />
                {label}
                <button
                  onClick={() => onRemoveText(group.uploadId)}
                  title={`Remove ${label}`}
                  aria-label={`Remove ${label}`}
                >
                  <IconClose size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {uploadNotices.length > 0 && (
        <div className="wb-note-line wb-warn">
          <span className="wb-ic"><IconWarn size={13} /></span>
          <span>{uploadNotices.join(' · ')}</span>
        </div>
      )}
      {error && (
        <div className="wb-note-line wb-warn" role="alert">
          <span className="wb-ic"><IconAlert size={13} /></span>
          <span>{error}</span>
        </div>
      )}
      {saveNotice && (
        <div className="wb-note-line wb-ok" role="status">
          <span className="wb-ic"><IconCheck size={13} /></span>
          <span>{saveNotice}</span>
        </div>
      )}

      <div className={`wb-box${hasApiKey ? '' : ' wb-is-locked'}`}>
        <button
          className="wb-tool"
          aria-label="Attach a file"
          title="Attach an image, a PDF or a .repx"
          onClick={() => fileInputRef.current?.click()}
        >
          <IconPaperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.repx"
          onChange={onFileChange}
          className="wb-hidden"
        />
        <input
          ref={promptRef}
          className="wb-line"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          /* Enter sends; Shift+Enter is left alone so a multi-line note is
             still possible. preventDefault stops the newline the send would
             otherwise leave behind in the field, and happens either way —
             suppressing the key is right even when the send is refused. */
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          disabled={!hasApiKey}
          placeholder={hasApiKey ? 'Describe a change…' : 'Add your API key to start'}
          aria-label="Describe a change"
        />
        <button
          className="wb-send"
          aria-label="Send note"
          /* Wrapped rather than passed bare. `onSend` is `handleGenerate`,
             whose first parameter is an optional prompt override, so handing
             it straight to onClick passes the click event as the prompt. */
          onClick={sendAndKeepFocus}
          disabled={!canSend}
        >
          <IconArrowUp size={15} />
        </button>
      </div>

      {!hasApiKey && (
        <button className="wb-gate" onClick={onAddKey}>
          <span className="wb-badge-ic"><IconAlert size={12} /></span>
          <span className="wb-txt">
            <b>Add your Gemini API key</b>
            <span>Forma ships no key of its own</span>
          </span>
          {/* Inline rather than an icon component: the artifact drew a
              right-chevron here, and icons.tsx has only the down one.
              Rotating it would need a rule in workspace.css, which is meant
              to stay byte-identical to the artifact. */}
          <svg
            className="wb-chev"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}

      {/* Shown in both states: whoever is about to paste a key is exactly
          who needs to know it is not being stored. */}
      <span className="wb-fineprint">
        <span>Your key clears when this tab closes</span>
      </span>
    </div>
  );
}
