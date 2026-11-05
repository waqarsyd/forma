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

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEventHandler, type RefObject } from 'react';
import type { AttachmentGroup, PreviewMeta } from '../lib/attachments';
import { groupLabel } from '../lib/attachments';
import { modelTiers } from '../lib/modelTiers';
import {
  IconAlert,
  IconArrowRight,
  IconArrowUp,
  IconChevronDown,
  IconClose,
  IconDoc,
  IconKey,
  IconMic,
  IconPencil,
  IconPlus,
  IconTarget,
  IconTrash,
  IconWarn,
} from './landing/icons';

/** A message typed while Forma works, waiting its turn (2026-11-05). */
export interface QueuedMessage {
  id: string;
  text: string;
}

/** The browser's speech recognition, as much of it as the box uses. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The constructor, where the browser has one (Chrome and Edge as `webkitSpeechRecognition`). */
function speechRecognition(): (new () => Recognition) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

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

  /** Problems with what was attached or sent: the only notes the composer shows. */
  uploadNotices: string[];
  error: string | null;

  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  /**
   * Stops what is in flight (2026-11-04): a generation, and since 2026-11-05
   * a chat reply, the questions asked before a design, or the reading of a
   * sent page. While one runs the send button is a Stop button, as in the
   * chat apps people know; there is no pause, ring or percentage in the chat.
   */
  onStop?: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  /**
   * Whether an AI is set up. Forma ships no key of its own, and with none the
   * box is locked and its button opens Settings for one (2026-11-05, the
   * owner's rule that the key is the entry point to any work).
   */
  hasApiKey: boolean;
  /** Opens Settings at the key, from the locked box's button. */
  onAddKey?: () => void;
  isAnalyzing: boolean;
  /** A chat turn is in flight. Blocks a second send — see `canSend` below. */
  isChatting: boolean;
  isIngesting: boolean;
  /** Files pasted into the box, as a drop or a pick would bring them. */
  onPasteFiles?: (files: File[]) => void;
  /**
   * The controls selected on the Preview (2026-11-05), shown above the box
   * as what "this" will mean, as ChatGPT's canvas shows a highlighted
   * passage. Cleared on the Preview, where it was made.
   */
  selection?: readonly string[];
  /**
   * The Gemini model the chat and reports use (2026-11-05), shown in the box
   * as Gemini shows its own: Auto, which Forma's detection picks per request,
   * or one of the models this key has answered for, with the requests sent
   * to each from this browser today. Absent for another AI.
   */
  models?: { current: string; choices: readonly { id: string; used: number }[]; onChoose: (id: string) => void } | null;
  /**
   * The queue (2026-11-05), as Stitch's tray over its box: a message sent
   * while Forma works waits here, each with Steer (stop what runs and send
   * this now), Edit (back into the box) and Cancel, and App sends the next
   * when Forma is free. With `onQueue` absent, the box only stops.
   */
  queue?: readonly QueuedMessage[];
  onQueue?: (text: string) => void;
  onSteer?: (id: string) => void;
  onEditQueued?: (id: string) => void;
  onCancelQueued?: (id: string) => void;
}

