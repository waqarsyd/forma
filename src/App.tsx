/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
// Only for the theme swap: a view transition snapshots the DOM around its
// callback, so the state change has to land inside it rather than on React's
// own schedule. See setTheme.
import { flushSync } from 'react-dom';
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
  IconChevronsLeft,
  IconChevronsRight,
  IconClose,
  IconCopy,
  IconDoc,
  IconDownload,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconHistory,
  IconStack,
  IconKey,
  IconMoon,
  IconSearch,
  IconShieldCheck,
  IconSun,
  IconImage,
  IconLayout,
  IconLogin,
  IconLogout,
  IconPanelLeft,
  IconPaperclip,
  IconPause,
  IconPlay,
  IconPlus,
  IconSave,
  IconTrash,
  IconTune,
  IconWarn,
} from './components/landing/icons';
/* `landing/` is the shared marketing design system, not a private folder — see
   CLAUDE.md. Eyebrow is reused here rather than restating its markup. */
import { Eyebrow } from './components/landing/sections';
/*
 * Types only — erased at compile time, so this line costs nothing at runtime and
 * does NOT pull the service into the eager chunk. The values it used to import
 * alongside them (`analyzeReportDesign`, `chatReply`, `validateApiKey`,
 * `MissingApiKeyError`) now arrive through `loadGemini()` below, which is what
 * keeps the 19.6 kB mega-prompt off the landing page. Adding a value back to
 * this import undoes that silently; the entry-chunk budget in
 * scripts/check-bundle-size.mjs is what would catch it.
 */
import type {
  ReportLayout,
  ReportElement,
  ReportConfig,
  SourceRect,
  StreamProgress,
  ChatTurn,
} from './services/geminiService';
import { loadGemini, isMissingApiKey } from './lib/geminiClient';
/* Eager on purpose: cleared from a synchronous effect. See lib/modelCache.ts. */
import { clearCachedModel } from './lib/modelCache';
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
import { circularThemeSwap } from './lib/themeTransition';
// @ts-ignore
/* Firebase arrives on demand — see lib/firebaseClient.ts for why, and for what
   had to move with it. `OperationType` is the one piece that stays eager: it is
   an enum, so referencing a member is a value reference that would pull the SDK
   back into this chunk unaided. */
import { loadFirebase, type FirebaseClient } from './lib/firebaseClient';
import { OperationType } from './lib/firestoreOps';
import {
  toFirestoreDocument,
  fromFirestoreDocument,
  reportDisplayName,
  saveReportsLocally,
  loadReportsLocally,
} from './lib/savedReport';
import { loadPdfjs } from './lib/pdf';
import { toAttachmentParts } from './lib/attachmentParts';
import {
  startProgress,
  tickSimulated,
  applyStreamProgress,
  finishProgress,
  stepLabel,
  IDLE_PROGRESS,
  STEP_INTERVAL_MS,
  type GenerationProgress,
} from './lib/generationProgress';
// react-markdown lives behind this boundary; see src/components/Markdown.tsx.
const Markdown = lazy(() => import('./components/Markdown'));
import { User } from 'firebase/auth';
/* Lazy for the same reason as the loader above, not for their own size: both
   import `services/firebase` directly, and a static import of either would pull
   the SDK straight back into the entry chunk and undo the deferral. Both are
   modals — neither can be on screen at first paint. */
const LoginPage = lazy(() => import('./components/LoginPage'));
const AccountDialog = lazy(() => import('./components/AccountDialog'));
/* The paginated print preview. Lazy because it is reachable only from the
   workspace with a finished report, and it carries its own print stylesheet. */
const ReportPreview = lazy(() => import('./components/ReportPreview'));
/* The binding screen. Lazy for the same reason as the preview: workspace-only,
   reachable only with a finished report, and it carries its own styles. */
const DataBinding = lazy(() => import('./components/DataBinding'));
/* Batch intake. Lazy for the same reason as the other two, and it carries the
   ZIP writer, which nobody generating a single report ever needs. */
const BatchPanel = lazy(() => import('./components/BatchPanel'));
import { useFocusTrap } from './components/useFocusTrap';
import LandingPage from './components/LandingPage';
/* Lazy as of 2026-09-05, measured: these five were 105 kB of a 597 kB entry
   chunk, and a visitor renders exactly one of the six. Sourcemap attribution put
   DocsPage at 40,891 B, FeaturesPage at 34,498 and ContactPage at 20,269 — every
   one of them downloaded by someone who opened /workspace and will never see a
   marketing page.

   `LandingPage` stays eager, deliberately. It is the default route, so deferring
   it puts a second round trip in front of the home page's first paint — the one
   page that cannot afford one, and the reason index.html carries a pre-paint
   theme resolver at all. 24 kB is a fair price for that.

   The `LegalDoc` import below must stay a TYPE import. Making it a value import
   again pulls LegalPage straight back into the entry chunk, exactly as a static
   import of `services/firebase` would undo that deferral, and nothing would
   report it except this chunk's budget. */
const FeaturesPage = lazy(() => import('./components/FeaturesPage'));
const DocsPage = lazy(() => import('./components/DocsPage'));
const ContactPage = lazy(() => import('./components/ContactPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage'));
import type { LegalDoc } from './components/LegalPage';
import Logo from './components/Logo';
import { currentPath, navigate, onRouteChange, migrateLegacyHashUrl } from './lib/router';
import { titleForRoute, viewForRoute } from './lib/routes';
/* App.tsx's own view state, extracted so it can be tested — see the header of
   each for the failure it was carrying while it lived here. */
import { plateFor, stateForPlate, type Plate, type ActiveTab, type SpecView } from './lib/workspaceView';
import { countStagedUploads, admitFiles } from './lib/attachmentBudget';
// Pure helpers live in src/lib so they can be unit-tested without importing the
// whole app (and pdf.js, and Firebase) into a test run.
import { formatXml, tokenizeXml, checkRepx } from './lib/repx';
import { readBoundFields } from './lib/repxBindingPlan';
import { auditRepx } from './lib/repxAudit';
import { sourceRectFor } from './lib/sourceRect';
import { pingDesigner, sendToDesigner, designerFileName, launchDesigner, waitForDesigner } from './lib/designerBridge';
import { groupAttachments, groupLabel, type PreviewMeta } from './lib/attachments';
import { formatSessionStamp } from './lib/datetime';
import { unitsToPx, pointsToUnits, pdfTopFromBaseline, unitsPerInch } from './lib/reportGeometry';
import LogoPulse from './components/LogoPulse';
import { mergeStoredConfig, toPersistable, STORAGE_KEY as CONFIG_STORAGE_KEY } from './lib/reportConfigStore';
import {
  clampReviewWidth,
  readReviewWidth,
  REVIEW_DEFAULT_WIDTH,
  REVIEW_MIN_WIDTH,
  REVIEW_MAX_WIDTH,
} from './lib/panelSize';

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
/**
 * PDF points are 1/72"; the report grid is whatever `ReportUnit` says.
 *
 * Was a `100 / 72` constant, which hardcoded hundredths-of-an-inch into the one
 * part of the pipeline whose output the prompt tells the model to use verbatim
 * as `LocationFloat`. `pointsToUnits` in `src/lib/reportGeometry.ts` replaces
 * it, and unlike the constant it is under test.
 */
/** Cap on extracted strings per page, so a dense page cannot flood the prompt. */
const MAX_TEXT_ITEMS_PER_PAGE = 400;

/**
 * Firestore's hard ceiling is 1,048,576 bytes per document. This leaves headroom
 * for the field names, the id/name/timestamp fields and UTF-8 expansion, so a
 * save that passes this check is not going to be rejected for size alone.
 */
const CLOUD_SAVE_BUDGET_BYTES = 900_000;

/**
 * A non-visual attachment: a PDF's text layer, or the contents of a .repx.
 *
 * `uploadId` is the same id the upload's page images carry in `PreviewMeta`,
 * and it is what ties the two lists back together. Without it the composer had
 * no way to tell that eight "page N text" entries and eight page images were
 * one file the user dropped, so it drew sixteen chips for one PDF.
 */
