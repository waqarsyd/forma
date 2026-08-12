/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
/*
 * The workspace draws from the same hairline set as the marketing pages. It used
 * to mix two other systems: Material Symbols (40 ligature spans) and lucide
 * (these eight). Both are gone from this file — see the note in icons.tsx.
 *
 * One consequence worth knowing: Material Symbols ships its own `display` from
 * an unlayered <link>, which beat Tailwind's layered `hidden`, so responsive
 * classes on those spans silently never applied. Inline SVG has no such problem,
 * so `hidden sm:inline` on an icon now does what it says.
 */
import {
  IconAlert,
  IconArrowUp,
  IconChat,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconClose,
  IconCode,
  IconCopy,
  IconDoc,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconHistory,
  IconImage,
  IconLayout,
  IconLogin,
  IconLogout,
  IconMenu,
  IconPaperclip,
  IconPause,
  IconPlay,
  IconPlus,
  IconReplay,
  IconRuler,
  IconSave,
  IconSpec,
  IconTrash,
  IconTune,
  IconUpload,
  IconWarn,
} from './components/landing/icons';
/* `landing/` is the shared marketing design system, not a private folder — see
   CLAUDE.md. Eyebrow is reused here rather than restating its markup. */
import { Eyebrow } from './components/landing/sections';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  analyzeReportDesign,
  chatReply,
  validateApiKey,
  clearCachedModel,
  MissingApiKeyError,
  ReportLayout,
  ReportElement,
  ReportConfig,
  SourceRect,
  StreamProgress,
  ChatTurn,
  AttachmentPart,
} from './services/geminiService';
import {
  encryptApiKey,
  decryptApiKey,
  isVaultAvailable,
  WrongPassphraseError,
  cacheKeyForSession,
  readSessionKey,
  clearSessionKey,
  purgeLegacyPlaintextKey,
  EncryptedKeyRecord,
} from './services/keyVault';
import {
  DURATION,
  transition,
  backdropVariants,
  modalVariants,
  drawerVariants,
  messageVariants,
  tabPanelVariants,
} from './lib/motion';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { auth, db, logOut, handleFirestoreError, OperationType } from './services/firebase';
import { collection, onSnapshot, query, setDoc, doc, deleteDoc, getDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import LoginPage from './components/LoginPage';
import UserAvatar from './components/UserAvatar';
import LandingPage from './components/LandingPage';
import FeaturesPage from './components/FeaturesPage';
import DocsPage from './components/DocsPage';
import ContactPage from './components/ContactPage';
import Logo from './components/Logo';
import { currentPath, navigate, onRouteChange, migrateLegacyHashUrl } from './lib/router';
// Pure helpers live in src/lib so they can be unit-tested without importing the
// whole app (and pdf.js, and Firebase) into a test run.
import { formatXml, tokenizeXml, checkRepx } from './lib/repx';
import { sourceRectFor } from './lib/sourceRect';

interface DesignResult {
  content: string;
  timestamp: Date;
  title?: string;
  layout?: ReportLayout;
  repxContent?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: string[];
  result?: DesignResult;
  /**
   * Set when the turn this message asked for failed. A failed chat turn used to
   * leave the user's message sitting in the transcript with no reply and no
   * marker, while the explanation appeared in a small note pinned under the
   * composer — two things that were never visually connected.
   */
  error?: string;
}


/* ------------------------------------------------------------------ *
 * Upload optimisation
 *
 * Uploads used to be sent at whatever size the user happened to have: a phone
 * photo or a large screenshot went to Google whole, and base64 added another
 * third on top. That is paid twice — once uploading, once as prefill before
 * the model writes a single token.
 *
 * The cap is deliberately generous. Past roughly this many pixels the extra
 * resolution adds payload without adding detail the model can act on, but
 * ordinary screenshots and scans stay untouched and lossless.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * File intake
 *
 * One path for the picker and for drag-and-drop. These were two near-identical
 * copies that had to be edited in lockstep; everything below is shared so they
 * cannot drift again.
 * ------------------------------------------------------------------ */

/** Beyond this the request gets slow and expensive with little added signal. */
const MAX_ATTACHMENTS = 12;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Pages past this are reported to the user rather than silently dropped. */
const MAX_PDF_PAGES = 8;
/**
 * ~250 DPI. The previous 1.5 (~150 DPI) left small footers and dense table
 * figures soft, and soft text becomes wrong Text= values and wrong coordinates
 * in the generated REPX.
 */
const PDF_RENDER_SCALE = 2.5;
/** PDF points are 1/72"; the report grid is hundredths of an inch. */
const PT_TO_REPORT_UNITS = 100 / 72;
/** Cap on extracted strings per page, so a dense page cannot flood the prompt. */
const MAX_TEXT_ITEMS_PER_PAGE = 400;

/**
 * Firestore's hard ceiling is 1,048,576 bytes per document. This leaves headroom
 * for the field names, the id/name/timestamp fields and UTF-8 expansion, so a
 * save that passes this check is not going to be rejected for size alone.
 */
const CLOUD_SAVE_BUDGET_BYTES = 900_000;

/** A non-visual attachment: a PDF's text layer, or the contents of a .repx. */
interface TextAttachment {
  id: string;
  label: string;
  text: string;
}

interface IngestResult {
  images: string[];
  texts: TextAttachment[];
  /** User-facing warnings: skipped files, dropped pages, invalid XML. */
  notices: string[];
}

/**
 * Pull a PDF page's real text with real coordinates.
 *
 * This is the whole reason a digital PDF beats a photograph: the file already
 * knows every string and where it sits, so the model should never have to read
 * that back out of pixels. Coordinates are converted here into the same
 * hundredths-of-an-inch grid the REPX uses, with the origin flipped to
 * top-left, so the model can use them directly rather than re-deriving them.
 */
async function extractPdfPageText(
  page: any,
  pageNumber: number
): Promise<{ text: string; omitted: number } | null> {
  try {
    const base = page.getViewport({ scale: 1 });
    const pageHeightPt = base.height;
    const content = await page.getTextContent();
    const items: any[] = content?.items || [];

    const lines: string[] = [];
    // Counted rather than inferred from items.length: blank items are skipped
    // above and would otherwise be reported to the user as dropped strings.
    let omitted = 0;
    for (const item of items) {
      const str = (item.str || '').trim();
      if (!str) continue;

      if (lines.length >= MAX_TEXT_ITEMS_PER_PAGE) {
        omitted++;
        continue;
      }

      // transform = [scaleX, skewX, skewY, scaleY, x, y]; y is the baseline,
      // measured up from the bottom of the page.
      const x = item.transform?.[4] ?? 0;
      const baselineY = item.transform?.[5] ?? 0;
      const h = item.height || 0;
      const yTop = pageHeightPt - (baselineY + h);

      lines.push(
        `"${str.replace(/"/g, "'")}" x=${Math.round(x * PT_TO_REPORT_UNITS)} ` +
        `y=${Math.round(yTop * PT_TO_REPORT_UNITS)} ` +
        `w=${Math.round((item.width || 0) * PT_TO_REPORT_UNITS)} ` +
        `h=${Math.round(h * PT_TO_REPORT_UNITS)}`
      );
    }

    // A scanned PDF is pixels in a wrapper — no text layer to recover.
    if (lines.length === 0) return null;

    const truncated = omitted > 0
      ? `\n(${omitted} further strings omitted.)`
      : '';

    const text = (
      `PDF page ${pageNumber} — text layer extracted from the file itself. ` +
      `These strings and coordinates are EXACT and take priority over anything read from the page image.\n` +
      `Page is ${Math.round(base.width * PT_TO_REPORT_UNITS)} x ${Math.round(pageHeightPt * PT_TO_REPORT_UNITS)} report units. ` +
      `Coordinates are already in report units (hundredths of an inch), origin top-left.\n` +
      lines.join('\n') + truncated
    );

    return { text, omitted };
  } catch (err) {
    console.warn(`Could not read the text layer of page ${pageNumber}:`, err);
    return null;
  }
}

/** Render one PDF page to a white-backed JPEG at PDF_RENDER_SCALE. */
async function renderPdfPage(page: any): Promise<string | null> {
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // pdf.js draws onto transparency; JPEG has no alpha, so an unpainted page
  // would come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport, canvas: canvas as any }).promise;

  // Route through the same optimiser as uploaded images — at this scale a page
  // can exceed the edge cap, which it never did at 1.5.
  return optimizeImageDataUrl(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
}

/**
 * Turn one dropped or picked file into the parts that get sent. Unsupported
 * and oversized files produce a notice rather than being silently ignored —
 * previously dropping a .docx did nothing at all, with no feedback.
 */
async function ingestFile(file: File): Promise<IngestResult> {
  const out: IngestResult = { images: [], texts: [], notices: [] };
  const name = file.name || 'file';

  if (file.size > MAX_FILE_BYTES) {
    out.notices.push(`"${name}" is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB and was skipped.`);
    return out;
  }

  if (file.type.startsWith('image/')) {
    out.images.push(await optimizeImageDataUrl(await readAsDataUrl(file)));
    return out;
  }

  if (file.type === 'application/pdf') {
    try {
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const pageCount = pdf.numPages;
      const readable = Math.min(pageCount, MAX_PDF_PAGES);

      for (let n = 1; n <= readable; n++) {
        const page = await pdf.getPage(n);
        const image = await renderPdfPage(page);
        if (image) out.images.push(image);

        const extracted = await extractPdfPageText(page, n);
        if (extracted) {
          out.texts.push({ id: `${Date.now()}-${name}-p${n}`, label: `${name} · page ${n} text`, text: extracted.text });
          // The per-page string cap used to drop the tail of a dense page in
          // silence, so missing accuracy at the bottom of a busy page looked
          // like a model failure. Say it out loud instead.
          if (extracted.omitted > 0) {
            out.notices.push(
              `"${name}" page ${n} has more text than can be read exactly — ${extracted.omitted} ` +
              `${extracted.omitted === 1 ? 'string was' : 'strings were'} left out, and that part of the page ` +
              `will be read from the image instead.`
            );
          }
        } else if (n === 1) {
          out.notices.push(
            `"${name}" has no text layer — it looks like a scan, so text will be read from the image and may be less exact.`
          );
        }
      }

      if (pageCount > readable) {
        out.notices.push(`"${name}" has ${pageCount} pages; the first ${readable} were read and the rest skipped.`);
      }
    } catch (err) {
      console.error('Error reading PDF:', err);
      out.notices.push(`"${name}" could not be read as a PDF.`);
    }
    return out;
  }

  if (name.toLowerCase().endsWith('.repx')) {
    // Read as real text rather than shipping an opaque base64 blob: base64 is
    // 33% larger, and a string can actually be validated before it is sent.
    const xml = (await file.text()).trim();
    if (!xml) {
      out.notices.push(`"${name}" is empty.`);
      return out;
    }
    const verdict = checkRepx(xml);
    if (!verdict.ok) {
      out.notices.push(`"${name}": ${verdict.message}`);
    }
    out.texts.push({
      id: `${Date.now()}-${name}`,
      label: name,
      text: `Existing DevExpress report (${name}). Use this as the base structure and preserve it unless asked to change it:\n\n${xml}`,
    });
    return out;
  }

  out.notices.push(`"${name}" is not a supported type. Use an image, a PDF, or a .repx file.`);
  return out;
}

/** Elapsed wall-clock for the progress card: "12.4s" under a minute, then "1:23". */
function formatElapsed(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const MAX_IMAGE_EDGE = 2048;
const JPEG_QUALITY = 0.92;
/** Below this, re-encoding is not worth the quality risk. */
const REENCODE_THRESHOLD_BYTES = 1_200_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Shrink an oversized image, leaving small ones exactly as they are. Returns
 * the original on any failure, and never returns something larger than it was
 * given — so this can only ever help.
 */
async function optimizeImageDataUrl(dataUrl: string): Promise<string> {
  try {
    if (!dataUrl?.startsWith('data:image/')) return dataUrl;

    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return dataUrl;

    const longest = Math.max(w, h);
    const oversized = longest > MAX_IMAGE_EDGE;

    // Already modest in both dimensions and weight — leave it completely alone.
    if (!oversized && dataUrl.length < REENCODE_THRESHOLD_BYTES) return dataUrl;

    const ratio = oversized ? MAX_IMAGE_EDGE / longest : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // JPEG carries no alpha, so paint the sheet white first — otherwise a
    // transparent screenshot background would come out black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (out.length >= dataUrl.length) return dataUrl;

    console.debug(
      `Optimised upload: ${w}x${h} ${Math.round(dataUrl.length / 1024)}KB -> ` +
      `${canvas.width}x${canvas.height} ${Math.round(out.length / 1024)}KB.`
    );
    return out;
  } catch {
    return dataUrl; // Never let optimisation block an upload.
  }
}

/* ------------------------------------------------------------------ *
 * REPX source viewer
 *
 * The "Specs & REPX" tab used to render only the markdown specification, so
 * the XML that Forma actually produces could never be inspected before it was
 * downloaded — a malformed report only revealed itself once DevExpress refused
 * to open it. This shows the real thing, checks that it parses, and lets it be
 * copied straight into the designer.
 * ------------------------------------------------------------------ */

/*
 * Syntax colours for the REPX pane. Deliberately theme-INVARIANT: the pane sits
 * on `--code-bg`, which is dark in both themes (the same treatment the docs and
 * features pages give their code blocks), so a `dark:` variant would light the
 * text up against a background that never lightened. These are the former
 * dark-mode values, used unconditionally.
 */
const XML_TOKEN_CLASS: Record<string, string> = {
  tag: 'text-sky-400',
  attr: 'text-violet-400',
  value: 'text-emerald-400',
  punct: 'text-[color:var(--code-ink-faint)]',
  meta: 'text-[color:var(--code-ink-faint)] italic',
};

/** Clipboard write with a fallback for non-secure contexts (plain HTTP on a LAN IP). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const RepxViewer = ({ xml }: { xml: string }) => {
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(() => formatXml(xml || ''), [xml]);
  const status = useMemo(() => checkRepx(xml || ''), [xml]);
  const lines = useMemo(() => formatted.split('\n'), [formatted]);

  const handleCopy = async () => {
    const ok = await copyText(xml);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!xml?.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <IconWarn className="text-error" size={28} />
        <p className="text-sm font-semibold text-on-surface">No REPX was generated for this report.</p>
        <p className="text-xs text-on-surface-variant max-w-sm">
          The model returned a specification but no DevExpress XML. Export will fall back to a
          plain-text file. Try generating again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Status + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div
          className={`flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full border ${
            status.ok
              ? 'text-[color:var(--ok-ink)] border-[color:var(--ok-line)] bg-[color:var(--ok-wash)]'
              : 'text-[color:var(--bad-ink)] border-[color:var(--bad-line)] bg-[color:var(--bad-wash)]'
          }`}
        >
          {status.ok ? <IconCheckCircle size={14} /> : <IconAlert size={14} />}
          <span>{status.message}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-on-surface-variant font-mono">
            {lines.length} lines · {xml.length.toLocaleString()} chars
          </span>
          <button
            onClick={handleCopy}
            className="u-tap u-transition-fast u-press u-focus-ring flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-[11px] font-semibold text-on-surface-variant rounded-full cursor-pointer"
          >
            {copied ? <IconCheck size={13} className="text-[color:var(--ok-ink)]" /> : <IconCopy size={13} />}
            {copied ? 'Copied' : 'Copy XML'}
          </button>
        </div>
      </div>

      {/* Source */}
      {/* The XML pane is one of the things the sheet's --code-* tokens exist for.
          It used `bg-surface-container-lowest dark:bg-[#0d1117]` — white in light
          mode with a hardcoded dark twin. It is now dark in both themes like the
          docs and features code blocks, which is why nothing inside it may use a
          token that flips: the gutter and the row hover are fixed values too. */}
      <div className="rounded-xl border border-[color:var(--code-rule)] bg-[color:var(--code-bg)] overflow-auto max-h-[65vh]">
        <pre className="text-[11px] leading-relaxed font-mono p-4 min-w-max text-[color:var(--code-ink)]">
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-white/5">
              <span className="select-none text-[color:var(--code-ink-faint)] pr-4 text-right tabular-nums shrink-0 w-10">
                {i + 1}
              </span>
              <span className="whitespace-pre">
                {tokenizeXml(line).map((tok, j) => (
                  <span key={j} className={tok.kind ? XML_TOKEN_CLASS[tok.kind] : undefined}>
                    {tok.text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
};

/**
 * Crop a fractional rectangle out of a data-URL image and return it as its own
 * data URL. Used to lift the real logo/artwork out of what the user uploaded,
 * rather than drawing a grey placeholder box for it.
 *
 * The model reports the rectangle in fractions (0..1) because it does not know
 * the file's true pixel size, so everything is multiplied up by naturalWidth /
 * naturalHeight here. Returns null on anything unexpected — a bad rect, a
 * non-image upload, a decode failure — and the caller falls back to the
 * placeholder rather than showing a broken image.
 */
async function cropSourceRegion(
  dataUrl: string,
  rect: SourceRect,
  /** Width/height of the element this will be drawn into, for the shape check. */
  elementAspect?: number,
  /** Element content, used only to name the offender in warnings. */
  label = 'image'
): Promise<string | null> {
  try {
    if (!dataUrl?.startsWith('data:image/')) return null;

    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return null;

    /* --- Plausibility checks ---------------------------------------- *
     * A design containing several pictures is where this goes wrong: the
     * model returns one rectangle spanning most of the page, so a single
     * picture box ends up showing the entire upload while the other picture
     * elements come out empty. A wrong crop is worse than no crop, so an
     * implausible rectangle falls back to the placeholder. */
    const w = rect.width ?? 0;
    const h = rect.height ?? 0;

    if (w <= 0 || h <= 0) return null;

    // Almost the whole page in one dimension, or over half its area, is not a
    // logo — it is the model failing to isolate one.
    if (w > 0.9 || h > 0.9 || w * h > 0.5) {
      console.warn(
        `Ignoring sourceRect for "${label}": it covers ${Math.round(w * 100)}%x${Math.round(h * 100)}% ` +
        `of the source, which is the whole design rather than one picture.`
      );
      return null;
    }

    // Clamp into the image so a slightly over-reaching estimate still crops.
    const sx = Math.max(0, Math.min(1, rect.x ?? 0)) * iw;
    const sy = Math.max(0, Math.min(1, rect.y ?? 0)) * ih;
    const sw = Math.min(iw - sx, Math.max(0, w) * iw);
    const sh = Math.min(ih - sy, Math.max(0, h) * ih);

    // A degenerate rect would produce an empty canvas; the placeholder is better.
    if (sw < 2 || sh < 2) return null;

    // The crop should be roughly the shape of the box it will be drawn into.
    // A wildly different aspect means the rectangle is not this element's
    // artwork — typically a full-width band grabbed for a small square logo.
    if (elementAspect && elementAspect > 0) {
      const cropAspect = sw / sh;
      const ratio = cropAspect / elementAspect;
      if (ratio > 4 || ratio < 0.25) {
        console.warn(
          `Ignoring sourceRect for "${label}": crop is ${cropAspect.toFixed(2)}:1 but the ` +
          `element is ${elementAspect.toFixed(2)}:1 — the rectangle does not match this picture.`
        );
        return null;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Per-side borders, falling back to the legacy all-sides `hasBorder` flag. */
function borderStyleFor(el: ReportElement): React.CSSProperties {
  const colour = el.borderColor || 'rgba(0,0,0,0.15)';
  const rule = `1px solid ${colour}`;

  const anyPerSide =
    el.borderTop || el.borderRight || el.borderBottom || el.borderLeft;

  // Old layouts (and genuine full boxes) only carry hasBorder.
  if (!anyPerSide) {
    return el.hasBorder || el.type === 'table' || el.type === 'barcode'
      ? { border: rule }
      : {};
  }

  return {
    borderTop: el.borderTop ? rule : undefined,
    borderRight: el.borderRight ? rule : undefined,
    borderBottom: el.borderBottom ? rule : undefined,
    borderLeft: el.borderLeft ? rule : undefined,
  };
}

/**
 * Draws one `type: "image"` element. Shows the real cropped artwork when the
 * model supplied a sourceRect and the originating upload is still available;
 * otherwise falls back to the icon placeholder used before.
 */
const MockupImage = ({
  el,
  sourceImages,
}: {
  el: ReportElement;
  sourceImages?: string[];
}) => {
  const [cropped, setCropped] = useState<string | null>(null);

  const rect = sourceRectFor(el);
  const source = sourceImages?.[el.sourceImageIndex ?? 0];

  useEffect(() => {
    let cancelled = false;
    if (!rect || !source) {
      setCropped(null);
      return;
    }
    const aspect = el.width && el.height ? el.width / el.height : undefined;
    cropSourceRegion(source, rect, aspect, el.content || el.id).then((result) => {
      if (!cancelled) setCropped(result);
    });
    return () => {
      cancelled = true;
    };
  }, [source, rect?.x, rect?.y, rect?.width, rect?.height]);

  if (cropped) {
    return (
      <img
        src={cropped}
        alt={el.content}
        className="w-full h-full"
        style={{ objectFit: 'contain', objectPosition: 'center' }}
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-on-paper/5">
      <IconImage size={24} className="text-on-paper/40" />
      <span className="text-[10px] text-on-paper/60 mt-1 truncate px-1 max-w-full">{el.content}</span>
    </div>
  );
};

/** Draws a real grid from `rows`/`cells`, sized by relative weights. */
const MockupTable = ({ el, scaleFont }: { el: ReportElement; scaleFont: number }) => {
  const rows = el.rows || [];

  // Nothing to draw — an older layout, or the model omitted the rows. Show an
  // empty ruled box rather than the invented "Data Row 1" placeholder, which
  // used to make an empty result look like real content.
  if (rows.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-[10px] text-on-paper/40 truncate px-1">{el.content}</span>
      </div>
    );
  }

  const totalRowWeight = rows.reduce((sum, r) => sum + (r.weight || 1), 0);

  return (
    <div className="w-full h-full flex flex-col">
      {rows.map((row, rIdx) => {
        const cells = row.cells || [];
        const totalCellWeight = cells.reduce((sum, c) => sum + (c.weight || 1), 0);

        return (
          <div
            key={rIdx}
            className="flex w-full overflow-hidden"
            style={{
              height: `${((row.weight || 1) / totalRowWeight) * 100}%`,
              borderBottom: rIdx < rows.length - 1 ? '1px solid rgba(0,0,0,0.15)' : undefined,
              backgroundColor: row.isHeader ? 'rgba(0,0,0,0.06)' : undefined,
            }}
          >
            {cells.map((cell, cIdx) => (
              <div
                key={cIdx}
                className="flex items-center px-1 overflow-hidden"
                style={{
                  width: `${((cell.weight || 1) / totalCellWeight) * 100}%`,
                  borderRight: cIdx < cells.length - 1 ? '1px solid rgba(0,0,0,0.15)' : undefined,
                  backgroundColor: cell.backgroundColor || undefined,
                  color: cell.color || undefined,
                  fontWeight: cell.bold || row.isHeader ? 700 : undefined,
                  justifyContent:
                    cell.textAlign === 'center' ? 'center' : cell.textAlign === 'right' ? 'flex-end' : 'flex-start',
                  fontSize: el.fontSize ? `${el.fontSize * scaleFont}px` : undefined,
                }}
              >
                <span className="truncate" style={{ textAlign: cell.textAlign || 'left' }}>
                  {cell.content}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

/** Draws a chart whose shape follows chartType/chartValues when supplied. */
const MockupChart = ({ el }: { el: ReportElement }) => {
  const values = el.chartValues?.length ? el.chartValues : [40, 70, 45, 90, 65, 80, 50];
  const max = Math.max(...values, 1);
  const pct = values.map((v) => Math.max(2, (v / max) * 100));
  const kind = el.chartType || 'bar';

  if (kind === 'pie') {
    // Single-slice approximation: enough to read as a pie in a mockup.
    const share = Math.round((values[0] / values.reduce((a, b) => a + b, 0)) * 100) || 25;
    return (
      <div className="w-full h-full flex items-center justify-center bg-on-paper/4">
        <div
          className="rounded-full"
          style={{
            width: '80%',
            aspectRatio: '1 / 1',
            background: `conic-gradient(var(--color-primary, #3b82f6) 0% ${share}%, rgba(0,0,0,0.12) ${share}% 100%)`,
          }}
        />
      </div>
    );
  }

  if (kind === 'line' || kind === 'area') {
    const points = pct
      .map((p, i) => `${(i / Math.max(1, pct.length - 1)) * 100},${100 - p}`)
      .join(' ');
    return (
      <div className="w-full h-full bg-on-paper/4">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          {kind === 'area' && (
            <polygon points={`0,100 ${points} 100,100`} fill="currentColor" opacity="0.25" />
          )}
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-end gap-1 px-2 pb-2 bg-on-paper/4">
      {pct.map((h, i) => (
        <div key={i} className="flex-1 bg-[color:var(--paper-accent-soft)] rounded-t-sm" style={{ height: `${h}%` }}></div>
      ))}
    </div>
  );
};

const ReportMockup = ({
  layout,
  sourceImages,
}: {
  layout: ReportLayout;
  /** The user's uploaded images, so `sourceRect` crops can be resolved. */
  sourceImages?: string[];
}) => {
  // The report page is an absolutely-positioned pixel grid (coordinates come
  // straight from the REPX units), so it cannot reflow. Instead we measure the
  // available width and scale the whole page down to fit — the geometry stays
  // byte-identical, only the presentation shrinks.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const pageWidth = (layout.pageWidth || 850) * 0.96;
  const pageHeight = Math.max(
    1056, // 1100 * 0.96
    layout.sections.reduce((sum, s) => sum + (s.height || 100) * 0.96, 0),
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientWidth;
      if (available > 0) setScale(Math.min(1, available / pageWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageWidth]);

  return (
    <div className="bg-surface-container-lowest border border-outline-variant shadow-[var(--shadow-sm)] rounded-xl overflow-hidden w-full max-w-5xl mx-auto my-4 sm:my-8 font-sans flex flex-col">
      {/* Report Page Area */}
      <div className="p-3 sm:p-8 bg-surface relative overflow-hidden">
        <div ref={viewportRef} className="w-full">
          {/* Stage reserves the post-scale footprint so nothing overlaps.
              Deliberately NOT transitioned: width/height are layout properties
              and this updates on every resize tick. */}
          <div
            className="relative mx-auto"
            style={{ width: pageWidth * scale, height: pageHeight * scale }}
          >
        {/* The Page */}
        <div
          className="bg-paper text-on-paper shadow-[var(--shadow-md)] absolute top-0 left-0 overflow-hidden ring-1 ring-[color:var(--paper-rule)]"
          style={{
            width: pageWidth,
            minHeight: pageHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {layout.sections.map((section, sIdx) => (
            <div
              key={sIdx}
              className="relative w-full"
              style={{ height: (section.height || 100) * 0.96 }}
            >
              {/* Elements */}
              {section.elements.map((el, eIdx) => {
                const isTable = el.type === 'table';
                const isChart = el.type === 'chart';
                const isGauge = el.type === 'gauge';
                const isImage = el.type === 'image';
                const isLine = el.type === 'line';
                const isLabel = el.type === 'label';
                const isBarcode = el.type === 'barcode';

                const verticalAlign =
                  el.verticalAlign === 'top'
                    ? 'flex-start'
                    : el.verticalAlign === 'bottom'
                      ? 'flex-end'
                      : 'center';

                return (
                  <div
                    key={eIdx}
                    // Everything inside the sheet is drawn against --paper, so
                    // it uses paper-relative colours rather than the themed
                    // tokens — the rendered report must look identical in both
                    // themes, and a flipping token would invert or vanish here.
                    className="absolute flex overflow-hidden"
                    style={{
                      left: (el.x || 0) * 0.96,
                      top: (el.y || 0) * 0.96,
                      width: (el.width || 100) * 0.96,
                      height: (el.height || 20) * 0.96,
                      backgroundColor: el.backgroundColor || 'transparent',
                      color: el.color || 'inherit',
                      fontSize: el.fontSize ? `${el.fontSize * 0.96}px` : '12px',
                      fontWeight: el.bold ? 700 : undefined,
                      fontStyle: el.italic ? 'italic' : undefined,
                      fontFamily: el.fontFamily || undefined,
                      alignItems: verticalAlign,
                      justifyContent: el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start',
                      ...borderStyleFor(el),
                    }}
                  >
                    {isLabel && (
                      <span
                        className={`px-1 w-full ${el.wrap ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                        style={{ textAlign: el.textAlign || 'left' }}
                      >
                        {el.content}
                      </span>
                    )}

                    {isBarcode && (
                      <div className="w-full h-full flex flex-col justify-between items-center opacity-70 p-1">
                        <div className="w-full flex-1 flex gap-[2px] justify-center items-stretch">
                          {Array.from({ length: 15 }).map((_, i) => (
                            <div key={i} className="bg-on-paper" style={{ width: i % 3 === 0 ? '4px' : '2px' }}></div>
                          ))}
                        </div>
                        <span className="text-[10px] truncate">{el.content}</span>
                      </div>
                    )}

                    {isImage && <MockupImage el={el} sourceImages={sourceImages} />}

                    {isLine && (
                      <div className="w-full h-[1px] bg-on-paper/80"></div>
                    )}

                    {isTable && <MockupTable el={el} scaleFont={0.96} />}

                    {isChart && <MockupChart el={el} />}

                    {isGauge && (
                      <div className="w-full h-full flex items-center justify-center rounded-full border-4 border-t-[color:var(--paper-accent)] border-r-[color:var(--paper-accent)] border-b-on-paper/10 border-l-on-paper/10 bg-on-paper/4">
                        <span className="text-xs font-bold truncate px-1">{el.content}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface SavedReport {
  id: string;
  name: string;
  timestamp: string;
  messages: ChatMessage[];
  result: DesignResult | null;
}

/**
 * The canvas's status line.
 *
 * There were two of these, byte-identical, one inside each branch of the
 * canvas's result/empty `AnimatePresence` — so every change had to be made twice
 * and kept in step by hand. It is the same bar in both states, so it is now one
 * component rendered once *outside* that switch: the branches animate, the
 * status line does not, which is also more honest, since the engine state is a
 * property of the app rather than of whichever pane happens to be showing.
 *
 * The three states are mutually exclusive and ordered deliberately —
 * processing wins over paused wins over idle.
 */
function CanvasStatusBar({
  isAnalyzing,
  isPaused,
  analyzingStep,
}: {
  isAnalyzing: boolean;
  isPaused: boolean;
  analyzingStep: string;
}) {
  const processing = isAnalyzing && !isPaused;
  return (
    <div className="h-10 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-center px-6 flex-shrink-0 select-none">
      <span className="font-code-sm text-[10px] tracking-[0.2em] text-on-surface-variant uppercase flex items-center gap-2">
        {processing ? (
          <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-ping" />
        ) : isPaused ? (
          <span className="w-1.5 h-1.5 bg-[color:var(--ink-faint)] rounded-full" />
        ) : (
          <span className="w-1.5 h-1.5 bg-success rounded-full" />
        )}
        {processing
          ? `Engine Status: Processing / ${analyzingStep || 'Analyzing...'}`
          : isPaused
            ? 'Engine Status: Paused / Idle'
            : 'Engine Status: Idle • Ready for Input'}
      </span>
    </div>
  );
}

/**
 * Per-route document titles.
 *
 * `index.html` can only carry one title, so every route used to show the home
 * page's — a browser with six Forma tabs open showed six identical ones, and a
 * bookmark or history entry recorded nothing about which page it came from.
 *
 * Two things here are deliberate:
 *
 * 1. **`/` must stay byte-identical to the `<title>` in `index.html`.** That tag
 *    is what search engines and link-preview scrapers read (they do not run this
 *    code), and it is also what paints before the bundle loads. Any difference
 *    would rewrite the title a moment after first paint for no reason. If you
 *    change one, change both — same rule as the theme bootstrap.
 *
 * 2. **The page name leads, the brand trails.** Tab strips truncate the end, so
 *    "Docs — Forma" survives being narrowed to a favicon-plus-two-words while
 *    "Forma — Docs" degrades to "Forma…" on every tab. The names match the
 *    header nav and the login page's own tab labels rather than inventing
 *    synonyms.
 *
 * An unrecognised path falls back to `/`, which is what the route effect's
 * `default` branch already renders.
 */
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Forma — Screenshot to DevExpress .repx',
  '/features': 'Features — Forma',
  '/docs': 'Docs — Forma',
  '/contact': 'Contact — Forma',
  '/login': 'Sign in — Forma',
  '/signup': 'Create account — Forma',
  '/workspace': 'Workspace — Forma',
};

export default function App() {
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>(() => {
    const saved = localStorage.getItem('savedReports');
    return saved ? JSON.parse(saved) : [];
  });
  const [user, setUser] = useState<User | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Below md the chat and canvas panes cannot sit side by side (the sidebar
  // alone is wider than a 375px viewport), so they become tabs. At md+ this
  // value is ignored and both panes render.
  const [mobilePane, setMobilePane] = useState<'chat' | 'canvas'>('chat');
  const [isDragging, setIsDragging] = useState(false);
  /**
   * Save confirmation. This used to be a native `alert()` — modal, unstyled, and
   * the only thing in the app that broke out of its own visual language. It sits
   * beside the composer with the other notices and clears itself.
   */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const activePromptRef = useRef<string>('');
  const activePreviewsRef = useRef<string[]>([]);
  /** Text attachments for the in-flight run, so pause/resume re-sends them too. */
  const activeTextsRef = useRef<TextAttachment[]>([]);
  const lastCompletedStepIndexRef = useRef<number>(0);
  const [analyzingStep, setAnalyzingStep] = useState<string>('');
  const [analyzingProgress, setAnalyzingProgress] = useState<number>(0);
  /** Characters of model output received so far — 0 until streaming begins. */
  const [streamChars, setStreamChars] = useState<number>(0);
  /**
   * Non-visual attachments: PDF text layers and .repx contents. Kept separate
   * from `previews` so that stays image-only — thumbnails, `sourceRect`
   * cropping and saved-report `images` all depend on that.
   */
  const [attachmentTexts, setAttachmentTexts] = useState<TextAttachment[]>([]);
  /** Warnings from the last upload: skipped files, dropped pages, bad XML. */
  const [uploadNotices, setUploadNotices] = useState<string[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<'signin' | 'signup'>('signin');
  const [currentRoute, setCurrentRoute] = useState(currentPath());
  const [lastViewPath, setLastViewPath] = useState('/');

  const [showWorkspaceProfile, setShowWorkspaceProfile] = useState(false);
  const workspaceProfileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (workspaceProfileRef.current && !workspaceProfileRef.current.contains(event.target as Node)) {
        setShowWorkspaceProfile(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * Route -> view state, and back/forward support.
   *
   * Paths, not hashes: the address bar reads `/features` rather than
   * `/#features`. `migrateLegacyHashUrl` runs first so an old bookmarked
   * `/#features` is rewritten in place before anything renders.
   */
  useEffect(() => {
    migrateLegacyHashUrl();

    const applyRoute = () => {
      const path = currentPath();
      setCurrentRoute(path);
      // Set here rather than in a render pass or a per-page effect: this runs on
      // boot, on navigate() and on back/forward, which is every way the route can
      // change, and one writer cannot disagree with another about the same tab.
      document.title = ROUTE_TITLES[path] ?? ROUTE_TITLES['/'];
      switch (path) {
        case '/workspace':
          setShowWorkspace(true);
          setShowLogin(false);
          setLastViewPath('/workspace');
          break;
        case '/login':
          setShowLogin(true);
          setLoginInitialMode('signin');
          break;
        case '/signup':
          setShowLogin(true);
          setLoginInitialMode('signup');
          break;
        case '/features':
        case '/docs':
        case '/contact':
          setShowWorkspace(false);
          setShowLogin(false);
          setLastViewPath(path);
          break;
        default:
          setShowWorkspace(false);
          setShowLogin(false);
          setLastViewPath('/');
          break;
      }
    };

    // A legacy `#hash` link followed from *within* the app is a same-document
    // change: no reload, so the boot-time migration above never re-runs. This
    // catches that case and rewrites it the same way.
    const onHashChange = () => {
      migrateLegacyHashUrl();
      applyRoute();
    };
    window.addEventListener('hashchange', onHashChange);

    const unsubscribe = onRouteChange(applyRoute);
    applyRoute();
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      unsubscribe();
    };
  }, []);

  /**
   * One delegated handler turns every in-app `<a href="/...">` into a client-side
   * navigation, so the individual pages keep using plain anchors — which stay
   * right-clickable, middle-clickable and readable in the status bar, unlike a
   * button pretending to be a link.
   *
   * Modified clicks, new-tab targets and downloads are left to the browser.
   */
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      event.preventDefault();
      navigate(href);
    };

    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // On phones the result lands in the hidden pane, so surface it automatically.
  // Desktop is unaffected — both panes are visible there.
  useEffect(() => {
    if (result) setMobilePane('canvas');
  }, [result]);

  /**
   * Auth state, including changes this tab did not initiate: signing out in
   * another tab, a revoked token, or an expired session all arrive here rather
   * than through `handleLogOut`.
   *
   * `previousUidRef` distinguishes "was signed in, now is not" from the initial
   * null every signed-out visitor gets on load — only the former is a sign-out,
   * and only the former should wipe the workspace. Clearing on the initial null
   * would throw away a signed-out user's work every time the page mounted.
   */
  const previousUidRef = useRef<string | null>(null);
  /**
   * The auth subscription is set up once, so it cannot close over
   * `handleClearChat` directly — it would capture the first render's copy and go
   * stale. The ref is refreshed after every render, below where that handler is
   * defined.
   */
  const handleClearChatRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      const wasSignedIn = previousUidRef.current !== null;
      const isSignedIn = !!u;
      previousUidRef.current = u?.uid ?? null;

      setUser(u);

      if (!isSignedIn) {
        // Signed out means the *device's* projects, not none. This used to be
        // `setSavedReports([])`, which also ran for the initial null every
        // signed-out visitor gets on load — so a project saved while signed out
        // vanished from the list on the next reload while still sitting in
        // localStorage, and only came back after a sign-in/sign-out cycle.
        // Matches what handleLogOut does on the explicit path.
        setSavedReports(JSON.parse(localStorage.getItem('savedReports') || '[]'));
        // A sign-out that happened elsewhere still has to leave this tab clean:
        // the uploads, extracted document text, transcript and generated report
        // all belong to the account that just left.
        if (wasSignedIn) {
          handleClearChatRef.current?.();
          setIsSidebarOpen(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch from Firebase
  useEffect(() => {
    if (!user) return;
    try {
      const q = query(collection(db, 'users', user.uid, 'reports'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const reports: SavedReport[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          reports.push({
            id: data.id,
            name: data.name,
            timestamp: new Date(data.timestamp).toISOString(),
            messages: JSON.parse(data.messages || '[]'),
            result: data.result ? JSON.parse(data.result) : null
          });
        });
        reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setSavedReports(reports);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/reports`);
      });
      return () => unsubscribe();
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/reports`);
    }
  }, [user]);

  const [error, setError] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [config, setConfig] = useState<ReportConfig>(() => {
    // Forma never ships a key of its own, so the only key in play is the user's.
    // It lives in sessionStorage, which the browser clears when the tab closes;
    // the durable copy (if the user opted in) is the AES-GCM ciphertext in
    // Firestore, which is useless without their passphrase.
    //
    // purgeLegacyPlaintextKey also sweeps up the plaintext key the previous build
    // left in localStorage, so upgrading users do not keep one on disk.
    const legacyKey = purgeLegacyPlaintextKey();
    const storedKey = readSessionKey() || legacyKey;
    // The model is detected from the key at request time, so modelName is left
    // unset. A stored 'selectedAiModel' from the old dropdown would pin a
    // retired id (gemini-2.5-flash) and defeat detection — drop it.
    try { localStorage.removeItem('selectedAiModel'); } catch { /* storage disabled */ }
    return {
      version: '23.2',
      unit: 'HundredthsOfAnInch',
      pageSize: 'Letter',
      header: {
        showCompanyLogo: false,
        title: ''
      },
      footer: {
        showPageNumbers: true,
        customText: ''
      },
      customApiKey: storedKey
    };
  });

  /**
   * The single gate for the whole workspace. Nothing here can call Google
   * without the user's own key, so chat, generation and refinement all check
   * this before doing anything at all.
   */
  const hasApiKey = Boolean(config.customApiKey?.trim());

  /** A short conversational turn is in flight (not a report generation). */
  const [isChatting, setIsChatting] = useState(false);
  /** The assistant's answer as it streams in, before it becomes a real message. */
  const [streamingReply, setStreamingReply] = useState('');

  useEffect(() => {
    // sessionStorage, not localStorage: the key is a live credential, and a
    // tab-scoped store is erased by the browser itself. A beforeunload handler
    // would not be — crashes, force-quit and mobile tab eviction all skip it.
    if (config.customApiKey) {
      cacheKeyForSession(config.customApiKey);
    } else {
      clearSessionKey();
      // A different key can have different model access, so a choice resolved
      // for the old key must not carry over.
      clearCachedModel();
    }
  }, [config.customApiKey]);

  /* ---- Encrypted key vault (see src/services/keyVault.ts) ---- */
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [vaultRecord, setVaultRecord] = useState<EncryptedKeyRecord | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultNotice, setVaultNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [keyCheck, setKeyCheck] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const canUseVault = !!user && isVaultAvailable();
  const vaultDocRef = useCallback(
    () => (user ? doc(db, 'users', user.uid, 'vault', 'geminiKey') : null),
    [user]
  );

  // Does this account have a stored key? Only the existence is fetched here —
  // decrypting needs the passphrase, which the user supplies on demand.
  useEffect(() => {
    if (!canUseVault) {
      setVaultRecord(null);
      return;
    }
    const ref = vaultDocRef();
    if (!ref) return;
    getDoc(ref)
      .then((snap) => setVaultRecord(snap.exists() ? (snap.data() as EncryptedKeyRecord) : null))
      .catch((err) => {
        console.warn('Could not check for a stored API key:', err);
        setVaultRecord(null);
      });
  }, [canUseVault, vaultDocRef]);

  /**
   * The config panel edits `config` live — every field's onChange writes straight
   * through. That was fine while both footer buttons did the same thing, which
   * is to say it was never fine: "Cancel" and "Save Changes" were both bare
   * `setIsConfigOpen(false)`, so a cancelled edit was already saved and the Save
   * button did nothing at all.
   *
   * Rather than rewrite every field to a draft object, the committed value is
   * snapshotted when the panel opens and restored if the user leaves by any
   * route other than Save — the footer Cancel, the X, or the backdrop.
   *
   * Explicit key actions (unlock, sync) refresh the snapshot themselves: those
   * are deliberate button presses with their own confirmation, and undoing one
   * because the panel was later dismissed would be its own surprise.
   */
  const configSnapshotRef = useRef<ReportConfig | null>(null);

  useEffect(() => {
    if (isConfigOpen) configSnapshotRef.current = config;
    // `config` intentionally omitted: the snapshot must be the value as it was
    // when the panel opened, not follow edits made while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigOpen]);

  const dismissConfigWithoutSaving = () => {
    if (configSnapshotRef.current) setConfig(configSnapshotRef.current);
    configSnapshotRef.current = null;
    setIsConfigOpen(false);
  };

  const saveConfigAndClose = () => {
    configSnapshotRef.current = null;
    setIsConfigOpen(false);
  };

  const handleCheckKey = async () => {
    setKeyCheck(null);
    setVaultBusy(true);
    try {
      const { valid, message } = await validateApiKey(config.customApiKey || '');
      setKeyCheck({ tone: valid ? 'ok' : 'error', text: message });
    } finally {
      setVaultBusy(false);
    }
  };

  // Encrypt in the browser, upload ciphertext. The passphrase is never stored or
  // sent anywhere, which is exactly why a forgotten one cannot be recovered.
  const handleSyncKeyToAccount = async () => {
    setVaultNotice(null);
    const key = (config.customApiKey || '').trim();

    if (!key) return setVaultNotice({ tone: 'error', text: 'Enter your API key first.' });
    if (passphrase.length < 8) {
      return setVaultNotice({ tone: 'error', text: 'Use a passphrase of at least 8 characters.' });
    }
    if (passphrase !== passphraseConfirm) {
      return setVaultNotice({ tone: 'error', text: 'The two passphrases do not match.' });
    }

    const ref = vaultDocRef();
    if (!ref) return;

    setVaultBusy(true);
    try {
      const record = await encryptApiKey(key, passphrase);
      await setDoc(ref, record);
      setVaultRecord(record);
      setPassphrase('');
      setPassphraseConfirm('');
      setVaultNotice({
        tone: 'ok',
        text: 'Key encrypted and synced. Unlock it with your passphrase on any device.',
      });
    } catch (err: any) {
      console.error('Failed to sync key:', err);
      setVaultNotice({ tone: 'error', text: err?.message || 'Could not sync the key.' });
    } finally {
      setVaultBusy(false);
    }
  };

  const handleUnlockKey = async () => {
    setVaultNotice(null);
    if (!vaultRecord) return;
    if (!passphrase) return setVaultNotice({ tone: 'error', text: 'Enter your passphrase.' });

    setVaultBusy(true);
    try {
      const key = await decryptApiKey(vaultRecord, passphrase);
      setConfig((prev) => ({ ...prev, customApiKey: key }));
      // Unlocking is a deliberate action with its own confirmation below, so it
      // survives a later Cancel — fold it into the snapshot the panel would
      // otherwise restore.
      if (configSnapshotRef.current) {
        configSnapshotRef.current = { ...configSnapshotRef.current, customApiKey: key };
      }
      setPassphrase('');
      setVaultNotice({ tone: 'ok', text: 'Key unlocked for this session.' });
    } catch (err: any) {
      setVaultNotice({
        tone: 'error',
        text: err instanceof WrongPassphraseError ? err.message : 'Could not unlock the key.',
      });
    } finally {
      setVaultBusy(false);
    }
  };

  const handleForgetStoredKey = async () => {
    const ref = vaultDocRef();
    if (!ref) return;
    setVaultBusy(true);
    try {
      await deleteDoc(ref);
      setVaultRecord(null);
      setVaultNotice({ tone: 'ok', text: 'Stored key removed from your account.' });
    } catch (err: any) {
      console.error('Failed to remove stored key:', err);
      setVaultNotice({ tone: 'error', text: 'Could not remove the stored key.' });
    } finally {
      setVaultBusy(false);
    }
  };

  /** Wipe the key from this session without touching the encrypted copy. */
  const handleClearKeyFromSession = () => {
    setConfig((prev) => ({ ...prev, customApiKey: '' }));
    clearSessionKey();
    setKeyCheck(null);
    setVaultNotice({ tone: 'ok', text: 'Key cleared from this browser session.' });
  };
  const [activeTab, setActiveTab] = useState<'spec' | 'ui'>('ui');
  // Sub-view inside the "Specs & REPX" tab. The tab has always been named for
  // both, but only ever rendered the specification.
  const [specView, setSpecView] = useState<'spec' | 'repx'>('spec');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      return JSON.parse(saved);
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const isFirstThemeRun = useRef(true);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAnalyzing && !isPaused) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      interval = setInterval(() => {
        setElapsedTime(Date.now() - (startTimeRef.current || Date.now()));
      }, 100);
    } else {
      if (!isAnalyzing) {
        startTimeRef.current = null;
      }
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAnalyzing, isPaused]);

  // Save confirmations are transient — they replace an alert the user had to
  // dismiss, so they must not need dismissing either.
  useEffect(() => {
    if (!saveNotice) return;
    const t = setTimeout(() => setSaveNotice(null), 4000);
    return () => clearTimeout(t);
  }, [saveNotice]);


  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const analyzingSteps = [
    'Analyzing input request and images...',
    'Extracting layout boundaries and sections...',
    'Generating spatial map...',
    'Constructing DevExpress XML...',
    'Refining mockup layout...',
    'Finalizing result...'
  ];

  /**
   * How far the simulated opening phase is allowed to climb. Nothing during
   * upload, model detection or the model's silent thinking pass reports real
   * progress, so this stretch is guesswork and must stay visibly small —
   * leaving the rest of the bar for output that genuinely arrived.
   */
  const PRE_STREAM_CEILING = 14;

  /**
   * Progress only ever moves forward. The opening phase is simulated and the
   * streamed phase is real, and without this guard the handover snapped the
   * bar backwards — the simulation had already climbed while the model was
   * still thinking, then the first real chunk reported a much lower figure.
   */
  const advanceProgress = useCallback((next: number) => {
    setAnalyzingProgress((prev) => (next > prev ? next : prev));
  }, []);

  /**
   * Real progress, fed by the streamed response.
   *
   * The simulated interval still covers the opening phase — model detection,
   * upload, and the model's own thinking produce no signal at all — but it is
   * capped low (see PRE_STREAM_CEILING) so this can take over without the bar
   * ever going backwards. Shared by both handleGenerate and handleResume so
   * the two cannot drift apart.
   */
  const handleStreamProgress = useCallback((progress: StreamProgress) => {
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }

    const stepIndex = Math.min(
      analyzingSteps.length - 1,
      Math.floor((progress.percent / 100) * analyzingSteps.length)
    );
    lastCompletedStepIndexRef.current = stepIndex;

    setAnalyzingStep(analyzingSteps[stepIndex]);
    setStreamChars(progress.chars);
    advanceProgress(Math.max(PRE_STREAM_CEILING + 1, progress.percent));
  }, [advanceProgress]);

  // Syncs the class only. Persistence deliberately lives in setTheme (the user
  // action) rather than here: StrictMode double-invokes effects in dev, so an
  // effect-based write would persist the system-derived value on mount and
  // permanently detach the user from prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDarkMode);

    // The inline bootstrap in index.html already painted the correct theme, so
    // mount must not animate — only a genuine change should.
    if (isFirstThemeRun.current) {
      isFirstThemeRun.current = false;
      return;
    }

    // Animate the swap with the app's shared timing, then drop the class so
    // steady-state hover/focus transitions are left exactly as they were.
    root.classList.add('theme-transition');
    const timer = window.setTimeout(
      () => root.classList.remove('theme-transition'),
      DURATION.base * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [isDarkMode]);

  // The only place a theme choice is persisted — an explicit user action.
  const setTheme = useCallback((val: boolean) => {
    setIsDarkMode(val);
    try {
      localStorage.setItem('darkMode', JSON.stringify(val));
    } catch {
      /* storage disabled — the choice still applies for this session */
    }
  }, []);

  // Keep following the OS for as long as the user has never chosen explicitly.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem('darkMode') === null) setIsDarkMode(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAnalyzing]);

  /**
   * The one intake path, shared by the picker and drag-and-drop. Runs files
   * sequentially so previews land in the order they were given, and reports
   * anything it could not use instead of failing silently.
   */
  const ingestFiles = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) return;
    setUploadNotices([]);

    const room = MAX_ATTACHMENTS - (previews.length + attachmentTexts.length);
    if (room <= 0) {
      setUploadNotices([`You can attach up to ${MAX_ATTACHMENTS} items. Remove one to add another.`]);
      return;
    }

    const accepted = incoming.slice(0, room);
    const notices: string[] = [];
    if (incoming.length > accepted.length) {
      notices.push(`Only the first ${accepted.length} of ${incoming.length} files were added (limit ${MAX_ATTACHMENTS}).`);
    }

    setIsIngesting(true);
    try {
      for (const file of accepted) {
        const result = await ingestFile(file);
        if (result.images.length) setPreviews(prev => [...prev, ...result.images]);
        if (result.texts.length) setAttachmentTexts(prev => [...prev, ...result.texts]);
        notices.push(...result.notices);
      }
    } finally {
      setIsIngesting(false);
      setUploadNotices(notices);
    }
  }, [previews.length, attachmentTexts.length]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await ingestFiles(Array.from(e.target.files || []));
    // Reset file input so the same file can be selected again after removal
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const removeTextAttachment = (id: string) => {
    setAttachmentTexts(prev => prev.filter(t => t.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  // dragleave fires when crossing into a child element too, so only clear the
  // state once the pointer has actually left the drop zone's bounds.
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    await ingestFiles(Array.from(e.dataTransfer.files));
  };

  const handleClearChat = () => {
    setResult(null);
    setPreviews([]);
    setAttachmentTexts([]);
    setUploadNotices([]);
    setPrompt('');
    setError(null);
    setMessages([]);
  };

  // Keeps the once-registered auth listener pointing at the current handler.
  useEffect(() => {
    handleClearChatRef.current = handleClearChat;
  });

  /**
   * Firestore failures used to vanish. `handleFirestoreError` logs and then
   * re-throws, and both call sites are `catch` blocks in async handlers with
   * nothing above them — so a rules rejection became an unhandled promise
   * rejection and the user saw nothing at all.
   *
   * This keeps the diagnostic logging and swallows the re-throw, then shows a
   * plain message. The thrown error's own text is deliberately not rendered: it
   * is a JSON dump containing the signed-in user's uid and email.
   */
  const reportFirestoreFailure = (
    err: unknown,
    operation: OperationType,
    path: string,
    userMessage: string
  ) => {
    try {
      handleFirestoreError(err, operation, path);
    } catch {
      // Already logged by handleFirestoreError; the re-throw stops here.
    }
    setError(userMessage);
  };

  const handleSaveReport = async () => {
    if (!result && messages.length === 0) return;
    const name = result?.title || prompt || 'Untitled Report';
    const reportId = Date.now().toString();
    const ts = Date.now();

    if (user) {
      try {
        const docRef = doc(db, 'users', user.uid, 'reports', reportId);

        // The transcript carries the user's uploads inline as base64 data URLs,
        // and one of those alone can be several times the size of an entire
        // Firestore document. Measured: a detailed 2048px photo at the intake's
        // own JPEG quality is ~4.7 MB against a 1 MiB document ceiling. Writing
        // it produced an opaque backend rejection and the save simply failed.
        //
        // So: try it whole, and if it will not fit, keep the part that matters —
        // the spec, layout and REPX — and say plainly that the images were left
        // behind. A saved report without its source thumbnails still reopens and
        // still exports; a failed save leaves the user with nothing.
        let messagesJson = JSON.stringify(messages);
        const resultJson = JSON.stringify(result);
        let imagesDropped = false;

        if (messagesJson.length + resultJson.length > CLOUD_SAVE_BUDGET_BYTES) {
          messagesJson = JSON.stringify(
            messages.map((m) => (m.images?.length ? { ...m, images: undefined } : m))
          );
          imagesDropped = true;
        }

        if (messagesJson.length + resultJson.length > CLOUD_SAVE_BUDGET_BYTES) {
          setError(
            'This project is too large to sync to your account. It is still open here, and "Save Project" while signed out keeps it on this device.'
          );
          return;
        }

        await setDoc(docRef, {
          id: reportId,
          name: name.substring(0, 30) + (name.length > 30 ? '...' : ''),
          timestamp: ts,
          messages: messagesJson,
          result: resultJson,
          userId: user.uid
        });
        setSaveNotice(
          imagesDropped
            ? 'Saved to your projects — the uploaded images were too large to sync, so the spec and REPX were saved without them.'
            : 'Saved to your projects.'
        );
      } catch (err) {
        reportFirestoreFailure(err, OperationType.WRITE, `users/${user.uid}/reports/${reportId}`,
          'That project could not be saved to your account. It is still open here — try again in a moment.');
      }
    } else {
      const newReport: SavedReport = {
        id: reportId,
        name: name.substring(0, 30) + (name.length > 30 ? '...' : ''),
        timestamp: new Date(ts).toISOString(),
        messages,
        result
      };
      setSavedReports(prev => {
        const updated = [newReport, ...prev];
        localStorage.setItem('savedReports', JSON.stringify(updated));
        return updated;
      });
      setSaveNotice('Saved on this device. Sign in to sync across devices.');
    }
  };

  const handleLoadReport = (report: SavedReport) => {
    setMessages(report.messages);
    setResult(report.result);
    setIsSidebarOpen(false);
  };

  const handleDeleteReport = async (id: string) => {
    // Signed in -> Firestore; signed out -> localStorage. This must stay the same
    // shape as handleSaveReport's branch, so a report is always deleted from
    // wherever it was written.
    if (user) {
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'reports', id));
      } catch (err) {
        reportFirestoreFailure(err, OperationType.DELETE, `users/${user.uid}/reports/${id}`,
          'That project could not be deleted from your account. It is still listed — try again in a moment.');
      }
    } else {
      setSavedReports(prev => {
        const updated = prev.filter(r => r.id !== id);
        localStorage.setItem('savedReports', JSON.stringify(updated));
        return updated;
      });
    }
  };

  const handleLogOut = async () => {
    try {
      await logOut();
    } catch (err) {
      console.error(err);
    }
    setUser(null);
    // Signing out must not leave a live credential behind for the next person at
    // this browser. The encrypted copy in Firestore is untouched — signing back
    // in and entering the passphrase restores it.
    setConfig((prev) => ({ ...prev, customApiKey: '' }));
    clearSessionKey();
    setPassphrase('');
    setPassphraseConfirm('');
    setVaultRecord(null);
    setVaultNotice(null);
    setKeyCheck(null);

    // The credential was never the only thing worth clearing. The workspace also
    // holds the signed-out user's *documents*: uploaded page images, text lifted
    // out of their PDFs, the chat transcript and the generated report. All of it
    // used to survive sign-out and sit there for whoever used the browser next.
    handleClearChat();
    setIsSidebarOpen(false);

    setSavedReports(JSON.parse(localStorage.getItem('savedReports') || '[]'));
  };

  /**
   * One definition for both render trees. `showLogin` is reachable from the
   * landing/marketing return *and* from the workspace return, and each used to
   * carry its own copy of this element with a **different** `onClose`: the
   * workspace copy hardcoded `/workspace` while the other restored
   * `lastViewPath`. Restoring `lastViewPath` is correct in both cases — it is
   * already `'/workspace'` whenever the workspace opened the dialog, because the
   * `/login` and `/signup` branches of the route effect deliberately leave it
   * alone. Keep this single copy; two copies drifted once already.
   */
  const handleLoginClose = useCallback(() => {
    navigate(lastViewPath || '/');
    setShowLogin(false);
  }, [lastViewPath]);

  /**
   * Only ever called by LoginPage after Firebase has actually authenticated. The
   * signed-in user itself arrives via `onAuthStateChanged`, not from here.
   *
   * This used to fabricate a `local-dev-user-id` / "Local Developer" session when
   * Firebase rejected the sign-in, which meant a misconfigured project (or an
   * unrecognised deployment domain) handed the workspace to anyone who clicked
   * the button. That fallback is gone on purpose: a failed sign-in is a failure.
   */
  const handleLoginSuccess = useCallback(() => {
    setShowLogin(false);
    navigate('/workspace');
  }, []);

  const loginModal = showLogin ? (
    <LoginPage
      initialMode={loginInitialMode}
      onClose={handleLoginClose}
      onSuccess={handleLoginSuccess}
      isDarkMode={isDarkMode}
      setIsDarkMode={setIsDarkMode}
    />
  ) : null;

  const handlePause = () => {
    if (isAnalyzing && !isPaused) {
      setIsPaused(true);
      // Pause the simulated loading interval
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current);
      }
      // Abort the active API call
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      console.log('Analysis paused by user at step index:', lastCompletedStepIndexRef.current);
    }
  };

  const handleResume = async () => {
    // Same gate as handleGenerate: the key could have been cleared from the
    // session while the run was paused.
    if (!hasApiKey) {
      setError('Add your Gemini API key to use the workspace.');
      setIsConfigOpen(true);
      return;
    }

    setIsPaused(false);
    setIsAnalyzing(true);
    setError(null);

    const currentPrompt = activePromptRef.current;
    const currentPreviews = activePreviewsRef.current;
    const currentTexts = activeTextsRef.current;

    let stepIndex = lastCompletedStepIndexRef.current;
    setAnalyzingStep(analyzingSteps[stepIndex]);
    // Resume re-issues the whole request, so previously received output no
    // longer counts. The bar itself stays where it was rather than snapping
    // backwards on an action the user took deliberately.
    setStreamChars(0);
    advanceProgress(Math.min(PRE_STREAM_CEILING, 4 + stepIndex * 2));

    loadingIntervalRef.current = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, analyzingSteps.length - 1);
      lastCompletedStepIndexRef.current = stepIndex;
      setAnalyzingStep(analyzingSteps[stepIndex]);
      advanceProgress(Math.min(PRE_STREAM_CEILING, 4 + stepIndex * 2));
    }, 2500);

    console.log(`Resuming report generation process. Prompt: "${currentPrompt}"`);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const imageParts = currentPreviews.map(dataUrl => {
        const [mimeInfo, base64Data] = dataUrl.split(',');
        const mimeType = mimeInfo.split(':')[1].split(';')[0];
        return {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        };
      });

      // Text recovered from the files themselves goes first, so the exact
      // strings and coordinates are in context before the page images.
      const attachmentParts: AttachmentPart[] = [
        ...currentTexts.map(t => ({ text: t.text })),
        ...imageParts,
      ];

      console.debug('Requesting Gemini API on resume...');
      const response = await analyzeReportDesign(
        currentPrompt || "Generate a professional DevExpress report layout based on these visuals.",
        attachmentParts,
        config,
        result ? { layout: result.layout, repxContent: result.repxContent } : undefined,
        signal,
        handleStreamProgress
      );

      if (signal.aborted) {
        console.debug('Generation aborted/paused by user.');
        return;
      }

      console.log('Successfully received response from Gemini API.');

      const newResult = {
        content: response.markdown,
        timestamp: new Date(),
        title: response.layout.title,
        layout: response.layout,
        repxContent: response.repxContent
      };

      setResult(newResult);
      setActiveTab('ui');

      // Add assistant message
      const newAssistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: currentPrompt ? "I've resumed and completed the report layout based on your instructions. You can view the UI preview and specifications on the right." : "I've resumed and completed the report layout based on your provided images. You can view the UI preview and specifications on the right.",
        result: newResult
      };
      setMessages(prev => [...prev, newAssistantMsg]);
      console.log('Report layout updated successfully on resume.');

    } catch (err: any) {
      if (signal.aborted) {
        console.debug('Generation aborted/paused by user during error handling.');
        return;
      }
      console.error('Error during report generation:', err);

      // No key configured is a setup step, not a failure — send the user straight
      // to the place they can fix it instead of showing a dead-end error.
      if (err instanceof MissingApiKeyError) {
        setError('Add your own Gemini API key in Settings to generate reports.');
        setIsConfigOpen(true);
        return;
      }

      let friendlyMessage = err.message || 'An error occurred during analysis.';
      if (friendlyMessage.includes('quota') || friendlyMessage.includes('429')) {
        friendlyMessage = 'Your Gemini API key has hit its quota. Check your plan and billing in Google AI Studio.';
      } else if (friendlyMessage.includes('Failed to fetch')) {
        friendlyMessage = 'Network error. Please check your internet connection.';
      }
      setError(friendlyMessage);
    } finally {
      if (!signal.aborted) {
        setAnalyzingProgress(100);
        setTimeout(() => {
          setIsAnalyzing(false);
          setIsPaused(false);
          setAnalyzingStep('');
          setAnalyzingProgress(0);
          setStreamChars(0);
        }, 500);
      }
      if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsAnalyzing(false);
    setIsPaused(false);
    setAnalyzingStep('');
    setAnalyzingProgress(0);
    setStreamChars(0);
    lastCompletedStepIndexRef.current = 0;
    activePromptRef.current = '';
    activePreviewsRef.current = [];
    if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);

    // Add a system message that generation was stopped
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      text: 'Generation stopped by user.'
    }]);
  };

  /**
   * Re-send a turn that failed. The failed message and anything after it are
   * dropped first, so the retry does not stack a second copy of the same
   * question in the transcript.
   */
  const handleRetryMessage = (id: string) => {
    if (isChatting || isAnalyzing) return;
    const failed = messages.find((m) => m.id === id);
    if (!failed) return;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      return idx === -1 ? prev : prev.slice(0, idx);
    });
    setError(null);
    void handleGenerate(failed.text);
  };

  /**
   * `overridePrompt` exists for the retry affordance on a failed message, which
   * re-sends that message's own text rather than whatever is in the composer.
   * Every call site passes it explicitly — never wire this straight to onClick,
   * or the click event arrives as the prompt.
   */
  const handleGenerate = async (overridePrompt?: string) => {
    const promptText = overridePrompt ?? prompt;

    if (previews.length === 0 && attachmentTexts.length === 0 && !promptText) {
      setError('Please provide at least an image, PDF, or a text description.');
      return;
    }

    // The API key gates everything in the workspace. Checked here rather than
    // relying on analyzeReportDesign to throw, so nothing is added to the
    // transcript and no loader appears before we know a request is possible.
    if (!hasApiKey) {
      setError('Add your Gemini API key to use the workspace.');
      setIsConfigOpen(true);
      return;
    }

    const currentPrompt = promptText;
    const currentPreviews = [...previews];
    const currentTexts = [...attachmentTexts];

    // Add user message
    const newUserMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: currentPrompt, // Only use the prompt the user actually typed
      images: currentPreviews.length > 0 ? currentPreviews : undefined
    };

    setMessages(prev => [...prev, newUserMsg]);
    setPrompt('');
    setPreviews([]);
    setAttachmentTexts([]);
    setUploadNotices([]);

    /* ---------------------------------------------------------------- *
     * Conversation vs. work.
     *
     * Every message used to go straight into a full report generation, so
     * typing "hello" produced a mockup report. An attachment is an
     * unambiguous request to build something; without one, a cheap chat turn
     * answers the message and decides whether a report was actually being
     * asked for.
     * ---------------------------------------------------------------- */
    // Any attachment — a page image or text lifted out of a PDF/.repx — is an
    // unambiguous request to build something, so it skips the chat turn.
    if (currentPreviews.length === 0 && currentTexts.length === 0) {
      setIsChatting(true);
      setStreamingReply('');
      try {
        const history: ChatTurn[] = [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: 'user', text: currentPrompt },
        ];
        const outcome = await chatReply(history, config, undefined, setStreamingReply);

        if (!outcome.wantsReport) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            text: outcome.reply,
          }]);
          return;
        }

        // The user does want a report built from their description — fall
        // through to generation below, after acknowledging.
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          text: outcome.reply,
        }]);
      } catch (err: any) {
        console.error('Chat turn failed:', err);
        const message = err instanceof MissingApiKeyError
          ? 'Add your Gemini API key to use the workspace.'
          : err?.message || 'Could not reach the assistant.';
        setError(message);
        // Mark the message that failed, so the transcript shows which turn went
        // wrong instead of leaving it looking merely unanswered.
        setMessages(prev => prev.map(m =>
          m.id === newUserMsg.id ? { ...m, error: message } : m
        ));
        if (err instanceof MissingApiKeyError) setIsConfigOpen(true);
        return;
      } finally {
        setIsChatting(false);
        setStreamingReply('');
      }
    }

    setIsAnalyzing(true);
    setIsPaused(false);

    // Cache inputs for pause/resume
    activePromptRef.current = currentPrompt;
    activePreviewsRef.current = currentPreviews;
    activeTextsRef.current = currentTexts;
    lastCompletedStepIndexRef.current = 0;

    setAnalyzingStep(analyzingSteps[0]);
    setAnalyzingProgress(4);
    setStreamChars(0);
    setError(null);

    let stepIndex = 0;
    loadingIntervalRef.current = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, analyzingSteps.length - 1);
      lastCompletedStepIndexRef.current = stepIndex;
      setAnalyzingStep(analyzingSteps[stepIndex]);
      advanceProgress(Math.min(PRE_STREAM_CEILING, 4 + stepIndex * 2));
    }, 2500);

    console.log(`Starting report generation process. Prompt: "${currentPrompt}"`);
    console.debug(`Included ${currentPreviews.length} preview images/files.`);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const imageParts = currentPreviews.map(dataUrl => {
        const [mimeInfo, base64Data] = dataUrl.split(',');
        const mimeType = mimeInfo.split(':')[1].split(';')[0];
        return {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        };
      });

      // Text recovered from the files themselves goes first, so the exact
      // strings and coordinates are in context before the page images.
      const attachmentParts: AttachmentPart[] = [
        ...currentTexts.map(t => ({ text: t.text })),
        ...imageParts,
      ];

      console.debug('Sending request to Gemini API...');
      const response = await analyzeReportDesign(
        currentPrompt || "Generate a professional DevExpress report layout based on these visuals.",
        attachmentParts,
        config,
        result ? { layout: result.layout, repxContent: result.repxContent } : undefined,
        signal,
        handleStreamProgress
      );

      if (signal.aborted) {
        console.debug('Generation aborted/paused by user.');
        return;
      }

      console.log('Successfully received response from Gemini API.');
      console.debug(`Generated Layout Title: ${response.layout.title}`);
      console.debug(`Generated REPX length: ${response.repxContent.length} characters`);

      const newResult = {
        content: response.markdown,
        timestamp: new Date(),
        title: response.layout.title,
        layout: response.layout,
        repxContent: response.repxContent
      };

      setResult(newResult);
      setActiveTab('ui');

      // Add assistant message
      const newAssistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: currentPrompt ? "I've updated the report layout based on your instructions. You can view the UI preview and specifications on the right." : "I've generated the report layout based on your provided images. You can view the UI preview and specifications on the right.",
        result: newResult
      };
      setMessages(prev => [...prev, newAssistantMsg]);
      console.log('Report layout updated successfully.');

    } catch (err: any) {
      if (signal.aborted) {
        console.debug('Generation aborted/paused by user during error handling.');
        return;
      }
      console.error('Error during report generation:', err);

      // No key configured is a setup step, not a failure — send the user straight
      // to the place they can fix it instead of showing a dead-end error.
      if (err instanceof MissingApiKeyError) {
        setError('Add your own Gemini API key in Settings to generate reports.');
        setIsConfigOpen(true);
        return;
      }

      let friendlyMessage = err.message || 'An error occurred during analysis.';
      if (friendlyMessage.includes('quota') || friendlyMessage.includes('429')) {
        friendlyMessage = 'Your Gemini API key has hit its quota. Check your plan and billing in Google AI Studio.';
      } else if (friendlyMessage.includes('Failed to fetch')) {
        friendlyMessage = 'Network error. Please check your internet connection.';
      }
      setError(friendlyMessage);
    } finally {
      if (!signal.aborted) {
        setAnalyzingProgress(100);
        setTimeout(() => {
          setIsAnalyzing(false);
          setIsPaused(false);
          setAnalyzingStep('');
          setAnalyzingProgress(0);
          setStreamChars(0);
        }, 500);
      }
      if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    }
  };

  const downloadDesign = () => {
    if (!result) return;
    const element = document.createElement("a");
    const file = new Blob([result.repxContent || result.content], { type: result.repxContent ? 'application/xml' : 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${result.title ? result.title.replace(/\s+/g, '_') : 'report-design'}${result.repxContent ? '.repx' : '.txt'}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  /**
   * The uploads a `sourceRect` can be cropped from. Live uploads win, but a
   * report reloaded from history has an empty `previews` — its images survive
   * on the user chat message, so fall back to those and keep logo cropping
   * working after a reload. Order matches the parts sent to the model, so
   * `sourceImageIndex` lines up either way.
   */
  const mockupSourceImages = useMemo(() => {
    if (previews.length > 0) return previews;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && msg.images?.length) return msg.images;
    }
    return undefined;
  }, [previews, messages]);

  if (!showWorkspace) {
    const isFeatures = currentRoute === '/features';
    const isDocs = currentRoute === '/docs';
    const isContact = currentRoute === '/contact';

    return (
      <div className="h-full w-full">
        {isFeatures ? (
          <FeaturesPage
            onEnterWorkspace={() => {
              navigate('/workspace');
            }}
            onSignIn={() => {
              navigate('/login');
            }}
            onSignUp={() => {
              navigate('/signup');
            }}
            user={user}
            logOut={handleLogOut}
            isDarkMode={isDarkMode}
            setIsDarkMode={setTheme}
          />
        ) : isDocs ? (
          <DocsPage
            onEnterWorkspace={() => {
              navigate('/workspace');
            }}
            onSignIn={() => {
              navigate('/login');
            }}
            onSignUp={() => {
              navigate('/signup');
            }}
            user={user}
            logOut={handleLogOut}
            isDarkMode={isDarkMode}
            setIsDarkMode={setTheme}
          />
        ) : isContact ? (
          <ContactPage
            onEnterWorkspace={() => {
              navigate('/workspace');
            }}
            onSignIn={() => {
              navigate('/login');
            }}
            onSignUp={() => {
              navigate('/signup');
            }}
            user={user}
            logOut={handleLogOut}
            isDarkMode={isDarkMode}
            setIsDarkMode={setTheme}
          />
        ) : (
          <LandingPage
            onEnterWorkspace={() => {
              navigate('/workspace');
            }}
            onSignIn={() => {
              navigate('/login');
            }}
            onSignUp={() => {
              navigate('/signup');
            }}
            user={user}
            logOut={handleLogOut}
            isDarkMode={isDarkMode}
            setIsDarkMode={setTheme}
          />
        )}
        {loginModal}
      </div>
    );
  }

  return (
    /*
     * `sheet` is what makes this surface part of the same design as the five
     * marketing pages: it supplies the sheet palette (see the SHEET PALETTE
     * block in index.css), so every `bg-surface*` / `text-on-surface*` /
     * `border-outline-variant` below resolves to the sheet's cool greys and
     * `text-secondary` resolves to the brand orange #fe6b00 instead of the
     * app-wide #a04100 brown.
     *
     * Deliberately `sheet` and NOT `landing`: that class adds `overflow-x: clip`
     * and a 1180px measure, both of which are wrong for a full-bleed h-screen
     * frame. The two selectors were split for exactly this reason.
     *
     * The root must also carry real colours rather than the shadcn-family
     * `bg-background` / `text-foreground` it used to: those tokens are not
     * remapped by the sheet scope, so the root stayed #FCFCFC while every
     * descendant moved to sheet grey.
     */
    <div className="sheet h-screen flex flex-col bg-surface text-on-surface font-sans overflow-hidden">
      {/* TopNavBar */}
      {/* Height and material are copied from SiteHeader deliberately: h-[68px]
          with the same translucent fill and blur. Crossing from a marketing page
          into the workspace used to shift the bar 4px shorter and change it from
          a translucent sheet to opaque white, which read as landing on a
          different site. If you change one, change the other. */}
      <header className="w-full h-[68px] bg-surface/[0.84] [backdrop-filter:blur(16px)_saturate(1.5)] border-b border-outline-variant flex-shrink-0 z-50">
        <nav className="flex justify-between items-center gap-2 px-3 sm:px-6 h-full w-full">
          <div className="flex items-center gap-3 lg:gap-6 min-w-0">
            <div
              onClick={() => {
                navigate('/');
              }}
              className="flex items-center gap-3 cursor-pointer hover:opacity-85 transition-opacity shrink-0"
              title="Back to Landing Page"
            >
              <Logo size={28} />
              {/* Below sm the action cluster needs the whole bar, so only the mark
                  survives. The wordmark used to stay and, having nothing to shrink
                  or truncate against, painted straight over the round buttons. */}
              <div className="hidden sm:flex flex-col min-w-0">
                <span className="font-display-lg text-title-md font-bold text-on-surface leading-tight">Forma</span>
                <span className="font-label-caps text-[9px] tracking-widest text-on-surface-variant uppercase leading-none hidden sm:block">Show it. Build it. Ship it.</span>
              </div>
            </div>
            <div className="h-8 w-px bg-outline-variant/30 hidden sm:block"></div>
            <div className="flex items-center gap-4 select-none">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="u-tap u-transition-fast u-focus-ring u-press flex items-center justify-center w-10 h-10 rounded-full text-on-surface-variant hover:text-secondary hover:bg-surface-container cursor-pointer relative"
                title="Saved Projects"
                aria-label={`Saved projects${savedReports.length ? ` (${savedReports.length})` : ''}`}
              >
                <IconHistory size={20} />
                {savedReports.length > 0 && !isSidebarOpen && (
                  <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-secondary text-[8px] font-bold text-white rounded-full flex items-center justify-center border border-white">
                    {savedReports.length}
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              onClick={handleSaveReport}
              disabled={!result && messages.length === 0}
              className="u-tap u-transition-fast u-press u-focus-ring px-2.5 sm:px-3 lg:px-5 py-1.5 bg-surface-container-high font-label-caps text-[11px] text-on-surface-variant rounded-full hover:bg-surface-container-highest cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hidden sm:flex items-center gap-2"
              title="Save Project"
              aria-label="Save project"
            >
              {/* No responsive class on the icon: Material Symbols ships its own
                  `display` from an unlayered <link>, which beats Tailwind's
                  layered `hidden` utility regardless of breakpoint. The
                  `lg:hidden` that used to sit here had never once applied — the
                  desktop button always rendered icon *and* label, like its two
                  siblings. Wrap the icon in a plain span if you ever do need to
                  hide one responsively. */}
              <IconSave size={14} />
              <span className="hidden lg:inline">Save Project</span>
            </button>
            <button
              onClick={handleClearChat}
              className="u-tap u-transition-fast u-press u-focus-ring px-2.5 sm:px-3 lg:px-5 py-1.5 border border-outline-variant font-label-caps text-[11px] text-on-surface-variant hidden sm:flex items-center gap-2 rounded-full hover:bg-surface cursor-pointer"
              title="New Process"
              aria-label="New process"
            >
              <IconPlus size={14} />
              <span className="hidden lg:inline">New Process</span>
            </button>
            <button
              onClick={() => setIsConfigOpen(true)}
              className="u-tap u-transition-fast u-press u-focus-ring px-2.5 sm:px-3 lg:px-5 py-1.5 bg-secondary-container text-white font-label-caps text-[11px] flex items-center gap-2 rounded-full shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] cursor-pointer"
              title="Configure"
              aria-label="Configure"
            >
              <IconTune size={14} />
              <span className="hidden lg:inline">Configure</span>
            </button>
            <div className="w-px h-6 bg-outline-variant/30 mx-1 sm:mx-2 hidden sm:block"></div>
            {user ? (
              <div className="relative" ref={workspaceProfileRef}>
                <div
                  onClick={() => setShowWorkspaceProfile(!showWorkspaceProfile)}
                  className="flex items-center gap-2.5 pr-3 border-r border-outline-variant/30 cursor-pointer select-none hover:opacity-85 transition-opacity"
                >
                  <UserAvatar user={user} />
                  <span className="font-label-caps text-[11px] text-on-surface-variant font-semibold hidden sm:inline max-w-[120px] truncate">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                  {/* One chevron rotated, rather than two glyphs: the Material set
                      had expand_less/expand_more as separate ligatures, but a
                      rotation animates and cannot drift out of step. */}
                  <IconChevronDown
                    size={14}
                    className={`u-transition-fast text-on-surface-variant select-none hidden sm:inline ${
                      showWorkspaceProfile ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                {showWorkspaceProfile && (
                  <div className="absolute right-0 mt-2 w-56 bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-[var(--shadow-lg)] z-50 overflow-hidden py-2">
                    <div className="px-4 py-3 border-b border-outline-variant/30 flex flex-col text-left">
                      <span className="text-xs font-bold text-on-surface truncate">
                        {user.displayName || 'Developer User'}
                      </span>
                      <span className="text-[10px] text-on-surface-variant truncate font-mono mt-0.5">
                        {user.email || 'developer@example.com'}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setShowWorkspaceProfile(false);
                        handleLogOut();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-error-container text-error hover:text-error transition-colors text-left text-xs font-semibold font-label-caps cursor-pointer"
                    >
                      <IconLogout size={16} />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  navigate('/login');
                }}
                className="font-label-caps text-body-sm text-on-surface-variant px-2.5 sm:px-4 py-2 hover:bg-surface-container rounded-full transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap"
                aria-label="Sign in"
              >
                {/* Below sm only the icon remains: at 91px the label was both the
                    widest thing in the bar and the only text that wrapped.
                    The icon carries no responsive class on purpose — Material
                    Symbols sets its own `display`, which beats Tailwind's `hidden`
                    (see the same dead `lg:hidden` on the save icon above), and
                    showing it at every width matches the sibling pills anyway. */}
                <IconLogin size={20} />
                <span className="hidden sm:inline">Sign In</span>
              </button>
            )}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={`w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container rounded-full transition-all cursor-pointer ${isMenuOpen ? 'bg-surface-container' : ''}`}
              >
                <IconMenu size={20} />
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-[var(--shadow-lg)] z-50 overflow-hidden">
                  <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-label-caps text-[9px] tracking-widest text-secondary uppercase font-bold">Developer Settings</span>
                      <span className="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse"></span>
                    </div>
                    <div className="space-y-1">
                      {/* Save and New leave the bar below sm — at 320px the full
                          control set overlapped itself. They live here instead, so
                          the actions stay reachable rather than disappearing. */}
                      <button
                        onClick={() => {
                          setIsMenuOpen(false);
                          handleSaveReport();
                        }}
                        disabled={!result && messages.length === 0}
                        className="sm:hidden w-full flex items-center gap-3 p-2 hover:bg-surface-container rounded-xl transition-colors group cursor-pointer text-left text-on-surface disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <IconSave size={18} className="text-on-surface-variant group-hover:text-secondary" />
                        <span className="font-body-sm text-[13px]">Save Project</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsMenuOpen(false);
                          handleClearChat();
                        }}
                        className="sm:hidden w-full flex items-center gap-3 p-2 hover:bg-surface-container rounded-xl transition-colors group cursor-pointer text-left text-on-surface"
                      >
                        <IconPlus size={18} className="text-on-surface-variant group-hover:text-secondary" />
                        <span className="font-body-sm text-[13px]">New Process</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* Configuration Modal */}
      <AnimatePresence>
        {isConfigOpen && (
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={dismissConfigWithoutSaving}
            className="fixed inset-0 bg-black/50 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Report configuration"
              className="bg-surface-container-lowest border border-outline-variant rounded-t-2xl sm:rounded-2xl shadow-[var(--shadow-lg)] w-full sm:max-w-md overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh]"
            >
              <div className="flex items-center justify-between p-6 border-b border-outline-variant flex-shrink-0">
                <h3 className="text-lg font-bold flex items-center gap-2 font-title-md">
                  <IconTune size={20} className="text-secondary" />
                  Report Configuration
                </h3>
                <button onClick={dismissConfigWithoutSaving} aria-label="Close without saving" className="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer flex items-center">
                  <IconClose size={20} />
                </button>
              </div>
              <div className="p-6 space-y-5 overflow-y-auto">
                <div>
                  <label className="block text-xs font-mono font-bold text-on-surface-variant mb-2">DevExpress Version</label>
                  <select
                    value={config.version}
                    onChange={(e) => setConfig({ ...config, version: e.target.value })}
                    className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                  >
                    <option value="24.1">v24.1</option>
                    <option value="23.2">v23.2</option>
                    <option value="23.1">v23.1</option>
                    <option value="22.2">v22.2</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold text-on-surface-variant mb-2">Report Unit</label>
                  <select
                    value={config.unit}
                    onChange={(e) => setConfig({ ...config, unit: e.target.value })}
                    className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                  >
                    <option value="HundredthsOfAnInch">HundredthsOfAnInch</option>
                    <option value="TenthsOfAMillimeter">TenthsOfAMillimeter</option>
                    <option value="Pixels">Pixels</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold text-on-surface-variant mb-2">Page Size</label>
                  <select
                    value={config.pageSize}
                    onChange={(e) => setConfig({ ...config, pageSize: e.target.value })}
                    className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                  >
                    <option value="Letter">Letter</option>
                    <option value="A4">A4</option>
                    <option value="Legal">Legal</option>
                  </select>
                </div>

                {/* Header Config */}
                <div className="pt-4 border-t border-outline-variant">
                  <h4 className="text-xs font-mono font-bold text-on-surface-variant mb-3 uppercase tracking-wider">Header Settings</h4>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.header?.showCompanyLogo}
                        onChange={(e) => setConfig({ ...config, header: { ...config.header, showCompanyLogo: e.target.checked } })}
                        className="rounded border-outline-variant text-secondary focus:ring-secondary"
                      />
                      Include Company Logo
                    </label>
                    <div>
                      <label className="block text-[11px] font-mono text-on-surface-variant mb-1 font-semibold">Report Title</label>
                      <input
                        type="text"
                        value={config.header?.title || ''}
                        onChange={(e) => setConfig({ ...config, header: { ...config.header, title: e.target.value } })}
                        placeholder="e.g., Monthly Sales Report"
                        className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                      />
                    </div>
                  </div>
                </div>

                {/* Footer Config */}
                <div className="pt-4 border-t border-outline-variant">
                  <h4 className="text-xs font-mono font-bold text-on-surface-variant mb-3 uppercase tracking-wider">Footer Settings</h4>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.footer?.showPageNumbers}
                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, showPageNumbers: e.target.checked } })}
                        className="rounded border-outline-variant text-secondary focus:ring-secondary"
                      />
                      Include Page Numbers
                    </label>
                    <div>
                      <label className="block text-[11px] font-mono text-on-surface-variant mb-1 font-semibold">Custom Footer Text</label>
                      <input
                        type="text"
                        value={config.footer?.customText || ''}
                        onChange={(e) => setConfig({ ...config, footer: { ...config.footer, customText: e.target.value } })}
                        placeholder="e.g., Confidential Document"
                        className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                      />
                    </div>
                  </div>
                </div>

                {/* The model picker used to live here. It has been removed on purpose:
                    hardcoded model ids rot. Google retires models "for new users", so
                    the old gemini-2.5-flash default 404'd for every freshly created key
                    while the dropdown still advertised models (3.5 Flash/Pro) that never
                    existed for most accounts. The model is now detected from the key —
                    see resolveModel() in geminiService.ts. */}

                {/* API Config */}
                <div className="pt-4 border-t border-outline-variant">
                  <h4 className="text-xs font-mono font-bold text-on-surface-variant mb-3 uppercase tracking-wider">Your Gemini API Key</h4>
                  <div>
                    <label className="block text-[11px] font-mono text-on-surface-variant mb-1 font-semibold">API Key <span className="text-error opacity-80">(Required)</span></label>
                    <div className="relative flex items-center">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={config.customApiKey || ''}
                        onChange={(e) => {
                          setConfig({ ...config, customApiKey: e.target.value });
                          setKeyCheck(null);
                        }}
                        placeholder="AIzaSy..."
                        className="w-full p-2.5 pr-10 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center"
                        title={showApiKey ? "Hide API Key" : "Show API Key"}
                      >
                        {showApiKey ? <IconEye size={18} /> : <IconEyeOff size={18} />}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={handleCheckKey}
                        disabled={vaultBusy || !config.customApiKey}
                        className="u-tap u-transition-fast u-press u-focus-ring px-3 py-1.5 bg-surface-container-high text-[11px] font-semibold text-on-surface-variant rounded-full hover:bg-surface-container-highest cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Check key
                      </button>
                      {config.customApiKey && (
                        <button
                          type="button"
                          onClick={handleClearKeyFromSession}
                          className="u-tap u-transition-fast u-press u-focus-ring px-3 py-1.5 text-[11px] font-semibold text-on-surface-variant rounded-full hover:bg-surface-container-high cursor-pointer"
                        >
                          Clear from this session
                        </button>
                      )}
                    </div>

                    {keyCheck && (
                      <p className={`text-[10px] mt-2 leading-snug ${keyCheck.tone === 'ok' ? 'text-[color:var(--ok-ink)]' : 'text-[color:var(--bad-ink)]'}`}>
                        {keyCheck.text}
                      </p>
                    )}

                    <p className="text-[10px] text-on-surface-variant mt-2 leading-snug">
                      Forma ships with no API key of its own. Get a free key from{' '}
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-on-surface"
                      >
                        Google AI Studio
                      </a>
                      . Your key goes straight from this browser to Google — it never reaches our servers.
                      It is kept for this browser tab only and is erased when you close it.
                    </p>
                  </div>

                  {/* Zero-knowledge sync — signed-in users only */}
                  {canUseVault && (
                    <div className="mt-5 pt-4 border-t border-outline-variant">
                      <h4 className="text-xs font-mono font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                        Sync Across Devices
                      </h4>
                      <p className="text-[10px] text-on-surface-variant mb-3 leading-snug">
                        Your key is encrypted in this browser with a passphrase before it is saved to your
                        account. We store only the encrypted result and cannot read it.
                      </p>

                      {vaultRecord ? (
                        <>
                          <label className="block text-[11px] font-mono text-on-surface-variant mb-1 font-semibold">
                            Passphrase
                          </label>
                          <input
                            type="password"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockKey(); }}
                            placeholder="Unlock your stored key"
                            className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                          />
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              onClick={handleUnlockKey}
                              disabled={vaultBusy}
                              className="u-tap u-transition-fast u-press u-focus-ring px-3 py-1.5 bg-secondary-container text-white text-[11px] font-semibold rounded-full hover:bg-secondary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {vaultBusy ? 'Working…' : 'Unlock key'}
                            </button>
                            <button
                              type="button"
                              onClick={handleForgetStoredKey}
                              disabled={vaultBusy}
                              className="u-tap u-transition-fast u-press u-focus-ring px-3 py-1.5 text-[11px] font-semibold text-error rounded-full hover:bg-error/10 cursor-pointer disabled:opacity-50"
                            >
                              Delete stored key
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="block text-[11px] font-mono text-on-surface-variant mb-1 font-semibold">
                            Create a passphrase
                          </label>
                          <input
                            type="password"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            placeholder="At least 8 characters"
                            className="w-full p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                          />
                          <input
                            type="password"
                            value={passphraseConfirm}
                            onChange={(e) => setPassphraseConfirm(e.target.value)}
                            placeholder="Confirm passphrase"
                            className="w-full mt-2 p-2.5 border border-outline-variant rounded-xl focus:border-secondary outline-none bg-surface-container-lowest text-sm font-sans"
                          />
                          <p className="text-[10px] text-error mt-2 leading-snug">
                            Write this passphrase down. It is never sent to us, so if you forget it your stored
                            key cannot be recovered — you would need to delete it and add your API key again.
                          </p>
                          <button
                            type="button"
                            onClick={handleSyncKeyToAccount}
                            disabled={vaultBusy}
                            className="u-tap u-transition-fast u-press u-focus-ring mt-2 px-3 py-1.5 bg-secondary-container text-white text-[11px] font-semibold rounded-full hover:bg-secondary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {vaultBusy ? 'Encrypting…' : 'Encrypt & sync to my account'}
                          </button>
                        </>
                      )}

                      {vaultNotice && (
                        <p className={`text-[10px] mt-2 leading-snug ${vaultNotice.tone === 'ok' ? 'text-[color:var(--ok-ink)]' : 'text-[color:var(--bad-ink)]'}`}>
                          {vaultNotice.text}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-6 border-t border-outline-variant bg-surface-container-low flex justify-end gap-3 flex-shrink-0">
                <button
                  onClick={dismissConfigWithoutSaving}
                  className="px-5 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={saveConfigAndClose}
                  className="px-5 py-2.5 bg-secondary-container text-white text-sm font-semibold rounded-xl hover:bg-secondary transition-colors cursor-pointer shadow-[var(--shadow-sm)]"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Screen Image Modal */}
      <AnimatePresence>
        {fullScreenImage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFullScreenImage(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-pointer"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-5xl max-h-[90vh] flex flex-col items-center justify-center pointer-events-none"
            >
              <img
                src={fullScreenImage}
                alt="Full screen preview"
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-[var(--shadow-lg)] pointer-events-auto"
              />
              <button
                onClick={() => setFullScreenImage(null)}
                className="absolute -top-4 -right-4 bg-surface-container-lowest text-on-surface p-2 rounded-full shadow-[var(--shadow-lg)] hover:bg-surface transition-colors pointer-events-auto cursor-pointer flex items-center"
              >
                <IconClose size={18} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Workspace Frame */}
      <main className="flex-grow flex overflow-hidden relative">
        {/* Integrated Left Sidebar */}
        <aside
          className={`${mobilePane === 'chat' ? 'flex' : 'hidden'} md:flex relative w-full md:w-80 lg:w-96 md:flex-shrink-0 border-r border-outline-variant flex-col bg-surface-container-low u-transition ${isDragging ? 'ring-2 ring-inset ring-[color:var(--accent-line)] bg-[color:var(--accent-wash)]' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Sticky header for Instruction Log & Clear Chat */}
          {messages.length > 0 && (
            <div className="px-6 py-4 border-b border-outline-variant/30 flex justify-between items-center flex-shrink-0 bg-surface-container-low z-10">
              <span className="font-label-caps text-on-surface-variant text-[10px] uppercase font-bold tracking-wider">Instruction Log</span>
              <button
                onClick={handleClearChat}
                className="text-[10px] font-bold text-error hover:text-error flex items-center gap-1 transition-colors cursor-pointer uppercase font-label-caps font-mono"
                title="Clear All Chat"
              >
                <IconTrash size={13} />
                Clear Chat
              </button>
            </div>
          )}

          {/* Scrollable instructions & messages */}
          <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-6">
            {/* Hi there Card */}
            {messages.length === 0 && (
              <div className="bg-surface-container-lowest border border-outline-variant p-5 rounded-2xl shadow-[var(--shadow-sm)]">
                <h4 className="font-title-md text-body-sm font-bold mb-3 flex items-center gap-2 text-on-surface">
                  <IconChat size={18} className="text-secondary" />
                  Hi there!
                </h4>
                <p className="font-body-sm text-[13px] text-on-surface-variant leading-relaxed">
                  Welcome back. Upload your report mockups, sketches, or PDFs and describe what you want to build.
                </p>
              </div>
            )}

            {/* Chat History Flow inside Sidebar */}
            {messages.length > 0 && (
              <div className="space-y-4">
                {messages.map(msg => (
                  <motion.div
                    key={msg.id}
                    variants={messageVariants}
                    initial="hidden"
                    animate="visible"
                    className={`flex flex-col gap-2 w-full ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {/* Attached files preview in message bubbles */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 w-full justify-end">
                        {msg.images.map((src, idx) => {
                          const isRepx = src.startsWith('data:application/xml') || src.startsWith('data:text/');
                          return (
                            <div key={idx} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-outline-variant/50 bg-surface-container-lowest flex items-center justify-center shadow-[var(--shadow-sm)]">
                              {isRepx ? (
                                <div className="flex flex-col items-center justify-center w-full h-full text-on-surface-variant">
                                  <IconDoc size={18} />
                                  <span className="text-[7px] font-bold uppercase mt-0.5">REPX</span>
                                </div>
                              ) : (
                                <img
                                  src={src}
                                  alt="Attached"
                                  className="w-full h-full object-cover cursor-pointer hover:opacity-85"
                                  onClick={() => setFullScreenImage(src)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {msg.text && (
                      <div className={`px-4 py-2.5 text-xs leading-relaxed shadow-[var(--shadow-sm)] ${msg.role === 'user'
                        ? 'bg-secondary-container/10 border border-secondary/20 rounded-2xl text-on-surface-variant w-fit max-w-[90%]'
                        : 'bg-surface-container-lowest border border-outline-variant rounded-2xl text-on-surface-variant w-fit max-w-[90%]'
                        }`}>
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    )}

                    {/* The failure belongs next to the turn that failed, not only
                        in a note by the composer that scrolls away from it. */}
                    {msg.error && (
                      <div className="flex items-start gap-1.5 max-w-[90%] text-error" role="alert">
                        <IconAlert size={13} className="shrink-0 mt-px" />
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-[10px] leading-snug">{msg.error}</span>
                          <button
                            onClick={() => handleRetryMessage(msg.id)}
                            disabled={isChatting || isAnalyzing}
                            className="u-transition-fast u-focus-ring text-[10px] font-label-caps underline underline-offset-2 hover:text-on-surface cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Try again
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}

            {/* A chat turn is short and cheap, so it gets a light typing
                indicator rather than the full generation card below. Once the
                first characters land it becomes the answer itself, filling in
                as it streams. */}
            <AnimatePresence>
              {isChatting && !isAnalyzing && (
                <motion.div
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  aria-live="polite"
                  className="w-fit max-w-[90%] bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-[var(--shadow-sm)] px-4 py-2.5"
                >
                  {streamingReply ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant whitespace-pre-wrap">
                      {streamingReply}
                      <span className="inline-block w-1 h-3 ml-0.5 bg-secondary align-middle animate-pulse" />
                    </p>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      <IconReplay size={16} className="animate-spin text-secondary select-none" />
                      <span className="text-[11px] text-on-surface-variant">Thinking…</span>
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Analysis Loader / Pause State Card */}
            <AnimatePresence>
              {(isAnalyzing || isPaused) && (
                <motion.div
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                  aria-live="polite"
                  className={`flex flex-col gap-2 w-full bg-surface-container-lowest p-4 rounded-xl border shadow-[var(--shadow-sm)] relative overflow-hidden group u-transition ${isPaused ? 'border-[color:var(--ink-faint)]/40' : 'border-outline-variant'
                    }`}
                >
                  {/* Header: state, elapsed time, stop */}
                  <div className="flex items-center justify-between gap-3 w-full">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isPaused ? (
                        <IconPause size={18} className="text-[color:var(--ink-faint)] select-none" />
                      ) : (
                        <IconReplay size={18} className="animate-spin text-secondary select-none" />
                      )}
                      <span className="text-xs font-bold text-[color:var(--ink-faint)] truncate">
                        {isPaused ? 'Analysis Paused' : streamChars > 0 ? 'Writing report' : 'Reading your design'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[11px] font-mono tabular-nums text-on-surface-variant">
                        {formatElapsed(elapsedTime)}
                      </span>
                      <button
                        onClick={handleStop}
                        className="u-tap u-transition-fast u-press u-focus-ring p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container rounded-full z-20 flex items-center justify-center cursor-pointer"
                        title="Stop & Reset"
                        aria-label="Stop analysis"
                      >
                        <IconClose size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Bar. scaleX from a left origin rather than width: width
                      animates on the layout thread every frame of a run that
                      lasts the whole generation. Identical visual result. */}
                  <div className="flex items-center gap-2.5 w-full mt-0.5">
                    <div className="relative flex-1 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                      <motion.div
                        className={`h-full w-full origin-left rounded-full ${isPaused ? 'bg-[color:var(--ink-faint)]' : 'bg-secondary'}`}
                        animate={{ scaleX: analyzingProgress / 100 }}
                        transition={transition.slow}
                      />
                    </div>
                    <span className="text-[11px] font-mono tabular-nums font-bold text-on-surface-variant w-9 text-right shrink-0">
                      {Math.round(analyzingProgress)}%
                    </span>
                  </div>

                  {/* Current stage, plus the live output readout once the model
                      is actually writing — the one number here that is measured
                      rather than estimated. */}
                  <div className="flex items-baseline justify-between gap-3 w-full">
                    <p className={`text-[11px] text-on-surface-variant leading-tight truncate ${!isPaused && 'animate-pulse'}`}>
                      {isPaused ? `Paused: ${analyzingStep}` : (analyzingStep || 'Generating output...')}
                    </p>
                    {streamChars > 0 && !isPaused && (
                      <span className="text-[10px] font-mono text-on-surface-variant/70 shrink-0 tabular-nums">
                        {(streamChars / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </div>

                  {/* Before output arrives there is genuinely nothing to report,
                      so a skeleton stands in. Once the model starts writing the
                      bar above carries real information and the skeleton would
                      only add noise. */}
                  {!isPaused && streamChars === 0 && (
                    <div className="mt-1 space-y-1.5" aria-hidden="true">
                      <div className="skeleton h-2.5 w-3/4 rounded-full" />
                      <div className="skeleton h-2.5 w-full rounded-full" />
                      <div className="skeleton h-2.5 w-2/3 rounded-full" />
                    </div>
                  )}

                  {/* Measured on a live run: the model spent 4,770 thinking
                      tokens — roughly 68 of 80 seconds — before emitting a single
                      character. Nothing is streaming yet, so the bar is honestly
                      pinned at PRE_STREAM_CEILING for that whole stretch and
                      looks hung. Rather than invent movement, say what is
                      happening. Only appears once the wait is long enough to be
                      worth explaining. */}
                  {!isPaused && streamChars === 0 && elapsedTime >= 20_000 && (
                    <p className="mt-2 text-[10px] leading-snug text-on-surface-variant/70" role="status">
                      The model is still reasoning — it writes nothing until it has planned the
                      whole layout, so the bar holds here until output starts arriving.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          {/* Drop-target feedback while dragging files over the chat pane */}
          <AnimatePresence>
            {isDragging && (
              <motion.div
                variants={backdropVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="absolute inset-0 z-30 m-3 rounded-2xl border-2 border-dashed border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 pointer-events-none"
              >
                <IconUpload size={34} className="text-secondary" />
                <p className="font-label-caps text-[11px] font-bold text-secondary uppercase tracking-wider">Drop to attach</p>
                <p className="text-[10px] text-on-surface-variant">PNG, JPG, PDF or .repx</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Upload and input pill shape at sidebar bottom */}
          <div className="p-3 sm:p-6 border-t border-outline-variant bg-surface-container-lowest/50 backdrop-blur-sm flex flex-col gap-3">
            {/* Attached file staging indicators */}
            {previews.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 px-1 no-scrollbar">
                {previews.map((src, idx) => {
                  const isRepx = src.startsWith('data:application/xml') || src.startsWith('data:text/');
                  return (
                    <div key={idx} className="relative group w-12 h-12 flex-shrink-0 rounded border border-outline-variant shadow-[var(--shadow-sm)] flex items-center justify-center bg-surface-container-lowest">
                      {isRepx ? (
                        <div className="flex flex-col items-center justify-center w-full h-full text-on-surface-variant" title="REPX File">
                          <IconDoc size={18} />
                          <span className="text-[8px] font-bold mt-0.5 uppercase">REPX</span>
                        </div>
                      ) : (
                        <img
                          src={src}
                          alt="Preview"
                          className="w-full h-full object-cover cursor-pointer rounded hover:opacity-85"
                          onClick={() => setFullScreenImage(src)}
                        />
                      )}
                      <button
                        onClick={() => removeFile(idx)}
                        aria-label="Remove attachment"
                        /* Always visible on touch devices — there is no hover
                           there, so the old opacity-0 made this unreachable. */
                        className="u-transition-fast u-press u-focus-ring absolute -top-2 -right-2 w-6 h-6 bg-surface-container-lowest border border-outline-variant hover:bg-red-500 hover:text-white hover:border-red-500 text-on-surface-variant rounded-full shadow-[var(--shadow-sm)] opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 cursor-pointer flex items-center justify-center"
                      >
                        <IconClose size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Text pulled out of the files themselves — a PDF's text layer or
                an uploaded .repx. These carry exact strings and coordinates,
                so they are shown as their own chips rather than hidden. */}
            {attachmentTexts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {attachmentTexts.map((t) => (
                  <span
                    key={t.id}
                    className="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-[10px] text-on-surface-variant max-w-full"
                    title={`${t.label} — exact text extracted from the file`}
                  >
                    <IconDoc size={13} className="text-secondary shrink-0" />
                    <span className="truncate max-w-[160px]">{t.label}</span>
                    <button
                      onClick={() => removeTextAttachment(t.id)}
                      aria-label={`Remove ${t.label}`}
                      className="u-transition-fast u-focus-ring shrink-0 w-4 h-4 rounded-full hover:bg-error hover:text-white flex items-center justify-center cursor-pointer"
                    >
                      <IconClose size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {isIngesting && (
              <p className="text-[10px] text-on-surface-variant px-2 flex items-center gap-1.5">
                <IconReplay size={13} className="animate-spin" />
                Reading files…
              </p>
            )}

            {/* Anything the intake could not use. Previously an unsupported
                drop did nothing at all, with no explanation. */}
            {uploadNotices.length > 0 && (
              <div className="flex flex-col gap-1 px-1">
                {uploadNotices.map((notice, i) => (
                  <p key={i} className="text-[10px] text-on-surface-variant leading-snug flex items-start gap-1.5">
                    <IconWarn size={11} className="text-secondary shrink-0 mt-px" />
                    <span>{notice}</span>
                  </p>
                ))}
              </div>
            )}

            {saveNotice && (
              <p className="text-[10px] text-on-surface-variant leading-snug flex items-start gap-1.5 px-1" role="status">
                <IconCheckCircle size={13} className="text-[color:var(--ok-ink)] shrink-0" />
                <span>{saveNotice}</span>
              </p>
            )}

            <div className="flex items-center gap-2 sm:gap-3 p-1.5 bg-surface-container-lowest rounded-full border border-outline-variant shadow-[var(--shadow-sm)] u-transition focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20 group">
              <div className="flex-1 flex items-center gap-2 pl-2 sm:pl-3 min-w-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="u-transition-fast u-press u-focus-ring shrink-0 w-9 h-9 rounded-full text-on-surface-variant hover:text-secondary hover:bg-surface-container flex items-center justify-center cursor-pointer"
                  title="Attach files"
                  aria-label="Attach files"
                >
                  <IconPaperclip size={20} />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  multiple
                  accept="image/*,application/pdf,.repx"
                />
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const isDisabled = (!isAnalyzing && !isPaused) && (previews.length === 0 && !prompt);
                      if (!isDisabled) {
                        if (isAnalyzing || isPaused) {
                          if (isPaused) handleResume(); else handlePause();
                        } else {
                          handleGenerate();
                        }
                      }
                    }
                  }}
                  placeholder={hasApiKey ? 'Ask a question, or upload a design...' : vaultRecord ? 'Unlock your stored key to start' : 'Add your API key to start'}
                  disabled={!hasApiKey}
                  className="bg-transparent border-none focus:ring-0 text-xs w-full py-2 text-on-surface placeholder-on-surface-variant/50 outline-none min-w-0 disabled:cursor-not-allowed"
                />
              </div>
              <button
                onClick={isAnalyzing || isPaused ? (isPaused ? handleResume : handlePause) : () => handleGenerate()}
                disabled={(!isAnalyzing && !isPaused) && (!hasApiKey || isChatting || isIngesting || (previews.length === 0 && attachmentTexts.length === 0 && !prompt))}
                aria-label={isAnalyzing ? 'Pause analysis' : isPaused ? 'Resume analysis' : 'Generate report'}
                className={`u-transition u-press u-focus-ring shrink-0 text-white p-2 rounded-full w-11 h-11 flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:pointer-events-none hover:brightness-110 ${
                  isPaused ? 'bg-[color:var(--ink-faint)]' : isAnalyzing ? 'bg-yellow-600' : 'bg-secondary-container'
                }`}
              >
                {isAnalyzing || isPaused ? (
                  isPaused ? (
                    <IconPlay size={20} />
                  ) : (
                    <IconPause size={20} />
                  )
                ) : (
                  <IconArrowUp size={20} />
                )}
              </button>
            </div>
            {/* The key gates the entire workspace — chat and generation alike —
                so say so plainly rather than letting the first attempt fail. */}
            {!hasApiKey && (
              <button
                onClick={() => setIsConfigOpen(true)}
                className="u-transition-fast u-focus-ring w-full flex items-start gap-2 text-left px-3 py-2.5 rounded-xl border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] hover:bg-[color:var(--accent-line)] cursor-pointer"
              >
                <IconAlert size={14} className="text-secondary shrink-0 mt-0.5" />
                {/* Signing out clears the session key, but the encrypted copy in
                    the account survives. Telling a returning user to "add your
                    API key" when the app already knows they have one stored made
                    the vault look broken — they had no way to learn that
                    unlocking was even an option. */}
                {vaultRecord ? (
                  <span className="text-[11px] text-on-surface-variant leading-snug">
                    <strong className="text-on-surface">Unlock your stored API key.</strong>{' '}
                    This account has an encrypted key saved. Click here and enter your passphrase —
                    it never left your browser, so only you can unlock it.
                  </span>
                ) : (
                  <span className="text-[11px] text-on-surface-variant leading-snug">
                    <strong className="text-on-surface">Add your Gemini API key to begin.</strong>{' '}
                    Nothing in the workspace can run without it — Forma ships no key of its own.
                    Click here to open Settings.
                  </span>
                )}
              </button>
            )}
            {error && <p className="text-error text-[10px] font-mono px-2 leading-tight">{error}</p>}
          </div>
        </aside>

        {/* Technical Canvas */}
        <div className={`${mobilePane === 'canvas' ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 flex-col bg-surface-bright overflow-hidden`}>
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                /* flex-1 min-h-0, not h-full: the status bar is a sibling below
                   this now, so h-full would size to the whole column and push it
                   off the bottom. min-h-0 is what lets the scroll area inside
                   actually shrink rather than growing the flex item. */
                className="flex-1 min-h-0 flex flex-col overflow-hidden"
              >
                {/* Result header navigation toolbar */}
                <div className="bg-surface-container-lowest px-3 sm:px-6 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-y-2 gap-x-3 shrink-0 shadow-[var(--shadow-sm)] z-10">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                    {/* Hidden below sm rather than truncated. The tab row beside
                        it is shrink-0, so on a phone the title was left with a few
                        pixels and rendered as a single letter and a full stop —
                        "M." for "Mock Invoice Report" — which carries nothing. The
                        tabs and Export are the useful controls at that width. */}
                    <div className="hidden sm:flex items-center gap-2 min-w-0">
                      <IconLayout size={20} className="text-secondary shrink-0" />
                      <span className="font-semibold text-sm tracking-normal text-on-surface truncate" title={result.title || 'Generated Report'}>{result.title || 'Generated Report'}</span>
                    </div>
                    <div className="flex bg-surface-container-low p-1 rounded-full border border-outline-variant shrink-0" role="tablist">
                      {([
                        { id: 'ui', label: 'Overview' },
                        { id: 'spec', label: 'Specs & REPX' },
                      ] as const).map((tab) => (
                        <button
                          key={tab.id}
                          role="tab"
                          aria-selected={activeTab === tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`u-transition-fast u-focus-ring relative px-3 sm:px-4 py-1 rounded-full text-[11px] font-label-caps cursor-pointer whitespace-nowrap ${activeTab === tab.id ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-secondary'}`}
                        >
                          {activeTab === tab.id && (
                            <motion.span
                              layoutId="canvas-tab-pill"
                              className="absolute inset-0 bg-surface-container-lowest shadow-[var(--shadow-sm)] rounded-full"
                              transition={transition.base}
                            />
                          )}
                          <span className="relative">{tab.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={downloadDesign}
                      className="u-tap u-transition-fast u-press u-focus-ring px-4 sm:px-5 py-1.5 bg-secondary-container hover:bg-secondary text-white font-label-caps text-[11px] flex items-center gap-2 rounded-full cursor-pointer shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]"
                    >
                      <IconDownload size={14} />
                      <span className="hidden sm:inline">Export .REPX</span>
                      <span className="sm:hidden">Export</span>
                    </button>
                  </div>
                </div>

                {/* Technical report content dotted canvas */}
                <div className="flex-1 overflow-auto p-3 sm:p-6 bg-surface-bright flex justify-center items-start sheet-grid">
                  <AnimatePresence mode="wait" initial={false}>
                    {activeTab === 'ui' && result.layout ? (
                      <motion.div
                        key="tab-ui"
                        variants={tabPanelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        className="w-full flex justify-center"
                      >
                        {/* No wrapper frame here. ReportMockup already draws its
                            own panel — border, radius, shadow and the grey inset
                            around the page — so this div's border, shadow,
                            rounding and `bg-paper` stacked a second frame around
                            the first: white, then grey, then white, with two
                            borders and two shadows. It owns its own max-width
                            too. */}
                        <ReportMockup layout={result.layout} sourceImages={mockupSourceImages} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="tab-spec"
                        variants={tabPanelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        className="bg-surface-container-lowest p-4 sm:p-8 rounded-2xl shadow-[var(--shadow-lg)] border border-outline-variant max-w-4xl mx-auto w-full overflow-x-auto"
                      >
                        {/* Specification / REPX switch — the tab is named for both. */}
                        <div className="flex items-center gap-1 mb-5 p-1 bg-surface-container-low rounded-full border border-outline-variant w-fit">
                          {([
                            { id: 'spec', label: 'Specification', icon: IconSpec },
                            { id: 'repx', label: 'REPX XML', icon: IconCode },
                          ] as const).map((view) => (
                            <button
                              key={view.id}
                              onClick={() => setSpecView(view.id)}
                              aria-selected={specView === view.id}
                              className={`u-transition-fast u-focus-ring flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-label-caps cursor-pointer ${
                                specView === view.id
                                  ? 'bg-surface-container-highest text-secondary font-bold'
                                  : 'text-on-surface-variant hover:text-secondary'
                              }`}
                            >
                              <view.icon size={13} />
                              {view.label}
                            </button>
                          ))}
                        </div>

                        {specView === 'repx' ? (
                          <RepxViewer xml={result.repxContent || ''} />
                        ) : (
                          <div className="markdown-body prose prose-indigo dark:prose-invert prose-sm md:prose-base max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {result.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 min-h-0 flex flex-col overflow-hidden"
              >
                {/* `sheet-grid`, not `dot-grid`: the dotted ground was drawn from
                    the shadcn-family `--foreground`, and it is the same two-scale
                    drafting grid the marketing pages and the OG card use. */}
                <div className="flex-1 relative sheet-grid p-8 sm:p-12 overflow-auto flex items-center justify-center">
                  <div className="max-w-xl w-full">
                    {/* The eyebrow is the shared marketing primitive, not a
                        restatement of its markup — the coordinate reads in the
                        report's own hundredths-of-an-inch grid. */}
                    <Eyebrow coord="x 000 · y 0000">Canvas</Eyebrow>

                    <div className="relative mt-8 mb-9 w-fit">
                      <div className="w-20 h-20 bg-surface-container-lowest border border-outline-variant shadow-[var(--shadow-md)] rounded-2xl flex items-center justify-center relative z-10">
                        <Logo size={44} alt="Forma" />
                      </div>
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-0 rounded-2xl bg-secondary opacity-20 blur-2xl"
                      />
                    </div>

                    <h3 className="font-display-lg text-[40px] leading-[1.02] font-extrabold tracking-[-0.035em] text-on-surface">
                      Ready to process
                    </h3>
                    <p className="mt-4 mb-10 max-w-md font-body-lg text-[15px] leading-[1.6] text-on-surface-variant">
                      Upload a design in the chat pane — a screenshot, a PDF, or an existing{' '}
                      <span className="font-code-sm text-[13.5px]">.repx</span> — and the spec, mockup
                      and XML land here.
                    </p>

                    {/* The pipeline, and it is the app's own three-beat tagline:
                        show it, build it, ship it. Mapped rather than written out
                        three times — these were three copies of one card that had
                        to be edited in lockstep. */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {([
                        { n: '01', step: 'Show', icon: IconUpload, label: 'Ingest the design' },
                        { n: '02', step: 'Build', icon: IconRuler, label: 'Read the geometry' },
                        { n: '03', step: 'Ship', icon: IconDownload, label: 'Export native REPX' },
                      ] as const).map((s) => (
                        <div
                          key={s.n}
                          className="u-transition group rounded-2xl border border-outline-variant border-b-2 border-b-[color:var(--accent-line)] bg-surface-container-lowest p-5 text-left shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]"
                        >
                          <div className="u-transition mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--accent-wash)] group-hover:bg-[color:var(--accent-line)]">
                            <s.icon size={19} className="text-secondary" />
                          </div>
                          <span className="mb-1 block font-code-sm text-[10.5px] font-medium tracking-[0.15em] uppercase text-secondary">
                            {s.n} {s.step}
                          </span>
                          <span className="font-body-lg text-[13px] leading-[1.5] text-on-surface-variant">
                            {s.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

          {/* One status line for both branches, outside the switch — see
              CanvasStatusBar. It used to be duplicated inside each. */}
          <CanvasStatusBar isAnalyzing={isAnalyzing} isPaused={isPaused} analyzingStep={analyzingStep} />
        </div>
      </main>

      {/* Mobile pane switcher — replaces the side-by-side split below md. */}
      <nav
        className="md:hidden flex-shrink-0 grid grid-cols-2 border-t border-outline-variant bg-surface-container-lowest"
        role="tablist"
        aria-label="Workspace panes"
      >
        {([
          { id: 'chat', label: 'Chat', icon: IconChat },
          { id: 'canvas', label: 'Canvas', icon: IconLayout },
        ] as const).map((pane) => {
          const isActive = mobilePane === pane.id;
          return (
            <button
              key={pane.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setMobilePane(pane.id)}
              className={`u-tap u-transition-fast u-focus-ring relative flex items-center justify-center gap-2 py-3 font-label-caps text-[11px] font-bold cursor-pointer ${
                isActive ? 'text-secondary' : 'text-on-surface-variant'
              }`}
            >
              <pane.icon size={18} />
              {pane.label}
              {pane.id === 'canvas' && result && !isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-secondary" aria-hidden="true" />
              )}
              {isActive && (
                <motion.span
                  layoutId="mobile-pane-underline"
                  className="absolute inset-x-4 top-0 h-0.5 bg-secondary rounded-full"
                  transition={transition.base}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Saved Projects Sidebar Drawer */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/20 z-50 flex justify-end"
          >
            <motion.div
              variants={drawerVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="My projects"
              className="w-full max-w-sm bg-surface-container-lowest h-full shadow-[var(--shadow-lg)] flex flex-col border-l border-outline-variant"
            >
              <div className="p-4 border-b border-outline-variant flex items-center justify-between">
                <div className="flex items-center gap-2 text-on-surface font-bold font-title-md">
                  <IconHistory size={20} className="text-secondary" />
                  <h2>My Projects</h2>
                </div>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="u-tap u-transition-fast u-press u-focus-ring p-2 text-on-surface-variant hover:bg-surface-container rounded-full cursor-pointer flex items-center justify-center"
                  aria-label="Close projects panel"
                >
                  <IconClose size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {savedReports.length === 0 ? (
                  <div className="text-center text-on-surface-variant py-8 font-sans">
                    <IconFolder size={32} className="mb-2 opacity-50 block mx-auto" />
                    <p className="text-xs">No saved projects yet.</p>
                  </div>
                ) : (
                  savedReports.map(report => (
                    <div
                      key={report.id}
                      className="relative group bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:bg-surface-container transition-colors cursor-pointer"
                      onClick={() => handleLoadReport(report)}
                    >
                      <h3 className="font-semibold text-xs mb-1 truncate pr-8 text-on-surface">{report.name}</h3>
                      <p className="text-[10px] text-on-surface-variant font-mono">
                        {new Date(report.timestamp).toLocaleDateString()} at {new Date(report.timestamp).toLocaleTimeString()}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteReport(report.id); }}
                        aria-label={`Delete ${report.name}`}
                        /* Visible by default on touch (no hover to reveal it);
                           fades in on hover for pointer devices. */
                        className="u-tap u-transition-fast u-press u-focus-ring absolute top-2 right-2 p-2 text-on-surface-variant opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 hover:text-error hover:bg-red-500/10 rounded-full cursor-pointer flex items-center justify-center"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {loginModal}
    </div>
  );
}