/** A model's name as the picker shows it: "2.5-flash" for "gemini-2.5-flash". */
export function modelLabel(id: string): string {
  return id ? id.replace(/^models\//, '').replace(/^gemini-/, '') : 'Auto';
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
  prompt,
  onPromptChange,
  onSend,
  onStop,
  fileInputRef,
  onFileChange,
  hasApiKey,
  onAddKey,
  isAnalyzing,
  isChatting,
  isIngesting,
  onPasteFiles,
  selection = [],
  models,
  queue = [],
  onQueue,
  onSteer,
  onEditQueued,
  onCancelQueued,
}: ComposerProps) {
  /* The model menu, open over the box; Escape or a click elsewhere closes it. */
  const [modelMenu, setModelMenu] = useState(false);
  const tiers = models ? modelTiers(models.choices) : [];
  const modelMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modelMenu) return;
    const away = (e: MouseEvent) => {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModelMenu(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [modelMenu]);
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
  // No key, no send (2026-11-05): the key is the entry point to any work, as
  // it was before 2026-11-02, when for three days Forma's own model answered
  // without one. Nothing about an attachment holds the send (2026-11-03): its
  // text is read after the message goes, as a step of the run.
  const canSend = hasApiKey && !isAnalyzing && !isChatting && !isIngesting;
  // While Forma works, words in the box queue rather than wait (2026-11-05).
  const canQueue = hasApiKey && (isAnalyzing || isChatting) && !!onQueue && prompt.trim().length > 0;

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
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // The box grows with what is typed, to a limit, as chat boxes do.
  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [prompt]);

  const sendAndKeepFocus = () => {
    onSend();
    promptRef.current?.focus();
  };

  /*
   * Speaking a message (2026-11-05), as ChatGPT's and Gemini's boxes take one.
   * The browser's own speech recognition, so nothing is installed and nothing
   * is paid for; offered only where the browser has it. What is heard is
   * written into the box after whatever was typed, as it is heard, and is
   * sent like anything typed. The site's Permissions-Policy lets this page,
   * and nothing it frames, ask for the microphone; the browser asks first.
   */
  const Recognizer = speechRecognition();
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const toggleVoice = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    if (!Recognizer) return;
    const r = new Recognizer();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    const before = prompt.trim() ? `${prompt.replace(/\s+$/, '')} ` : '';
    r.onresult = (event) => {
      const heard = Array.from(event.results, (result) => result[0]?.transcript ?? '').join('');
      onPromptChange(before + heard);
    };
    r.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      promptRef.current?.focus();
    };
    r.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = r;
    setListening(true);
    r.start();
  };
  // Leaving the workspace stops listening.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  /*
   * The box floats over the conversation (2026-11-05), as Gemini's does: the
   * messages scroll on behind it and fade out there, rather than ending at a
   * band the box sits in. The box overlaps the foot of the thread by its own
   * height, which it publishes to its column as `--composer-h`, and the
   * thread pads its foot by as much so its last message can still scroll
   * clear. Measured, because the box grows with a long message, staged
   * files and a notice. Measured from offsetHeight, which a browser without
   * ResizeObserver (jsdom) still reports once.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const column = el?.parentElement;
    if (!el || !column) return;
    const publish = () => column.style.setProperty('--composer-h', `${el.offsetHeight}px`);
    publish();
    const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    watch?.observe(el);
    return () => {
      watch?.disconnect();
      column.style.removeProperty('--composer-h');
    };
  }, []);

  return (
    <div className="wb-composer" ref={rootRef}>
      {/* The queue (2026-11-05), as Stitch's tray over its box. */}
      {queue.length > 0 && (
        <div className="wb-queue" role="list" aria-label="Queued messages">
          <div className="wb-queue-head">Queued · sends after this one</div>
          {queue.map((q) => (
            <div className="wb-queue-item" role="listitem" key={q.id}>
              <span title={q.text}>{q.text}</span>
              <button type="button" className="wb-tool" aria-label="Steer: stop what runs and send this now" title="Steer: stop what runs and send this now" onClick={() => onSteer?.(q.id)}>
                <IconArrowRight size={14} />
              </button>
              <button type="button" className="wb-tool" aria-label="Edit" title="Edit" onClick={() => onEditQueued?.(q.id)}>
                <IconPencil size={13} />
              </button>
              <button type="button" className="wb-tool" aria-label="Cancel" title="Cancel" onClick={() => onCancelQueued?.(q.id)}>
                <IconTrash size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Staged intake. The artifact had no slot for these; they are absent
          at rest, so the default view is unchanged. */}
      {previews.length > 0 && (
        <div className="wb-chip-row">
          {/* One chip per file the user dropped. A 5-page PDF is five
              images underneath — the model needs a page each — but showing
              five thumbnails for one upload reads as the product having
              mangled the file. Pages are reachable inside the viewer.
              The chip shows the file and nothing else (2026-11-03): the
              owner asked for the chat to work as other chat apps do, with
              every step behind the scenes once the message is sent. Until
              then it showed OCR reading the page as it was attached. */}
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
      {selection.length > 0 && (
        <div className="wb-chip-row">
          <span className="wb-attach wb-attach--selection" role="status" title="Selected on the Preview: “this” in your message means it">
            <IconTarget size={12} />
            {selection.length === 1 ? selection[0] : `${selection.length} controls: ${selection.join(', ')}`}
          </span>
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

      <div className={`wb-box${hasApiKey ? '' : ' wb-is-locked'}`}>
        {/* A plus at the left of the box, as ChatGPT's and Gemini's are
            (2026-11-05, at the owner's request): it was a paperclip. */}
        <button
          className="wb-tool"
          aria-label="Add photos and files"
          title="Add photos and files: an image, a PDF, a .repx, or data (CSV, Excel, JSON, Word, text, SQL)"
          onClick={() => fileInputRef.current?.click()}
          disabled={!hasApiKey}
        >
          <IconPlus size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.repx,.csv,.tsv,.json,.txt,.sql,.xlsx,.docx"
          onChange={onFileChange}
          className="wb-hidden"
        />
        <textarea
          ref={promptRef}
          className="wb-line"
          rows={1}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          /* Enter sends; Shift+Enter starts a new line, as in any chat box. It
             did nothing until 2026-11-01, when this was an `<input>` that could
             not hold a newline; a description with a schema in it needs lines.
             `preventDefault` on Enter keeps the newline out of the message
             whether or not the send is allowed. */
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
              else if (canQueue) onQueue?.(prompt.trim());
            }
          }}
          /* An image pasted into the box is attached, as a dropped one is. */
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length && onPasteFiles) {
              e.preventDefault();
              onPasteFiles(files);
            }
          }}
          disabled={!hasApiKey}
          // Stitch's question (2026-11-05), now the box sits under the report as its bar does.
          placeholder={listening ? 'Listening…' : hasApiKey ? 'What would you like to change or create?' : 'Add your API key to start'}
          aria-label="Message"
        />
        {hasApiKey && models && (
          <div className="wb-model" ref={modelMenuRef}>
            <button
              type="button"
              className="wb-model-pick"
              aria-haspopup="menu"
              aria-expanded={modelMenu}
              title="The model the chat and reports use"
              onClick={() => setModelMenu((open) => !open)}
            >
              {tiers.find((t) => t.id === models.current)?.label ?? modelLabel(models.current)}
              <IconChevronDown size={12} />
            </button>
            {modelMenu && (
              /* Named tiers (2026-11-05), as Stitch names its "Speed" and
                 "Balanced", each with the model behind it: see lib/modelTiers.ts. */
              <div className="wb-model-menu" role="menu" aria-label="Model">
                {[{ id: '', label: 'Auto', note: 'Forma picks the best model your key can use.', used: -1 }, ...tiers].map((choice) => (
                  <button
                    key={choice.id || 'auto'}
                    type="button"
                    role="menuitemradio"
                    aria-checked={models.current === choice.id}
                    onClick={() => {
                      models.onChoose(choice.id);
                      setModelMenu(false);
                    }}
                  >
                    <span>{choice.label}</span>
                    <small>{choice.used >= 0 ? `${choice.note} ${choice.used} today.` : choice.note}</small>
                  </button>
                ))}
                <p>
                  {models.choices.length
                    ? 'Requests sent from this browser today. Free daily limits reset at midnight Pacific time.'
                    : 'The models this key can use are listed after its first request.'}
                </p>
              </div>
            )}
          </div>
        )}
        {hasApiKey && Recognizer && (
          <button
            type="button"
            className={`wb-tool${listening ? ' wb-is-listening' : ''}`}
            aria-label={listening ? 'Stop listening' : 'Speak your message'}
            aria-pressed={listening}
            title={listening ? 'Stop listening' : "Speak your message (your browser's speech recognition hears it)"}
            onClick={toggleVoice}
            disabled={isAnalyzing || isChatting}
          >
            <IconMic size={16} />
          </button>
        )}
        {!hasApiKey ? (
          /* Locked, the send button is the way in: it opens Settings at the
             key, so nothing has to be added under the box (2026-11-04). */
          <button className="wb-send" aria-label="Add your API key" title="Add your API key in Settings" onClick={onAddKey}>
            <IconKey size={15} />
          </button>
        ) : canQueue ? (
          /* Words typed while Forma works go to the queue (2026-11-05). */
          <button className="wb-send" aria-label="Queue" title="Queue: sends after this one" onClick={() => onQueue?.(prompt.trim())}>
            <IconArrowUp size={15} />
          </button>
        ) : (isAnalyzing || isChatting) && onStop ? (
          /* While a generation runs, the send button is its Stop (2026-11-04),
             as in the chat apps people know; and while a reply is written
             (2026-11-05), as ChatGPT's is. */
          <button className="wb-send wb-send--stop" aria-label="Stop" title="Stop" onClick={onStop}>
            <span className="wb-stop-square" aria-hidden="true" />
          </button>
        ) : (
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
        )}
      </div>
      {/* Nothing under the box (2026-11-04). The "Working offline" banner and
          the "Your key clears when this tab closes" line lived here; the
          owner asked for the chat to hold the attach button, the messages and
          the answers only. Which AI answers, and how the key is kept, are said
          in Settings, where the key is typed. */}
    </div>
  );
}
