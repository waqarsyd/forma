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
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconChevronsLeft,
  IconChevronsRight,
  IconClose,
  IconCopy,
  IconDownload,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconRedo,
  IconStack,
  IconKey,
  IconMoon,
  IconSearch,
  IconShieldCheck,
  IconSun,
  IconDoc,
  IconImage,
  IconLayout,
  IconLogin,
  IconLogout,
  IconPanelLeft,
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
import { aiReady, effectiveProvider, isVisionOnly, PROVIDER_NAMES, readProviderSettings, visionModelOf, writeProviderSettings } from './lib/aiProvider';
import type { DraftSource, TeamMember } from './lib/formaTeam';
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
import { loadAuth, loadFirebase, type AuthClient, type FirebaseClient } from './lib/firebaseClient';
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
/* Revision history. Lazy like the other three panels; it carries the diff. */
const RevisionsPanel = lazy(() => import('./components/RevisionsPanel'));
/* The report library. Lazy for the same reason as its neighbours: a visitor who
   never opens the panel should not download it, and it pulls in the chunker,
   the store and the search behind it. */
const LibraryPanel = lazy(() => import('./components/LibraryPanel'));
/* OCR's dialog, and the engine it loads, are fetched only when someone opens it. */
const OcrDialog = lazy(() => import('./components/OcrDialog'));
// The AI provider choice (2026-11-02), in the settings dialog only.
const ProviderSettings = lazy(() => import('./components/ProviderSettings'));
// What Forma remembers (2026-11-02), in the settings dialog only.
const MemorySettings = lazy(() => import('./components/MemorySettings'));
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
import { pushRevision, type Revision } from './lib/revisions';
/* The report library: filling it, using it, and listing what it holds.
   docs/proposals/rag.md carries the reasoning; this file only wires it up.

   Loaded on demand, for the reason lib/geminiClient.ts spells out: importing it
   here put the chunker, the store, the search and the embedding client into the
   ENTRY chunk, which every visitor to the landing page downloads. Measured at
   +17,318 B (82.2% -> 84.9% of that artifact's budget) before this was made
   dynamic. The types are a separate `import type`, which is erased entirely. */
const loadLibrary = () => import('./services/library');
import type { LibraryDeps, LibrarySource } from './services/library';
/* Persisting those revisions. Pure — it plans documents, it does not write them —
   so it stays eager while `accountData`'s path builders arrive through
   `loadFirebase()` with the SDK they import. */
import {
  saveRevisions,
  loadRevisions,
  type VersionIo,
  type VersionDocument,
} from './lib/revisionStore';
// Pure helpers live in src/lib so they can be unit-tested without importing the
// whole app (and pdf.js, and Firebase) into a test run.
import { formatXml, tokenizeXml, checkRepx } from './lib/repx';
import { readBoundFields } from './lib/repxBindingPlan';
import type { RepxAudit } from './lib/repxAudit';
import {
  describedRequest,
  fixInstruction,
  isDescribable,
  PREDEFINED_PROMPTS,
  shouldRetryForErrors,
  withAnswers,
  type ClarificationAnswer,
  type ReportDescriptionRequest,
} from './lib/promptToReport';
import { sourceRectFor } from './lib/sourceRect';
import { summariseUsage, describeUsage, type TokenUsage } from './lib/tokenUsage';
import { pingDesigner, sendToDesigner, designerFileName, launchDesigner, waitForDesigner, shouldRecheckDesigner } from './lib/designerBridge';
import { groupAttachments, type PreviewMeta } from './lib/attachments';
import {
  buildChatHistory,
  isGenerationTurn,
  markMessageError,
  nextMessageId,
  noteCountLabel,
  truncateFrom,
  withdrawTurn,
  type ChatMessage as ChatSessionMessage,
} from './lib/chatSession';
import { formatSessionStamp } from './lib/datetime';
import { unitsToPx, pointsToUnits, pdfTopFromBaseline, unitsPerInch } from './lib/reportGeometry';
import { repeatedHeadingTables } from './lib/mockupRows';
// LogoPulse, the progress ring of the generation card, went with the card on
// 2026-11-04 (the minimal workspace). Find that commit with
// git log --diff-filter=D -- src/components/LogoPulse.tsx, and recover the file
// with git show <it>~1:src/components/LogoPulse.tsx.
import ChatThread, { WorkingDots } from './components/ChatThread';
import Composer from './components/Composer';
import type { OcrBuiltReport } from './components/OcrDialog';
import type { ReaderBuiltReport } from './lib/ocrAttach';
import type { ReadPage } from './lib/ocrAttach';
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
  /**
   * What the generation cost, for the status bar.
   *
   * Optional and often absent: a report restored from a save or from the
   * revision history never had a request of its own, and the mock path makes
   * none. The readout hides itself rather than showing a zero.
   */
  usage?: TokenUsage | null;
}

/**
 * The transcript entry, bound to this app's two payload types.
 *
 * The shape and the rules that rewrite it live in `lib/chatSession.ts`, which is
 * generic over both so it never has to import upward from `src/lib` into the
 * component layer — the same arrangement `savedReport.ts` uses. This alias is
 * what keeps every use site below reading as plain `ChatMessage`.
 */
type ChatMessage = ChatSessionMessage<DesignResult, PreviewMeta>;


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
          // Its size in points too, so OCR can read the image at its resolution.
          const points = page.getViewport({ scale: 1 });
          out.imageMeta.push({ uploadId, file: name, page: n, pagePoints: { width: points.width, height: points.height } });
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
            `"${name}" has no text layer — it looks like a scan, so its text is being read with OCR in your browser, ` +
            `to place every string where it was printed. Its chip shows how far that has got.`
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

/**
 * Longest edge of an uploaded image, in pixels.
 *
 * **This buys upload time and browser memory. It does not buy tokens, and the
 * obvious assumption that it does is wrong.** Recorded here because it was
 * measured on 2026-09-06 and is the kind of thing that gets re-derived, or
 * worse, tuned in the belief that a smaller number is cheaper.
 *
 * Gemini bills an image by TILES, and the tile grid comes from the image's
 * shape rather than its size: the crop unit is `floor(min(w, h) / 1.5)`, so it
 * scales with the image and the tile count cancels out. The arithmetic on a
 * real upload, from the token log of that day:
 *
 *     2400x1500  crop unit 1000  ->  3 x 2 = 6 tiles = 1,548 tokens
 *     2048x1280  crop unit  853  ->  3 x 2 = 6 tiles = 1,548 tokens
 *
 * Identical. In practice the count reduces to `2 * ceil(1.5 * aspect)` tiles at
 * 258 tokens each, which depends on aspect ratio ALONE above the small-image
 * threshold. A portrait page is 4 tiles; a 16:9 screenshot is 6.
 *
 * The one resize that would save tokens is dropping BOTH dimensions to 384px or
 * under, which Google bills as a single 258-token tile -- a 6x cut, and an
 * invoice nobody can read. Accuracy is the product here, so that trade is not
 * available.
 *
 * What does reduce the image bill is a tighter CROP, because it can change the
 * aspect ratio and it puts more of the document inside each 768px tile. That is
 * a win on both counts and the only one worth chasing on this side; the prompt
 * was ~90% of that request's input, and the five behavioural sections that no
 * image can evidence are dropped from it automatically -- see BEHAVIOURAL in
 * `lib/promptSections.ts`.
 */
const MAX_IMAGE_EDGE = 2048;
const JPEG_QUALITY = 0.92;
/** A message that plainly asks for a report to be built, which needs no chat turn to tell. */
const PLAIN_BUILD = /^\s*(please\s+)?(create|build|make|design|generate|produce|draft|prepare)\s+(me\s+)?(a|an|the|my|our)?\s*[\p{L}\p{N} ]{0,40}?\b(report|list|register|invoice|statement|ledger|summary|payslips?|labels?|catalogue)\b/iu;
/** A message asking Forma to remember something; the full rule is REMEMBER in lib/memory.ts, which this mirrors. */
const REMEMBER_WORDS = /^\s*(please\s+)?(remember|always|from now on|never|i\s+(always\s+)?prefer|by default|note that)\b/i;
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

/**
 * `unit` and `audit` arrived here on 2026-11-04 with the status bar's removal:
 * the owner asked for a workspace as clean as the chat apps people know, so
 * the bar's readouts went, and the two worth keeping moved to the pane about
 * the file they describe: the scale it is built at, and what the REPX audit
 * still finds wrong (lib/repxAudit.ts), listed in full rather than as a count
 * with its findings in a tooltip.
 */
