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
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconDoc,
  IconDownload,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconHistory,
  IconKey,
  IconMoon,
  IconSearch,
  IconShieldCheck,
  IconSun,
  IconImage,
  IconLayout,
  IconLogin,
  IconLogout,
  IconPaperclip,
  IconPause,
  IconPlay,
  IconPlus,
  IconReplay,
  IconSave,
  IconTrash,
  IconTune,
  IconWarn,
} from './components/landing/icons';
/* `landing/` is the shared marketing design system, not a private folder — see
   CLAUDE.md. Eyebrow is reused here rather than restating its markup. */
import { Eyebrow } from './components/landing/sections';
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
/* Only DURATION survives here. The workspace's motion is now the artifact's own
   CSS keyframes and transitions, so the Framer Motion presets it used to import
   are unused — see the note in CLAUDE.md about this being a deliberate departure
   for this surface. */
import { DURATION } from './lib/motion';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { auth, db, logOut, handleFirestoreError, OperationType } from './services/firebase';
import { collection, onSnapshot, query, setDoc, doc, deleteDoc, getDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import LoginPage from './components/LoginPage';
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
import { pingDesigner, sendToDesigner, designerFileName } from './lib/designerBridge';
import { groupAttachments, groupLabel, type PreviewMeta } from './lib/attachments';

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
  /**
   * Provenance for `images`, so a sent message groups its attachments the same
   * way the composer did. Optional on purpose: reports saved before this existed
   * reload with images and no meta, and `groupAttachments` renders those one per
   * image rather than dropping them.
   */
  imageMeta?: PreviewMeta[];
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
  /**
   * One entry per image in `images`, same order, same length: which upload it
   * came from and which page of it.
   *
   * Kept parallel rather than folded into `images` because that array's shape is
   * depended on all the way downstream — the request parts, `sourceRect`
   * cropping, and the `images` persisted on a saved report all expect bare data
   * URLs. Provenance is presentation, and it stops at the composer.
   */
  imageMeta: PreviewMeta[];
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
async function ingestFile(file: File, uploadId: string): Promise<IngestResult> {
  const out: IngestResult = { images: [], imageMeta: [], texts: [], notices: [] };
  const name = file.name || 'file';

  if (file.size > MAX_FILE_BYTES) {
    out.notices.push(`"${name}" is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB and was skipped.`);
    return out;
  }

  if (file.type.startsWith('image/')) {
    out.images.push(await optimizeImageDataUrl(await readAsDataUrl(file)));
    out.imageMeta.push({ uploadId, file: name });
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
        if (image) {
          out.images.push(image);
          // Same uploadId for every page, so the composer shows one attachment
          // for the file the user actually dropped rather than one per page.
          out.imageMeta.push({ uploadId, file: name, page: n });
        }

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
    /* The artifact's proof frame, applied to the component that owns the page:
       1px --paper-rule, 4px radius, --shadow-lg, 760px measure, registration
       marks. It is here rather than on a wrapper because ReportMockup already
       draws a frame — nesting it inside the artifact's `.wb-proof` produced two
       borders and two shadows, the same double-frame this canvas had before. */
    <div className="wb-reg-marks bg-surface-container-lowest border border-[color:var(--paper-rule)] shadow-[var(--shadow-lg)] rounded-[4px] overflow-hidden w-full max-w-[760px] mx-auto font-sans flex flex-col">
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

/** Which panel the rail's second column is showing. */
type RailPanel = 'review' | 'projects' | 'history';

/**
 * Initials for the rail's account button. Two letters at most — the artifact's
 * avatar is a 30px disc and a third glyph does not fit at that size.
 */
function initialsOf(user: { displayName?: string | null; email?: string | null }): string {
  const source = (user.displayName || user.email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}

export default function App() {
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  /**
   * Provenance for `previews`, index for index. Every write to one must write
   * the other — `removeFile` drops the same indices from both, and the places
   * that clear `previews` clear this too. Separate arrays because only this one
   * is presentation; see `IngestResult.imageMeta`.
   */
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta[]>([]);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>(() => {
    const saved = localStorage.getItem('savedReports');
    return saved ? JSON.parse(saved) : [];
  });
  const [user, setUser] = useState<User | null>(null);
  // Below md the chat and canvas panes cannot sit side by side (the sidebar
  // alone is wider than a 375px viewport), so they become tabs. At md+ this
  // value is ignored and both panes render.
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
  const [showLogin, setShowLogin] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<'signin' | 'signup'>('signin');
  const [currentRoute, setCurrentRoute] = useState(currentPath());
  const [lastViewPath, setLastViewPath] = useState('/');

  /* Which section the rail is showing. Replaces `isSidebarOpen`: the artifact
     puts saved projects and recent sessions in the second column rather than a
     drawer over the canvas. */
  const [railPanel, setRailPanel] = useState<RailPanel>('review');
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
          setRailPanel('review');
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
  /**
   * The attachment being viewed full size. Carries every image of that upload so
   * a multi-page PDF can be paged through in place — the pages exist, they just
   * have no business being five separate chips in the composer.
   */
  const [fullScreenImage, setFullScreenImage] = useState<
    { srcs: string[]; index: number; file: string } | null
  >(null);

  /** Open the viewer on one upload, positioned at `start` within it. */
  const openAttachment = (indices: number[], start: number, file: string) => {
    setFullScreenImage({ srcs: indices.map((i) => previews[i]), index: start, file });
  };

  /** Staged uploads, collapsed back from per-page images. */
  const previewGroups = useMemo(
    () => groupAttachments(previewMeta, previews.length),
    [previewMeta, previews.length]
  );
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
      for (const [i, file] of accepted.entries()) {
        // Identifies this drop for the life of the staged attachment. Two files
        // can share a name, so the name cannot be the key — see attachments.ts.
        const result = await ingestFile(file, `${Date.now()}-${i}-${file.name}`);
        if (result.images.length) {
          setPreviews(prev => [...prev, ...result.images]);
          setPreviewMeta(prev => [...prev, ...result.imageMeta]);
        }
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

  /**
   * Removes a whole upload, not one page of it. The user attached a file; the
   * split into pages is ours, so undoing the attachment has to undo all of it —
   * leaving pages 2..5 of a PDF behind after removing "it" would be its own
   * kind of broken.
   */
  const removeFile = (indices: number[]) => {
    const drop = new Set(indices);
    setPreviews(prev => prev.filter((_, i) => !drop.has(i)));
    setPreviewMeta(prev => prev.filter((_, i) => !drop.has(i)));
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
    setPreviewMeta([]);
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
    setRailPanel('review');
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
    setRailPanel('review');

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
    /*
     * Back to wherever they were, not into the workspace.
     *
     * This hardcoded `/workspace`, so signing in from the docs or the home page
     * threw the person into the editor instead of returning them to what they
     * were doing — signing in is not a statement of intent to start a report. The
     * cancel path beside this one already restored `lastViewPath`; only the
     * success path still forced it, which is the same split CLAUDE.md records
     * from when two copies of this modal drifted ("one restoring lastViewHash and
     * the other hardcoding #workspace").
     *
     * Someone who signed in *from* the workspace still lands back in it, because
     * that is what `lastViewPath` holds for them.
     */
    navigate(lastViewPath || '/');
  }, [lastViewPath]);

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
      images: currentPreviews.length > 0 ? currentPreviews : undefined,
      imageMeta: currentPreviews.length > 0 ? previewMeta : undefined
    };

    setMessages(prev => [...prev, newUserMsg]);
    setPrompt('');
    setPreviews([]);
    setPreviewMeta([]);
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

  /**
   * Whether the generated XML is something a designer can actually open.
   *
   * A generation can return a *complete* JSON object whose `repxContent` string
   * is truncated: `layout.sections` is intact, the spec reads normally, and the
   * XML simply stops mid-element. Observed 2026-08-13 — 896 bytes ending at
   * `Name=`, which parsed as JSON, rendered a mockup, exported happily, and was
   * refused by every designer it was given to.
   *
   * `RepxViewer` has always run this check; the two routes *out* of the app did
   * not, so the only warning was on a tab the user had no reason to open. The
   * failure is silent by construction and this is the cheapest place to make it
   * loud.
   */
  const repxCheck = useMemo(
    () => (result?.repxContent ? checkRepx(result.repxContent) : null),
    [result?.repxContent]
  );

  /**
   * Escape closes the attachment viewer. The backdrop already closes on a click,
   * but the viewer covers the screen and Escape is what a full-bleed overlay is
   * expected to answer to.
   */
  useEffect(() => {
    if (!fullScreenImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreenImage(null);
      // Arrows page through a multi-page upload. Clamped rather than wrapping:
      // wrapping makes it impossible to tell page 1 from page 6 of 6 without
      // reading the counter.
      if (e.key === 'ArrowRight') {
        setFullScreenImage((v) => (v ? { ...v, index: Math.min(v.index + 1, v.srcs.length - 1) } : v));
      }
      if (e.key === 'ArrowLeft') {
        setFullScreenImage((v) => (v ? { ...v, index: Math.max(v.index - 1, 0) } : v));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreenImage]);

  /** Shared by both exits. Returns true when the caller should stop. */
  const blockedByInvalidRepx = (): boolean => {
    if (!repxCheck || repxCheck.ok) return false;
    setError(
      `This generation produced REPX that no designer will open — ${repxCheck.message} ` +
      `That is a bad generation rather than something to repair by hand: generate again, ` +
      `and simplify the design if it keeps happening. The spec and the mockup are still fine to read.`
    );
    return true;
  };

  const downloadDesign = () => {
    if (!result) return;
    if (blockedByInvalidRepx()) return;
    const element = document.createElement("a");
    const file = new Blob([result.repxContent || result.content], { type: result.repxContent ? 'application/xml' : 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${result.title ? result.title.replace(/\s+/g, '_') : 'report-design'}${result.repxContent ? '.repx' : '.txt'}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  /**
   * Whether the RepxDesigner companion is running on this machine. Pinged once
   * on mount; false for everyone who has not installed it, which is the normal
   * case and is why the button it gates simply does not render rather than
   * appearing and failing. Same contract as `canUseVault`.
   */
  const [designerReady, setDesignerReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      pingDesigner().then((ready) => {
        if (!cancelled) setDesignerReady(ready);
      });
    };

    check();

    // Re-check when the tab regains focus. Starting the companion is something
    // the user does *outside* the browser, so a mount-only ping means the button
    // is still missing when they switch back — which reads as the feature having
    // been removed rather than as "nothing is listening yet". Coming back to the
    // tab is exactly the moment to look again.
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
    };
  }, []);

  /**
   * Hand the generated XML straight to the local designer — no download, no file
   * dialog. Only reachable when `designerReady`, and only meaningful when the
   * model actually returned XML: there is nothing for a report designer to open
   * in a plain-text fallback.
   */
  const openInDesigner = async () => {
    if (!result?.repxContent) return;
    if (blockedByInvalidRepx()) return;
    try {
      await sendToDesigner(result.repxContent, designerFileName(result.title));
    } catch (err) {
      setError(
        `Could not reach the report designer on this machine. ` +
        `Start it with \`RepxDesigner.exe --serve\` and try again. ` +
        `(${err instanceof Error ? err.message : String(err)})`
      );
    }
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

  /*
   * The workspace, ported from the approved artifact
   * (claude.ai/code/artifact/77c5245d-3967-43db-bffb-9751b269e2be).
   *
   * Appearance comes entirely from `src/workspace.css`, which is that artifact's
   * own CSS with only its selector names prefixed. Nothing here should carry a
   * hand-written colour, size or spacing value: if something looks wrong, the fix
   * belongs in that file, and the artifact is the reference for what it should be.
   *
   * Three places where the artifact had no equivalent and real behaviour wins,
   * each agreed rather than assumed:
   *   - The canvas renders `ReportMockup` from the model's own layout, inside the
   *     artifact's frame. The artifact's page was a fixed fictional statement.
   *   - Staged attachments, upload notices and errors render here because the app
   *     has them and the artifact never did. They are absent at rest, so the
   *     default view still matches.
   *   - The vault's unlock / sync / forget actions stay inside the artifact's
   *     "Encrypted sync" group; the artifact only drew the passphrase fields.
   *
   * `sheet` supplies the palette (see index.css); `wb-root` the type and ground.
   */
  const plate = activeTab === 'ui' ? 'proof' : specView === 'repx' ? 'xml' : 'spec';
  const showPlate = (next: 'proof' | 'spec' | 'xml') => {
    if (next === 'proof') { setActiveTab('ui'); return; }
    setActiveTab('spec');
    setSpecView(next === 'xml' ? 'repx' : 'spec');
  };
  const railBtn = (panel: RailPanel, label: string, icon: React.ReactNode) => (
    <button
      data-panel={panel}
      aria-current={railPanel === panel}
      title={label}
      aria-label={label}
      onClick={() => setRailPanel(panel)}
    >
      {icon}
    </button>
  );

  return (
    <div className="sheet wb-root wb-shell">
      {/* ============================================================== rail */}
      <nav className="wb-rail" aria-label="Sections">
        {/* The mark is a home link, as it is in SiteHeader on all five marketing
            pages. The artifact drew a plain <img> here, which left the workspace
            with no route back to the site at all — the previous header had this
            on the logo lockup ("Back to Landing Page").

            A plain <a href>, not an onClick: the delegated handler in this file
            turns in-app anchors into client-side navigation, so the link stays
            right-clickable and middle-clickable. */}
        <a href="/" className="wb-mark" title="Back to the home page" aria-label="Forma — home page">
          <Logo size={26} />
        </a>
        {railBtn('review', 'Current report', <IconLayout size={19} />)}
        {railBtn('projects', 'Saved projects', <IconFolder size={19} />)}
        {railBtn('history', 'Recent', <IconHistory size={19} />)}
        <button data-open-config title="Configure" aria-label="Configure" onClick={() => setIsConfigOpen(true)}>
          <IconTune size={19} />
        </button>
        <span className="wb-spacer" />
        <button title="Switch theme" aria-label="Switch theme" onClick={() => setTheme(!isDarkMode)}>
          {isDarkMode ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>

        {/*
          * Signed in: an accent disc with initials — that treatment means
          * "identity". Signed out: a plain rail button, because the accent disc is
          * ALSO what `aria-current` uses for the selected rail section, so an
          * accent-washed circle here read as "signed in" and as "active" at the
          * same time. Three meanings sharing one appearance is why this looked
          * like a logged-in avatar when nobody was logged in.
          *
          * Signed out it also navigates straight to /login rather than opening a
          * menu whose only item is "Sign in".
          */}
        {user ? (
          <>
            <button
              className="wb-avatar"
              aria-label="Account"
              aria-expanded={showWorkspaceProfile}
              title={`${user.displayName || user.email} — account`}
              onClick={(e) => { e.stopPropagation(); setShowWorkspaceProfile(!showWorkspaceProfile); }}
            >
              {initialsOf(user)}
            </button>

            {showWorkspaceProfile && (
              <div className="wb-pop" role="menu" ref={workspaceProfileRef}>
                <div className="wb-who">
                  <b>{user.displayName || 'Signed in'}</b>
                  <span>{user.email}</span>
                </div>
                <button
                  role="menuitem"
                  className="wb-danger"
                  onClick={() => { setShowWorkspaceProfile(false); handleLogOut(); }}
                >
                  <IconLogout size={15} />
                  Sign out
                </button>
              </div>
            )}
          </>
        ) : (
          <a href="/login" title="Sign in" aria-label="Sign in">
            <IconLogin size={19} />
          </a>
        )}
      </nav>

      {/* ============================================================ review */}
      <section
        className="wb-review wb-rise wb-rise-1"
        aria-label="Session"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Always present, whichever panel shows: a new report is reachable from
            anywhere without navigating somewhere else first. */}
        <div className="wb-actions">
          <button
            className="wb-pill wb-pill--accent wb-grow"
            onClick={() => { handleClearChat(); setRailPanel('review'); }}
          >
            <IconPlus size={14} />
            New report
          </button>
          <button
            className="wb-pill wb-pill--outline"
            title="Search projects"
            aria-label="Search projects"
            onClick={() => setRailPanel('projects')}
          >
            <IconSearch size={14} />
          </button>
        </div>

        {/* ------------------------------------------------ current session */}
        <div className={`wb-panel-body${railPanel === 'review' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <span className="wb-col-title">Review</span>
            <span className="wb-kicker">{messages.length === 1 ? '1 note' : `${messages.length} notes`}</span>
          </div>

          <div className="wb-thread">
            {messages.map((msg) => (
              <article key={msg.id} className={`wb-note${msg.role === 'user' ? ' wb-note--me' : ''}`}>
                <span className="wb-spine" />
                <div>
                  <div className="wb-who">{msg.role === 'user' ? 'You' : 'Forma'}</div>
                  {msg.text && <p>{msg.text}</p>}

                  {msg.images && msg.images.length > 0 && (
                    // Sent messages showed a count and nothing else, so once a
                    // message was on the transcript there was no way to check
                    // what had gone with it. Names are not kept on a message —
                    // `ChatMessage.images` is data URLs only, and a saved report
                    // reloads with just those — so the picture is the label.
                    <div className="wb-attach-strip">
                      {groupAttachments(msg.imageMeta ?? [], msg.images.length).map((group) => {
                        const label = groupLabel(group);
                        const srcs = group.indices.map((i) => msg.images![i]);
                        return (
                          <button
                            key={`${group.file}-${group.indices[0]}`}
                            type="button"
                            className="wb-attach-shot"
                            onClick={() => setFullScreenImage({ srcs, index: 0, file: group.file })}
                            title={`View ${label}`}
                            aria-label={`View ${label}`}
                          >
                            <img src={srcs[0]} alt="" />
                            {group.pages > 1 && <span className="wb-attach-pages">{group.pages}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* The failure belongs beside the turn that failed. */}
                  {msg.error && (
                    <p role="alert" style={{ color: 'var(--bad-ink)' }}>
                      {msg.error}{' '}
                      <button
                        className="wb-pill wb-pill--outline"
                        onClick={() => handleRetryMessage(msg.id)}
                        disabled={isChatting || isAnalyzing}
                      >
                        Try again
                      </button>
                    </p>
                  )}
                </div>
              </article>
            ))}

            {isChatting && !isAnalyzing && (
              <article className="wb-note" aria-live="polite">
                <span className="wb-spine" />
                <div>
                  <div className="wb-who">Forma</div>
                  <p>{streamingReply || 'Thinking…'}</p>
                </div>
              </article>
            )}

            {/* Generation. The bar reports only what has actually arrived. */}
            {(isAnalyzing || isPaused) && (
              <div className={`wb-progress${isPaused ? ' wb-is-paused' : ''}`} aria-live="polite">
                <div className="wb-top">
                  <span className="wb-state">
                    <span>{isPaused ? <IconPause size={17} /> : <IconReplay size={17} className="wb-spin" />}</span>
                    <b>{isPaused ? 'Analysis paused' : streamChars > 0 ? 'Writing report' : 'Reading your design'}</b>
                  </span>
                  <span className="wb-clock">{formatElapsed(elapsedTime)}</span>
                  <span className="wb-acts">
                    <button
                      className="wb-tool"
                      title={isPaused ? 'Resume' : 'Pause'}
                      aria-label={isPaused ? 'Resume analysis' : 'Pause analysis'}
                      onClick={isPaused ? handleResume : handlePause}
                    >
                      {isPaused ? <IconPlay size={15} /> : <IconPause size={15} />}
                    </button>
                    <button className="wb-tool" title="Stop &amp; reset" aria-label="Stop analysis" onClick={handleStop}>
                      <IconClose size={15} />
                    </button>
                  </span>
                </div>

                <div className="wb-track">
                  <i style={{ transform: `scaleX(${analyzingProgress / 100})` }} />
                </div>

                <div className="wb-stage">
                  <span>{analyzingStep || 'Analyzing input request and images…'}</span>
                  <span className="wb-chars">{streamChars > 0 ? `${streamChars.toLocaleString()} chars` : ''}</span>
                </div>

                {/* Before output arrives there is nothing real to report, so a
                    skeleton stands in rather than a bar that invents movement. */}
                {!isPaused && streamChars === 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-hidden="true">
                    <span className="wb-skeleton" style={{ width: '74%' }} />
                    <span className="wb-skeleton" style={{ width: '100%' }} />
                    <span className="wb-skeleton" style={{ width: '64%' }} />
                  </div>
                )}

                {/* Only once the wait is long enough to be worth explaining. */}
                {!isPaused && streamChars === 0 && elapsedTime >= 20_000 && (
                  <p className="wb-why">
                    The model is still thinking — it can spend most of a run reasoning before
                    emitting a character. Nothing is streaming yet, so the bar is honestly
                    pinned rather than pretending to move.
                  </p>
                )}
              </div>
            )}
          </div>

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
                  return (
                    <span key={`${group.file}-${first}`} className="wb-attach wb-attach--file">
                      <button
                        type="button"
                        className="wb-attach-open"
                        onClick={() => openAttachment(group.indices, 0, group.file)}
                        title={`View ${label}`}
                        aria-label={`View ${label}`}
                      >
                        <img className="wb-attach-thumb" src={previews[first]} alt="" />
                        <span className="wb-attach-name">{group.file}</span>
                        {group.pages > 1 && <span className="wb-attach-count">{group.pages} pages</span>}
                      </button>
                      <button
                        onClick={() => removeFile(group.indices)}
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
            {attachmentTexts.length > 0 && (
              <div className="wb-chip-row">
                {attachmentTexts.map((att) => (
                  <span key={att.id} className="wb-attach">
                    <IconDoc size={13} />
                    {att.label}
                    <button onClick={() => removeTextAttachment(att.id)} title="Remove" aria-label="Remove attachment">
                      <IconClose size={11} />
                    </button>
                  </span>
                ))}
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
                onChange={handleFileChange}
                className="wb-hidden"
              />
              <input
                className="wb-line"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
                disabled={!hasApiKey}
                placeholder={hasApiKey ? 'Describe a change…' : 'Add your API key to start'}
                aria-label="Describe a change"
              />
              <button
                className="wb-send"
                aria-label="Send note"
                /* Wrapped: handleGenerate's first parameter is an optional prompt
                   override, and passing it bare hands it the click event. */
                onClick={() => handleGenerate()}
                disabled={!hasApiKey || isAnalyzing || isIngesting}
              >
                <IconArrowUp size={15} />
              </button>
            </div>

            {!hasApiKey && (
              <button className="wb-gate" onClick={() => setIsConfigOpen(true)}>
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
        </div>

        {/* ------------------------------------------------- saved projects */}
        <div className={`wb-panel-body${railPanel === 'projects' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <span className="wb-col-title">Projects</span>
            <span className="wb-kicker">{savedReports.length} saved</span>
          </div>
          <div className="wb-search">
            <IconSearch size={14} />
            <span>{savedReports.length ? 'Search by name or content…' : 'Nothing saved yet'}</span>
          </div>
          <div className="wb-list">
            {savedReports.length === 0 ? (
              <div className="wb-empty">No saved projects yet.</div>
            ) : (
              savedReports.map((report) => (
                <div
                  key={report.id}
                  className={`wb-card${result?.title === report.name ? ' wb-is-open' : ''}`}
                  onClick={() => handleLoadReport(report)}
                >
                  <div className="wb-nm">{report.name}</div>
                  <div className="wb-sub">{new Date(report.timestamp).toLocaleDateString()}</div>
                  <div className="wb-row-actions">
                    <button
                      className="wb-danger"
                      aria-label={`Delete ${report.name}`}
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteReport(report.id); }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* -------------------------------------------------------- recent */}
        <div className={`wb-panel-body${railPanel === 'history' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <span className="wb-col-title">Recent</span>
            <span className="wb-kicker">this week</span>
          </div>
          <div className="wb-list" style={{ paddingTop: 0 }}>
            {savedReports.length === 0 ? (
              <div className="wb-empty">Nothing yet.</div>
            ) : (
              savedReports.map((report) => (
                <div key={report.id} className="wb-card" onClick={() => handleLoadReport(report)}>
                  <div className="wb-nm">{report.name}</div>
                  <div className="wb-sub">
                    {new Date(report.timestamp).toLocaleTimeString()} · {report.messages.length} notes
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ============================================================= bench */}
      <main className="wb-bench">
        <div className="wb-bench-bar">
          <div className="wb-doc-id">
            <h1>{result?.title || 'Untitled report'}</h1>
            {result && <span className="wb-rev">{result.layout?.sections?.length ?? 0} bands</span>}
          </div>

          {result && (
            <div className="wb-plates" role="tablist" aria-label="View">
              <button role="tab" aria-selected={plate === 'proof'} onClick={() => showPlate('proof')}>Mockup</button>
              <button role="tab" aria-selected={plate === 'spec'} onClick={() => showPlate('spec')}>Spec</button>
              <button role="tab" aria-selected={plate === 'xml'} onClick={() => showPlate('xml')}>REPX</button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {saveNotice && (
              <span className="wb-saved">
                <IconCheck size={13} />
                Saved
              </span>
            )}
            <button
              className="wb-pill wb-pill--outline"
              onClick={handleSaveReport}
              disabled={!result && messages.length === 0}
            >
              <IconSave size={14} />
              Save
            </button>
            {/* Only when the local companion answered on mount — see
                designerBridge.ts. Everyone else gets Export and nothing else. */}
            {designerReady && (
              <button
                className="wb-pill wb-pill--outline"
                onClick={openInDesigner}
                disabled={!result?.repxContent}
                title="Open this report in the DevExpress designer on this machine"
              >
                <IconExternal size={14} />
                Open in designer
              </button>
            )}
            <button className="wb-pill wb-pill--accent" onClick={downloadDesign} disabled={!result}>
              <IconDownload size={14} />
              Export .repx
            </button>
          </div>
        </div>

        <div className="wb-bench-body">
          {result ? (
            <>
              {plate === 'proof' && (
                <div className="wb-proof-holder wb-rise wb-rise-2">
                  <div className="wb-glow" style={{ inset: '-90px -70px auto -70px', height: 320 }} aria-hidden="true" />
                  {/* ReportMockup sits directly in the holder — it carries the
                      artifact's proof frame itself (see its root), so wrapping it
                      in `.wb-proof` would draw that frame twice. */}
                  <ReportMockup layout={result.layout!} sourceImages={mockupSourceImages} />
                </div>
              )}

              {plate === 'spec' && (
                <div className="wb-sheet wb-reg-marks">
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown>
                  </div>
                </div>
              )}

              {plate === 'xml' && (
                <div className="wb-sheet wb-reg-marks">
                  <RepxViewer xml={result.repxContent || ''} />
                </div>
              )}
            </>
          ) : (
            <div className="wb-proof-holder wb-rise wb-rise-2">
              <div className="wb-glow" style={{ inset: '-90px -70px auto -70px', height: 320 }} aria-hidden="true" />
              <div className="wb-sheet wb-reg-marks">
                <Eyebrow coord="x 000 · y 0000">Canvas</Eyebrow>
                <h3 style={{ marginTop: 22 }}>Ready to process</h3>
                <p>
                  Upload a design in the review pane — a screenshot, a PDF, or an existing{' '}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>.repx</span> — and the spec,
                  mockup and XML land here.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ======================================================= status bar */}
      <div className="wb-status">
        <span className="wb-live">
          <span
            className="wb-pip"
            style={{ background: isAnalyzing && !isPaused ? 'var(--warn)' : isPaused ? 'var(--ink-faint)' : 'var(--ok-ink)' }}
          />
          {isAnalyzing && !isPaused ? 'Processing' : isPaused ? 'Paused' : 'Idle'}
        </span>
        <span>{config.version ? `DevExpress v${config.version}` : ''}</span>
        <span>{isAnalyzing ? formatElapsed(elapsedTime) : ''}</span>
        <span className="wb-push" />
        <span>units 100/in</span>
        {result?.layout && <span>{result.layout.sections.length} bands</span>}
      </div>

      {/* =========================================================== modals */}
      {isConfigOpen && (
        <div className="wb-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismissConfigWithoutSaving(); }}>
          <div className="wb-modal wb-reg-marks" role="dialog" aria-modal="true" aria-labelledby="config-title">
            <div className="wb-modal-head">
              <h2 id="config-title">Report configuration</h2>
              <button className="wb-pill wb-pill--round" onClick={dismissConfigWithoutSaving} aria-label="Close without saving">
                <IconClose size={16} />
              </button>
            </div>

            <div className="wb-modal-body">
              <div className="wb-fset">
                <div className="wb-eyebrow"><b>x 000</b>Output<span className="wb-fade" /></div>
                <div>
                  <label className="wb-lbl" htmlFor="cfg-ver">DevExpress version</label>
                  <span className="wb-sel">
                    <select
                      className="wb-ctl"
                      id="cfg-ver"
                      value={config.version}
                      onChange={(e) => setConfig({ ...config, version: e.target.value })}
                    >
                      <option value="24.1">v24.1</option>
                      <option value="23.2">v23.2</option>
                      <option value="23.1">v23.1</option>
                      <option value="22.2">v22.2</option>
                      {/* 20.1 is here because the target ERP is built against
                          DevExpress.XtraReports.v20.1 and its templates declare
                          SerializerVersion 20.1.3.0. A newer .repx does not open
                          in an older designer, so without this option Forma
                          cannot produce a file that ERP can edit. */}
                      <option value="20.1">v20.1</option>
                    </select>
                    <IconChevronDown size={13} className="wb-caret" />
                  </span>
                </div>
                <div className="wb-grid2">
                  <div>
                    <label className="wb-lbl" htmlFor="cfg-unit">Report unit</label>
                    <span className="wb-sel">
                      <select
                        className="wb-ctl"
                        id="cfg-unit"
                        value={config.unit}
                        onChange={(e) => setConfig({ ...config, unit: e.target.value })}
                      >
                        <option value="HundredthsOfAnInch">HundredthsOfAnInch</option>
                        <option value="TenthsOfAMillimeter">TenthsOfAMillimeter</option>
                        <option value="Pixels">Pixels</option>
                      </select>
                      <IconChevronDown size={13} className="wb-caret" />
                    </span>
                  </div>
                  <div>
                    <label className="wb-lbl" htmlFor="cfg-page">Page size</label>
                    <span className="wb-sel">
                      <select
                        className="wb-ctl"
                        id="cfg-page"
                        value={config.pageSize}
                        onChange={(e) => setConfig({ ...config, pageSize: e.target.value })}
                      >
                        <option value="Letter">Letter</option>
                        <option value="A4">A4</option>
                        <option value="Legal">Legal</option>
                      </select>
                      <IconChevronDown size={13} className="wb-caret" />
                    </span>
                  </div>
                </div>
              </div>

              <div className="wb-fset">
                <div className="wb-eyebrow"><b>y 0000</b>Header<span className="wb-fade" /></div>
                <label className="wb-checkrow">
                  <input
                    type="checkbox"
                    checked={!!config.header?.showCompanyLogo}
                    onChange={(e) => setConfig({ ...config, header: { ...config.header, showCompanyLogo: e.target.checked } })}
                  />
                  Include company logo
                </label>
                <div>
                  <label className="wb-lbl" htmlFor="cfg-title">Report title</label>
                  <input
                    className="wb-ctl"
                    id="cfg-title"
                    type="text"
                    placeholder="e.g., Monthly Sales Report"
                    value={config.header?.title || ''}
                    onChange={(e) => setConfig({ ...config, header: { ...config.header, title: e.target.value } })}
                  />
                </div>
              </div>

              <div className="wb-fset">
                <div className="wb-eyebrow"><b>y 0474</b>Footer<span className="wb-fade" /></div>
                <label className="wb-checkrow">
                  <input
                    type="checkbox"
                    checked={!!config.footer?.showPageNumbers}
                    onChange={(e) => setConfig({ ...config, footer: { ...config.footer, showPageNumbers: e.target.checked } })}
                  />
                  Include page numbers
                </label>
                <div>
                  <label className="wb-lbl" htmlFor="cfg-foot">Custom footer text</label>
                  <input
                    className="wb-ctl"
                    id="cfg-foot"
                    type="text"
                    placeholder="e.g., Confidential Document"
                    value={config.footer?.customText || ''}
                    onChange={(e) => setConfig({ ...config, footer: { ...config.footer, customText: e.target.value } })}
                  />
                </div>
              </div>

              <div className="wb-fset">
                <div className="wb-eyebrow"><b>key</b>Your Gemini key<span className="wb-fade" /></div>
                <div>
                  <label className="wb-lbl" htmlFor="cfg-key">
                    API key <span className="wb-req">(required)</span>
                  </label>
                  <div className="wb-keyrow">
                    <span className="wb-wrap">
                      <input
                        className="wb-ctl"
                        id="cfg-key"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="AIzaSy…"
                        style={{ paddingRight: 38 }}
                        value={config.customApiKey || ''}
                        onChange={(e) => setConfig({ ...config, customApiKey: e.target.value })}
                      />
                      <button
                        className="wb-peek"
                        onClick={() => setShowApiKey(!showApiKey)}
                        aria-label={showApiKey ? 'Hide key' : 'Show key'}
                      >
                        {showApiKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                      </button>
                    </span>
                    <button className="wb-pill wb-pill--outline" onClick={handleCheckKey}>Check key</button>
                    {hasApiKey && (
                      <button className="wb-pill" onClick={handleClearKeyFromSession} title="Clear the key from this tab">
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {keyCheck && (
                  <div className={`wb-note-line ${keyCheck.tone === 'ok' ? 'wb-ok' : 'wb-warn'}`}>
                    <span className="wb-ic">{keyCheck.tone === 'ok' ? <IconCheck size={13} /> : <IconAlert size={13} />}</span>
                    <span>{keyCheck.text}</span>
                  </div>
                )}

                <div className="wb-note-line">
                  <span className="wb-ic"><IconKey size={13} /></span>
                  <span>
                    The key goes from this browser straight to Google. It is held for this tab
                    only and never written to disk.
                  </span>
                </div>
              </div>

              {canUseVault && (
                <div className="wb-fset">
                  <div className="wb-eyebrow"><b>opt in</b>Encrypted sync<span className="wb-fade" /></div>
                  <div className="wb-grid2">
                    <div>
                      <label className="wb-lbl" htmlFor="cfg-pass">Passphrase</label>
                      <input
                        className="wb-ctl"
                        id="cfg-pass"
                        type="password"
                        placeholder="At least 8 characters"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="wb-lbl" htmlFor="cfg-pass2">Confirm</label>
                      <input
                        className="wb-ctl"
                        id="cfg-pass2"
                        type="password"
                        placeholder="Confirm passphrase"
                        value={passphraseConfirm}
                        onChange={(e) => setPassphraseConfirm(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* The artifact drew the fields; these are the actions behind them. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="wb-pill wb-pill--outline" onClick={handleSyncKeyToAccount} disabled={vaultBusy}>
                      <IconShieldCheck size={14} />
                      {vaultRecord ? 'Replace stored key' : 'Store encrypted'}
                    </button>
                    {vaultRecord && (
                      <>
                        <button className="wb-pill wb-pill--outline" onClick={handleUnlockKey} disabled={vaultBusy}>Unlock</button>
                        <button className="wb-pill" onClick={handleForgetStoredKey} disabled={vaultBusy}>Forget</button>
                      </>
                    )}
                  </div>

                  {vaultNotice && (
                    <div className={`wb-note-line ${vaultNotice.tone === 'ok' ? 'wb-ok' : 'wb-warn'}`}>
                      <span className="wb-ic">{vaultNotice.tone === 'ok' ? <IconCheck size={13} /> : <IconAlert size={13} />}</span>
                      <span>{vaultNotice.text}</span>
                    </div>
                  )}

                  {/* Stated plainly because it is true and unrecoverable. */}
                  <div className="wb-note-line wb-warn">
                    <span className="wb-ic"><IconWarn size={13} /></span>
                    <span>
                      <b>There is no reset.</b> Your passphrase never leaves this browser, so if you
                      forget it the stored key cannot be recovered — by you or by anyone running Forma.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="wb-modal-foot">
              <button className="wb-pill wb-pill--outline" onClick={dismissConfigWithoutSaving}>Cancel</button>
              <button className="wb-pill wb-pill--accent" onClick={saveConfigAndClose}>Save configuration</button>
            </div>
          </div>
        </div>
      )}

      {fullScreenImage && (
        <div className="wb-backdrop" onMouseDown={() => setFullScreenImage(null)}>
          {/* stopPropagation so only the backdrop closes: the image itself is the
              thing being examined, and closing on a click into it makes zooming
              or dragging feel broken. Escape closes too — see the effect above. */}
          <figure className="wb-lightbox" onMouseDown={(e) => e.stopPropagation()}>
            <img
              src={fullScreenImage.srcs[fullScreenImage.index]}
              alt={`${fullScreenImage.file}${
                fullScreenImage.srcs.length > 1 ? `, page ${fullScreenImage.index + 1}` : ''
              }`}
            />
            <figcaption>
              {fullScreenImage.srcs.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setFullScreenImage((v) => (v ? { ...v, index: Math.max(v.index - 1, 0) } : v))
                  }
                  disabled={fullScreenImage.index === 0}
                  title="Previous page"
                  aria-label="Previous page"
                >
                  <IconChevronDown size={13} className="wb-rot-cw" />
                </button>
              )}
              <span>
                {fullScreenImage.file}
                {fullScreenImage.srcs.length > 1 &&
                  ` · page ${fullScreenImage.index + 1} of ${fullScreenImage.srcs.length}`}
              </span>
              {fullScreenImage.srcs.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setFullScreenImage((v) =>
                      v ? { ...v, index: Math.min(v.index + 1, v.srcs.length - 1) } : v
                    )
                  }
                  disabled={fullScreenImage.index === fullScreenImage.srcs.length - 1}
                  title="Next page"
                  aria-label="Next page"
                >
                  <IconChevronDown size={13} className="wb-rot-ccw" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setFullScreenImage(null)}
                title="Close (Esc)"
                aria-label="Close attachment view"
              >
                <IconClose size={13} />
              </button>
            </figcaption>
          </figure>
        </div>
      )}

      {loginModal}
    </div>
  );
}