interface TextAttachment {
  id: string;
  uploadId: string;
  /** Source filename. Display is derived from this, never stored pre-formatted. */
  file: string;
  /** 1-based page number, for text recovered page by page. */
  page?: number;
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
  pageNumber: number,
  reportUnit?: string
): Promise<{ text: string; omitted: number } | null> {
  const toUnits = (points: number) => Math.round(pointsToUnits(points, reportUnit));
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
      // pdf.js sets a text item's height to hypot(trm[2], trm[3]) — the text
      // transform's vertical scale, which is the font's EM SIZE in points, not
      // the height of the ink. So this one number is both the box height and
      // the exact font size, and the prompt is told to use it as both. It is 0
      // only for vertical fonts, which the same code path leaves unsized.
      const h = item.height || 0;
      const yTop = pdfTopFromBaseline(baselineY, h, pageHeightPt);

      lines.push(
        `"${str.replace(/"/g, "'")}" x=${toUnits(x)} ` +
        `y=${toUnits(yTop)} ` +
        `w=${toUnits(item.width || 0)} ` +
        `h=${toUnits(h)}`
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
      `Page is ${toUnits(base.width)} x ${toUnits(pageHeightPt)} report units. ` +
      `Coordinates are already in report units (${reportUnit || 'HundredthsOfAnInch'}), origin at the top-left of the paper.\n` +
      `h is the font's em size taken from the file, so it is each string's EXACT font size as well as its height — ` +
      `use it rather than estimating a size from the page image.\n` +
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
async function ingestFile(file: File, uploadId: string, reportUnit?: string): Promise<IngestResult> {
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
      // Loaded here rather than imported at the top: pdf.js is the largest
      // dependency in the project and this is the only place it is used, so a
      // static import put a PDF engine in front of every visitor to the landing
      // page. See src/lib/pdf.ts.
      const pdfjs = await loadPdfjs();
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

        const extracted = await extractPdfPageText(page, n, reportUnit);
        if (extracted) {
          out.texts.push({ id: `${Date.now()}-${name}-p${n}`, uploadId, file: name, page: n, text: extracted.text });
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
      uploadId,
      file: name,
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
            !status.ok
              ? 'text-[color:var(--bad-ink)] border-[color:var(--bad-line)] bg-[color:var(--bad-wash)]'
              : status.warnings.length
                // Valid, opens fine, will not look like the design. A third
                // state, because colouring it green hides the finding and
                // colouring it red says the file is broken when it is not.
                ? 'text-[color:var(--warn-ink,var(--bad-ink))] border-[color:var(--rule-strong)] bg-[color:var(--track)]'
                : 'text-[color:var(--ok-ink)] border-[color:var(--ok-line)] bg-[color:var(--ok-wash)]'
          }`}
        >
          {status.ok && !status.warnings.length ? <IconCheckCircle size={14} /> : <IconAlert size={14} />}
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

      {/* What will not look like the design. Listed rather than counted: "3
          elements do not fit" is not actionable, and the name of the control is
          the thing that makes it findable in the designer. */}
      {status.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3">
          {status.warnings.map((warning, i) => (
            <li key={i} className="flex gap-2 text-[11.5px] leading-[1.5] text-on-surface-variant">
              <span className="mt-[3px] shrink-0 text-[color:var(--ink-faint)]"><IconAlert size={12} /></span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

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
  reportUnit,
}: {
  layout: ReportLayout;
  /** The user's uploaded images, so `sourceRect` crops can be resolved. */
  sourceImages?: string[];
  /**
   * The `ReportUnit` the layout's numbers are in. Was a bare `0.96` at eight
   * call sites — correct for the default (1/100" ÷ 1/96" = 0.96) and silently
   * wrong for the other two units the config dialog offers.
   *
   * A report reloaded from history does not record the unit it was generated
   * under, so this is the *current* setting; that only misreads a report made
   * before the setting was changed, which is a far smaller wrong than being
   * fixed to one unit forever.
   */
  reportUnit?: string;
}) => {
  const px = (value: number) => unitsToPx(value, reportUnit);
  // The report page is an absolutely-positioned pixel grid (coordinates come
  // straight from the REPX units), so it cannot reflow. Instead we measure the
  // available width and scale the whole page down to fit — the geometry stays
  // byte-identical, only the presentation shrinks.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const pageWidth = px(layout.pageWidth || 850);
  const pageHeight = Math.max(
    px(1100),
    layout.sections.reduce((sum, s) => sum + px(s.height || 100), 0),
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
              style={{ height: px(section.height || 100) }}
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
                      left: px(el.x || 0),
                      top: px(el.y || 0),
                      width: px(el.width || 100),
                      height: px(el.height || 20),
                      backgroundColor: el.backgroundColor || 'transparent',
                      color: el.color || 'inherit',
                      // fontSize is in report units like every other number in
                      // the layout — see the prompt. It is the REPX that has to
                      // convert to points, not this.
                      fontSize: el.fontSize ? `${px(el.fontSize)}px` : '12px',
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

                    {isTable && <MockupTable el={el} scaleFont={unitsToPx(1, reportUnit)} />}

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

// The PDF.js worker used to be configured here, at module scope, which is what
// forced the engine into the eager bundle. loadPdfjs() now does it on the way
// past — see src/lib/pdf.ts.

export interface SavedReport {
  id: string;
  name: string;
  timestamp: string;
  messages: ChatMessage[];
  result: DesignResult | null;
}


/* Per-route titles and the route -> view-state mapping moved to
   `src/lib/routes.ts` on 2026-08-16, so they could be tested without importing
   this file. The reasoning that used to sit here moved with them — including
   why `/` must stay byte-identical to the `<title>` in `index.html`, which
   `routes.test.ts` now checks rather than asks you to remember. */

/** Which panel the rail's second column is showing. */
type RailPanel = 'review' | 'projects' | 'history' | 'batch';

/**
 * The review column's own geometry, remembered between sessions.
 *
 * Separate keys rather than a slot in `reportConfig`: that object is an
 * allowlist of settings that describe the *document* and is read back into the
 * config the model is given (see `reportConfigStore.ts`). How wide someone
 * likes their panel is not a report setting and must not travel with one.
 */
const REVIEW_WIDTH_KEY = 'reviewWidth';
const REVIEW_COLLAPSED_KEY = 'reviewCollapsed';
const RAIL_EXPANDED_KEY = 'railExpanded';

/**
 * Bump when a stored width stops meaning what it meant, and a browser carrying
 * the old one is worse off than one carrying nothing.
 *
 * Epoch 2 retires what the rail's widen button wrote. That button jumped the
 * column to 1000px and was removed the day it shipped; a browser that had
 * clicked it was left with a chat column filling two thirds of the window, and
 * the only way back was a double-click on a 7px divider nobody knows to try.
 * Persisted state that outlives the control that set it is not a preference,
 * it is a trap — so it is dropped once, here, rather than left for the user to
 * discover a gesture for.
 */
const REVIEW_WIDTH_EPOCH = '2';
const REVIEW_WIDTH_EPOCH_KEY = 'reviewWidthEpoch';

/**
 * The remembered column width, or the default if this browser has not caught up
 * to the current epoch. Guarded: `localStorage` throws outright in a
 * locked-down profile, and the workspace still has to open.
 */
function rememberedReviewWidth(): number {
  try {
    if (localStorage.getItem(REVIEW_WIDTH_EPOCH_KEY) !== REVIEW_WIDTH_EPOCH) {
      localStorage.removeItem(REVIEW_WIDTH_KEY);
      localStorage.setItem(REVIEW_WIDTH_EPOCH_KEY, REVIEW_WIDTH_EPOCH);
      return REVIEW_DEFAULT_WIDTH;
    }
    return readReviewWidth(localStorage.getItem(REVIEW_WIDTH_KEY));
  } catch {
    return REVIEW_DEFAULT_WIDTH;
  }
}

/**
 * The rail's two widths.
 *
 * 56px is the artifact's, and the icons are centred in it. Expanded it shows
 * the label beside each icon — wide enough for the longest of them at 12.5px
 * and no wider, because every pixel here comes off the bench.
 */
const RAIL_WIDTH = 56;
const RAIL_EXPANDED_WIDTH = 208;

/**
 * Initials for the rail's account button. Two letters at most — the artifact's
 * avatar is a 30px disc and a third glyph does not fit at that size.
 */
function initialsOf(user: { displayName?: string | null; email?: string | null }): string {
  const source = (user.displayName || user.email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}

/**
 * The only things that differed between a first generation and a resumed one.
 *
 * `handleResume` and `handleGenerate` used to carry a copy each of the same
 * ~90-line run: the same `analyzeReportDesign` call, the same result shape, the
 * same assistant message, and a byte-identical 30-line `catch`. Diffed on
 * 2026-08-28, every single difference between them was a log string or a
 * sentence of user-facing copy — nothing functional at all. They are one
 * function now (`runGeneration`) and this is the parameter that made that
 * possible.
 *
 * Keeping the wording out here rather than branching on an `isResume` flag is
 * deliberate: the strings are the *whole* difference, so a flag would put a
 * conditional inside the very code the split was hiding.
 */
type RunCopy = {
  /** Prefixes the run's opening `console.log`, before `Prompt: "…"`. */
  start: string;
  /** Logged immediately before the request goes out. */
  request: string;
  /** Logged once the transcript has the assistant's reply. */
  done: string;
  /** The assistant's message, given whether the user actually typed a prompt. */
  assistant: (fromPrompt: boolean) => string;
};

const INITIAL_RUN: RunCopy = {
  start: 'Starting report generation process.',
  request: 'Sending request to Gemini API...',
  done: 'Report layout updated successfully.',
  assistant: (fromPrompt) =>
    fromPrompt
      ? "I've updated the report layout based on your instructions. You can view the UI preview and specifications on the right."
      : "I've generated the report layout based on your provided images. You can view the UI preview and specifications on the right.",
};

const RESUMED_RUN: RunCopy = {
  start: 'Resuming report generation process.',
  request: 'Requesting Gemini API on resume...',
  done: 'Report layout updated successfully on resume.',
  assistant: (fromPrompt) =>
    fromPrompt
      ? "I've resumed and completed the report layout based on your instructions. You can view the UI preview and specifications on the right."
      : "I've resumed and completed the report layout based on your provided images. You can view the UI preview and specifications on the right.",
};

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
  // Through the validating reader. A bare JSON.parse here threw during the very
  // first render on a corrupted entry, taking the whole application to the error
  // boundary rather than costing one panel — with a message that says nothing
  // about storage, so the only way out was clearing site data. See
  // src/lib/savedReport.ts.
  const [savedReports, setSavedReports] = useState<SavedReport[]>(
    () => loadReportsLocally<ChatMessage, DesignResult>()
  );
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
  /**
   * The whole progress bar, as one value.
   *
   * Was three pieces of state plus a ref carrying the step index between
   * handlers. The rules that hold it together — the bar never moves backwards,
   * the simulated phase stays under a ceiling, the streamed phase starts above
   * it — now live in src/lib/generationProgress.ts under test, and every update
   * here is a functional one so no callback can read a stale copy.
   */
  const [progress, setProgress] = useState<GenerationProgress>(IDLE_PROGRESS);
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
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  /* Bumped when the account panel changes the profile. `updateProfile` mutates
     the Firebase `User` in place and fires no auth-state event, so this is what
     makes the rail show the new name without a reload. */
  const [profileTick, setProfileTick] = useState(0);
  /* Read through a memo so the tick is a real dependency rather than a state
     variable nobody consumes: the `user` object's identity never changes on a
     rename, so `[user]` alone would never recompute this. */
  const accountName = useMemo(
    () => user?.displayName || user?.email || 'Signed in',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, profileTick],
  );
  const workspaceProfileRef = useRef<HTMLDivElement>(null);

  /* The column's width and whether it is showing at all. Both persist: a panel
     you have to re-widen on every reload is one you stop widening. `localStorage`
     can throw outright in a locked-down profile, so every access is guarded —
     the workspace must still open, just without the memory. */
  const [reviewWidth, setReviewWidth] = useState(rememberedReviewWidth);
  const [isReviewCollapsed, setIsReviewCollapsed] = useState(() => {
    try {
      return localStorage.getItem(REVIEW_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  /* The rail's own state. Independent of the column beside it: they are two
     different objects and hiding one has never meant anything about the other. */
  const [isRailExpanded, setIsRailExpanded] = useState(() => {
    try {
      return localStorage.getItem(RAIL_EXPANDED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const toggleRail = () => {
    setIsRailExpanded((prev) => {
      try {
        localStorage.setItem(RAIL_EXPANDED_KEY, String(!prev));
      } catch {
        /* storage disabled — the choice still applies for this session */
      }
      return !prev;
    });
  };

  const [isResizingReview, setIsResizingReview] = useState(false);
  /* Where the pointer went down, and how wide the column was then. Deltas from
     that origin rather than "pointer position minus rail width", so a fast drag
     cannot slew the column by however far the pointer got ahead of the paint. */
  const reviewResizeFrom = useRef({ x: 0, width: REVIEW_DEFAULT_WIDTH });

  /* The stored width is what the user asked for; this is what fits right now.
     Keeping the two apart is what lets a 700px column survive a spell on a
     laptop and come back at 700 rather than at whatever the laptop allowed. */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  /* `panelSize.ts` reserves room for a 56px rail. An expanded one takes its
     extra out of the same window, so the clamp is handed a viewport that has
     already paid for it — otherwise widening the rail and then the column
     leaves the bench 152px short of the reserve it was promised. */
  const railWidth = isRailExpanded ? RAIL_EXPANDED_WIDTH : RAIL_WIDTH;
  const layoutWidth = viewportWidth - (railWidth - RAIL_WIDTH);
  const appliedReviewWidth = clampReviewWidth(reviewWidth, layoutWidth);

  const rememberReviewWidth = useCallback((width: number) => {
    try {
      localStorage.setItem(REVIEW_WIDTH_KEY, String(width));
    } catch {
      /* storage disabled — the width still applies for this session */
    }
  }, []);
  const rememberReviewCollapsed = useCallback((collapsed: boolean) => {
    try {
      localStorage.setItem(REVIEW_COLLAPSED_KEY, String(collapsed));
    } catch {
      /* storage disabled — the choice still applies for this session */
    }
  }, []);

  const toggleReviewPanel = useCallback(() => {
    setIsReviewCollapsed((prev) => {
      rememberReviewCollapsed(!prev);
      return !prev;
    });
  }, [rememberReviewCollapsed]);

  /* Every route into the second column goes through here, so that choosing a
     section while the panel is hidden shows it rather than switching a section
     nobody can see. The rail's toggle is the only control that hides it. */
  const showRailPanel = useCallback((panel: RailPanel) => {
    setRailPanel(panel);
    setIsReviewCollapsed(false);
    rememberReviewCollapsed(false);
  }, [rememberReviewCollapsed]);

  const beginReviewResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Stops the drag from being interpreted as a text selection or an image drag
    // in the panel it starts against.
    e.preventDefault();
    reviewResizeFrom.current = { x: e.clientX, width: appliedReviewWidth };
    // Capture, so the rest of the drag is delivered here even though the pointer
    // spends it over the bench.
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizingReview(true);
  };
  const moveReviewResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingReview) return;
    const { x, width } = reviewResizeFrom.current;
    setReviewWidth(clampReviewWidth(width + (e.clientX - x), layoutWidth));
  };
  const endReviewResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingReview) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setIsResizingReview(false);
    // Written once, at the end. A setItem per pointermove is a disk write per
    // frame for a value only the last of which matters.
    rememberReviewWidth(reviewWidth);
  };
  const resetReviewWidth = () => {
    setReviewWidth(REVIEW_DEFAULT_WIDTH);
    rememberReviewWidth(REVIEW_DEFAULT_WIDTH);
  };
  /* The handle is a real control, not a hover affordance: it takes focus and the
     arrow keys move it, which is the whole of the WAI-ARIA window-splitter
     pattern and the only way to resize this without a pointer. */
  const onReviewResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    const step = e.shiftKey ? 64 : 16;

    if (e.key === 'ArrowLeft') next = appliedReviewWidth - step;
    else if (e.key === 'ArrowRight') next = appliedReviewWidth + step;
    else if (e.key === 'Home') next = REVIEW_MIN_WIDTH;
    else if (e.key === 'End') next = REVIEW_MAX_WIDTH;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleReviewPanel();
      return;
    } else return;

    e.preventDefault();
    const clamped = clampReviewWidth(next, layoutWidth);
    setReviewWidth(clamped);
    rememberReviewWidth(clamped);
  };

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
      document.title = titleForRoute(path);

      // The mapping itself lives in `src/lib/routes.ts` so it can be tested
      // without importing this file (and with it pdf.js and Firebase). A `null`
      // means leave that piece of state as it was — which is how `/login` and
      // `/signup` render over the workspace instead of closing it, and why
      // neither overwrites the path we would return someone to after sign-in.
      const view = viewForRoute(path);
      if (view.showWorkspace !== null) setShowWorkspace(view.showWorkspace);
      setShowLogin(view.showLogin);
      if (view.loginMode !== null) setLoginInitialMode(view.loginMode);
      if (view.lastViewPath !== null) setLastViewPath(view.lastViewPath);
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

  /**
   * The loaded Firebase surface, or `null` until it arrives.
   *
   * Everything below that talks to Firebase is gated on this. Holding it in
   * state rather than a ref is deliberate: the auth subscription, the projects
   * snapshot and the vault lookup are all effects that must *re-run* once the
   * SDK is here, and a ref would not retrigger them.
   */
  const [firebase, setFirebase] = useState<FirebaseClient | null>(null);
  useEffect(() => {
    let alive = true;
    loadFirebase().then(
      (client) => {
        if (alive) setFirebase(client);
      },
      (err) => {
        // A failed chunk load leaves the app signed-out and local-only, which is
        // a supported state rather than a broken one — so this warns and stops
        // instead of surfacing an error the user cannot act on.
        console.warn('Firebase could not be loaded; staying local-only.', err);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!firebase) return;
    const unsubscribe = firebase.service.auth.onAuthStateChanged((u) => {
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
        setSavedReports(loadReportsLocally<ChatMessage, DesignResult>());
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
  }, [firebase]);

  // Fetch from Firebase
  useEffect(() => {
    if (!user || !firebase) return;
    const { service, sdk, paths } = firebase;
    try {
      const q = sdk.query(paths.reportsCollectionRef(service.db, user.uid));
      const unsubscribe = sdk.onSnapshot(q, (snapshot) => {
        const reports: SavedReport[] = [];
        snapshot.forEach((doc) => {
          // fromFirestoreDocument never throws. That matters here specifically:
          // this callback fires long after the try/catch below has returned, so
          // one malformed document would empty the whole projects panel rather
          // than skip a row. See src/lib/savedReport.ts.
          reports.push(fromFirestoreDocument<ChatMessage, DesignResult>(doc.data()));
        });
        reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setSavedReports(reports);
      }, (error) => {
        service.handleFirestoreError(error, OperationType.GET, `users/${user.uid}/reports`);
      });
      return () => unsubscribe();
    } catch (error) {
      service.handleFirestoreError(error, OperationType.GET, `users/${user.uid}/reports`);
    }
  }, [user, firebase]);

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

  /**
   * Text attachments that are not already represented by a chip of their own.
   *
   * A PDF produces both page images and a per-page text layer, and both are
   * needed — but they are one file. The images already collapse into a single
   * chip, so listing the text layer beside them drew a second chip per page: an
   * eight-page PDF appeared as nine attachments, which reads as the product
   * having torn the file apart. Text belonging to an upload that has images is
   * therefore part of that upload's chip and not listed again.
   *
   * What is left is genuinely text-only — a `.repx`, or a PDF whose pages all
   * failed to rasterise — and it is grouped by the same rule so that case
   * cannot re-open the same defect from the other side.
   */
  const textGroups = useMemo(() => {
    const withImages = new Set(previewMeta.map((m) => m.uploadId));
    const standalone = attachmentTexts.filter((t) => !withImages.has(t.uploadId));
    return groupAttachments(
      standalone.map((t) => ({ uploadId: t.uploadId, file: t.file, page: t.page })),
      standalone.length
    ).map((group) => ({ ...group, uploadId: standalone[group.indices[0]].uploadId }));
  }, [attachmentTexts, previewMeta]);

  /**
   * How many *files* are staged, which is what `MAX_ATTACHMENTS` has always
   * claimed to count. Counting rows instead meant one eight-page PDF spent
   * sixteen of the twelve allowed slots, and the next drop was refused with
   * "you can attach up to 12 items" after the user had attached one.
   */
  const stagedUploads = useMemo(
    () => countStagedUploads(previewMeta, attachmentTexts),
    [previewMeta, attachmentTexts],
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

    const defaults: ReportConfig = {
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
      customApiKey: ''
    };

    // The document settings are a standing preference — someone targeting
    // DevExpress 20.1 targets it every session. They used to live in state only,
    // so every reload silently reset the version to 23.2 and the next export
    // went out for a designer that would refuse it.
    //
    // The key is deliberately applied *after* the merge and never round-trips
    // through localStorage; see reportConfigStore.ts.
    let stored: string | null = null;
    try { stored = localStorage.getItem(CONFIG_STORAGE_KEY); } catch { /* storage disabled */ }

    return { ...mergeStoredConfig(defaults, stored), customApiKey: storedKey };
  });

  /**
   * Persist the document settings on every change, minus the key.
   *
   * `toPersistable` is an allowlist, so a field added to `ReportConfig` later is
   * not written until someone adds it there on purpose — which is what keeps the
   * next secret-bearing field from riding along unnoticed.
   */
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(toPersistable(config)));
    } catch {
      /* storage disabled (private mode, quota) — the setting still holds for this session */
    }
  }, [config]);

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
  // The path comes from lib/accountData rather than being spelled out here: the
  // account-deletion path needs the identical one, the vault has no `list` rule
  // so deletion cannot discover it, and two copies of the id meant a rename
  // here would silently orphan every stored key.
  const vaultDocRef = useCallback(
    () => (user && firebase ? firebase.paths.vaultDocRef(firebase.service.db, user.uid) : null),
    [user, firebase]
  );

  // Does this account have a stored key? Only the existence is fetched here —
  // decrypting needs the passphrase, which the user supplies on demand.
  useEffect(() => {
    if (!canUseVault) {
      setVaultRecord(null);
      return;
    }
    const ref = vaultDocRef();
    if (!ref || !firebase) return;
    firebase.sdk.getDoc(ref)
      .then((snap) => setVaultRecord(snap.exists() ? (snap.data() as EncryptedKeyRecord) : null))
      .catch((err) => {
        console.warn('Could not check for a stored API key:', err);
        setVaultRecord(null);
      });
  }, [canUseVault, vaultDocRef, firebase]);

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

  /**
   * The dialog's keyboard contract, which `role="dialog" aria-modal="true"`
   * promises and nothing was keeping.
   *
   * Three things were wrong, all confirmed in a real browser rather than
   * reasoned about: Escape did nothing (only the attachment lightbox listened
   * for it), focus stayed on `document.body` when the dialog opened, and Tab
   * from the Save button walked out into the rail behind the scrim — a set of
   * controls the user cannot see and did not ask for.
   *
   * The dismiss function is reached through a ref so this effect depends on
   * `isConfigOpen` alone. Listing the handler instead would re-run the whole
   * effect on every render, which means re-focusing the dialog on every
   * keystroke typed into it.
   */
  const configDialogRef = useRef<HTMLDivElement>(null);

  // This dialog stays mounted while closed, so the trap is armed by
  // `isConfigOpen` rather than by the component's lifetime. The rationale that
  // used to sit inline here — focus the dialog and not its first <select>, and
  // recompute the focusable list per keystroke because the vault section comes
  // and goes — now lives in useFocusTrap, which is the only copy of it.
  useFocusTrap(configDialogRef, dismissConfigWithoutSaving, isConfigOpen);

  /* A check result belongs to the session it was run in. Left alone, "That key
     looks valid" was still sitting there the next time the dialog opened, over
     a key that may since have been cleared. */
  useEffect(() => {
    if (!isConfigOpen) {
      setKeyCheck(null);
      setVaultNotice(null);
    }
  }, [isConfigOpen]);

  const saveConfigAndClose = () => {
    configSnapshotRef.current = null;
    setIsConfigOpen(false);
  };

  const handleCheckKey = async () => {
    setKeyCheck(null);
    setVaultBusy(true);
    try {
      const { validateApiKey } = await loadGemini();
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
      await (await loadFirebase()).sdk.setDoc(ref, record);
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
      await (await loadFirebase()).sdk.deleteDoc(ref);
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('ui');
  // Sub-view inside the "Specs & REPX" tab. The tab has always been named for
  // both, but only ever rendered the specification.
  const [specView, setSpecView] = useState<SpecView>('spec');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      return JSON.parse(saved);
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const isFirstThemeRun = useRef(true);
  /** Set when a circular wipe handled the swap, so the cross-fade stands down. */
  const skipThemeFade = useRef(false);
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

  /**
   * Real progress, fed by the streamed response.
   *
   * The rules that used to live here — the ceiling on the simulated phase, the
   * floor under the streamed one, and the guarantee that the bar only ever
   * moves forward — are in src/lib/generationProgress.ts, under test. What is
   * left is the wiring: stop the simulation, and fold the chunk in.
   *
   * The update is functional, so this cannot read a stale copy of the state and
   * needs no dependencies. Shared by handleGenerate and handleResume, which is
   * what stops the two drifting apart.
   */
  const handleStreamProgress = useCallback((chunk: StreamProgress) => {
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }
    setProgress((prev) => applyStreamProgress(prev, { percent: chunk.percent, chars: chunk.chars }));
  }, []);

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

    // A circular wipe already handled this one — see setTheme. Running the
    // cross-fade as well paints it *inside* the expanding circle and the
    // leading edge turns to mush. Consumed here so the next change, whatever
    // causes it, gets the fade again.
    if (skipThemeFade.current) {
      skipThemeFade.current = false;
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

  /**
   * The only place a theme choice is persisted — an explicit user action.
   *
   * The swap runs inside a circular view transition opening from whichever
   * control was pressed. Two details are load-bearing:
   *
   * - The class is toggled directly here rather than left to the effect above.
   *   `startViewTransition` snapshots the DOM *around* its callback, and the
   *   effect is passive, so it would run after the snapshot was taken and the
   *   new theme would flash in after the wipe instead of arriving with it.
   * - `flushSync` keeps React's own state in the same frame. Without it the
   *   class and the state disagree for a tick, which is visible on anything
   *   rendering off `isDarkMode` rather than off the class — the toggle's own
   *   sun/moon icon, for one.
   *
   * The effect then re-applies the identical class, which is a no-op.
   */
  const setTheme = useCallback((val: boolean) => {
    skipThemeFade.current = circularThemeSwap(() => {
      document.documentElement.classList.toggle('dark', val);
      flushSync(() => setIsDarkMode(val));
    });
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

    // Files, not rows — a PDF's pages are ours, not something the user
    // attached. The arithmetic and its wording are in lib/attachmentBudget.ts,
    // which records the off-by-eight this had before it was countable.
    const admission = admitFiles(incoming, stagedUploads, MAX_ATTACHMENTS);
    if (admission.full) {
      setUploadNotices(admission.notices);
      return;
    }

    const accepted = admission.accepted;
    const notices: string[] = [...admission.notices];

    setIsIngesting(true);
    try {
      for (const [i, file] of accepted.entries()) {
        // Identifies this drop for the life of the staged attachment. Two files
        // can share a name, so the name cannot be the key — see attachments.ts.
        // The extracted coordinates go into the prompt as LocationFloat values,
        // so they have to be in the unit the REPX will declare.
        const result = await ingestFile(file, `${Date.now()}-${i}-${file.name}`, config.unit);
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
  }, [stagedUploads]);

  /**
   * One file, one report — the batch panel's unit of work.
   *
   * Deliberately the ORDINARY path: the same `ingestFile`, the same
   * `analyzeReportDesign`, the same `auditRepx`. Batch intake is a different
   * way of feeding the product, not a different product, and a second
   * generation path would be a second set of bugs.
   *
   * No prompt and no previous state are passed. Each file is its own report
   * with nothing to refine against, and handing it the last file's layout is
   * how forty documents come out looking like the first one.
   */
  const batchResults = useRef<Map<string, DesignResult>>(new Map());
  const runOneBatchFile = useCallback(async (file: File, signal: AbortSignal, id: string) => {
    const ingested = await ingestFile(file, `batch-${id}`, config.unit);
    const parts = toAttachmentParts(ingested.images, ingested.texts);
    const { analyzeReportDesign } = await loadGemini();
    const response = await analyzeReportDesign('', parts, config, undefined, signal);
    const audit = auditRepx(response.repxContent, response.layout);
    batchResults.current.set(id, {
      content: response.markdown,
      layout: response.layout,
      repxContent: response.repxContent,
      title: response.layout?.title || file.name,
    } as DesignResult);
    return {
      title: response.layout?.title || '',
      repxContent: response.repxContent || '',
      bands: response.layout?.sections?.length ?? 0,
      errors: audit.errors,
      warnings: audit.warnings,
    };
  }, [config]);

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
   *
   * That includes the text layer, which has no chip of its own once the file
   * has images. It used to survive the removal, so a PDF the user had taken
   * back was still sent to the model — invisibly, with nothing on screen left
   * to remove it with.
   */
  const removeFile = (indices: number[], uploadId?: string) => {
    const drop = new Set(indices);
    setPreviews(prev => prev.filter((_, i) => !drop.has(i)));
    setPreviewMeta(prev => prev.filter((_, i) => !drop.has(i)));
    if (uploadId) setAttachmentTexts(prev => prev.filter(t => t.uploadId !== uploadId));
  };

  /** Same rule from the other side: one chip, one upload, all of it. */
  const removeTextAttachment = (uploadId: string) => {
    setAttachmentTexts(prev => prev.filter(t => t.uploadId !== uploadId));
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
    /* `loadFirebase()` is already resolved wherever this is reached — every
       caller failed a Firestore call to get here, so the SDK is in memory and
       this only awaits a settled promise. The user message is set outside the
       chain so it lands even if the module itself is what failed. */
    loadFirebase()
      .then(({ service }) => {
        try {
          service.handleFirestoreError(err, operation, path);
        } catch {
          // Already logged by handleFirestoreError; the re-throw stops here.
        }
      })
      .catch(() => {
        console.error('Firestore failure, and Firebase could not be loaded to report it:', err);
      });
    setError(userMessage);
  };

  const handleSaveReport = async () => {
    if (!result && messages.length === 0) return;
    const reportId = Date.now().toString();
    const ts = Date.now();

    // One report, one shape, converted at the boundary rather than assembled
    // differently in each branch — the two used to compute the display name
    // separately, so the same project could be listed under two names depending
    // on whether it was saved signed in. See src/lib/savedReport.ts.
    const draft: SavedReport = {
      id: reportId,
      name: reportDisplayName(result?.title || prompt),
      timestamp: new Date(ts).toISOString(),
      messages,
      result,
    };

    if (user) {
      try {
        const { service, sdk, paths } = await loadFirebase();
        const docRef = paths.reportDocRef(service.db, user.uid, reportId);

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
        let payload = toFirestoreDocument(draft, user.uid);
        let imagesDropped = false;

        if (payload.messages.length + payload.result.length > CLOUD_SAVE_BUDGET_BYTES) {
          payload = toFirestoreDocument(
            { ...draft, messages: messages.map((m) => (m.images?.length ? { ...m, images: undefined } : m)) },
            user.uid
          );
          imagesDropped = true;
        }

        if (payload.messages.length + payload.result.length > CLOUD_SAVE_BUDGET_BYTES) {
          setError(
            'This project is too large to sync to your account. It is still open here, and "Save Project" while signed out keeps it on this device.'
          );
          return;
        }

        await sdk.setDoc(docRef, payload);
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
      // The write happens before the state update, not inside it: a failing
      // setItem used to throw from inside a setSavedReports updater, which put
      // the exception into React rather than in front of the user. Deciding
      // first also means the list never shows a project that was not stored.
      const updated = [draft, ...savedReports];
      const outcome = saveReportsLocally(updated);

      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }

      setSavedReports(updated);
      setSaveNotice('Saved on this device. Sign in to sync across devices.');
    }
  };

  const handleLoadReport = (report: SavedReport) => {
    setMessages(report.messages);
    setResult(report.result);
    setRailPanel('review');
  };

  /**
   * Rows on their way out, so the list can fade them before they vanish.
   *
   * The delay is presentational only — `handleDeleteReport` still runs after
   * it, and the row is `pointer-events: none` meanwhile, so a second click
   * cannot queue the same delete twice.
   */
  const [leavingReportIds, setLeavingReportIds] = useState<string[]>([]);
  /** Two-step confirm for "Clear all". A native confirm() is banned here. */
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

  const REMOVE_FADE_MS = 190;

  const removeReports = (ids: string[]) => {
    if (ids.length === 0) return;
    setLeavingReportIds((prev) => [...prev, ...ids]);
    window.setTimeout(() => {
      ids.forEach((id) => void handleDeleteReport(id));
      setLeavingReportIds((prev) => prev.filter((id) => !ids.includes(id)));
    }, REMOVE_FADE_MS);
  };

  const handleDeleteReport = async (id: string) => {
    // Signed in -> Firestore; signed out -> localStorage. This must stay the same
    // shape as handleSaveReport's branch, so a report is always deleted from
    // wherever it was written.
    if (user) {
      try {
        const { service, sdk, paths } = await loadFirebase();
        await sdk.deleteDoc(paths.reportDocRef(service.db, user.uid, id));
      } catch (err) {
        reportFirestoreFailure(err, OperationType.DELETE, `users/${user.uid}/reports/${id}`,
          'That project could not be deleted from your account. It is still listed — try again in a moment.');
      }
    } else {
      // Through the same writer as the save path, for the same reason: it is
      // the same key, and an unguarded setItem here would throw out of a state
      // updater. A delete shrinks the payload so the quota is not a realistic
      // failure, but storage being blocked outright is.
      setSavedReports(prev => {
        const updated = prev.filter(r => r.id !== id);
        saveReportsLocally(updated);
        return updated;
      });
    }
  };

  const handleLogOut = async () => {
    try {
      await (await loadFirebase()).service.logOut();
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

    setSavedReports(loadReportsLocally<ChatMessage, DesignResult>());
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

  /* `fallback={null}` rather than a spinner: the chunk is small and usually
     already warm, and a flash of loading state where a dialog is about to open
     reads worse than the dialog simply appearing. */
  const loginModal = showLogin ? (
    <Suspense fallback={null}>
      <LoginPage
        initialMode={loginInitialMode}
        onClose={handleLoginClose}
        onSuccess={handleLoginSuccess}
        isDarkMode={isDarkMode}
        // `setTheme`, not the raw setter. This is the same explicit user action
        // as every other toggle, and it was the one place passing the state
        // setter directly — so switching the theme from the sign-in modal did not
        // persist and reverted on the next load. It now persists and wipes like
        // the rest.
        setIsDarkMode={setTheme}
      />
    </Suspense>
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
      console.log('Analysis paused by user at step index:', progress.stepIndex);
    }
  };

  /**
   * The generation run itself: ticker, request, result, transcript, error
   * handling, teardown.
   *
   * This is the single copy of what `handleGenerate` and `handleResume` used to
   * do twice. Everything either of them needs to vary is in `copy`; everything
   * that has to stay in step — above all the `catch`, which is the error path
   * for a call that can 404, 429, 503, hang, abort, or return truncated
   * `repxContent` — is here once and cannot drift again.
   *
   * The caller owns the *setup* that genuinely differs: the initial run adds a
   * user message and may take a chat turn first, and the resume carries the
   * progress bar's current step across instead of starting from zero.
   */
  const runGeneration = async (
    currentPrompt: string,
    currentPreviews: readonly string[],
    currentTexts: readonly TextAttachment[],
    copy: RunCopy,
  ) => {
    loadingIntervalRef.current = setInterval(() => setProgress(tickSimulated), STEP_INTERVAL_MS);

    console.log(`${copy.start} Prompt: "${currentPrompt}"`);
    console.debug(`Included ${currentPreviews.length} preview images/files.`);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Text before images, and malformed previews dropped rather than thrown
      // on — see src/lib/attachmentParts.ts.
      const attachmentParts = toAttachmentParts(currentPreviews, currentTexts);

      console.debug(copy.request);
      const { analyzeReportDesign } = await loadGemini();
      const response = await analyzeReportDesign(
        // Passed through empty when the user typed nothing. It used to become
        // "Generate a professional DevExpress report layout based on these
        // visuals." here, which handed the model an instruction nobody gave and
        // then told it to apply that as a modification. See lib/userInstructions.ts.
        currentPrompt,
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
        text: copy.assistant(Boolean(currentPrompt)),
        result: newResult
      };
      setMessages(prev => [...prev, newAssistantMsg]);
      console.log(copy.done);

    } catch (err: any) {
      if (signal.aborted) {
        console.debug('Generation aborted/paused by user during error handling.');
        return;
      }
      console.error('Error during report generation:', err);

      // No key configured is a setup step, not a failure — send the user straight
      // to the place they can fix it instead of showing a dead-end error.
      if (isMissingApiKey(err)) {
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
        setProgress(finishProgress);
        setTimeout(() => {
          setIsAnalyzing(false);
          setIsPaused(false);
          setProgress(IDLE_PROGRESS);
        }, 500);
      }
      if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
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

    // Resume re-issues the whole request, so previously received output no
    // longer counts: startProgress clears the character count. The bar itself
    // stays where it was rather than snapping backwards on an action the user
    // took deliberately, which is what carrying the current step across does.
    setProgress((prev) => startProgress(prev.stepIndex));

    await runGeneration(
      activePromptRef.current,
      activePreviewsRef.current,
      activeTextsRef.current,
      RESUMED_RUN,
    );
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsAnalyzing(false);
    setIsPaused(false);
    // Stop discards the run entirely, so the bar goes back to nothing rather
    // than to a step someone might resume from.
    setProgress(IDLE_PROGRESS);
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
        const { chatReply } = await loadGemini();
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
        const message = isMissingApiKey(err)
          ? 'Add your Gemini API key to use the workspace.'
          : err?.message || 'Could not reach the assistant.';
        setError(message);
        // Mark the message that failed, so the transcript shows which turn went
        // wrong instead of leaving it looking merely unanswered.
        setMessages(prev => prev.map(m =>
          m.id === newUserMsg.id ? { ...m, error: message } : m
        ));
        if (isMissingApiKey(err)) setIsConfigOpen(true);
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

    setProgress(startProgress());
    setError(null);

    await runGeneration(currentPrompt, currentPreviews, currentTexts, INITIAL_RUN);
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
   * Which data fields the report about to be exported is bound to.
   *
   * Read out of `repxContent` rather than carried on the response, so it is a
   * property of the artifact and not of the settings in force right now. A
   * report bound through the Data tab still reports its fields when reopened,
   * and one saved before it was bound reports none -- which is the truth in
   * both cases. That was the argument when a flag decided whether binding
   * happened at all, and it holds better now that a person does. It is also what keeps this honest
   * in the same way the units readout beside it has to be: it cannot claim a
   * binding the file does not contain.
   *
   * Empty for every report generated with binding off, which is the default, so
   * the readout simply does not appear.
   */
  const boundFields = useMemo(
    () => readBoundFields(result?.repxContent),
    [result?.repxContent]
  );

  /**
   * What is structurally wrong with the report about to be exported.
   *
   * Derived from `repxContent` like the two above, so it describes the artifact
   * rather than the run that produced it — a report loaded from a save is
   * audited on the same terms as one just generated.
   *
   * Every defect found on 2026-09-04 reached the user before the app noticed
   * anything: the tables were discarded on load, the page numbering was dropped,
   * and the app reported success each time because by its own lights it had
   * succeeded. This is that gap. See `repxAudit.ts`.
   */
  const repxAudit = useMemo(
    () => (result?.repxContent ? auditRepx(result.repxContent, result.layout) : null),
    [result?.repxContent, result?.layout]
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
   * case. It gates whether **Open in designer** can be clicked, not whether it
   * is drawn — the button is always in the bar and explains itself when the
   * companion is not answering. Same detection contract as `canUseVault`; the
   * difference is that an undiscoverable capability is its own failure.
   */
  const [designerReady, setDesignerReady] = useState(false);
  /** True while a `forma-repx://` launch is being waited on — a cold start is slow. */
  const [designerStarting, setDesignerStarting] = useState(false);
  useEffect(() => {
    // Only while the workspace is open. This used to run on mount with no
    // condition, so every visitor to the landing page, the docs and the privacy
    // policy fired a request at http://127.0.0.1:7317 — and for the very large
    // majority, who do not have the companion installed, it failed and logged
    // `net::ERR_CONNECTION_REFUSED` to the console. A predictable error on every
    // page load is noise that hides the unpredictable ones. Found by loading
    // the built app and reading the network log, not by reading the code.
    //
    // The button this feeds lives in the workspace, so nothing is lost: the
    // ping now happens when there is something for it to enable.
    if (!showWorkspace) return;

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
  }, [showWorkspace]);

  /**
   * Warm the lazy marketing chunks once the page is idle.
   *
   * Deferring those pages took ~105 kB off the entry chunk, and left a gap: a
   * visitor on the landing page who clicks "Docs" waits for a request that used
   * to have already happened. Fetching them during idle puts the bytes back
   * within reach without putting them back on the critical path — first paint no
   * longer waits for code the visitor may never render, which was the point.
   *
   * Only from a marketing page, and that condition is the whole reason this is
   * not just a prefetch of everything. Someone working in `/workspace` has no
   * link to any of these, so fetching them there would move the waste rather
   * than remove it — the exact criticism that would otherwise apply to warming
   * chunks at all.
   *
   * `lazy` reads through the module registry, so a chunk fetched here resolves
   * synchronously when the route changes; the two are not separate downloads.
   * Failures are swallowed on purpose: this is a nicety, and the real navigation
   * will surface a genuine network problem on its own.
   */
  useEffect(() => {
    if (showWorkspace) return;
    const warm = () => {
      void import('./components/FeaturesPage').catch(() => {});
      void import('./components/DocsPage').catch(() => {});
      void import('./components/ContactPage').catch(() => {});
      void import('./components/LegalPage').catch(() => {});
    };
    // requestIdleCallback is still unimplemented in Safari; the timeout is the
    // documented fallback rather than a second strategy.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) {
      const id = ric(warm);
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, [showWorkspace]);

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
      // Nothing listening: ask Windows to start it, then wait for the port.
      // The button no longer requires the companion to be running already —
      // requiring someone to remember a tray app before a one-click action
      // works is most of the reason this button was never used.
      if (!designerReady) {
        setError(null);
        setDesignerStarting(true);
        launchDesigner();
        const started = await waitForDesigner();
        setDesignerStarting(false);
        setDesignerReady(started);

        if (!started) {
          setError(
            `Could not start the report designer on this machine. If your browser asked for permission, ` +
            `allow it and click again. If it did not ask at all, the handler is not registered yet — run ` +
            `RepxDesigner.exe --register once (no admin needed), or start RepxDesigner.exe --serve yourself. ` +
            `Export .repx works regardless.`
          );
          return;
        }
      }

      await sendToDesigner(result.repxContent, designerFileName(result.title));
    } catch (err) {
      setDesignerStarting(false);
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
    const isNotFound = viewForRoute(currentRoute).notFound;
    const isFeatures = currentRoute === '/features';
    const isDocs = currentRoute === '/docs';
    const isContact = currentRoute === '/contact';
    const legalDoc: LegalDoc | null =
      currentRoute === '/terms' ? 'terms' : currentRoute === '/privacy' ? 'privacy' : null;

    return (
      /* `inert` while the sign-in dialog is open, rather than unmounting.
         The dialog is an opaque `fixed inset-0` sheet, so the page behind it is
         invisible but still in the document: two `<h1>`s in the outline, and a
         focusable tree behind a modal that claims `aria-modal="true"`.
         Unmounting it was the obvious fix and is the wrong one — the marketing
         page and the dialog render from the same component, so `/login` does not
         remount it, and closing returns you to the page at the scroll position
         you left (measured: 2000px out, 2000px back). Unmounting throws that
         away and replays every reveal animation. `inert` takes the subtree out
         of the a11y tree and out of tab order while leaving it mounted, which is
         the part that was actually wrong. */
      <>
        <div className="h-full w-full" inert={showLogin || undefined}>
          {/* `fallback={null}` because the alternative is worse, not because
              nothing was considered. The page chrome lives inside each page
              component, so there is no header to hold still while the rest
              arrives — any fallback here is a skeleton of a page we are about to
              replace. The gap is one same-origin request for at most 41 kB, and
              the effect below has usually fetched it before the click. */}
          <Suspense fallback={null}>
          {isNotFound ? (
          <NotFoundPage
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
        ) : legalDoc ? (
          <LegalPage
            doc={legalDoc}
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
        ) : isFeatures ? (
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
          </Suspense>
        </div>
        {loginModal}
      </>
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
  /* The derivation and the setter were two ternaries forty lines apart, and a
     plate present in one and not the other highlights its button and never
     opens its pane. They are one module now, with a round-trip test that fails
     on exactly that. See lib/workspaceView.ts. */
  const plate = plateFor({ activeTab, specView });
  const showPlate = (next: Plate) => {
    const state = stateForPlate(next, { activeTab, specView });
    setActiveTab(state.activeTab);
    setSpecView(state.specView);
  };
  const railBtn = (panel: RailPanel, label: string, icon: React.ReactNode) => (
    <button
      data-panel={panel}
      aria-current={railPanel === panel}
      title={label}
      aria-label={label}
      onClick={() => showRailPanel(panel)}
    >
      {icon}
      {/* Present in every state and hidden by CSS while the rail is narrow —
          the label is what the rail expands to show, and rendering it
          conditionally would mean the expanded rail mounts a different tree
          than the one whose focus and aria-current the user was just using. */}
      <span className="wb-rail-label">{label}</span>
    </button>
  );

  return (
    /* Same `inert`-while-signing-in treatment as the marketing return above, and
       for the same reason: the sign-in sheet is opaque and full-screen, so the
       workspace behind it is invisible but still focusable and still in the
       accessibility tree. `loginModal` moves out of this div so the attribute
       does not disable the dialog along with everything else. */
    <>
    <div
      className="sheet wb-root wb-shell"
      inert={showLogin || undefined}
      /* The first two tracks. The review column's is 0 while the panel is
         hidden — a `display: none` section keeps its grid track otherwise. Both
         are read by the rules at the foot of workspace.css, which explain why
         they are down there rather than at the top with everything else. */
      style={{
        '--wb-rail-w': `${railWidth}px`,
        '--wb-review-w': isReviewCollapsed ? '0px' : `${appliedReviewWidth}px`,
      } as React.CSSProperties}
      data-resizing={isResizingReview ? 'true' : undefined}
      data-rail={isRailExpanded ? 'wide' : undefined}
    >
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
          {/* The lockup the five marketing pages carry in `SiteHeader`, at the
              workspace's own type scale. Hidden with the rest of the labels
              while the rail is narrow: 56px has never had room for it. */}
          <span className="wb-wordmark">Forma</span>
        </a>

        {/* The rail's own expander, directly under the mark because it is about
            the navigation rather than about anything the navigation reaches.
            Expanded, every target here gains the label it already carries in
            `aria-label` — the icons alone are learnable, but only after you have
            clicked each one once to find out. */}
        <button
          data-toggle-rail
          title={isRailExpanded ? 'Collapse the sidebar' : 'Expand the sidebar'}
          aria-label={isRailExpanded ? 'Collapse the sidebar' : 'Expand the sidebar'}
          aria-expanded={isRailExpanded}
          onClick={toggleRail}
        >
          {isRailExpanded ? <IconChevronsLeft size={19} /> : <IconChevronsRight size={19} />}
          <span className="wb-rail-label">Collapse</span>
        </button>

        {railBtn('review', 'Current report', <IconLayout size={19} />)}
        {railBtn('projects', 'Saved projects', <IconFolder size={19} />)}
        {railBtn('history', 'Recent', <IconHistory size={19} />)}
        {railBtn('batch', 'Batch', <IconStack size={19} />)}
        <button data-open-config title="Configure" aria-label="Configure" onClick={() => setIsConfigOpen(true)}>
          <IconTune size={19} />
          <span className="wb-rail-label">Configure</span>
        </button>

        {/* The panel's only hide control, and the only way back once it is
            hidden — which is why it lives in the rail rather than in the panel
            it collapses. `aria-expanded` rather than `aria-current`: that
            attribute is the rail's "this section is showing" paint, and this is
            not a section. */}
        <button
          data-toggle-panel
          title={isReviewCollapsed ? 'Show the side panel' : 'Hide the side panel'}
          aria-label={isReviewCollapsed ? 'Show the side panel' : 'Hide the side panel'}
          aria-expanded={!isReviewCollapsed}
          aria-controls="wb-review-panel"
          onClick={toggleReviewPanel}
        >
          <IconPanelLeft size={19} />
          <span className="wb-rail-label">{isReviewCollapsed ? 'Show panel' : 'Hide panel'}</span>
        </button>
        <span className="wb-spacer" />
        <button title="Switch theme" aria-label="Switch theme" onClick={() => setTheme(!isDarkMode)}>
          {isDarkMode ? <IconSun size={18} /> : <IconMoon size={18} />}
          <span className="wb-rail-label">{isDarkMode ? 'Light theme' : 'Dark theme'}</span>
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
              title={`${accountName} — account`}
              onClick={(e) => { e.stopPropagation(); setShowWorkspaceProfile(!showWorkspaceProfile); }}
            >
              <span className="wb-initials">{initialsOf(user)}</span>
              <span className="wb-rail-label">{user.displayName || 'Account'}</span>
            </button>

            {showWorkspaceProfile && (
              <div className="wb-pop" role="menu" ref={workspaceProfileRef}>
                <div className="wb-who">
                  <b>{accountName}</b>
                  <span>{user.email}</span>
                </div>
                {/* The only route to account settings. Deliberately above Sign
                    out: the destructive-adjacent item goes last. */}
                <button
                  role="menuitem"
                  onClick={() => { setShowWorkspaceProfile(false); setIsAccountOpen(true); }}
                >
                  <IconShieldCheck size={15} />
                  Account settings
                </button>
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
            <span className="wb-rail-label">Sign in</span>
          </a>
        )}
      </nav>

      {/* ============================================================ review */}
      <section
        id="wb-review-panel"
        className={`wb-review wb-rise wb-rise-1${isReviewCollapsed ? ' wb-hidden' : ''}`}
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
            onClick={() => { handleClearChat(); showRailPanel('review'); }}
          >
            <IconPlus size={14} />
            New report
          </button>
          <button
            className="wb-pill wb-pill--outline"
            title="Search projects"
            aria-label="Search projects"
            onClick={() => showRailPanel('projects')}
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

          {/* Unverified means an address nobody has proved they can read. It is
              a nudge, not a gate: nothing here is withheld until it is done,
              because the account only ever holds this person's own reports and
              locking them out of their own work would cost more than it buys.
              Google accounts never see this — the popup already proved it. */}
          {user && !user.emailVerified && user.providerData.some((p) => p.providerId === 'password') && (
            <div style={{ padding: '12px 20px 0' }}>
              <div className="wb-note-line wb-warn">
                <span className="wb-ic"><IconWarn size={13} /></span>
                <span>
                  <b>Verify your email.</b> We sent a link when you created the account.{' '}
                  <button
                    type="button"
                    onClick={() => setIsAccountOpen(true)}
                    style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Send it again
                  </button>
                </span>
              </div>
            </div>
          )}

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

            {/* Generation. The ring around the mark *is* the progress bar — same
                `analyzingProgress`, same guarantee that it only ever reports
                what has actually arrived. The spinner, the clock and the three
                shimmering skeleton bars are gone: the status bar at the foot of
                the workspace already carries state and elapsed time, and this
                card sits in the middle of a conversation, where five stacked
                rows of furniture is the loudest thing on screen for a job the
                user already knows they started. */}
            {(isAnalyzing || isPaused) && (
              <div className={`wb-progress${isPaused ? ' wb-is-paused' : ''}`} aria-live="polite">
                <LogoPulse percent={progress.percent} paused={isPaused} size={56} />

                <b className="wb-state">
                  {isPaused ? 'Analysis paused' : progress.streamChars > 0 ? 'Writing report' : 'Reading your design'}
                </b>
                {/* stepLabel always names a step, so the `||` fallback this
                    used to carry is gone rather than dead. */}
                <span className="wb-stage">{stepLabel(progress)}</span>
                <span className="wb-metrics">
                  <b>{Math.round(progress.percent)}%</b>
                  {progress.streamChars > 0 && (
                    <span>· {progress.streamChars.toLocaleString()} chars</span>
                  )}
                </span>

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

                {/* Only once the wait is long enough to be worth explaining. */}
                {!isPaused && progress.streamChars === 0 && elapsedTime >= 20_000 && (
                  <p className="wb-why">
                    The model is still thinking — it can spend most of a run reasoning before
                    emitting a character. Nothing is streaming yet, so the ring is honestly
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
                  const uploadId = previewMeta[first]?.uploadId;
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
                        onClick={() => removeFile(group.indices, uploadId)}
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
                        onClick={() => removeTextAttachment(group.uploadId)}
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
        <div className={`wb-panel-body${railPanel === 'batch' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <span className="wb-col-title">Batch</span>
          </div>
          <div style={{ padding: '0 16px 16px', flex: 1, minHeight: 0, display: 'flex' }}>
            <Suspense fallback={null}>
              <BatchPanel
                ready={hasApiKey}
                onNeedKey={() => setIsConfigOpen(true)}
                runOne={runOneBatchFile}
                onOpen={(item) => {
                  const full = batchResults.current.get(item.id);
                  if (!full) return;
                  setResult(full);
                  setMessages([]);
                  showRailPanel('review');
                }}
              />
            </Suspense>
          </div>
        </div>

        <div className={`wb-panel-body${railPanel === 'history' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <span className="wb-col-title">Recent</span>
            {/* Was the words "this week", over a list that has always been every
                saved session regardless of age. Harmless while the rows showed
                no date; a plain contradiction now that they do. */}
            {/* Two-step, in place. A native confirm() is the one thing this app
                does not do — see the save notice — and "clear all" wiping every
                saved project on a single stray click is exactly the case a
                confirm exists for. */}
            {confirmingClearAll ? (
              <span className="wb-kicker wb-confirm">
                <span>Delete all {savedReports.length}?</span>
                <button
                  className="wb-mini wb-danger"
                  onClick={() => {
                    removeReports(savedReports.map((r) => r.id));
                    setConfirmingClearAll(false);
                  }}
                >
                  Delete
                </button>
                <button className="wb-mini" onClick={() => setConfirmingClearAll(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="wb-kicker">
                {savedReports.length} {savedReports.length === 1 ? 'session' : 'sessions'}
                {savedReports.length > 0 && (
                  <button
                    className="wb-mini"
                    onClick={() => setConfirmingClearAll(true)}
                    title="Delete every saved session"
                  >
                    Clear all
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="wb-list" style={{ paddingTop: 0 }}>
            {savedReports.length === 0 ? (
              <div className="wb-empty">Nothing yet.</div>
            ) : (
              savedReports.map((report) => {
                // Day and time. A bare clock time was the same six characters
                // for a session from this morning and one from last month.
                const stamp = formatSessionStamp(report.timestamp);
                const leaving = leavingReportIds.includes(report.id);
                return (
                  <div
                    key={report.id}
                    className={`wb-card${leaving ? ' wb-leaving' : ''}`}
                    onClick={() => handleLoadReport(report)}
                  >
                    <div className="wb-nm">{report.name}</div>
                    <div className="wb-sub">
                      {stamp && `${stamp} · `}
                      {report.messages.length} {report.messages.length === 1 ? 'note' : 'notes'}
                    </div>
                    {/* Same hover-revealed affordance as the Projects list, and
                        the same handler — these two panels are one array. */}
                    <div className="wb-row-actions">
                      <button
                        className="wb-danger"
                        aria-label={`Delete ${report.name}`}
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); removeReports([report.id]); }}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* The column's right edge, made draggable. Last child so it paints over
            the three panel bodies, and inside the section rather than beside it
            because the shell's three grid tracks are load-bearing everywhere
            else — a fourth item would land in the bench's track. */}
        <div
          className="wb-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the side panel"
          aria-controls="wb-review-panel"
          aria-valuenow={appliedReviewWidth}
          aria-valuemin={REVIEW_MIN_WIDTH}
          aria-valuemax={REVIEW_MAX_WIDTH}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={beginReviewResize}
          onPointerMove={moveReviewResize}
          onPointerUp={endReviewResize}
          onPointerCancel={endReviewResize}
          onDoubleClick={resetReviewWidth}
          onKeyDown={onReviewResizeKey}
        />
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
              {/* Between the picture and the file, because that is what it is:
                  the REPX laid out as it prints. See components/ReportPreview. */}
              <button role="tab" aria-selected={plate === 'print'} onClick={() => showPlate('print')}>Preview</button>
              <button role="tab" aria-selected={plate === 'data'} onClick={() => showPlate('data')}>Data</button>
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
            {/* Always in the bar, beside Save and Export, and disabled rather
                than absent when the local companion is not answering — see
                designerBridge.ts for the ping. It used to render only once
                `designerReady`, which made the feature invisible to everyone
                who had not already installed the companion: nothing on screen
                said the capability existed, so nobody went looking for it. The
                detection still decides whether it can be *clicked*; what
                changed is that it no longer decides whether anyone can find
                out. `title` carries the reason, so a greyed pill is never a
                dead end. */}
            <button
              className="wb-pill wb-pill--outline"
              onClick={openInDesigner}
              // Only the report gates this now. Whether the companion happens to
              // be running is no longer the user's problem to solve before
              // clicking — see `openInDesigner`, which starts it.
              disabled={!result?.repxContent || designerStarting}
              title={
                !result?.repxContent
                  ? 'This report has no DevExpress XML to open'
                  : designerReady
                    ? 'Open this report in the DevExpress designer on this machine'
                    : 'Start the DevExpress designer on this machine and open this report in it'
              }
            >
              <IconExternal size={14} />
              {designerStarting ? 'Starting designer…' : 'Open in designer'}
            </button>
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
                  {/* ReportMockup sits directly in the holder — it carries the
                      artifact's proof frame itself (see its root), so wrapping it
                      in `.wb-proof` would draw that frame twice. */}
                  <ReportMockup layout={result.layout!} sourceImages={mockupSourceImages} reportUnit={config.unit} />
                </div>
              )}

              {plate === 'print' && (
                <div className="wb-proof-holder wb-rise wb-rise-2">
                  {/* Lazy for its own sake: the pane is workspace-only and the
                      marketing pages were just taken off the entry chunk. */}
                  <Suspense fallback={null}>
                    <ReportPreview
                      repxContent={result.repxContent}
                      layout={result.layout}
                      title={result.title}
                      /* Editing writes the REPX only. The layout and the spec
                         still describe the source document, which is what the
                         Mockup is for — nudging a control in the file does not
                         change what was uploaded. */
                      onEdit={(xml, reason) => {
                        setResult({ ...result, repxContent: xml });
                        setSaveNotice(reason);
                      }}
                    />
                  </Suspense>
                </div>
              )}

              {plate === 'data' && (
                <div className="wb-sheet wb-reg-marks">
                  <Suspense fallback={null}>
                    <DataBinding
                      repxContent={result.repxContent}
                      /* Rewrites only the REPX. The layout and the spec still
                         describe the same report — a binding changes where a
                         cell's text comes from at print time, not what the
                         document is. */
                      onApply={(xml, summary) => {
                        setResult({ ...result, repxContent: xml });
                        setSaveNotice(summary);
                      }}
                    />
                  </Suspense>
                </div>
              )}

              {plate === 'spec' && (
                <div className="wb-sheet wb-reg-marks">
                  <div className="markdown-body">
                    {/* Lazy: react-markdown carries the micromark tokenizer and
                        is used only here. The fallback is deliberately the
                        unformatted spec rather than a spinner — the text is
                        already in hand, so showing it beats showing nothing
                        while the renderer arrives. */}
                    <Suspense
                      fallback={
                        // Inline rather than a new class: this is one element
                        // visible for a few hundred milliseconds, and the
                        // surrounding .markdown-body already supplies the
                        // typography. pre-wrap stops the raw spec forcing a
                        // horizontal scrollbar on the way past.
                        <div style={{ whiteSpace: 'pre-wrap' }}>{result.content}</div>
                      }
                    >
                      <Markdown>{result.content}</Markdown>
                    </Suspense>
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
              <div className="wb-sheet wb-reg-marks">
                <Eyebrow coord="x 000 · y 0000">Canvas</Eyebrow>
                {/* h2, not h3: this follows the bench's h1 and would otherwise
                    skip a level. `.wb-sheet h2` in workspace.css carries the
                    same styling the ported `.wb-sheet h3` rule gives, so this
                    looks identical. */}
                <h2 style={{ marginTop: 22 }}>Ready to process</h2>
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
        {/* Read from the same table the pipeline converts with, never written
            out here. This said `units 100/in` as a literal, which is true only
            for the default: pick TenthsOfAMillimeter and the bar still claimed
            100 where the report is built at 254, and Pixels at 96. It sits
            beside the version readout, which *is* derived, so the whole bar
            reads as live — and it names the scale of the file about to be
            exported, which is the worst place to be confidently wrong. */}
        <span>units {unitsPerInch(config.unit)}/in</span>
        {result?.layout && <span>{result.layout.sections.length} bands</span>}
        {/* Only when the report actually carries bindings, which now means
            somebody bound it in the Data tab — generation never binds anything
            by itself. Derived from repxContent for the same reason as the units
            readout above: this bar describes the file about to be exported. */}
        {boundFields.length > 0 && (
          <span title={`Bound to: ${boundFields.join(', ')}`}>
            {boundFields.length} bound
          </span>
        )}
        {/* Structural problems in the file about to be exported. Silent when
            there are none, which is the common case. The full text of each
            finding is in the tooltip and in the console; the bar has room for
            a count. See lib/repxAudit.ts. */}
        {repxAudit && !repxAudit.ok && (
          <span
            className={repxAudit.errors ? 'wb-bad' : 'wb-warn'}
            title={repxAudit.findings.map((f) => `${f.severity.toUpperCase()}: ${f.message}`).join('\n\n')}
          >
            {repxAudit.errors > 0 && `${repxAudit.errors} REPX error${repxAudit.errors > 1 ? 's' : ''}`}
            {repxAudit.errors > 0 && repxAudit.warnings > 0 && ', '}
            {repxAudit.warnings > 0 && `${repxAudit.warnings} REPX warning${repxAudit.warnings > 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {/* =========================================================== modals */}
      {isConfigOpen && (
        <div className="wb-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismissConfigWithoutSaving(); }}>
          <div
            className="wb-modal wb-reg-marks"
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-title"
            ref={configDialogRef}
            /* Focusable only programmatically: the effect above puts focus here
               on open so the dialog is where the keyboard is, without making it
               a Tab stop of its own afterwards. */
            tabIndex={-1}
          >
            <div className="wb-modal-head">
              <h2 id="config-title">Report configuration</h2>
              <button className="wb-pill wb-pill--round" onClick={dismissConfigWithoutSaving} aria-label="Close without saving">
                <IconClose size={16} />
              </button>
            </div>

            {/* Two columns above 760px, one below — see workspace.css. The split
                is the one the code already makes: everything on the left is a
                property of the document and goes through `reportConfigStore`'s
                allowlist; everything on the right is the key, which goes to
                `sessionStorage` and the vault and must never travel with it. */}
            <div className="wb-modal-body">
              <div className="wb-modal-col">
              <div className="wb-fset">
                <div className="wb-eyebrow"><b>x 000</b>Output<span className="wb-fade" /></div>
                {/* The two short values share a row and the long one takes the
                    width. The other way round — version alone, unit beside page
                    size — is what the single-column dialog did, and in a 328px
                    column it clipped the unit to "Hundredths of an". */}
                <div className="wb-grid2">
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
                        {/* 20.1 is here because the ERP this was first built for is
                            built against DevExpress.XtraReports.v20.1 and its
                            templates declare SerializerVersion 20.1.3.0. A newer
                            .repx does not open in an older designer, so without this
                            option Forma cannot produce a file that ERP can edit.
                            It is also the version installed on the development
                            machine, and therefore the only one a generated file can
                            actually be opened in here — see tools/RepxDesigner. */}
                        <option value="20.1">v20.1</option>
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
                <div>
                  <label className="wb-lbl" htmlFor="cfg-unit">Report unit</label>
                  <span className="wb-sel">
                    <select
                      className="wb-ctl"
                      id="cfg-unit"
                      value={config.unit}
                      onChange={(e) => setConfig({ ...config, unit: e.target.value })}
                    >
                      {/* The label is prose, the value is still the exact
                          DevExpress enum that goes into the XML. The enum names
                          were the labels and did not fit the field —
                          "HundredthsOfAnInch" rendered as "HundredthsOfAnIr…",
                          which is a worse thing to show than the words it
                          stands for. */}
                      <option value="HundredthsOfAnInch">Hundredths of an inch</option>
                      <option value="TenthsOfAMillimeter">Tenths of a millimetre</option>
                      <option value="Pixels">Pixels</option>
                    </select>
                    <IconChevronDown size={13} className="wb-caret" />
                  </span>
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

              </div>

              <div className="wb-modal-col">
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
                        /* The whole point of this app is that the key is not
                           written to disk. A password manager offering to save
                           it, or the browser offering to fill it, undoes that
                           from outside — and the field is revealed as plain text
                           by the eye button, where autocorrect would happily
                           rewrite an API key.

                           For the same reason this input is deliberately NOT
                           inside a <form>. Chromium logs a warning about that on
                           every load — "[DOM] Password field is not contained in
                           a form" — and it is the browser objecting to the
                           correct behaviour: that hint exists to help password
                           managers recognise sign-in forms, which is the one
                           thing this field must never look like. Do not silence
                           it by adding a form wrapper; that trades a console
                           line for the security property the app is built on.
                           If Enter-to-submit is ever wanted here, wire an
                           onKeyDown to the check-key handler instead. */
                        aria-describedby="cfg-key-note"
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <button
                        className="wb-peek"
                        onClick={() => setShowApiKey(!showApiKey)}
                        aria-label={showApiKey ? 'Hide key' : 'Show key'}
                      >
                        {showApiKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                      </button>
                    </span>
                    {/* Disabled while it runs: the check is a network round trip
                        to Google, and nothing about the button said so, so a
                        second click fired a second request. */}
                    <button
                      className="wb-pill wb-pill--outline"
                      onClick={handleCheckKey}
                      disabled={vaultBusy || !(config.customApiKey || '').trim()}
                    >
                      {vaultBusy ? 'Checking…' : 'Check key'}
                    </button>
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

                <div className="wb-note-line" id="cfg-key-note">
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
                        /* `new-password` rather than `off`: this is the one
                           field a manager may legitimately generate for, and it
                           stops it being autofilled with the account password,
                           which would silently become the vault passphrase. */
                        autoComplete="new-password"
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
                        autoComplete="new-password"
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
            </div>

            <div className="wb-modal-foot">
              <button className="wb-pill wb-pill--outline" onClick={dismissConfigWithoutSaving}>Cancel</button>
              <button className="wb-pill wb-pill--accent" onClick={saveConfigAndClose}>Save configuration</button>
            </div>
          </div>
        </div>
      )}

      {/* Rendered from the shell rather than from the rail's menu, which
          unmounts the moment it is clicked.

          Deliberately not keyed on `profileTick`: re-keying would remount the
          panel and throw away the fields and the "Name updated." line the user
          just earned. The counter only has to re-render this component. */}
      {isAccountOpen && user && (
        <Suspense fallback={null}>
          <AccountDialog
            user={user}
            onClose={() => setIsAccountOpen(false)}
            onProfileUpdated={() => setProfileTick((n) => n + 1)}
          />
        </Suspense>
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

    </div>
    {loginModal}
    </>
  );
}