const RepxViewer = ({
  xml,
  unit,
  audit,
  usage,
}: {
  xml: string;
  unit?: string;
  audit?: RepxAudit | null;
  /** What the generation cost, when the model said (lib/tokenUsage.ts): a short line and its parts. */
  usage?: { short: string; long: string | null } | null;
}) => {
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
          {/* Read from the same table the pipeline converts with, never
              written out here: a literal "100/in" is right for the default
              unit and silently wrong at 254 or 96. It lived in the status bar
              until 2026-11-04; reportGeometry.test.ts guards it here. */}
          <span className="text-[11px] text-on-surface-variant font-mono" data-readout="units">
            {lines.length} lines · {xml.length.toLocaleString()} chars · units {unitsPerInch(unit)}/in
          </span>
          {usage && (
            <span className="text-[11px] text-on-surface-variant font-mono" title={usage.long ?? undefined}>
              {usage.short}
            </span>
          )}
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

      {/* What the REPX audit still finds after the repairs: silent when there
          is nothing, which is the common case. */}
      {audit && !audit.ok && (
        <details className="wb-audit rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3" data-audit>
          <summary className={`text-[11.5px] font-semibold cursor-pointer ${audit.errors ? 'text-[color:var(--bad-ink)]' : 'text-on-surface-variant'}`}>
            {audit.errors > 0 && `${audit.errors} REPX error${audit.errors > 1 ? 's' : ''}`}
            {audit.errors > 0 && audit.warnings > 0 && ', '}
            {audit.warnings > 0 && `${audit.warnings} REPX warning${audit.warnings > 1 ? 's' : ''}`}
          </summary>
          <ul className="flex flex-col gap-1.5 mt-2">
            {audit.findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] leading-[1.5] text-on-surface-variant">
                <span className={`mt-[3px] shrink-0 ${f.severity === 'error' ? 'text-[color:var(--bad-ink)]' : 'text-[color:var(--ink-faint)]'}`}>
                  <IconAlert size={12} />
                </span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </details>
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
const MockupTable = ({
  el,
  scaleFont,
  skipFirstRow,
}: {
  el: ReportElement;
  scaleFont: number;
  /**
   * Drop the heading row an earlier section already drew. Decided by
   * `repeatedHeadingTables`, which explains why the row stays in the data and
   * only the drawing changes.
   */
  skipFirstRow?: boolean;
}) => {
  const declared = el.rows || [];
  const rows = skipFirstRow && declared.length > 1 ? declared.slice(1) : declared;

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

  // The detail tables whose first row the PageHeader already drew. Computed
  // once for the whole page because the answer depends on what sits above each
  // table, which no single element can see.
  const repeatedHeadings = useMemo(() => repeatedHeadingTables(layout), [layout]);

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
                const isCheckbox = el.type === 'checkbox';

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

                    {/* A checkbox draws its box and its caption, matching what
                        the Preview draws from the REPX. The two panes answer
                        different questions -- fidelity to the source here, the
                        exported artifact there -- but a control present in one
                        and missing from the other reads as a generation bug. */}
                    {isCheckbox && (
                      <span className="px-1 w-full flex items-center gap-[6px]">
                        <span
                          aria-hidden
                          className="shrink-0 flex items-center justify-center border border-on-paper rounded-[2px]"
                          style={{ width: 11, height: 11, fontSize: 9, lineHeight: 1 }}
                        >
                          {el.checked ? '✓' : ''}
                        </span>
                        <span className="truncate">{el.content}</span>
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

                    {isTable && (
                      <MockupTable
                        el={el}
                        scaleFont={unitsToPx(1, reportUnit)}
                        skipFirstRow={repeatedHeadings.has(`${sIdx}:${eIdx}`)}
                      />
                    )}

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
type RailPanel = 'review' | 'projects' | 'batch' | 'revisions' | 'library';

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
/* Which library files are house style. Names only -- the library itself is in
   IndexedDB, and this is a handful of strings. */
const CANONICAL_KEY = 'libraryCanonical';

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

/** Prompt-to-Report: a description and no attachment. See lib/promptToReport.ts. */
const DESCRIBE_RUN: RunCopy = {
  start: 'Starting report generation from a description.',
  request: 'Sending the description to Gemini API...',
  done: 'Report designed from the description.',
  assistant: () =>
    "I've designed the report from your description. You can view the UI preview and specifications on the right, and the status bar says what the audit still found.",
};

/**
 * What the rest of Forma's team has for a run (2026-11-03, lib/formaTeam.ts),
 * captured when the run starts so a resume has it too. Absent on a turn
 * that only refines the open report in words: there is no page to read and
 * no draft worth handing over in its place.
 */
type TeamInput = {
  /** The staged pages OCR finished reading. */
  read: { meta: PreviewMeta; read: ReadPage }[];
  /** The first page, for Forma's vision model, when it is an image. */
  firstImage?: { src: string; meta: PreviewMeta };
  /** The same upload's last page, when it has more than one (2026-11-04): its footers and totals. */
  lastImage?: { src: string; meta: PreviewMeta };
  /** A report described in words: the house style is told, and Forma's own model drafts. */
  described?: ReportDescriptionRequest;
};

/** What the team brought to a run: the brief the AI is told, who took part, and the draft that stands in if the AI fails. */
type TeamPlan = {
  brief: string;
  members: TeamMember[];
  draft: (() => Promise<{ result: DesignResult; source: DraftSource } | null>) | null;
};

const NO_TEAM: TeamPlan = { brief: '', members: [], draft: null };

/**
 * The staged pages Forma's vision model reads, by index (2026-11-04): the
 * first, when it is an image, and the same upload's last page when it has
 * more than one, since a report's last page holds the footers and totals its
 * first does not. Empty when the first is not an image (a PDF read as one).
 */
function visionPages(images: readonly string[], metas: readonly PreviewMeta[]): number[] {
  if (!images[0]?.startsWith('data:image/') || !metas[0]) return [];
  let last = 0;
  metas.forEach((m, i) => {
    if (i > 0 && m.uploadId === metas[0].uploadId && images[i]?.startsWith('data:image/')) last = i;
  });
  return last > 0 ? [0, last] : [0];
}

// RESUMED_RUN, the copy for resuming a paused run, went with pause and resume
// on 2026-11-04: the chat shows working dots and a Stop, as other chat apps do.

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
   * the only thing in the app that broke out of its own visual language. It
   * shows beside Save in the bench's bar and clears itself; until 2026-11-04 it
   * also sat under the composer, which now holds problems only.
   */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
  /*
   * Auth alone at start, for the signed-in state every page shows; Firestore
   * only once someone is signed in, below (2026-11-01, see lib/firebaseClient):
   * a signed-out visitor never downloads the database SDK.
   */
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);
  useEffect(() => {
    let alive = true;
    loadAuth().then(
      (client) => {
        if (alive) setAuthClient(client);
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
    if (!authClient) return;
    const unsubscribe = authClient.service.auth.onAuthStateChanged((u) => {
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
  }, [authClient]);

  // Firestore, once someone is signed in: the projects list and the key vault
  // below wait for it.
  useEffect(() => {
    if (!user || firebase) return;
    let alive = true;
    loadFirebase().then(
      (client) => {
        if (alive) setFirebase(client);
      },
      (err) => console.warn('Firestore could not be loaded; projects stay on this device.', err),
    );
    return () => {
      alive = false;
    };
  }, [user, firebase]);

  // Fetch from Firebase
  useEffect(() => {
    if (!user || !firebase) return;
    const { service, sdk, paths, db } = firebase;
    try {
      const q = sdk.query(paths.reportsCollectionRef(db, user.uid));
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
  /**
   * The questions a typed description is waiting on (Prompt-to-Report in the
   * chat, 2026-11-01): the request they belong to and the message that asks
   * them. Answered by that message's form or by the next message typed.
   */
  const pendingClarifyRef = useRef<{ request: ReportDescriptionRequest; messageId: string } | null>(null);
  /** The transcript search: null while closed, the text typed while open. */
  const [chatQuery, setChatQuery] = useState<string | null>(null);
  /** The description the last run was started from, which Test data describes the report by. */
  const activeDescribeRef = useRef<ReportDescriptionRequest | undefined>(undefined);
  /** What a part of Forma's team is doing before the AI is asked, for the progress card; null when nothing. */
  const [teamStage, setTeamStage] = useState<string | null>(null);
  /**
   * AI-generated sample rows for the Preview, keyed by bound field. Null is
   * the one-placeholder-record preview. Cleared whenever the set of bound
   * fields changes, since rows keyed by yesterday's fields would print as
   * blanks; a nudge or a retype leaves them alone.
   */
  const [testRows, setTestRows] = useState<Record<string, string>[] | null>(null);
  const [testDataBusy, setTestDataBusy] = useState(false);
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

    // The AI provider and its settings (2026-11-02, lib/aiProvider.ts): the
    // choice in localStorage, the OpenRouter key in sessionStorage like this one.
    return { ...mergeStoredConfig(defaults, stored), customApiKey: storedKey, ...readProviderSettings() };
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

  useEffect(() => {
    writeProviderSettings(config);
  }, [config.provider, config.localUrl, config.localModel, config.openRouterModel, config.openRouterKey, config.visionModel]);

  /**
   * Whether an AI model is set up to answer: Gemini with a key, a local AI with
   * a model, or OpenRouter with a key and a model (lib/aiProvider.ts). Chat,
   * generation and refinement check it; without one, the chat box hands words
   * to Forma's own model and images to OCR. Until 2026-11-02 it was the Gemini
   * key alone, and the whole workspace's gate.
   */
  const hasApiKey = aiReady(config);
  /** The Gemini key field's own state, whichever provider answers. */
  const hasGeminiKey = Boolean(config.customApiKey?.trim());

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
    () => (user && firebase ? firebase.paths.vaultDocRef(firebase.db, user.uid) : null),
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

  /**
   * Wipe the key from this session without touching the encrypted copy.
   *
   * The confirmation goes through `keyCheck`, not `vaultNotice`, and that is
   * the whole point: `vaultNotice` renders inside the `canUseVault` block,
   * which is `!!user && isVaultAvailable()`. The **Clear** button beside the
   * key field appears whenever `hasApiKey`, signed in or not — so signed out
   * this told the user nothing at all. Measured 2026-09-08: the key really was
   * cleared and no element on the page said the word "cleared".
   *
   * `keyCheck` is the right home anyway, gated on nothing and rendered
   * directly under the key row, which is where the thing just happened.
   * `vaultNotice` is cleared alongside so a stale sync message cannot sit
   * under a key that is no longer here.
   */
  const handleClearKeyFromSession = () => {
    setConfig((prev) => ({ ...prev, customApiKey: '' }));
    clearSessionKey();
    setVaultNotice(null);
    setKeyCheck({ tone: 'ok', text: 'Key cleared from this browser session.' });
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
  // The elapsed-time clock went with the status bar on 2026-11-04. It set state
  // every 100 ms of a generation, re-rendering the whole app ten times a second
  // for a number in the bottom bar.

  // Save confirmations are transient — they replace an alert the user had to
  // dismiss, so they must not need dismissing either.
  useEffect(() => {
    if (!saveNotice) return;
    const t = setTimeout(() => setSaveNotice(null), 4000);
    return () => clearTimeout(t);
  }, [saveNotice]);


  const fileInputRef = useRef<HTMLInputElement>(null);
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

  /* The transcript follows itself now, inside `ChatThread`, which owns the
     scrolling element. A `messagesEndRef` and a `scrollIntoView` effect stood
     here from before the 2026-08-12 port until 2026-09-08 — the port took the
     sentinel div the ref pointed at, so the effect ran against `null` on every
     message and the thread never scrolled. Removed rather than reattached:
     the element that scrolls is not in this file any more. */

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
  /*
   * Revision history for the report on the bench.
   *
   * Milestones only -- each generation or refinement, and each binding pass.
   * A drag is not a revision: ReportPreview has its own undo, one entry per
   * gesture, and pushing here as well would bury the three or four versions
   * somebody actually wants to return to under forty nudges. See lib/revisions.
   */
  const [revisions, setRevisions] = useState<Revision[]>([]);

  /* ---------------------------------------------------------- report library */
  /**
   * The user's own reports, as house style. See docs/proposals/rag.md.
   *
   * Three pieces of state and no more: what the library holds (by file, not by
   * fragment), which files count as house style, and the dependency bundle that
   * owns the IndexedDB store. The work is all in services/library.ts -- this is
   * the part React needs to re-render.
   */
  const [librarySources, setLibrarySources] = useState<LibrarySource[]>([]);
  /**
   * Which files may be retrieved from. Off by default, and persisted here
   * because it is a handful of names rather than a store.
   *
   * The corpus is the argument for the default: a folder of real reports holds
   * drafts and variants, and an import path that made everything canonical
   * would show the model a draft as an example of how this place writes
   * reports.
   */
  const [canonicalSources, setCanonicalSources] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(CANONICAL_KEY);
      return new Set<string>(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  /* One bundle for the session. Creating it per call would open IndexedDB each time. */
  const libraryDeps = useRef<LibraryDeps | null>(null);
  const getLibraryDeps = useCallback(async (): Promise<LibraryDeps> => {
    if (!libraryDeps.current) libraryDeps.current = (await loadLibrary()).defaultDeps();
    return libraryDeps.current;
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const [{ sources }, deps] = await Promise.all([loadLibrary(), getLibraryDeps()]);
      setLibrarySources(sources(await deps.storage.load()));
    } catch {
      /* A library that cannot be read is a feature offering nothing, not a
         broken workspace -- the same rule libraryDb.load() follows. */
      setLibrarySources([]);
    }
  }, [getLibraryDeps]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    try {
      localStorage.setItem(CANONICAL_KEY, JSON.stringify([...canonicalSources]));
    } catch {
      /* Quota, private mode. The ticks are a convenience, not the library. */
    }
  }, [canonicalSources]);

  const handleLibraryImport = useCallback(
    async (files: File[]) => {
      const read = await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      );
      const { importReports } = await loadLibrary();
      try {
        return await importReports(read, await getLibraryDeps(), {
          apiKey: config.customApiKey?.trim() ?? '',
        });
      } finally {
        /* In a `finally`, because the chunks are written BEFORE the embedding
           request and the request is the part that fails. Refreshing only on
           success left the panel saying "Nothing here yet" over a store holding
           31 fragments -- observed on 2026-09-24 importing Invoice.repx with a
           key that could not embed. The list must show what is stored, not what
           the last call returned. */
        await refreshLibrary();
      }
    },
    [config.customApiKey, getLibraryDeps, refreshLibrary],
  );

  const handleLibraryRemove = useCallback(
    (name: string) => {
      void (async () => {
        const { removeSource } = await loadLibrary();
        await removeSource(name, await getLibraryDeps());
        setCanonicalSources((previous) => {
          const next = new Set(previous);
          next.delete(name);
          return next;
        });
        await refreshLibrary();
      })();
    },
    [getLibraryDeps, refreshLibrary],
  );

  const handleToggleCanonical = useCallback((name: string, canonical: boolean) => {
    setCanonicalSources((previous) => {
      const next = new Set(previous);
      if (canonical) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);
  /**
   * Which saved project the bench is currently showing, or null for unsaved work.
   *
   * Only `handleLoadReport` reads it, and only to discard a history that arrived
   * for a report the user has already navigated away from: two clicks in the
   * project list race, and the slower query answering second would otherwise
   * hang the first report's versions off the second report.
   */
  const openReportId = useRef<string | null>(null);
  /**
   * The same id again, as state, because the ref cannot drive a render.
   *
   * The ref exists to be read inside an async closure after an await -- state
   * captured there would be the value from the render that started the load, so
   * the guard would compare the wrong id. The Projects list needs the opposite:
   * a value that re-renders the row when it changes. Both are set together and
   * neither is derived from the other, so keep the two assignments adjacent.
   *
   * Before this the list marked a row open by comparing `result.title` to
   * `report.name`. Names are not unique -- two invoices both titled "Invoice"
   * marked each other open, which a mock whose every report is called "Mock
   * Invoice Report" showed as EVERY row highlighted at once (2026-09-06).
   */
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const recordRevision = useCallback((label: string, snapshot: DesignResult) => {
    setRevisions((list) => pushRevision(list, label, {
      content: snapshot.content,
      // Both are optional on DesignResult: a generation that returned no XML
      // still produced a report worth being able to return to, and the
      // duplicate check compares REPX, where two empties are correctly equal.
      repxContent: snapshot.repxContent ?? '',
      title: snapshot.title ?? '',
      layout: snapshot.layout,
    }));
  }, []);

  const batchResults = useRef<Map<string, DesignResult>>(new Map());
  const runOneBatchFile = useCallback(async (file: File, signal: AbortSignal, id: string) => {
    const ingested = await ingestFile(file, `batch-${id}`, config.unit);
    const parts = toAttachmentParts(ingested.images, ingested.texts);
    const { analyzeReportDesign } = await loadGemini();
    const response = await analyzeReportDesign('', parts, config, undefined, signal);
    const { auditRepx } = await import('./lib/repxAudit');
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

  /**
   * The attached pages OCR can read: every image, and every PDF page with no
   * text layer. A page whose text came out of its file is exact already.
   */
  const ocrPages = useMemo(() => {
    const withText = new Set(attachmentTexts.map((t) => `${t.uploadId}#${t.page ?? 0}`));
    return previews.flatMap((src, i) => {
      const meta = previewMeta[i];
      return meta && !withText.has(`${meta.uploadId}#${meta.page ?? 0}`) ? [{ src, meta }] : [];
    });
  }, [previews, previewMeta, attachmentTexts]);

  /*
   * An image's text is read after the message is sent (2026-11-03), one page
   * at a time, since the engine is one worker. The owner asked for the chat to
   * work as other chat apps do: attaching a file shows the file, and the rest
   * happens behind the scenes once the message goes. From 2026-11-01 reading
   * began as a page was attached, its chip showing "Reading text 36%" and
   * holding the send until it finished. Now it is a step of the run, which the
   * reply says ("Reading the text on your page…"), still in the browser, so an
   * upload never leaves it. A page read once is not read again: a retry or a
   * second message reuses its reading. The engine loads only when needed.
   */
  type OcrRun = { state: 'done'; read: ReadPage } | { state: 'failed' };
  const [ocrRuns, setOcrRuns] = useState<Record<string, OcrRun>>({});
  /** Each page's reading by key, for this session: null when it could not be read. */
  const ocrRead = useRef<Record<string, ReadPage | null>>({});
  const ocrKey = (meta: PreviewMeta) => `${meta.uploadId}#${meta.page ?? 0}`;

  /** Read the pages' text, reporting which page is being read and how far it has got. */
  const readPages = async (
    pages: readonly { src: string; meta: PreviewMeta }[],
    onProgress?: (page: number, of: number, progress: number) => void,
  ): Promise<{ meta: PreviewMeta; read: ReadPage }[]> => {
    const out: { meta: PreviewMeta; read: ReadPage }[] = [];
    for (const [i, { src, meta }] of pages.entries()) {
      const key = ocrKey(meta);
      let read = ocrRead.current[key];
      if (read === undefined) {
        try {
          const { readPage } = await import('./lib/ocrAttach');
          read = await readPage(src, meta, config.unit, config.pageSize, (progress) => onProgress?.(i, pages.length, progress));
        } catch (err) {
          // The image still goes with the message; only its text does not.
          console.warn(`The text of ${meta.file} could not be read:`, err);
          read = null;
        }
        ocrRead.current[key] = read;
        const settled = read;
        setOcrRuns((runs) => ({ ...runs, [key]: settled ? { state: 'done', read: settled } : { state: 'failed' } }));
      }
      if (read) out.push({ meta, read });
    }
    return out;
  };

  /** Pages sent with a message, by upload, so what was read in them can be reviewed from a reply. */
  const [sentPages, setSentPages] = useState<Record<string, { src: string; meta: PreviewMeta }[]>>({});
  const reviewable = useMemo(
    () => new Set(Object.entries(sentPages).filter(([, pages]) => pages.some(({ meta }) => ocrRuns[ocrKey(meta)]?.state === 'done')).map(([id]) => id)),
    [sentPages, ocrRuns],
  );

  /** What the reply says while pages are read. */
  const readingNote = (page: number, of: number, progress: number) =>
    `Reading the text on your page${of > 1 ? `s (${page + 1} of ${of})` : ''}… ${Math.round(progress * 100)}%`;

  /**
   * Read the staged pages behind the scenes, after the message is in the
   * thread: the reply placeholder says how far it has got, and the composer
   * is held as for any reply. The pages are kept for the review a reply built
   * from their text offers.
   */
  const readSentPages = async (pages: readonly { src: string; meta: PreviewMeta }[]) => {
    if (!pages.length) return [];
    setSentPages((prev) => {
      const next = { ...prev };
      for (const p of pages) next[p.meta.uploadId] = [...(next[p.meta.uploadId] ?? []).filter((q) => ocrKey(q.meta) !== ocrKey(p.meta)), p];
      return next;
    });
    setIsChatting(true);
    setStreamingReply(readingNote(0, pages.length, 0));
    try {
      return await readPages(pages, (page, of, progress) => setStreamingReply(readingNote(page, of, progress)));
    } finally {
      setIsChatting(false);
      setStreamingReply('');
    }
  };

  /** The upload whose reading is being reviewed, over its image, with Build .repx. */
  const [ocrReview, setOcrReview] = useState<string | null>(null);
  const ocrReviewPages = useMemo(() => (ocrReview ? sentPages[ocrReview] ?? [] : []), [sentPages, ocrReview]);

  /** A report built from OCR alone: every pane, a revision, and a line in the thread. */
  const handleOcrBuild = (built: OcrBuiltReport) => {
    const newResult: DesignResult = {
      content: built.markdown,
      timestamp: new Date(),
      title: built.title,
      layout: built.layout,
      repxContent: built.repxContent,
      usage: null,
    };
    setResult(newResult);
    recordRevision('Read by OCR', newResult);
    setActiveTab('ui');
    const unsure = built.flagged
      ? ` ${built.flagged} ${built.flagged === 1 ? 'text holds a word' : 'texts hold words'} read at low confidence, ` +
        `named lowConfidence… in the report: check ${built.flagged === 1 ? 'it' : 'them'} against the source.`
      : '';
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'assistant',
      text: `Built "${built.title}" from the text OCR read, with no model involved.${unsure}`,
      result: newResult,
    }]);
    setOcrReview(null);
  };

  /**
   * A report Forma's box reader built from the text OCR read (2026-11-04,
   * lib/boxReader.ts): banded, its records printing from bound fields. The
   * page as OCR read it, every text where it printed, is kept as the revision
   * before it, so either is one click away in Revisions.
   */
  const handleReaderBuild = (built: ReaderBuiltReport, copy: OcrBuiltReport | null) => {
    if (copy) recordRevision('Read by OCR', { content: copy.markdown, timestamp: new Date(), title: copy.title, layout: copy.layout, repxContent: copy.repxContent, usage: null });
    const newResult: DesignResult = { content: built.markdown, timestamp: new Date(), title: built.title, layout: built.layout, repxContent: built.repxContent, usage: null };
    setResult(newResult);
    recordRevision("Forma's box reader", newResult);
    setActiveTab('ui');
    const bands = built.skeleton.bands.filter((b) => b.controls.length).length;
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'assistant',
      text:
        `Built "${built.title}" from the text OCR read, with Forma's box reader putting each text in its band: ` +
        `${bands} ${bands === 1 ? 'band' : 'bands'}, the records printing from bound fields.` +
        (copy ? ' The page exactly as OCR read it is the revision before this one.' : ''),
      result: newResult,
    }]);
    setOcrReview(null);
  };

  /** Forma's box reader's report from the pages read, or null when it cannot load or finds no text. */
  const readerBuild = async (read: readonly { meta: PreviewMeta; read: ReadPage }[]): Promise<ReaderBuiltReport | null> => {
    try {
      const [{ loadBoxReader }, { buildWithReader }] = await Promise.all([import('./lib/boxReader'), import('./lib/ocrAttach')]);
      return buildWithReader(read, await loadBoxReader(), config.pageSize);
    } catch (err) {
      console.warn("Forma's box reader could not read the page.", err);
      return null;
    }
  };

  /** The text read from the sent pages, as attachments for the message. */
  const ocrAttachments = async (read: readonly { meta: PreviewMeta; read: ReadPage }[]): Promise<TextAttachment[]> => {
    if (!read.length) return [];
    const { ocrTexts } = await import('./lib/ocrAttach');
    const stamp = Date.now();
    return ocrTexts(read, config.unit, config.pageSize).map((t, i) => ({ ...t, id: `${stamp}-${i}-ocr-${t.file}-p${t.page ?? 1}` }));
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
    openReportId.current = null;
    setOpenProjectId(null);
    setPreviews([]);
    setPreviewMeta([]);
    setAttachmentTexts([]);
    setUploadNotices([]);
    setPrompt('');
    setError(null);
    setMessages([]);
    // A new conversation owes no answers to the last one's questions.
    pendingClarifyRef.current = null;
    setChatQuery(null);
    setOcrReview(null);
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
    /* `loadAuth()` is already resolved wherever this is reached — every
       caller failed a Firestore call to get here, so the module is in memory
       and this only awaits a settled promise. It is the auth half rather than
       `loadFirebase()` because `handleFirestoreError` lives there, so this
       still reports when the Firestore chunk is what failed. The user message
       is set outside the chain so it lands even if the module itself did. */
    loadAuth()
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

  /**
   * The Firestore half of revision storage, and the only place it is spelled out.
   *
   * Everything above this — planning, budgeting, the numbering — lives in
   * `lib/revisionStore.ts` and is exercised against the emulator through this
   * same interface by `tests/revisionRoundTrip.test.ts`. What is left here is
   * four SDK calls, which is the part a test cannot reach without a browser and
   * the part least likely to be wrong.
   *
   * The `orderBy` is not decoration: `fromVersionDocuments` numbers downwards
   * from the newest and trusts the caller to have ordered them, so reading this
   * collection unordered would hand the highest id to whichever document
   * Firestore returned first.
   */
  const versionIo = async (uid: string, reportId: string): Promise<VersionIo> => {
    const { sdk, paths, db } = await loadFirebase();
    const collectionRef = paths.versionsCollectionRef(db, uid, reportId);
    const docRef = (id: string) => paths.versionDocRef(db, uid, reportId, id);
    return {
      list: async () => (await sdk.getDocs(collectionRef)).docs.map((entry) => entry.id),
      read: async () =>
        (await sdk.getDocs(sdk.query(collectionRef, sdk.orderBy('timestamp', 'desc')))).docs.map(
          (entry) => entry.data() as VersionDocument,
        ),
      write: async (document) => { await sdk.setDoc(docRef(document.id), document); },
      remove: async (id) => { await sdk.deleteDoc(docRef(id)); },
    };
  };

  /**
   * Write the revision history beside a report that has just been saved.
   *
   * Separate from the report write, and allowed to fail on its own. The report
   * is the thing the user asked to save; losing the history is a smaller loss
   * than turning a successful save into a failed one, so this never throws into
   * `handleSaveReport` and never calls `reportFirestoreFailure` — that sets an
   * error saying the project could not be saved, which would be untrue.
   *
   * Signed out gets nothing, deliberately. See the header of
   * `lib/revisionStore.ts`: localStorage is one shared 5–10 MB quota across
   * every project, and a megabyte of history per report would evict the reports.
   *
   * The read of what is already stored looks redundant today — `handleSaveReport`
   * mints a new `reportId` on every save, so the collection always comes back
   * empty and the plan always writes everything. It is here because the plan is
   * what makes this correct the day saving updates a project in place instead of
   * creating another one, and an empty query is a cheap price for not having to
   * remember that.
   */
  const persistRevisions = async (
    reportId: string,
  ): Promise<'none' | 'saved' | 'partial' | 'failed'> => {
    if (!user || revisions.length === 0) return 'none';
    try {
      const outcome = await saveRevisions(await versionIo(user.uid, reportId), revisions, reportId, user.uid);
      return outcome.tooLarge.length > 0 ? 'partial' : 'saved';
    } catch (err) {
      console.warn('The report was saved, but its version history was not:', err);
      return 'failed';
    }
  };

  /**
   * Put the panel that shows notices back on screen.
   *
   * `saveNotice` and `error` both render in the Composer, which lives in the
   * Review panel — so a save attempted from the **Projects** panel reported
   * into a `wb-hidden` subtree. Measured 2026-09-08: on failure the message was
   * in the DOM at 0x0 with `onScreen=false`, and since a failed save also adds
   * no card, the user got no card and no message. Silence, from the panel you
   * are most likely to be on while managing saved projects.
   *
   * Only the failure paths call this. A *successful* save from the Projects
   * panel already announces itself the best way it can — the new row appears
   * in the list the user is looking at — and yanking the panel away from them
   * to show a confirmation they do not need would be worse than the bug.
   */
  const revealSaveFailure = () => setRailPanel('review');

  /** A report the user keeps teaches the memory its style, never its words (lib/memory.ts). */
  const rememberKept = (repx: string | undefined) => {
    if (!repx) return;
    void import('./lib/memory').then(m => {
      const style = m.keptStyleOf(repx);
      if (style) m.writeMemory(m.rememberKept(m.readMemory(), style));
    }).catch(() => undefined);
  };

  const handleSaveReport = async () => {
    if (!result && messages.length === 0) return;
    rememberKept(result?.repxContent);
    const reportId = Date.now().toString();
    const ts = Date.now();
    // Saving makes this the open project, so the list marks the row it just
    // created rather than nothing.
    openReportId.current = reportId;
    setOpenProjectId(reportId);

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
        const { sdk, paths, db } = await loadFirebase();
        const docRef = paths.reportDocRef(db, user.uid, reportId);

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

        // After the report, and only after: a version filed under a report that
        // failed to save would be history for something nobody can open.
        const history = await persistRevisions(reportId);
        const historyNote =
          history === 'saved' ? ' Its version history came with it.'
          : history === 'partial' ? ' One version was too large to sync; the rest came with it.'
          : history === 'failed' ? ' Its version history could not be synced — it is still here for this session.'
          : '';

        setSaveNotice(
          (imagesDropped
            ? 'Saved to your projects — the uploaded images were too large to sync, so the spec and REPX were saved without them.'
            : 'Saved to your projects.') + historyNote
        );
      } catch (err) {
        reportFirestoreFailure(err, OperationType.WRITE, `users/${user.uid}/reports/${reportId}`,
          'That project could not be saved to your account. It is still open here — try again in a moment.');
        revealSaveFailure();
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
        revealSaveFailure();
        return;
      }

      setSavedReports(updated);
      setSaveNotice('Saved on this device. Sign in to sync across devices.');
    }
  };

  /**
   * Open a saved project, and bring its history with it.
   *
   * The report goes onto the bench synchronously and the history follows,
   * because the history is a second round trip and the report should not wait on
   * it. `setRevisions([])` first is not tidiness: without it the previous
   * project's versions stay in the panel and read as belonging to this one — the
   * one way a revision list can be actively misleading rather than merely empty.
   */
  const handleLoadReport = async (report: SavedReport) => {
    setMessages(report.messages);
    setResult(report.result);
    setRevisions([]);
    setRailPanel('review');
    openReportId.current = report.id;
    setOpenProjectId(report.id);

    if (!user) return;
    try {
      // Drops any version whose snapshot will not parse, and numbers the rest
      // downwards from the newest — see the note on `fromVersionDocuments`.
      const restored = await loadRevisions(await versionIo(user.uid, report.id));
      if (openReportId.current !== report.id) return;
      setRevisions(restored);
    } catch (err) {
      // Deliberately not an error banner. The project opened; the panel is
      // simply empty, which is the same thing it shows for a project saved
      // before this existed.
      console.warn('That project opened, but its version history did not load:', err);
    }
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
        const { paths, db } = await loadFirebase();
        // Not `deleteDoc(reportDocRef(...))`. Firestore does not delete a
        // subcollection with its parent, so that would leave the whole version
        // history behind, under an account that may itself go next, reachable
        // by nobody -- and it looks exactly like a successful delete.
        await paths.deleteReportAndVersions(db, user.uid, id);
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
      await (await loadAuth()).service.logOut();
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
  /** A report Forma's own model designs from a description, with no AI: the chat box with no key, and the stand-in when the AI fails. */
  const offlineDesign = async (request: ReportDescriptionRequest, message: string) => {
    const [offline, { loadFormaModel }, { parseDataSource }, { readMemory, preferencesOf }] = await Promise.all([
      import('./lib/offlineGenerator'),
      import('./lib/formaModel'),
      import('./lib/dataSource'),
      import('./lib/memory'),
    ]);
    const fields = request.dataSchema
      ? parseDataSource(request.dataSchema).fields.map(f => ({ name: f.name, type: f.type === 'string' ? ('text' as const) : f.type }))
      : undefined;
    const design = offline.generateOffline(await loadFormaModel(), { description: request.description || message, fields, preferences: preferencesOf(readMemory()) });
    const newResult: DesignResult = {
      content: design.markdown,
      timestamp: new Date(),
      title: design.title,
      layout: design.layout,
      repxContent: design.repx,
      usage: null,
    };
    return { design, result: newResult, reply: offline.designedReply(design) };
  };

  /**
   * Everything Forma's own parts bring to a run before the AI is asked
   * (2026-11-03, lib/formaTeam.ts). Each part is optional and none can fail
   * the run: a vision model that is off, or a model file that will not load,
   * leaves that part out with a warning in the console.
   * - A picture: Forma's vision model, when one is set up, reads the first
   *   page, and OCR's words go into its boxes. That draft is the brief, and
   *   the stand-in. With no vision model, OCR's own build is the stand-in.
   * - A description: the house style Forma's own model learned is the brief,
   *   and that model's own design is the stand-in.
   */
  const prepareTeam = async (input: TeamInput | undefined, signal: AbortSignal): Promise<TeamPlan> => {
    if (!input) return NO_TEAM;
    const members: TeamMember[] = [];
    let brief = '';
    let draft: TeamPlan['draft'] = null;
    if (input.read.length) members.push('ocr');

    const vision = input.firstImage ? visionModelOf(config) : null;
    if (vision && input.firstImage) {
      try {
        const [{ readSkeleton }, { skeletonToDesign, pageTextsOf, mergePageSkeletons }, { detectLayout }, { pageForImage }, { draftBrief }] = await Promise.all([
          import('./services/formaVision'),
          import('./lib/skeletonRepx'),
          import('./lib/ocrLayout'),
          import('./lib/reportGeometry'),
          import('./lib/formaTeam'),
        ]);
        const first = input.firstImage.meta;
        setTeamStage("Forma's vision model is reading the layout");
        // The first page, and the upload's last when it has more (2026-11-04),
        // whose footers and totals the first does not show.
        const [firstReading, lastReading] = await (async () => {
          const one = await readSkeleton(vision, input.firstImage!.src, signal);
          const two = input.lastImage ? await readSkeleton(vision, input.lastImage.src, signal).catch(() => null) : null;
          return [one, two] as const;
        })().finally(() => setTeamStage(null));
        if (!firstReading.skeleton) throw new Error('its answer had no page line');
        const reading = { skeleton: mergePageSkeletons(firstReading.skeleton, ...(lastReading?.skeleton ? [lastReading.skeleton] : [])) };
        const paper = reading.skeleton.paper === 'Custom' ? config.pageSize : reading.skeleton.paper;
        const page = input.read.find(({ meta }) => meta.uploadId === first.uploadId && (meta.page ?? 0) === (first.page ?? 0));
        const texts = page
          ? pageTextsOf(detectLayout([{ ocr: page.read.ocr, page: pageForImage(page.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }))
          : [];
        const design = skeletonToDesign(reading.skeleton, { texts, title: first.file.replace(/\.[^.]+$/, '') });
        brief = draftBrief(reading.skeleton, design.layout, config.unit);
        members.push('vision');
        const visionResult: DesignResult = { content: design.markdown, timestamp: new Date(), title: design.title, layout: design.layout, repxContent: design.repx, usage: null };
        draft = async () => ({ result: visionResult, source: 'vision' });
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn("Forma's vision model could not read the page; the AI designs without its draft.", err);
      }
    }
    // With no vision model's draft, Forma's box reader puts the texts OCR read
    // in their bands (2026-11-04, lib/boxReader.ts), and that is the brief and
    // the stand-in. It needs no AI and no GPU, so it is there for every picture.
    if (!draft && input.read.length) {
      const built = await readerBuild(input.read);
      if (built && !signal.aborted) {
        const { draftBrief } = await import('./lib/formaTeam');
        brief = draftBrief(built.skeleton, built.layout, config.unit, 'reader');
        members.push('reader');
        const readerResult: DesignResult = { content: built.markdown, timestamp: new Date(), title: built.title, layout: built.layout, repxContent: built.repxContent, usage: null };
        draft = async () => ({ result: readerResult, source: 'reader' });
      }
    }
    if (!draft && input.read.length) {
      const read = input.read;
      draft = async () => {
        const { buildFromRead } = await import('./lib/ocrAttach');
        const built = buildFromRead(read, config.unit, config.pageSize);
        if (!built) return null;
        return {
          result: { content: built.markdown, timestamp: new Date(), title: built.title, layout: built.layout, repxContent: built.repxContent, usage: null },
          source: 'ocr',
        };
      };
    }

    const described = input.described;
    if (described) {
      try {
        const [{ loadFormaModel }, { houseStyleBrief }] = await Promise.all([import('./lib/formaModel'), import('./lib/formaTeam')]);
        const model = await loadFormaModel();
        brief = houseStyleBrief(model.style, model.reports, config.unit);
        if (brief) members.push('house');
      } catch (err) {
        console.warn("Forma's own model could not be loaded; the AI designs without its house style.", err);
      }
      draft = async () => ({ result: (await offlineDesign(described, described.description)).result, source: 'offline' });
    }
    return { brief, members, draft };
  };

  const runGeneration = async (
    currentPrompt: string,
    currentPreviews: readonly string[],
    currentTexts: readonly TextAttachment[],
    copy: RunCopy,
    /** Set for a Prompt-to-Report run: no attachments, the description is the source. */
    describeRequest?: ReportDescriptionRequest,
    /** What Forma's own parts bring (lib/formaTeam.ts); absent on a refinement in words. */
    teamInput?: TeamInput,
  ) => {
    loadingIntervalRef.current = setInterval(() => setProgress(tickSimulated), STEP_INTERVAL_MS);

    console.log(`${copy.start} Prompt: "${currentPrompt}"`);
    console.debug(`Included ${currentPreviews.length} preview images/files.`);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    /** The AI chosen in the settings, by name, for the replies. */
    const aiName = PROVIDER_NAMES[effectiveProvider(config)];
    let team: TeamPlan = NO_TEAM;

    try {
      team = await prepareTeam(teamInput, signal);
      if (signal.aborted) return;
      // Text before images, and malformed previews dropped rather than thrown
      // on — see src/lib/attachmentParts.ts.
      const attachmentParts = toAttachmentParts(currentPreviews, currentTexts);

      console.debug(copy.request);
      const { analyzeReportDesign } = await loadGemini();

      /**
       * House style, retrieved only on a refinement and only from files the
       * user has ticked.
       *
       * `result` being present is what makes this a refinement: the draft is
       * the query, which is the whole reason retrieval waits for the second
       * pass rather than running on the screenshot (see lib/houseStyle.ts).
       *
       * Failure is swallowed to a warning on purpose. This is an enhancement to
       * a request that works perfectly well without it, and an empty library, a
       * blocked IndexedDB or a refused embedding must not cost the user the
       * generation they actually asked for.
       */
      let houseStyle = '';
      if (result?.repxContent && canonicalSources.size > 0) {
        try {
          const { retrieveHouseStyle } = await loadLibrary();
          houseStyle = await retrieveHouseStyle(
            result.repxContent,
            currentPrompt,
            await getLibraryDeps(),
            {
              apiKey: config.customApiKey?.trim() ?? '',
              signal,
              where: (entry) => canonicalSources.has(entry.chunk.source),
            },
          );
        } catch (error) {
          console.warn('House style could not be retrieved; generating without it.', error);
        }
      }

      // The user's remembered preferences (lib/memory.ts), as their own block
      // ahead of the request, never mixed into the words they typed.
      const remembered = await import('./lib/memory').then(m => m.instructionsOf(m.readMemory())).catch(() => '');
      if (remembered && team.members.length) team.members.push('memory');
      let response = await analyzeReportDesign(
        // Passed through empty when the user typed nothing. It used to become
        // "Generate a professional DevExpress report layout based on these
        // visuals." here, which handed the model an instruction nobody gave and
        // then told it to apply that as a modification. See lib/userInstructions.ts.
        currentPrompt,
        attachmentParts,
        config,
        result ? { layout: result.layout, repxContent: result.repxContent, houseStyle } : undefined,
        signal,
        handleStreamProgress,
        { ...(describeRequest ? { description: describeRequest } : {}), remembered, formaBrief: team.brief },
      );

      if (signal.aborted) {
        console.debug('Generation aborted/paused by user.');
        return;
      }

      /*
       * The repair loop, for a report designed from words.
       *
       * DevExpress's Prompt-to-Report retries a layout the model got wrong up
       * to RetryAttemptCount times. Here the audit decides: only ERRORS -- a
       * file a designer refuses or silently loses content over -- send the
       * report back, and the model is told exactly which, with the previous
       * report as the thing to fix rather than a blank page. Warnings never
       * do; a second generation over a warning trades a usable report for a
       * different one. Bounded by MAX_FIX_ATTEMPTS in lib/promptToReport.ts.
       * Image runs are not retried this way: an error there is more often a
       * repair that declined than a layout the model can be talked out of.
       */
      if (describeRequest) {
        const { auditRepx } = await import('./lib/repxAudit');
        let attempt = 1;
        let audit = auditRepx(response.repxContent, response.layout);
        while (shouldRetryForErrors(audit, attempt)) {
          attempt += 1;
          console.warn(`Report has ${audit.errors} structural error(s) after repairs; asking for a fix (attempt ${attempt}).`);
          const fixed = await analyzeReportDesign(
            fixInstruction(audit),
            [],
            config,
            { layout: response.layout, repxContent: response.repxContent },
            signal,
            handleStreamProgress,
            { description: describeRequest },
          );
          if (signal.aborted) {
            console.debug('Generation aborted/paused by user during repair.');
            return;
          }
          const next = auditRepx(fixed.repxContent, fixed.layout);
          // Keep the better of the two; a repair that made things worse is not applied.
          if (next.errors <= audit.errors) {
            response = fixed;
            audit = next;
          } else {
            console.warn(`The repair attempt had ${next.errors} error(s) against ${audit.errors}; keeping the earlier report.`);
            break;
          }
        }
      }

      console.log('Successfully received response from Gemini API.');
      console.debug(`Generated Layout Title: ${response.layout.title}`);
      console.debug(`Generated REPX length: ${response.repxContent.length} characters`);

      const newResult = {
        content: response.markdown,
        timestamp: new Date(),
        title: response.layout.title,
        layout: response.layout,
        repxContent: response.repxContent,
        usage: response.usage ?? null
      };

      setResult(newResult);
      // A refinement turn replaces the whole report, so this is the moment the
      // previous one would otherwise be gone for good.
      recordRevision(result ? 'Refined' : 'Generated', newResult);
      setActiveTab('ui');

      // Add assistant message, with who took part when more than the AI did.
      const credits = team.members.length
        ? await import('./lib/formaTeam').then(m => m.teamLine([...team.members, 'ai', 'checks'], aiName)).catch(() => '')
        : '';
      const newAssistantMsg: ChatMessage = {
        id: nextMessageId(),
        role: 'assistant',
        text: credits ? `${copy.assistant(Boolean(currentPrompt))} ${credits}` : copy.assistant(Boolean(currentPrompt)),
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

      // Forma's own draft stands in for the AI that could not answer
      // (lib/formaTeam.ts), rather than the request ending in an error.
      if (team.draft) {
        try {
          const made = await team.draft();
          if (made && !signal.aborted) {
            const { fallbackReply } = await import('./lib/formaTeam');
            setResult(made.result);
            recordRevision("Forma's own draft", made.result);
            setActiveTab('ui');
            setMessages(prev => [...prev, {
              id: nextMessageId(),
              role: 'assistant',
              text: fallbackReply(aiName, err?.message || friendlyMessage, made.source),
              result: made.result,
            }]);
            return;
          }
        } catch (draftError) {
          console.warn("Forma's own draft could not be made either.", draftError);
        }
      }
      setError(friendlyMessage);
    } finally {
      if (!signal.aborted) {
        setProgress(finishProgress);
        setTimeout(() => {
          setIsAnalyzing(false);
          setProgress(IDLE_PROGRESS);
        }, 500);
      }
      if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    }
  };

  // handleResume went with pause on 2026-11-04 (see RESUMED_RUN above). A
  // stopped run is sent again by sending the message again.

  /** The composer's Stop, while a generation runs: the run is discarded. */
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsAnalyzing(false);
    setProgress(IDLE_PROGRESS);
    if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'assistant',
      text: 'Stopped.'
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

    setMessages((prev) => truncateFrom(prev, id));
    setError(null);
    void handleGenerate(failed.text);
  };

  /**
   * A sent message, edited (2026-11-04): as Try again, the message and
   * everything after it leave the transcript and the new text is sent in its
   * place. Questions Forma asked after it go with it, so an open clarification
   * that belonged to them is closed rather than answered by the next message.
   */
  const handleEditMessage = (id: string, text: string) => {
    if (isChatting || isAnalyzing) return;
    const at = messages.findIndex((m) => m.id === id);
    if (at === -1 || messages[at].role !== 'user' || !text.trim()) return;
    const pending = pendingClarifyRef.current;
    if (pending && messages.findIndex((m) => m.id === pending.messageId) >= at) pendingClarifyRef.current = null;
    setMessages((prev) => truncateFrom(prev, id));
    setError(null);
    void handleGenerate(text.trim());
  };

  /** One of the person's messages and Forma's answers to it, withdrawn (2026-11-04). See `withdrawTurn`. */
  const handleWithdrawMessage = (id: string) => {
    if (isChatting || isAnalyzing) return;
    const pending = pendingClarifyRef.current;
    if (pending) {
      const kept = withdrawTurn(messages, id);
      if (!kept.some((m) => m.id === pending.messageId)) pendingClarifyRef.current = null;
    }
    setMessages((prev) => withdrawTurn(prev, id));
  };

  /**
   * The chat box with no key (2026-11-02, docs/proposals/own-model.md).
   * Forma's own model designs a report from words, and an image is built from
   * the text OCR read, both with no AI service, so the workspace works for
   * anyone. A PDF's text layer and an attached .repx still need a model, and
   * the reply says so rather than pretending.
   */
  const designOffline = async (message: string) => {
    const staged = [...previews];
    const stagedForOcr = ocrPages;
    const texts = attachmentTexts;
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'user',
      text: message,
      images: staged.length > 0 ? staged : undefined,
      imageMeta: staged.length > 0 ? previewMeta : undefined,
    }]);
    setPrompt('');
    setPreviews([]);
    setPreviewMeta([]);
    setAttachmentTexts([]);
    setUploadNotices([]);
    setError(null);
    const say = (text: string, attached?: DesignResult) =>
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text, ...(attached ? { result: attached } : {}) }]);
    try {
      // Read behind the scenes, with the message already in the thread (2026-11-03).
      const read = await readSentPages(stagedForOcr);
      if (read.length) {
        const { buildFromRead } = await import('./lib/ocrAttach');
        const built = buildFromRead(read, config.unit, config.pageSize);
        // Banded by Forma's box reader when it can be (2026-11-04), with the page
        // as OCR read it kept as the revision before; OCR's copy alone otherwise.
        const banded = await readerBuild(read);
        if (banded) {
          handleReaderBuild(banded, built);
          return;
        }
        if (built) {
          handleOcrBuild(built);
          return;
        }
      }
      // The words, the replies and the generator are one lazy module, so the
      // entry chunk carries none of them.
      const offline = await import('./lib/offlineGenerator');
      if (staged.length || texts.length) {
        say(offline.OFFLINE_NEEDS_MODEL);
        return;
      }
      const request = describedRequest(message);
      if (!request.dataSchema && !offline.isOfflineRequest(message)) {
        say(offline.OFFLINE_HELP);
        return;
      }
      // With what the user asked Forma to remember, and what their kept reports show.
      const { result: newResult, reply } = await offlineDesign(request, message);
      setResult(newResult);
      recordRevision("Forma's own model", newResult);
      setActiveTab('ui');
      say(reply, newResult);
    } catch (err: any) {
      say(err?.message || "Forma's own model could not design this report.");
    }
  };

  /**
   * A picture read by Forma's vision model alone (2026-11-03, milestone 6 of
   * docs/proposals/own-model.md). This path runs when no other AI designs:
   * the Local AI model is itself "forma-vision", or there is no AI and the
   * vision model is set up as a helper (`visionModelOf`). With an AI, the
   * same reading is that AI's brief instead (`prepareTeam`).
   * - the model writes the first page's skeleton;
   * - OCR's reading of the same page gives its words;
   * - skeletonRepx.ts builds the report.
   * The mega-prompt is not sent, because the model was trained on one
   * question. When the model cannot be reached, or its answer has no page
   * line, the report is built from OCR alone and the reply says why.
   */
  const designFromVision = async (message: string) => {
    const staged = [...previews];
    const stagedMeta = [...previewMeta];
    const stagedForOcr = ocrPages;
    setMessages(prev => [...prev, { id: nextMessageId(), role: 'user', text: message, images: staged, imageMeta: stagedMeta }]);
    setPrompt('');
    setPreviews([]);
    setPreviewMeta([]);
    setAttachmentTexts([]);
    setUploadNotices([]);
    setError(null);
    const say = (text: string, attached?: DesignResult) =>
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text, ...(attached ? { result: attached } : {}) }]);
    let read: { meta: PreviewMeta; read: ReadPage }[] = [];
    try {
      const [{ readSkeleton }, { skeletonToDesign, pageTextsOf }, { detectLayout }, { pageForImage }] = await Promise.all([
        import('./services/formaVision'),
        import('./lib/skeletonRepx'),
        import('./lib/ocrLayout'),
        import('./lib/reportGeometry'),
      ]);
      const vision = visionModelOf(config);
      // The pages' layout and their text are read at the same time, behind the
      // scenes, the message already in the thread (2026-11-03). The model's
      // answers are settled into a value so that a failure while the text is
      // still being read is not an unhandled rejection. It reads the upload's
      // first page and, when it has more, its last (2026-11-04), whose footers
      // and totals the first does not show; mergePageSkeletons joins them.
      const pagesToRead = visionPages(staged, stagedMeta);
      const looking = vision
        ? (async () => {
            const readings = [];
            for (const i of pagesToRead) readings.push(await readSkeleton(vision, staged[i]));
            return readings;
          })().then((readings) => ({ readings }), (e: unknown) => ({ failed: e }))
        : Promise.resolve({ failed: new Error('no vision model is set up') });
      read = await readSentPages(stagedForOcr);
      setIsChatting(true);
      const looked = await looking;
      if ('failed' in looked) throw looked.failed;
      const [firstReading, ...laterReadings] = looked.readings;
      if (!firstReading?.skeleton) throw new Error('its answer had no page line');
      const { mergePageSkeletons } = await import('./lib/skeletonRepx');
      const reading = {
        skeleton: mergePageSkeletons(firstReading.skeleton, ...laterReadings.flatMap((r) => (r.skeleton ? [r.skeleton] : []))),
        problems: looked.readings.flatMap((r) => r.problems),
      };
      // The words OCR read on the same page, in the skeleton's unit and on its paper.
      const first = stagedMeta[0];
      const page = read.find(({ meta }) => meta.uploadId === first?.uploadId && (meta.page ?? 0) === (first?.page ?? 0));
      const paper = reading.skeleton.paper === 'Custom' ? config.pageSize : reading.skeleton.paper;
      const texts = page
        ? pageTextsOf(detectLayout([{ ocr: page.read.ocr, page: pageForImage(page.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }))
        : [];
      const design = skeletonToDesign(reading.skeleton, { texts, title: first?.file.replace(/\.[^.]+$/, '') });
      const newResult: DesignResult = {
        content: design.markdown,
        timestamp: new Date(),
        title: design.title,
        layout: design.layout,
        repxContent: design.repx,
        usage: null,
      };
      setResult(newResult);
      recordRevision("Forma's vision model", newResult);
      setActiveTab('ui');
      const skipped = reading.problems.length
        ? ` ${reading.problems.length} ${reading.problems.length === 1 ? 'line of its answer could not be read and was' : 'lines of its answer could not be read and were'} left out.`
        : '';
      const more = staged.length > pagesToRead.length
        ? pagesToRead.length > 1
          ? ` Its first and last pages were read, of ${staged.length}.`
          : ` Only the first of the ${staged.length} pages was read.`
        : '';
      say(
        `Read "${design.title}" with Forma's vision model: ${design.read} of ${design.read + design.placeholders} titles and captions took their words from the page.${skipped}${more}`,
        newResult,
      );
    } catch (err: any) {
      const why = err?.message || 'it did not answer';
      if (read.length) {
        const { buildFromRead } = await import('./lib/ocrAttach');
        const built = buildFromRead(read, config.unit, config.pageSize);
        const banded = await readerBuild(read);
        if (banded || built) {
          say(`Forma's vision model could not read the page (${why}), so the report was built from the text OCR read.`);
          if (banded) handleReaderBuild(banded, built);
          else if (built) handleOcrBuild(built);
          return;
        }
      }
      say(`Forma's vision model could not read the page: ${why}.`);
    } finally {
      setIsChatting(false);
      setStreamingReply('');
    }
  };

  /**
   * `overridePrompt` exists for the retry affordance on a failed message, which
   * re-sends that message's own text rather than whatever is in the composer.
   * Every call site passes it explicitly — never wire this straight to onClick,
   * or the click event arrives as the prompt.
   */
  const handleGenerate = async (overridePrompt?: string) => {
    /*
     * Refuse re-entry while a request is already in flight.
     *
     * `handleRetryMessage` has always had this guard and this function never
     * did, which is the asymmetry that gave it away. The composer's button was
     * disabled during a generation, so the only way in was the keyboard — Enter
     * fires the keydown handler on the input, which knew nothing about the
     * button's state. A second generation overwrites `activePromptRef` and the
     * progress state the first one is still writing to; a second chat turn is
     * built from a `messages` closure captured before the first reply landed, so
     * the model is sent a conversation that is missing a turn.
     *
     * The composer refuses it too, so the control agrees with the behaviour, but
     * this is the guard that makes it true regardless of who calls.
     */
    if (isChatting || isAnalyzing) return;

    const promptText = overridePrompt ?? prompt;

    if (previews.length === 0 && attachmentTexts.length === 0 && !promptText) {
      setError('Please provide at least an image, PDF, or a text description.');
      return;
    }

    // "Remember: always use A4" is kept, not designed or sent (2026-11-02,
    // lib/memory.ts), whichever AI answers and with none.
    if (previews.length === 0 && attachmentTexts.length === 0 && REMEMBER_WORDS.test(promptText)) {
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'user', text: promptText }]);
      setPrompt('');
      const memory = await import('./lib/memory');
      const kept = memory.memoryFrom(promptText);
      const state = memory.readMemory();
      memory.writeMemory({ ...state, memories: [...state.memories, kept] });
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text: memory.rememberedReply(kept) }]);
      return;
    }

    // A picture for Forma's own vision model alone (2026-11-03): the Local AI
    // model is itself "forma-vision", which is asked the one question it was
    // trained on and not the mega-prompt; or no AI is set up and the vision
    // model is, as a helper. With an AI it helps that AI instead (prepareTeam).
    if (previews.length > 0 && (isVisionOnly(config) || (!hasApiKey && visionModelOf(config)))) {
      await designFromVision(promptText);
      return;
    }

    // With no key, Forma's own model and OCR answer instead of Gemini
    // (2026-11-02). Until then the key gated the whole workspace here.
    if (!hasApiKey) {
      await designOffline(promptText);
      return;
    }

    const currentPrompt = promptText;
    const currentPreviews = [...previews];
    // The staged pages whose text is read in the browser, captured before the
    // composer is cleared below; their text joins the attachments after.
    const stagedForOcr = ocrPages;
    // What Forma's own parts need for a picture (lib/formaTeam.ts), captured
    // before the composer is cleared: the first page for the vision model,
    // when it is an image rather than a PDF. The pages OCR reads join it
    // once they are read, after the message is in the thread.
    const stagedMeta = [...previewMeta];
    const [firstAt, lastAt] = visionPages(currentPreviews, stagedMeta);
    const firstImage = firstAt !== undefined ? { src: currentPreviews[firstAt], meta: stagedMeta[firstAt] } : undefined;
    const lastImage = lastAt !== undefined ? { src: currentPreviews[lastAt], meta: stagedMeta[lastAt] } : undefined;

    // Add user message
    const newUserMsg: ChatMessage = {
      id: nextMessageId(),
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

    // What OCR reads from the attached images goes with them, as a PDF's text
    // layer does (2026-11-01). It is read now, behind the scenes, with the
    // message already in the thread (2026-11-03).
    const read = await readSentPages(stagedForOcr);
    const readByOcr = await ocrAttachments(read);
    const currentTexts = [...attachmentTexts, ...readByOcr];
    if (readByOcr.length) console.debug(`Including the text of ${readByOcr.length} page(s) read by OCR.`);
    const teamInput: TeamInput | undefined = currentPreviews.length > 0 ? { read, firstImage, lastImage } : undefined;

    /*
     * A reply to the questions a description is waiting on. Typed into the
     * box rather than given in the form, it is taken as the answer, as any
     * chat takes the next message after a question; an attachment instead is a
     * new request, and the questions are dropped.
     */
    const pending = pendingClarifyRef.current;
    if (pending) {
      pendingClarifyRef.current = null;
      setMessages(prev => prev.map(m => (m.id === pending.messageId && m.clarify ? { ...m, clarify: { ...m.clarify, answered: true } } : m)));
      if (!isGenerationTurn(currentPreviews.length, currentTexts.length)) {
        await startDescribedGeneration(withAnswers(pending.request, [{ id: 'reply', question: 'In the reader\'s own words', answer: currentPrompt }]));
        return;
      }
    }

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
    /** A report asked for in words, with no attachment and no report yet: Prompt-to-Report. */
    let fromDescription = false;
    // A plain "create a … report" with no report open skips the chat turn
    // (2026-11-02): it is a report request in any reading, and the turn spent
    // one request of the key's free allowance saying so.
    if (!result && !isGenerationTurn(currentPreviews.length, currentTexts.length) && PLAIN_BUILD.test(currentPrompt)) {
      await describeFromChat(currentPrompt);
      return;
    }
    if (!isGenerationTurn(currentPreviews.length, currentTexts.length)) {
      setIsChatting(true);
      setStreamingReply('');
      try {
        const history: ChatTurn[] = buildChatHistory(messages, currentPrompt);
        const { chatReply } = await loadGemini();
        const outcome = await chatReply(history, config, undefined, setStreamingReply);

        if (!outcome.wantsReport) {
          setMessages(prev => [...prev, {
            id: nextMessageId(),
            role: 'assistant',
            text: outcome.reply,
          }]);
          return;
        }

        // The user does want a report built from their description — fall
        // through to generation below, after acknowledging.
        setMessages(prev => [...prev, {
          id: nextMessageId(),
          role: 'assistant',
          text: outcome.reply,
        }]);
        // With no report to refine, a description is designed as the Describe
        // dialog designed one, which the chat box took over on 2026-11-01:
        // a question or two first if it leaves something open, then the brief.
        fromDescription = !result;
      } catch (err: any) {
        console.error('Chat turn failed:', err);
        const message = isMissingApiKey(err)
          ? 'Add your Gemini API key to use the workspace.'
          : err?.message || 'Could not reach the assistant.';
        setError(message);
        // Mark the message that failed, so the transcript shows which turn went
        // wrong instead of leaving it looking merely unanswered.
        setMessages(prev => markMessageError(prev, newUserMsg.id, message));
        if (isMissingApiKey(err)) setIsConfigOpen(true);
        return;
      } finally {
        setIsChatting(false);
        setStreamingReply('');
      }
    }

    if (fromDescription) {
      await describeFromChat(currentPrompt);
      return;
    }

    setIsAnalyzing(true);
    setProgress(startProgress());
    setError(null);

    activeDescribeRef.current = undefined;
    await runGeneration(currentPrompt, currentPreviews, currentTexts, INITIAL_RUN, undefined, teamInput);
  };

  /* ---------------------------------------------------------------- *
   * Prompt-to-Report.
   *
   * The dialog collects a description (lib/promptToReport.ts); this is the
   * sequence DevExpress's wizard runs after its Finish button, read off its
   * own strings: "Analyzing the request..." (the clarification call, which
   * may come back with questions and a Submit), then "Building your
   * report...". The description becomes the user's message in the transcript
   * so the conversation shows what was asked, exactly as an upload does.
   * ---------------------------------------------------------------- */
  const startDescribedGeneration = async (request: ReportDescriptionRequest) => {
    setIsAnalyzing(true);
    activeDescribeRef.current = request;
    // The house style is the brief, and Forma's own model the stand-in (lib/formaTeam.ts).
    const teamInput: TeamInput = { read: [], described: request };
    setProgress(startProgress());
    setError(null);
    await runGeneration('', [], [], DESCRIBE_RUN, request, teamInput);
  };

  /*
   * A report described in the chat (2026-11-01). The Describe dialog's two
   * stages, without the dialog: the typed message is the description, a
   * fenced code block or CREATE TABLE in it the data source; the
   * clarification call may come back with questions, which the thread asks
   * as a form; then the brief. A failure inside the clarification already
   * answers "ready", so the only way out without a generation is a key problem.
   */
  const describeFromChat = async (message: string) => {
    const request = describedRequest(message);
    // Too little to design from, the dialog's Build button stayed disabled;
    // in the chat the same rule asks for more instead.
    if (!isDescribable(request)) {
      setMessages((prev) => [...prev, {
        id: nextMessageId(),
        role: 'assistant',
        text: 'Tell me a little more about the report: what it lists, how it is grouped or sorted, and what it totals. Or attach an image or a PDF of one.',
      }]);
      return;
    }
    setIsChatting(true);
    try {
      const { clarifyReportRequest } = await loadGemini();
      const outcome = await clarifyReportRequest(request, config);
      if (!outcome.ready) {
        const id = nextMessageId();
        setMessages((prev) => [...prev, {
          id,
          role: 'assistant',
          text: `Before I design it, ${outcome.questions.length === 1 ? 'one question' : `${outcome.questions.length} questions`}. Keep the suggested answers, change them, or reply in your own words.`,
          clarify: { questions: outcome.questions, answered: false },
        }]);
        pendingClarifyRef.current = { request, messageId: id };
        return;
      }
    } catch (err: any) {
      const message = isMissingApiKey(err) ? 'Add your Gemini API key to use the workspace.' : err?.message || 'Could not reach the assistant.';
      setError(message);
      if (isMissingApiKey(err)) setIsConfigOpen(true);
      return;
    } finally {
      setIsChatting(false);
    }
    await startDescribedGeneration(request);
  };

  /** The answers given in a message's question form. */
  const handleClarifyAnswers = async (messageId: string, answers: ClarificationAnswer[]) => {
    const pending = pendingClarifyRef.current;
    if (!pending || pending.messageId !== messageId || isChatting || isAnalyzing) return;
    pendingClarifyRef.current = null;
    setMessages((prev) => prev.map((m) => (m.id === messageId && m.clarify ? { ...m, clarify: { ...m.clarify, answered: true } } : m)));
    const answered = answers.filter((a) => a.answer.trim());
    if (answered.length) {
      setMessages((prev) => [...prev, {
        id: nextMessageId(),
        role: 'user',
        text: answered.map((a) => `${a.question} ${a.answer.trim()}`).join('\n'),
      }]);
    }
    await startDescribedGeneration(withAnswers(pending.request, answers));
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

  const boundKey = boundFields.join('\u0000');
  useEffect(() => {
    setTestRows(null);
  }, [boundKey]);

  /**
   * DevExpress's "Show Report Preview with AI-generated Test Data", for a
   * report the Data tab has bound. One call, up to twenty rows, keyed by the
   * bound fields; the Preview prints them into the Detail band. A failure is
   * an error line, not a dead preview -- the placeholder record stays.
   */
  const handleTestData = async () => {
    if (!result?.repxContent || boundFields.length === 0) return;
    if (!hasApiKey) {
      setError('Add your Gemini API key to use the workspace.');
      setIsConfigOpen(true);
      return;
    }
    setTestDataBusy(true);
    setError(null);
    try {
      const { generateTestData } = await loadGemini();
      const rows = await generateTestData(
        boundFields,
        { title: result.title, description: activeDescribeRef.current?.description ?? result.content?.slice(0, 600) },
        20,
        config,
      );
      setTestRows(rows);
      setSaveNotice(`${rows.length} sample rows generated for the preview.`);
    } catch (err: any) {
      if (isMissingApiKey(err)) {
        setError('Add your Gemini API key to use the workspace.');
        setIsConfigOpen(true);
      } else {
        setError(err?.message || 'Could not generate test data.');
      }
    } finally {
      setTestDataBusy(false);
    }
  };

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
   *
   * Loaded on demand since 2026-11-04: the audit and what it imports (the
   * cross-tab, layout and accessibility checks) were on the entry chunk every
   * landing-page visitor downloads, for a box only the REPX pane shows. Until
   * the module arrives the pane shows no findings, which is what it showed for
   * a report with none.
   */
  const [repxAudit, setRepxAudit] = useState<RepxAudit | null>(null);
  useEffect(() => {
    const xml = result?.repxContent;
    if (!xml) {
      setRepxAudit(null);
      return;
    }
    let current = true;
    void import('./lib/repxAudit').then(({ auditRepx }) => {
      if (current) setRepxAudit(auditRepx(xml, result?.layout));
    });
    return () => {
      current = false;
    };
  }, [result?.repxContent, result?.layout]);

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
    rememberKept(result.repxContent);
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
  /**
   * Is there anything for the designer to open yet?
   *
   * A boolean rather than `result?.repxContent` itself, so the probe runs when
   * the first report arrives and not again on every edit to its XML.
   */
  const hasRepxToOpen = Boolean(result?.repxContent);
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
    //
    // Narrowed again on 2026-09-08, by the same argument one step further. The
    // workspace opens empty, and the button is disabled until a report has XML
    // to open — so probing before then answers a question nothing is asking,
    // and spends the one console line a visitor without the companion gets.
    // Nothing degrades while unprobed: `designerReady` picks the tooltip and
    // decides whether a click sends to a running designer or launches one, and
    // `false` takes the launch path, which is the correct fallback regardless.
    if (!showWorkspace || !hasRepxToOpen) return;

    let cancelled = false;
    let lastCheckedAt: number | null = null;
    const check = () => {
      lastCheckedAt = Date.now();
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
    //
    // Throttled, because a refused connection is logged by the browser itself
    // and cannot be caught: without this, someone alt-tabbing while they work
    // fills the console with `ERR_CONNECTION_REFUSED`, which is precisely the
    // noise the comment above this effect exists to prevent. The gap is short
    // enough that it never delays noticing a designer the user has just
    // started — see `shouldRecheckDesigner`.
    const checkOnFocus = () => {
      if (shouldRecheckDesigner(lastCheckedAt, Date.now())) check();
    };
    window.addEventListener('focus', checkOnFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', checkOnFocus);
    };
  }, [showWorkspace, hasRepxToOpen]);

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

        {railBtn('review', 'Chat', <IconLayout size={19} />)}
        {railBtn('projects', 'Saved projects', <IconFolder size={19} />)}
        {railBtn('revisions', 'Revisions', <IconRedo size={19} />)}
        {railBtn('batch', 'Batch', <IconStack size={19} />)}
        {railBtn('library', 'Report library', <IconDoc size={19} />)}
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
            {/* `h2`, not a styled span. These four panel titles are the only
                structure the workspace has below the report's `h1`, and a
                screen-reader user navigating by heading found exactly one
                landmark on the whole page — measured 2026-09-08 by walking the
                rendered DOM, not by reading the markup. `.wb-col-title` states
                its own font, weight and size and Tailwind's preflight zeroes
                heading margins, so the element renders identically: semantics
                with no visual change. Only one panel is in the layout at a
                time; the others are `wb-hidden`, so no reader meets four. */}
            {/* "Chat", and no count of notes beside it (2026-11-04): the column
                is the conversation, as in the chat apps people know. It said
                "Review" with "2 notes" until then. */}
            <h2 className="wb-col-title">Chat</h2>
            {/* Searching the transcript (2026-11-04): a field under the head,
                opened from here, as the chat apps people know do it. */}
            {messages.length > 0 && (
              <button
                type="button"
                className={`wb-icon-btn${chatQuery !== null ? ' wb-is-on' : ''}`}
                title="Search the chat"
                aria-label="Search the chat"
                aria-expanded={chatQuery !== null}
                onClick={() => setChatQuery((q) => (q === null ? '' : null))}
              >
                <IconSearch size={14} />
              </button>
            )}
          </div>
          {chatQuery !== null && messages.length > 0 && (
            <div className="wb-chat-search">
              <IconSearch size={13} />
              <input
                type="search"
                value={chatQuery}
                autoFocus
                placeholder="Search the chat"
                aria-label="Search the chat"
                onChange={(e) => setChatQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setChatQuery(null);
                }}
              />
              <button type="button" title="Close the search" aria-label="Close the search" onClick={() => setChatQuery(null)}>
                <IconClose size={13} />
              </button>
            </div>
          )}

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

          <ChatThread
            messages={messages}
            isChatting={isChatting}
            isAnalyzing={isAnalyzing}
            streamingReply={streamingReply}
            onRetry={handleRetryMessage}
            onOpenAttachment={setFullScreenImage}
            onAnswer={handleClarifyAnswers}
            suggestions={PREDEFINED_PROMPTS}
            onSuggest={setPrompt}
            onEdit={handleEditMessage}
            onWithdraw={handleWithdrawMessage}
            query={chatQuery ?? ''}
          >
            {/* Generation, as Forma's answer being written: three dots
                (2026-11-04). Until then a card held a progress ring, the step,
                a percentage, a character count, pause and stop, and after 20
                seconds a paragraph about the model thinking. The owner asked
                for the chat to show the messages and the answers only, with
                every step behind the scenes; Stop is the composer's button.
                The progress is still measured honestly, and a screen reader
                still hears it, from the attributes below. */}
            {isAnalyzing && (
              <article className="wb-note" aria-live="polite">
                <span className="wb-spine" />
                <div>
                  <div className="wb-who">Forma</div>
                  <p
                    role="progressbar"
                    aria-label="Forma is designing the report"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress.percent)}
                    aria-valuetext={teamStage ?? stepLabel(progress)}
                  >
                    <WorkingDots />
                  </p>
                </div>
              </article>
            )}
          </ChatThread>

          <Composer
            previews={previews}
            previewGroups={previewGroups}
            previewMeta={previewMeta}
            textGroups={textGroups}
            onOpenAttachment={openAttachment}
            onRemoveFile={removeFile}
            onRemoveText={removeTextAttachment}
            uploadNotices={uploadNotices}
            error={error}
            prompt={prompt}
            onPromptChange={setPrompt}
            onSend={handleGenerate}
            onStop={handleStop}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
            hasApiKey={hasApiKey}
            isAnalyzing={isAnalyzing}
            isChatting={isChatting}
            isIngesting={isIngesting}
            onPasteFiles={ingestFiles}
          />
        </div>

        {/* ------------------------------------------------- saved projects */}
          {/* Projects: every saved session, in one panel.

              There were two of these until 2026-09-06 — a folder "Projects" and
              a clock "Recent" — mapping the same `savedReports` array, calling
              the same loader, differing only in date format and in which delete
              handler they reached for. A comment in the second already said
              "these two panels are one array".

              Recent was meant to be time-scoped and never was: its header read
              "this week" over a list that has always been every saved session
              regardless of age, and that wording was corrected rather than the
              behaviour. The distinction it existed for was never built, so the
              panel was a second view of one list.

              Merged keeping the better half of each. Recent's row, which carries
              a day-and-time stamp and the note count where Projects showed a
              bare date; Recent's `removeReports`, which fades a row out before
              deleting where Projects called `handleDeleteReport` raw and the row
              simply vanished; and Projects' `wb-is-open` marker, which Recent
              never had. The search box went with it — it was a `<span>`, not an
              input, so it looked like a capability and was not one. */}
          <div className={`wb-panel-body${railPanel === 'projects' ? '' : ' wb-hidden'}`}>
            <div className="wb-col-head">
              <h2 className="wb-col-title">Projects</h2>
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
                  {savedReports.length} saved
                  {savedReports.length > 0 && (
                    <button
                      className="wb-mini"
                      onClick={() => setConfirmingClearAll(true)}
                      title="Delete every saved project"
                    >
                      Clear all
                    </button>
                  )}
                </span>
              )}
            </div>
            <div className="wb-list">
              {savedReports.length === 0 ? (
                <div className="wb-empty">No saved projects yet.</div>
              ) : (
                savedReports.map((report) => {
                  // Day and time. A bare clock time was the same six characters
                  // for a session from this morning and one from last month.
                  const stamp = formatSessionStamp(report.timestamp);
                  const leaving = leavingReportIds.includes(report.id);
                  const open = report.id === openProjectId;
                  return (
                    <div
                      key={report.id}
                      className={`wb-card${open ? ' wb-is-open' : ''}${leaving ? ' wb-leaving' : ''}`}
                      onClick={() => void handleLoadReport(report)}
                    >
                      <div className="wb-nm">{report.name}</div>
                      <div className="wb-sub">
                        {stamp && `${stamp} · `}
                        {noteCountLabel(report.messages.length)}
                      </div>
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

        {/* -------------------------------------------------------- recent */}
        <div className={`wb-panel-body${railPanel === 'revisions' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <h2 className="wb-col-title">Revisions</h2>
            {revisions.length > 0 && (
              <span className="wb-kicker">
                {revisions.length === 1 ? '1 version' : `${revisions.length} versions`}
              </span>
            )}
          </div>
          <div style={{ padding: '0 16px 16px', flex: 1, minHeight: 0, display: 'flex' }}>
            <Suspense fallback={null}>
              <RevisionsPanel
                revisions={revisions}
                current={result?.repxContent}
                persisted={!!user}
                onRestore={(revision) => {
                  /* Restoring is itself a change worth recording, so the
                     version being left is not lost by returning to an older
                     one -- which would make Restore the very trap this panel
                     exists to remove. */
                  const restored = {
                    ...(result ?? {}),
                    content: revision.snapshot.content,
                    repxContent: revision.snapshot.repxContent,
                    title: revision.snapshot.title,
                    layout: revision.snapshot.layout,
                  } as DesignResult;
                  setResult(restored);
                  recordRevision(`Restored "${revision.label}"`, restored);
                  setSaveNotice(`Restored the version from ${new Date(revision.at).toLocaleTimeString()}.`);
                }}
              />
            </Suspense>
          </div>
        </div>

        <div className={`wb-panel-body${railPanel === 'batch' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <h2 className="wb-col-title">Batch</h2>
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

        <div className={`wb-panel-body${railPanel === 'library' ? '' : ' wb-hidden'}`}>
          <div className="wb-col-head">
            <h2 className="wb-col-title">Report library</h2>
            {canonicalSources.size > 0 && (
              <span className="wb-kicker">
                {canonicalSources.size === 1 ? '1 in use' : `${canonicalSources.size} in use`}
              </span>
            )}
          </div>
          <div style={{ padding: '0 16px 16px', flex: 1, minHeight: 0, display: 'flex' }}>
            <Suspense fallback={null}>
              <LibraryPanel
                sources={librarySources}
                canonical={canonicalSources}
                onImport={handleLibraryImport}
                onRemove={handleLibraryRemove}
                onToggleCanonical={handleToggleCanonical}
                ready={hasApiKey}
                onNeedKey={() => setIsConfigOpen(true)}
              />
            </Suspense>
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
            {/* The notice's own words (2026-11-04), not always "Saved": the
                composer stopped repeating it, and "Restored the version from
                10:15" or "8 sample rows generated" are not saves. */}
            {saveNotice && (
              <span className="wb-saved" role="status" title={saveNotice}>
                <IconCheck size={13} />
                <span className="wb-saved-text">{saveNotice}</span>
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
                      records={testRows}
                      onTestData={handleTestData}
                      onClearTestData={() => setTestRows(null)}
                      testDataBusy={testDataBusy}
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
                      /* Prompt-to-Expression. The call is here, not in the
                         pane, so the pane renders and is tested with no key. */
                      onPromptToExpression={async (prompt, fields) => {
                        if (!hasApiKey) {
                          setIsConfigOpen(true);
                          throw new Error('Add your Gemini API key to use the workspace.');
                        }
                        const { promptToExpression } = await loadGemini();
                        return promptToExpression(prompt, fields, config);
                      }}
                      /* Rewrites only the REPX. The layout and the spec still
                         describe the same report — a binding changes where a
                         cell's text comes from at print time, not what the
                         document is. */
                      onApply={(xml, summary) => {
                        const bound = { ...result, repxContent: xml };
                        setResult(bound);
                        // Binding rewrites every mapped cell, so it is a
                        // milestone in the same sense a refinement is.
                        recordRevision('Bound to data', bound);
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
                  <RepxViewer
                    xml={result.repxContent || ''}
                    unit={config.unit}
                    audit={repxAudit}
                    usage={summariseUsage(result.usage) ? { short: summariseUsage(result.usage)!, long: describeUsage(result.usage) } : null}
                  />
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
                  Attach a design in the chat — a screenshot, a PDF, or an existing{' '}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>.repx</span> — or describe the
                  report you want, and it lands here.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* The status bar went on 2026-11-04, at the owner's request for a workspace
          as clean as the chat apps people know. Its live state, version, clock,
          band and binding counts were behind-the-scenes readouts; the units and
          token usage readouts and the REPX audit moved to the REPX pane, about the
          file they describe (RepxViewer). */}

      {/* =========================================================== modals */}
      {/* What was read from one sent upload, over its image: opened from the
          image viewer's "Text read" (2026-11-04; from the attachment's chip
          until 2026-11-03, then for a day from a reply), the pages already
          read, Build .repx with no model. */}
      {ocrReview && ocrReviewPages.length > 0 && (
        <Suspense fallback={null}>
          <OcrDialog
            pages={ocrReviewPages}
            preread={ocrReviewPages.map(({ meta }) => {
              const run = ocrRuns[ocrKey(meta)];
              return run?.state === 'done' ? run.read.ocr : null;
            })}
            unit={config.unit}
            pageSize={config.pageSize}
            onBuild={handleOcrBuild}
            onClose={() => setOcrReview(null)}
          />
        </Suspense>
      )}
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
                        <option value="26.1">v26.1</option>
                        <option value="25.2">v25.2</option>
                        <option value="25.1">v25.1</option>
                        <option value="24.1">v24.1</option>
                        <option value="23.2">v23.2</option>
                        <option value="23.1">v23.1</option>
                        <option value="22.2">v22.2</option>
                        {/* 20.1 is here because the ERP this was first built for is
                            built against DevExpress.XtraReports.v20.1 and its
                            templates declare SerializerVersion 20.1.3.0, so a file
                            matching it drops straight into that codebase.

                            This comment used to say a newer .repx does not open in an
                            older designer, and that the installed 20.1 was therefore
                            the only version openable here. Both were wrong. Measured
                            2026-09-06 with `RepxProbe inspect`: a 24.1 file loaded
                            through the installed 20.1 assemblies with nothing lost,
                            and the loader rewrote the tag to 20.1.3.0 on save. Pick
                            whichever version suits whoever opens the file. */}
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
              <Suspense fallback={null}>
                <ProviderSettings config={config} onChange={(changes) => setConfig(prev => ({ ...prev, ...changes }))} />
                <MemorySettings />
              </Suspense>
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
                    {hasGeminiKey && (
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
              {/* What OCR read on a sent page, over the image, from which a
                  .repx can be built with no model (2026-11-04). Here, in the
                  viewer the page's thumbnail opens, so the chat itself holds
                  no buttons for it; a reply offered it for a day before. */}
              {(() => {
                const shown = fullScreenImage.srcs[fullScreenImage.index];
                const uploadId = Object.entries(sentPages).find(([, pages]) => pages.some((p) => p.src === shown))?.[0];
                return uploadId && reviewable.has(uploadId) ? (
                  <button
                    type="button"
                    className="wb-lightbox-text"
                    onClick={() => {
                      setFullScreenImage(null);
                      setOcrReview(uploadId);
                    }}
                    title="See the text read on this page, and build a report from it with no model"
                  >
                    Text read
                  </button>
                ) : null;
              })()}
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
