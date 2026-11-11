/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense } from 'react';
// Only for the theme swap: a view transition snapshots the DOM around its
// callback, so the state change has to land inside it rather than on React's
// own schedule. See setTheme.
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
  IconCheck,
  IconChevronDown,
  IconClose,
  IconCopy,
  IconDownload,
  IconFolder,
  IconHelp,
  IconRedo,
  IconRedoStep,
  IconUndo,
  IconMinus,
  IconPlus,
  IconStack,
  IconSearch,
  IconShieldCheck,
  IconDoc,
  IconLogin,
  IconLogout,
  IconMenu,
  IconCollapse,
  IconMarquee,
  IconPointer,
  IconPanelLeft,
  IconCompose,
  IconSave,
  IconTrash,
  IconPin,
  IconPencil,
  IconArchive,
  IconTune,
  IconWarn,
} from './components/landing/icons';
import { applyDetected, detectSettings, repxFacts, type DetectInput, type DetectedSettings, type SourcePage } from './lib/autoConfig';
import {
  SIDEBAR_CLOSED_WIDTH,
  SIDEBAR_OPEN_WIDTH,
  SIDEBAR_SHORTCUT_ARIA,
  isSidebarShortcut,
  isStacked,
  sidebarShortcutText,
  sidebarToggleLabel,
} from './lib/sidebar';
/* `landing/` is the shared marketing design system, not a private folder — see
   CLAUDE.md. Its Eyebrow drew the empty canvas until 2026-11-07 (agent audit
   item 97), the workspace's last use of it. */
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
  ReportConfig,
  StreamProgress,
  ChatTurn,
  DraftRequest,
} from './services/geminiService';
import { loadGemini, isMissingApiKey } from './lib/geminiClient';
import { answeringModel, effectiveProvider, isVisionOnly, pageReaderOf, PROVIDER_NAMES, readProviderSettings, visionModelOf, workspaceOpen, writeProviderSettings } from './lib/aiProvider';
import type { SettingsSection } from './components/SettingsDialog';
import type { DraftSource } from './lib/formaTeam';
import type { JobPlan } from './lib/jobPlan';
/* Eager on purpose: cleared from a synchronous effect. See lib/modelCache.ts. */
import { clearCachedModel, onModelCacheChange, readCachedModel, readCachedModelSet, readDailyModel } from './lib/modelCache';
import { requestsToday } from './lib/requestCount';
import { cacheKeyForSession, readSessionKey, clearSessionKey, purgeLegacyPlaintextKey } from './services/keyVault';
import { startKeyHandoff } from './lib/keyHandoff';
import { askToKeepStorage } from './lib/storagePersist';
/* Only DURATION survives here. The workspace's motion is now the artifact's own
   CSS keyframes and transitions, so the Framer Motion presets it used to import
   are unused — see the note in CLAUDE.md about this being a deliberate departure
   for this surface. */
import { useTheme } from './components/useTheme';
import { useLinkNavigation } from './components/useLinkNavigation';
import ErrorBoundary from './components/ErrorBoundary';
import { forgetSession } from './lib/signOut';
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
  toIndexDocument,
  fromIndexDocument,
  mergeIndexed,
  projectName,
  saveReportsLocally,
  loadReportsLocally,
  sessionSignature,
  arrangeProjects,
  readIdList,
  writeIdList,
  toggleId,
} from './lib/savedReport';
import { loadPdfjs } from './lib/pdf';
import { toAttachmentParts } from './lib/attachmentParts';
import {
  startProgress,
  tickSimulated,
  applyStreamProgress,
  finishProgress,
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
/* The Data tab's SQL Server database (2026-11-08): lazy with the binding screen, and it carries the query model. */
const DatabasePanel = lazy(() => import('./components/DatabasePanel'));
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
/* Settings (redesigned 2026-11-07, as ChatGPT's): its sections, the key check
   and the encrypted copy of the key load when it opens. The AI provider
   (ProviderSettings), what Forma remembers (MemorySettings) and the day's
   requests (UsageSettings) are its sections, no longer lazy from here. */
const SettingsDialog = lazy(() => import('./components/SettingsDialog'));
/* DataSettings (right to left, stored procedure) and OcrSettings (languages,
   handwriting) went on 2026-11-04, with the choices they offered: Forma works
   those out per request now (lib/autoConfig.ts, lib/ocrScript.ts).
   `git log --diff-filter=D -- src/components/OcrSettings.tsx` finds them. */
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
/* The release notes (2026-11-07), lazy like the other marketing pages. */
const NotFoundPage = lazy(() => import('./components/NotFoundPage'));
import { publicPageFor } from './components/publicPages';
import Logo from './components/Logo';
import { currentPath, navigate, onRouteChange, migrateLegacyHashUrl, scrollToHash } from './lib/router';
import { readyTitle, sharedReportId, titleForRoute, viewForRoute, type ReadyWhat } from './lib/routes';
import { applyHead, headFor } from './lib/seo';
import { chatShortcutOf, shortcutText, workspaceShortcutOf, type ChatShortcut, type WorkspaceShortcut } from './lib/shortcuts';
import { hasOpenLayer, topLayer } from './lib/layers';
import { initialsOf } from './lib/initials';
import { useLayer } from './components/useLayer';
import { useMenuKeys } from './components/useMenuKeys';
import type { Command } from './components/CommandMenu';
import { TIP_INTERVAL_MS, WORKING_TIPS, forPlatform, tipAt } from './lib/workingTips';
/* App.tsx's own view state, extracted so it can be tested — see the header of
   each for the failure it was carrying while it lived here. */
import { plateFor, stateForPlate, type Plate, type ActiveTab, type SpecView } from './lib/workspaceView';
import { countStagedUploads, admitFiles, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_PDF_PAGES } from './lib/attachmentBudget';
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
import { checkRepx } from './lib/repx';
import { readBoundFields } from './lib/repxBindingPlan';
import type { RepxAudit } from './lib/repxAudit';
import type { AgentTool, FormatAction } from './lib/agentEdit';
import {
  describedRequest,
  fixInstruction,
  isDescribable,
  shouldRetryForErrors,
  withAnswers,
  type ClarificationAnswer,
  type ReportDescriptionRequest,
} from './lib/promptToReport';
import { addUsage, summariseUsage, describeUsage, type TokenUsage } from './lib/tokenUsage';
import type { ReadCoverage } from './lib/readCoverage';
import { designerFileName } from './lib/designerBridge';
import { groupAttachments, type PreviewMeta } from './lib/attachments';
import { makeRightToLeft } from './lib/repxRtl';
import {
  buildChatHistory,
  isGenerationTurn,
  markAskError,
  markInterrupted,
  markMessageError,
  nextMessageId,
  AFFIRMATIVE,
  answeredBy,
  branchesForResend,
  showBranch,
  conversationMarkdown,
  type ChatBranch,
  noteCountLabel,
  projectMatches,
  requestsOf,
  truncateFrom,
  withdrawTurn,
  type ChatMessage as ChatSessionMessage,
} from './lib/chatSession';
import { packChanges, unpackChanges, REPLY_CHANGES_KEY } from './lib/replyChanges';
import { copyText } from './lib/clipboard';
import { DRAFTS_KEY, keepQueue, keptQueueFor, LEGACY_DRAFT_KEY, movedDraft, NEW_DRAFT, parseDrafts, QUEUE_KEY, queuedFiles, withDraft, withoutFiles, type Drafts } from './lib/composerStore';
import { firstReply, isPlainBuild, isRememberMessage, isVagueReportAsk, needsRowsConsent, pendingQuestions, pendingReplyKind, queueStep, resumed, steered, turnBase, turnEnding, vagueReportReply, vagueReportWord, withSelection, type ReplyKind } from './lib/chatTurn';
import { formatSessionStamp } from './lib/datetime';
import { pointsToUnits, pdfTopFromBaseline } from './lib/reportGeometry';
// LogoPulse, the progress ring of the generation card, went with the card on
// 2026-11-04 (the minimal workspace). Find that commit with
// git log --diff-filter=D -- src/components/LogoPulse.tsx, and recover the file
// with git show <it>~1:src/components/LogoPulse.tsx.
/* The chat column, on demand (2026-11-05): only the workspace shows it, and
   the entry chunk every landing-page visitor downloads had reached 98.3% of
   its budget, half of that day's growth being the chat's own features. The
   working dots come from the same module, so all three are one chunk. See the
   index- entry in scripts/check-bundle-size.mjs. Since the same evening the
   conversation floats over the report a request at a time, as Google Stitch's
   does: the card and the log draw it, the thread inside the card. */
const ConversationPanel = lazy(() => import('./components/ConversationPanel'));
const CommandMenu = lazy(() => import('./components/CommandMenu'));
const ZoomField = lazy(() => import('./components/ZoomField'));
const HelpMenu = lazy(() => import('./components/HelpMenu'));
const ExportPanel = lazy(() => import('./components/ExportPanel'));
const ProjectMenu = lazy(() => import('./components/ProjectMenu'));
const HomeStart = lazy(() => import('./components/HomeStart'));
const PinProject = lazy(() => import('./components/PinProject'));
/* Sharing (2026-11-06): the dialog, and the page a shared link opens. */
const ShareDialog = lazy(() => import('./components/ShareDialog'));
const OpenInDesigner = lazy(() => import('./components/OpenInDesigner'));
const SharedReportPage = lazy(() => import('./components/SharedReportPage'));
/* The Mockup and the REPX pane (2026-11-06), each drawn only with a report open. */
const ReportMockup = lazy(() => import('./components/ReportMockup'));
const RepxViewer = lazy(() => import('./components/RepxViewer'));
const ShortcutsDialog = lazy(() => import('./components/ShortcutsDialog'));
const WorkingDots = lazy(() => import('./components/ChatThread').then((m) => ({ default: m.WorkingDots })));
const Composer = lazy(() => import('./components/Composer'));
import type { OcrBuiltReport } from './components/OcrDialog';
import type { ReaderBuiltReport } from './lib/ocrAttach';
import type { ReadPage } from './lib/ocrAttach';
import type { DatabaseText, SqlSchema } from './lib/sqlSchema';
import type { ReportQuery } from './lib/sqlQuery';
import type { DataField } from './lib/dataSource';
import { mergeStoredConfig, toPersistable, STORAGE_KEY as CONFIG_STORAGE_KEY } from './lib/reportConfigStore';
import {
  clampReviewWidth,
  readReviewWidth,
  REVIEW_DEFAULT_WIDTH,
  REVIEW_MIN_WIDTH,
  REVIEW_MAX_WIDTH,
} from './lib/panelSize';

/** What a request brings that its settings are worked out from (lib/autoConfig.ts). */
interface DetectionSources {
  texts?: readonly { file: string; text: string }[];
  metas?: readonly PreviewMeta[];
  pages?: readonly SourcePage[];
  words?: string;
}

interface DesignResult {
  content: string;
  timestamp: Date;
  title?: string;
  layout?: ReportLayout;
  repxContent?: string;
  /**
   * What the generation cost, for the REPX pane's readout and beside the
   * reply's time (the status bar it was for went on 2026-11-04).
   *
   * Optional and often absent: a report restored from a save or from the
   * revision history never had a request of its own, and the mock path makes
   * none. The readout hides itself rather than showing a zero.
   */
  usage?: TokenUsage | null;
  /**
   * What the report kept of the captions and titles Forma read on the page
   * (2026-11-10, lib/readCoverage.ts), for the REPX pane. Absent when the
   * request carried no draft, and on a restored report.
   */
  coverage?: ReadCoverage | null;
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

// MAX_ATTACHMENTS, MAX_FILE_BYTES and MAX_PDF_PAGES live in
// lib/attachmentBudget.ts since 2026-11-08, where the public pages' tests read them.
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
 * A project as its account document, inside that budget: whole when it fits,
 * else without the uploaded pictures (the spec, layout and REPX are what
 * matter), else null. Shared by the save and the title menu's Duplicate
 * (2026-11-06), which writes a new document the same way.
 */
function cloudPayload(draft: SavedReport, uid: string): { payload: ReturnType<typeof toFirestoreDocument>; imagesDropped: boolean } | null {
  const fits = (p: ReturnType<typeof toFirestoreDocument>) => p.messages.length + p.result.length <= CLOUD_SAVE_BUDGET_BYTES;
  const whole = toFirestoreDocument(draft, uid);
  if (fits(whole)) return { payload: whole, imagesDropped: false };
  // The earlier versions of a message carry pictures too (2026-11-05).
  const withoutImages = (list: ChatMessage[]): ChatMessage[] =>
    list.map((m) => ({
      ...m,
      images: undefined,
      branches: m.branches?.map((b) => ({ ...b, images: undefined, tail: withoutImages(b.tail) })),
    }));
  const lighter = toFirestoreDocument({ ...draft, messages: withoutImages(draft.messages) }, uid);
  return fits(lighter) ? { payload: lighter, imagesDropped: true } : null;
}

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
  /**
   * A database's layout or sample rows (2026-11-08, the SQL Server programme):
   * read here, kept on the device and summarised for the AI by `ingestFiles`,
   * which knows the database already in use.
   */
  database?: DatabaseText & { file: string; uploadId: string };
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
          // A dense page's tail past the per-page string cap is read from the
          // image instead. A notice said so, with a count of the strings left
          // out, until 2026-11-11 (the full audit, CV-12): it told how the page
          // was read and changed nothing the user could do.
        }
        // A scan, with no text layer, is read as pictures when it is sent. A
        // notice said that too until 2026-11-11 (CV-25), for the same reason.
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

  // A data file (2026-11-05, lib/dataFiles.ts): a table's columns are the
  // report's fields; a document is the person's words. Read in the browser,
  // by a module loaded only when such a file arrives: imported statically it
  // put 8 kB on the entry chunk every landing-page visitor downloads.
  const data = await import('./lib/dataFiles');
  if (data.isDataFile(name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A database's layout or sample rows, from Forma's scripts or an SSMS
    // "Generate Scripts" file (2026-11-08, lib/sqlSchema.ts): recognised before
    // it is read as plain data, and loaded only when such a file arrives.
    if (/\.(json|sql|txt)$/i.test(name)) {
      const { readDatabaseText } = await import('./lib/sqlSchema');
      const found = readDatabaseText(new TextDecoder().decode(bytes).replace(/^﻿/, ''), name.replace(/\.[^.]+$/, ''));
      if (found) {
        out.database = { ...found, file: name, uploadId };
        return out;
      }
    }
    const read = await data.readDataFile(name, bytes);
    if (read.note) out.notices.push(read.note);
    if (read.text) out.texts.push({ id: `${Date.now()}-${name}`, uploadId, file: name, text: read.text });
    return out;
  }

  out.notices.push(`"${name}" is not a supported type. Use an image, a PDF, a .repx, or data (CSV, TSV, JSON, text, SQL, Excel or Word).`);
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
/* PLAIN_BUILD and REMEMBER_WORDS went to lib/chatTurn.ts on 2026-11-07 (the
   agent audit's batch B), as `isPlainBuild` and `isRememberMessage`: the
   second was a copy of memory.ts's rule that had already drifted from it. */
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

/* The REPX viewer and the Mockup moved to components/RepxViewer.tsx and components/ReportMockup.tsx on 2026-11-06, lazy, to make room in the entry chunk. */

// The PDF.js worker used to be configured here, at module scope, which is what
// forced the engine into the eager bundle. loadPdfjs() now does it on the way
// past — see src/lib/pdf.ts.

export interface SavedReport {
  id: string;
  name: string;
  timestamp: string;
  messages: ChatMessage[];
  result: DesignResult | null;
  /** Listed from the account's index, its content not yet fetched (lib/savedReport.ts, site audit item 63). */
  stub?: boolean;
  search?: string;
  notes?: number;
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
/** The box's house style switch (2026-11-08): 'off' when turned off, absent when on. */
const HOUSE_STYLE_KEY = 'houseStyle';

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
/* The project open in this tab, kept in sessionStorage so a reload opens it
   again (2026-11-05). An id only; the project itself is where it was saved. */
const OPEN_PROJECT_KEY = 'forma:openProject';
/**
 * Whether `VITE_FORMA_MOCK` answers instead of an AI, read as geminiService's
 * `isMockMode` reads it but without importing that module, which stays out of
 * the first download. A reply says so rather than crediting an AI (item 96).
 */
const MOCK_MODE = ['true', 'misordered'].includes(((import.meta as { env?: Record<string, string | undefined> }).env ?? {}).VITE_FORMA_MOCK ?? '');
/* The message typed and not yet sent, and the queue, kept per tab and per
   project since 2026-11-07: see lib/composerStore.ts. */
/* Pinned and archived projects, kept on this device (2026-11-05). Ids only. */
const PINNED_PROJECTS_KEY = 'forma:pinnedProjects';
const ARCHIVED_PROJECTS_KEY = 'forma:archivedProjects';

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
 * 56px is the artifact's, and the icons are centred in it. Open, it shows the
 * label beside each icon at ChatGPT's measured 260px (it was 208 until
 * 2026-11-04, when the owner asked for the sidebar Gemini and ChatGPT have;
 * see lib/sidebar.ts for what was measured).
 */
const RAIL_WIDTH = SIDEBAR_CLOSED_WIDTH;
const RAIL_EXPANDED_WIDTH = SIDEBAR_OPEN_WIDTH;

/**
 * Initials for the rail's account button. Two letters at most — the artifact's
 * avatar is a 30px disc and a third glyph does not fit at that size.
 */

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
};

/*
 * The assistant's message left RunCopy on 2026-11-11 (the full audit's UI2):
 * "I've updated the report from your instructions" was said of a first report
 * built from a picture. `firstReply` in lib/chatTurn.ts says what was made,
 * and from what.
 */
const INITIAL_RUN: RunCopy = {
  start: 'Starting report generation process.',
  request: 'Sending request to Gemini API...',
  done: 'Report layout updated successfully.',
};

/** The test rows the AI made up, as the Preview's rows name their source: its own, never asked about (WS-01). */
const MADE_UP_ROWS = 'made-up test rows';

/** Prompt-to-Report: a description and no attachment. See lib/promptToReport.ts. */
const DESCRIBE_RUN: RunCopy = {
  start: 'Starting report generation from a description.',
  request: 'Sending the description to Gemini API...',
  done: 'Report designed from the description.',
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

/**
 * What the team brought to a run: the brief the AI is told and the quicker
 * version that stands in if the AI fails. Who took part is not kept
 * (2026-11-11, the full audit's RH-08): the reply is the result, and names
 * nobody.
 */
type TeamPlan = {
  brief: string;
  draft: (() => Promise<{ result: DesignResult; source: DraftSource } | null>) | null;
  /**
   * OCR's own layout of the source, which the audit checks the AI's REPX
   * against (2026-11-05, `sourceLayoutOf`).
   */
  evidence?: ReportLayout | null;
  /**
   * Forma's draft of the page, for the AI to correct rather than design the
   * report from nothing (2026-11-05, lib/draftText.ts). Null without a picture
   * whose layout the vision model or the box reader read.
   */
  correct?: DraftRequest | null;
};

const NO_TEAM: TeamPlan = { brief: '', draft: null };

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
  /*
   * What is typed and not yet sent survives a reload (2026-11-05), as a
   * ChatGPT draft does. Per tab, in sessionStorage, as the key is: this may be
   * a shared machine, and an unsent message is the person's words. Sending,
   * New report and signing out clear the box, and so the draft.
   *
   * Since 2026-11-07 (agent audit item 69) one draft per project, as ChatGPT
   * keeps one per chat (lib/composerStore.ts): opening a project shows the
   * words left in its box, and a reload brings back the open project's. The
   * tab had one draft, which followed the person from project to project.
   */
  /** The project the words in the box belong to: its id, or `NEW_DRAFT` before its first save. */
  const draftKeyRef = useRef<string>(NEW_DRAFT);
  const readDrafts = (): Drafts => {
    try {
      return parseDrafts(sessionStorage.getItem(DRAFTS_KEY), sessionStorage.getItem(LEGACY_DRAFT_KEY), sessionStorage.getItem(OPEN_PROJECT_KEY) ?? NEW_DRAFT);
    } catch {
      return {};
    }
  };
  const writeDrafts = (drafts: Drafts) => {
    try {
      if (Object.keys(drafts).length) sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      else sessionStorage.removeItem(DRAFTS_KEY);
      sessionStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch {
      /* storage blocked: the draft lasts as long as the page */
    }
  };
  const keepDraft = (key: string, text: string) => writeDrafts(withDraft(readDrafts(), key, text));
  const [prompt, setPrompt] = useState(() => readDrafts()[NEW_DRAFT] ?? '');
  useEffect(() => {
    // The key now, before a project opened in the next render takes it over.
    const key = draftKeyRef.current;
    const t = window.setTimeout(() => keepDraft(key, prompt), 300);
    return () => window.clearTimeout(t);
  }, [prompt]);
  /** The words in the box as the latest render has them, kept at once when the page goes. */
  const draftNow = useRef(prompt);
  draftNow.current = prompt;
  /**
   * Words put in the box for the person to finish (2026-11-07, agent audit
   * item 57): after what is already typed, on a line of their own, where
   * "Edit text" and a starting point replaced an unsent draft.
   */
  const addToBox = (text: string) => setPrompt((typed) => (typed.trim() ? `${typed.replace(/\s+$/, '')}\n${text}` : text));
  /**
   * The keyboard's focus to the end of the box, after the next paint: where
   * it goes when what held it goes away, an edit sent or a message
   * withdrawn (agent audit item 59), and after words put in the box.
   */
  const focusBox = () => {
    // The box folds away with the conversation (2026-11-08): open it first.
    setIsPanelCollapsed(false);
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
    });
  };
  /*
   * /workspace?start=<id> puts a starting point in the box (2026-11-08, the
   * site audit's batch SJ): the Examples page's "Open it in the workspace".
   * Once, on the way in, and the address loses its query so a reload does
   * not put it there again.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('start');
    if (!id) return;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
    void import('./lib/startingPoints').then(({ STARTING_POINTS }) => {
      const point = STARTING_POINTS.find((p) => p.id === id);
      if (!point) return;
      addToBox(point.text);
      focusBox();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the way in
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Through the validating reader. A bare JSON.parse here threw during the very
  // first render on a corrupted entry, taking the whole application to the error
  // boundary rather than costing one panel — with a message that says nothing
  // about storage, so the only way out was clearing site data. See
  // src/lib/savedReport.ts.
  const [savedReports, setSavedReports] = useState<SavedReport[]>(
    () => loadReportsLocally<ChatMessage, DesignResult>()
  );
  /**
   * The list as it is now, for a save scheduled earlier (2026-11-06, the
   * workspace audit): the autosave's closure held the list from when it was
   * scheduled, so a rename made in that moment was written back to the old
   * name, and a local save rebuilt the list without whatever changed since.
   */
  const savedReportsRef = useRef(savedReports);
  savedReportsRef.current = savedReports;
  const [user, setUser] = useState<User | null>(null);
  // `isDragging` went on 2026-11-06 (the workspace audit): set on every drag
  // over the bench and read by nothing since the tabs it once drove below md
  // went with the port; the comment above it still described them.
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
  /**
   * The SQL Server database the report is designed against (2026-11-08, the
   * SQL Server programme): its layout, read from Forma's script or an SSMS
   * file, never a connection. Kept on this device (lib/sqlSchemaStore.ts); the
   * report itself names it by connection from batch DD on.
   */
  const [activeDatabase, setActiveDatabase] = useState<SqlSchema | null>(null);
  const activeDatabaseRef = useRef<SqlSchema | null>(null);
  activeDatabaseRef.current = activeDatabase;
  /** What the report reads from it, chosen on the Data tab (batch DC); written into the .repx from batch DD. */
  const [activeQuery, setActiveQuery] = useState<ReportQuery | null>(null);
  /** Whether its names and sample values go to the AI (batch DE): on when attached, until unticked on the Data tab. */
  const [databaseShared, setDatabaseShared] = useState(false);
  /**
   * What the person said to the rows the Preview prints going with a question
   * about the data (2026-11-10, lib/previewRows.ts): yes, no, or nothing yet.
   * Per project (2026-11-11, the full audit's WS-01): a yes outlived the
   * project it was given in, and a no was asked again at once.
   */
  const [rowsDecision, setRowsDecision] = useState<'yes' | 'no' | null>(null);
  /** What the Preview reads it as (batch DF), one object while neither changes. */
  const previewDatabase = useMemo(() => (activeDatabase ? { schema: activeDatabase, query: activeQuery } : null), [activeDatabase, activeQuery]);
  /** The databases kept on this device, by name, newest first. */
  const [keptDatabases, setKeptDatabases] = useState<string[]>([]);
  /** The chosen query's fields, for the Data tab's column mapping. */
  const [queryFieldList, setQueryFieldList] = useState<{ fields: DataField[]; label: string }>({ fields: [], label: '' });
  // Another database means another layout: what was chosen from the last one no longer applies.
  const activeDatabaseName = activeDatabase?.database ?? '';
  useEffect(() => {
    setActiveQuery(null);
  }, [activeDatabaseName]);
  useEffect(() => {
    let live = true;
    void import('./lib/sqlSchemaStore').then((store) => store.loadDatabases()).then((kept) => {
      if (live) setKeptDatabases(kept.map((d) => d.name));
    });
    return () => {
      live = false;
    };
  }, [activeDatabase]);
  /** Warnings from the last upload: skipped files, dropped pages, bad XML. */
  const [uploadNotices, setUploadNotices] = useState<string[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [result, setResult] = useState<DesignResult | null>(null);
  /**
   * The report as the latest render has it (2026-11-07), for a turn that
   * lands after an await: a drag or a Format made while the chat was working
   * is in this, and an edit applied to the report the turn started from
   * would throw it away (agent audit item 8).
   */
  const reportNow = useRef<DesignResult | null>(null);
  reportNow.current = result;
  /*
   * The Mockup and the Spec follow the file (2026-11-07, agent audit item 1).
   * Both are read off the REPX (lib/repxViews.ts), once, when a generation
   * lands; a change made in place (an edit in the chat, the selection
   * toolbar, a drag on Preview, a binding) keeps the result's layout and
   * changes its file, so the Mockup went on showing the report before it:
   * a title made bold on Preview stayed regular on the Mockup. Each layout is
   * remembered with the file it describes; a result whose file is not that
   * one has its views read again, a moment after the last change, so a drag
   * is read once at its end rather than at every frame. A layout seen for the
   * first time (a generation, a project opened) is taken as describing its
   * own file, so a report saved with the AI's layout keeps it until edited.
   */
  const viewsOf = useRef(new WeakMap<object, string>());
  useEffect(() => {
    const layout = result?.layout;
    const xml = result?.repxContent;
    if (!layout || !xml) return;
    const described = viewsOf.current.get(layout);
    if (described === undefined) {
      viewsOf.current.set(layout, xml);
      return;
    }
    if (described === xml) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void import('./lib/repxViews').then(({ layoutFromRepx, specFromRepx }) => {
        if (!live) return;
        setResult((prev) => {
          if (!prev || prev.repxContent !== xml || prev.layout !== layout) return prev;
          const title = layout.title || prev.title || undefined;
          const next = layoutFromRepx(xml, title);
          viewsOf.current.set(next, xml);
          return { ...prev, layout: next, content: specFromRepx(xml, title) };
        });
      }).catch((err) => console.warn('The Mockup and the Spec could not be read again after the change.', err));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [result]);
  /* The unit the open report is written in, for the panes that measure it:
     its own, not whichever unit the next request will be worked out in. */
  const openUnit = useMemo(() => repxFacts(result?.repxContent).unit ?? 'HundredthsOfAnInch', [result?.repxContent]);
  const [showLogin, setShowLogin] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<'signin' | 'signup'>('signin');
  const [currentRoute, setCurrentRoute] = useState(currentPath());
  const [lastViewPath, setLastViewPath] = useState('/');

  /* Which section the rail is showing. Replaces `isSidebarOpen`: the artifact
     puts saved projects and recent sessions in the second column rather than a
     drawer over the canvas. */
  const [railPanel, setRailPanel] = useState<RailPanel>('review');
  /*
   * The conversation a request at a time (2026-11-05), floating over the
   * report as Google Stitch's agent card does: the request the card shows,
   * null for the newest, and whether the card is folded to its mark. See *The
   * conversation floats over the report* in docs/notes/app-shell.md.
   */
  const [shownRequestId, setShownRequestId] = useState<string | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  /** The controls the request picked in the log changed, outlined on Preview. */
  const [changedHighlight, setChangedHighlight] = useState<string[]>([]);
  /*
   * Stitch's command menu (Ctrl+K), its Shortcut Keys ("?") and its Zen mode
   * (Ctrl+\), the clean screen, which hides everything but the report
   * (2026-11-05). Their keys are `workspaceShortcutOf` in lib/shortcuts.ts.
   */
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isClean, setIsClean] = useState(false);
  /** The corner's "?" menu (2026-11-06, components/HelpMenu.tsx). */
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  /** The tip above the box while Forma works: a random first one, then the next every few seconds. */
  const tipStart = useRef(Math.floor(Math.random() * WORKING_TIPS.length));
  const [tipStep, setTipStep] = useState(0);
  const workspaceShortcutRef = useRef<((shortcut: WorkspaceShortcut) => boolean) | null>(null);
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
  const toggleRail = useCallback(() => {
    setIsRailExpanded((prev) => {
      try {
        localStorage.setItem(RAIL_EXPANDED_KEY, String(!prev));
      } catch {
        /* storage disabled — the choice still applies for this session */
      }
      return !prev;
    });
  }, []);

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
     leaves the bench short of the reserve it was promised, by the difference
     between the two widths. */
  const railWidth = isRailExpanded ? RAIL_EXPANDED_WIDTH : RAIL_WIDTH;
  const layoutWidth = viewportWidth - (railWidth - RAIL_WIDTH);

  /* Stacked, the sidebar is a drawer, as Gemini's is on a phone: a menu button
     in a top bar opens it over a dimmed page, and it closes on its own X, on
     the dimmed page, on Escape, or on choosing somewhere to go. Never open on
     load, whatever the desktop choice is, and closed again if the window
     widens past the stack. */
  const isStackedLayout = isStacked(viewportWidth);
  const [isRailDrawerOpen, setIsRailDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isStackedLayout) setIsRailDrawerOpen(false);
  }, [isStackedLayout]);
  /* Into the drawer when it opens, so the keyboard is where the eye is. */
  useEffect(() => {
    if (isRailDrawerOpen) railToggleRef.current?.focus();
  }, [isRailDrawerOpen]);
  const closeRailDrawer = useCallback(() => {
    setIsRailDrawerOpen((open) => {
      // Back to the button that opened it, as a dialog does.
      if (open) requestAnimationFrame(() => menuButtonRef.current?.focus());
      return false;
    });
  }, []);
  /* One toggle for both shapes, read from the window at the moment of use so
     the keyboard shortcut and the button cannot disagree about which it is. */
  const toggleSidebar = useCallback(() => {
    if (isStacked(window.innerWidth)) {
      setIsRailDrawerOpen((open) => !open);
    } else {
      toggleRail();
    }
  }, [toggleRail]);
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
    // The chat has no column since 2026-11-05: choosing it opens the card.
    if (panel === 'review') setIsPanelCollapsed(false);
    // Choosing somewhere to go closes the drawer, as Gemini's does.
    setIsRailDrawerOpen(false);
  }, [rememberReviewCollapsed]);

  /** The sidebar's Search: the saved projects, with the search field open. */
  const openProjectSearch = useCallback(() => {
    showRailPanel('projects');
    setProjectQuery((q) => q ?? '');
  }, [showRailPanel]);

  /*
   * The bench's bar height, on the shell as --wb-bar-h (2026-11-08), so a side
   * panel floating over the report lines up with the chat, whose float starts
   * under the bar. The bar's height moves with what it holds, so it is
   * measured rather than written down.
   */
  useLayoutEffect(() => {
    if (!showWorkspace) return;
    const bar = document.querySelector<HTMLElement>('.wb-bench-bar');
    const shell = bar?.closest<HTMLElement>('.wb-shell');
    if (!bar || !shell) return;
    const publish = () => shell.style.setProperty('--wb-bar-h', `${bar.offsetHeight}px`);
    publish();
    const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    watch?.observe(bar);
    return () => watch?.disconnect();
  }, [showWorkspace]);

  /* Ctrl+B / Cmd+B opens and closes the sidebar, and Escape closes the drawer.
     Only while the workspace is what is on screen: a marketing page has no
     sidebar, and the sign-in sheet over the workspace owns the keyboard. */
  useEffect(() => {
    if (!showWorkspace || showLogin) return;
    const onKey = (e: KeyboardEvent) => {
      // Stitch's: the command menu, the clean screen, the list and the zoom (2026-11-05).
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const workspace = workspaceShortcutOf(e, typing);
      // With a menu, panel or dialog open, its keys are its own (2026-11-06,
      // lib/layers.ts): Ctrl+K over Settings opened the command menu on top,
      // and the Escape that closed it closed Settings too. Ctrl+K still
      // closes the command menu it opened.
      if (hasOpenLayer()) {
        if (workspace === 'commands' && topLayer()?.id === 'commands') {
          e.preventDefault();
          setIsCommandOpen(false);
        }
        return;
      }
      if (workspace && workspaceShortcutRef.current?.(workspace)) {
        e.preventDefault();
        return;
      }
      // The chat's shortcuts, ChatGPT's own (2026-11-05, lib/shortcuts.ts).
      const chat = chatShortcutOf(e);
      if (chat) {
        e.preventDefault();
        chatShortcutRef.current?.(chat);
        return;
      }
      if (isSidebarShortcut(e)) {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === 'Escape' && isRailDrawerOpen) {
        e.preventDefault();
        closeRailDrawer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showWorkspace, showLogin, isRailDrawerOpen, toggleSidebar, closeRailDrawer]);

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
      // Not the avatar that opened it (2026-11-06): its own click toggles it,
      // and closing here first made that click open it again.
      if ((event.target as Element | null)?.closest?.('.wb-avatar')) return;
      if (workspaceProfileRef.current && !workspaceProfileRef.current.contains(event.target as Node)) {
        setShowWorkspaceProfile(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  // Escape closes the account menu, as every other menu here (lib/layers.ts),
  // and its arrow keys move between its items, focus going back to the avatar.
  useLayer(() => setShowWorkspaceProfile(false), showWorkspaceProfile, 'account-menu');
  useMenuKeys(workspaceProfileRef, showWorkspaceProfile);

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
      // The whole head since 2026-11-08 (site audit item 53, src/lib/seo.ts):
      // the description, the preview's words, the canonical address and
      // robots follow the route, as the build wrote them for the page loaded.
      applyHead(document, headFor(path));

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
    // A link to a section of a page, /docs#faq or /changelog#<entry>, opened
    // from outside: the section renders after the page's chunk, so wait for it.
    if (window.location.hash) scrollToHash(window.location.hash);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      unsubscribe();
    };
  }, []);

  // In-app links navigate without a reload (components/useLinkNavigation.ts,
  // shared with the public site since 2026-11-08).
  useLinkNavigation();


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
   * `forgetSignedOut` directly — it would capture the first render's copy and
   * go stale. The ref is refreshed after every render, below where that
   * handler is defined. It held `handleClearChat` until 2026-11-06, so a
   * sign-out in another tab cleared the conversation and kept every key.
   */
  const forgetSignedOutRef = useRef<(() => void) | null>(null);

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
        if (wasSignedIn) forgetSignedOutRef.current?.();
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

  /*
   * The account's projects, from its index (2026-11-08, site audit item 63).
   *
   * The list listened to the projects themselves, so every visit downloaded
   * every project in full, images included, and every autosave went to every
   * open tab, about 1 MB a turn. It listens to `users/{uid}/reportIndex` now,
   * one small entry per project, and a project's content is fetched when it
   * is opened (`fullReport`). Three things keep it whole:
   *
   * - A reconciliation once a week per device (`forma:indexCheckedAt:<uid>`),
   *   and at once when the index is empty: the projects read in full, as the
   *   list did, and an entry written for any without one. That fills the
   *   index the first time and heals one a save could not write.
   * - If the index cannot be read at all (its rules not yet deployed), the
   *   list falls back to listening to the projects as it did before.
   * - Nothing writes a listed entry back as a project: an entry has no content
   *   (`stub`), and rename changes only the name.
   */
  const RECONCILE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
  useEffect(() => {
    if (!user || !firebase) return;
    const { sdk, paths, db } = firebase;
    const uid = user.uid;
    const loadFailed = (error: unknown) =>
      // Reported, not rethrown (2026-11-08, site audit item 62): this callback
      // runs long after the try below, so the rethrow was an uncaught error
      // whose text carried the account's email.
      reportFirestoreFailure(error, OperationType.GET, 'users/{uid}/reports', 'Your saved projects could not be loaded just now. What is open here is safe; reload to try again.');
    let unsubscribe: () => void = () => {};
    let gone = false;

    /** The projects in full, as the list read them before the index. */
    const readAll = async (): Promise<SavedReport[]> => {
      const snapshot = await sdk.getDocs(paths.reportsCollectionRef(db, uid));
      // fromFirestoreDocument never throws, so one malformed document skips a
      // row rather than emptying the panel. See src/lib/savedReport.ts.
      return snapshot.docs.map((d) => fromFirestoreDocument<ChatMessage, DesignResult>(d.data()));
    };
    const reconcile = async (indexed: ReadonlySet<string>) => {
      const all = await readAll();
      if (gone) return;
      // In full, newest first: everything the index would list, with content.
      setSavedReports(mergeIndexed(all, []));
      await Promise.all(
        all.filter((r) => !indexed.has(r.id)).map((r) => sdk.setDoc(paths.reportIndexDocRef(db, uid, r.id), toIndexDocument(r, uid))),
      );
      try {
        localStorage.setItem(`forma:indexCheckedAt:${uid}`, String(Date.now()));
      } catch {
        /* storage blocked: it reconciles again next time */
      }
    };
    const listenToProjects = () => {
      unsubscribe = sdk.onSnapshot(sdk.query(paths.reportsCollectionRef(db, uid)), (snapshot) => {
        const reports = snapshot.docs.map((d) => fromFirestoreDocument<ChatMessage, DesignResult>(d.data()));
        reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setSavedReports(reports);
      }, loadFailed);
    };

    let checked = false;
    try {
      unsubscribe = sdk.onSnapshot(sdk.query(paths.reportIndexCollectionRef(db, uid)), (snapshot) => {
        const rows = snapshot.docs.map((d) => fromIndexDocument<ChatMessage, DesignResult>(d.data()));
        setSavedReports((prev) => mergeIndexed(rows, prev));
        if (checked) return;
        checked = true;
        let last = 0;
        try {
          last = Number(localStorage.getItem(`forma:indexCheckedAt:${uid}`)) || 0;
        } catch {
          /* storage blocked: reconcile */
        }
        if (snapshot.empty || Date.now() - last > RECONCILE_EVERY_MS) {
          void reconcile(new Set(rows.map((r) => r.id))).catch(loadFailed);
        }
      }, (error) => {
        // The index cannot be read (its rules not deployed yet): the list as before.
        console.warn('The projects index could not be read; listing the projects in full.', error);
        unsubscribe();
        if (!gone) listenToProjects();
      });
    } catch (error) {
      console.warn('The projects index could not be opened; listing the projects in full.', error);
      listenToProjects();
    }
    return () => {
      gone = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportFirestoreFailure only sets state and logs
  }, [user, firebase]);

  /**
   * Every saved project in one .zip (2026-11-08, site audit items 59 and
   * 66, lib/projectExport.ts): from the account in full when signed in, from
   * this browser otherwise. Resolves to how many went in.
   */
  const exportAllProjects = async (): Promise<number> => {
    let projects: SavedReport[];
    if (user) {
      const { sdk, paths, db } = await loadFirebase();
      const snapshot = await sdk.getDocs(paths.reportsCollectionRef(db, user.uid));
      projects = snapshot.docs.map((d) => fromFirestoreDocument<ChatMessage, DesignResult>(d.data()));
    } else {
      projects = loadReportsLocally<ChatMessage, DesignResult>();
    }
    if (!projects.length) return 0;
    const [{ buildZip }, { projectExportEntries, exportFileName }] = await Promise.all([import('./lib/zip'), import('./lib/projectExport')]);
    const now = new Date();
    const { bytes, reason } = buildZip(projectExportEntries(projects, now), now);
    if (!bytes) throw new Error(`The projects could not be packed: ${reason}.`);
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return projects.length;
  };

  /** A listed project with its content, fetched when the list holds only its index entry. */
  const fullReport = async (listed: SavedReport): Promise<SavedReport | null> => {
    if (!listed.stub) return listed;
    if (!user) return null;
    try {
      const { sdk, paths, db } = await loadFirebase();
      const snap = await sdk.getDoc(paths.reportDocRef(db, user.uid, listed.id));
      if (!snap.exists()) return null;
      const full = fromFirestoreDocument<ChatMessage, DesignResult>(snap.data());
      setSavedReports((prev) => prev.map((r) => (r.id === full.id && r.timestamp === full.timestamp ? full : r)));
      return full;
    } catch (err) {
      reportFirestoreFailure(err, OperationType.GET, 'users/{uid}/reports', 'That project could not be opened just now. Try again in a moment.');
      return null;
    }
  };

  const [error, setError] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  /** The Settings section to open at, from the box's model label (agent audit item 74). */
  const [configStart, setConfigStart] = useState<SettingsSection | undefined>(undefined);
  /**
   * The questions a typed description is waiting on (Prompt-to-Report in the
   * chat, 2026-11-01): the request they belong to and the message that asks
   * them. Answered by that message's form or by the next message typed.
   */
  const pendingClarifyRef = useRef<{ request: ReportDescriptionRequest; messageId: string } | null>(null);
  /**
   * The questions a conversation is waiting on, from the conversation itself
   * (2026-11-07, agent audit item 24): its last message's, when they are
   * unanswered and carry their description. For a project opened and a
   * version flipped, where the ref above had been emptied.
   */
  const pendingClarifyOf = (list: readonly ChatMessage[]) => pendingQuestions<ReportDescriptionRequest>(list);
  /*
   * The transcript as requests (2026-11-05), the sections of the conversation
   * panel's thread since 2026-11-08 (the card's and the log's until then). A
   * new request opens the panel, as Stitch's does when a prompt is sent.
   */
  const requests = useMemo(() => requestsOf(messages), [messages]);
  const requestCount = requests.length;
  /** A request to keep shown when the count changes under it: a version flipped (agent audit item 31). */
  const keepShownRef = useRef<string | null>(null);
  useEffect(() => {
    setShownRequestId(keepShownRef.current);
    keepShownRef.current = null;
    setIsPanelCollapsed(false);
    setChangedHighlight([]);
  }, [requestCount]);
  /**
   * The changes the chat made, each with the report before and after it, for
   * the reply's Undo and Redo (2026-11-05). Kept in this tab as REPX too
   * since 2026-11-07 (lib/replyChanges.ts), so a reload keeps them: they were
   * memory only, and a reload took every Undo away while the reply still
   * listed what it changed. Older versions are in Revisions.
   */
  const [chatChanges, setChatChanges] = useState<Record<string, { before: DesignResult; after: DesignResult }>>({});
  /** The requests whose change is known this session, which the panel offers to show on the Preview (2026-11-08). */
  const changedRequests = useMemo(() => new Set(requests.filter((r) => r.replies.some((m) => chatChanges[m.id])).map((r) => r.id)), [requests, chatChanges]);
  /** What the tab kept before this load, read once, for the project the reload opens again. */
  const keptChanges = useRef<string | null>((() => {
    try {
      return sessionStorage.getItem(REPLY_CHANGES_KEY);
    } catch {
      return null;
    }
  })());
  /**
   * The report as each of the person's messages found it, for Try again and an
   * edit (2026-11-07, agent audit item 3): a turn sent again starts from the
   * report it first started from, so an edit is not made twice and a first
   * report is not refined. Null for none open; in memory, with `fresh` on
   * the message and the replies' changes covering a reload.
   */
  const turnBases = useRef(new Map<string, DesignResult | null>());
  /** The chat's tools waiting for the render that applies the turn's edits (2026-11-05). */
  const [pendingTools, setPendingTools] = useState<AgentTool[] | null>(null);
  /** The reply that said what they do, which a translation finishes in place (2026-11-11, the full audit's UI3). */
  const toolReplyRef = useRef<string | null>(null);
  /** Runs them; assigned beside `showPlate`, where the handlers it calls are. */
  const runToolsRef = useRef<((tools: AgentTool[]) => void) | null>(null);
  /** Does what a chat shortcut asks (2026-11-05, lib/shortcuts.ts); assigned beside `showPlate` too. */
  const chatShortcutRef = useRef<((shortcut: ChatShortcut) => void) | null>(null);
  useEffect(() => {
    if (!pendingTools) return;
    setPendingTools(null);
    runToolsRef.current?.(pendingTools);
  }, [pendingTools]);
  /** The controls selected on the Preview, by name: what the chat's "this" means (2026-11-05). */
  const [previewSelection, setPreviewSelection] = useState<string[]>([]);
  /*
   * The Preview's tool (2026-11-08), from the rail at the bench's right as
   * Stitch's: Select, one control at a time, or Mark, a box dragged over the
   * report selecting what it touches, which returns to Select once drawn.
   */
  const [previewTool, setPreviewTool] = useState<'select' | 'mark'>('select');
  /** An export the chat or the Export panel asked the Preview for, made once per nonce. */
  const [exportRequest, setExportRequest] = useState<{ format: Exclude<AgentTool['format'], 'repx' | undefined> | 'pdf-outline'; nonce: number } | null>(null);
  /** The Export panel (2026-11-06, components/ExportPanel.tsx). */
  const [isExportOpen, setIsExportOpen] = useState(false);
  /*
   * The house style switch in the box (2026-11-08), as Stitch's "Use
   * DESIGN.md": on by default, as it always was; off, neither the library's
   * ticked reports nor Forma's own style guide a design. Kept on this device.
   */
  const [houseStyleOn, setHouseStyleOn] = useState(() => {
    try {
      return localStorage.getItem(HOUSE_STYLE_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const toggleHouseStyle = () =>
    setHouseStyleOn((on) => {
      try {
        if (on) localStorage.setItem(HOUSE_STYLE_KEY, 'off');
        else localStorage.removeItem(HOUSE_STYLE_KEY);
      } catch {
        /* a blocked storage keeps the choice for this visit */
      }
      return !on;
    });
  /** The project's menu, opened from its title (2026-11-06, components/ProjectMenu.tsx). */
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  /** Where the project's menu opens when Ctrl+K opened it: at Rename, or at Delete's question (2026-11-06). */
  const [projectMenuStart, setProjectMenuStart] = useState<'rename' | 'delete' | undefined>(undefined);
  /** The Share dialog (2026-11-06, components/ShareDialog.tsx). */
  const [isShareOpen, setIsShareOpen] = useState(false);
  /**
   * The sidebar's Search over the saved projects (2026-11-05), as ChatGPT's
   * searches its chats: null while closed, the text typed while open.
   */
  const [projectQuery, setProjectQuery] = useState<string | null>(null);
  /** The description the last run was started from, which Test data describes the report by. */
  const activeDescribeRef = useRef<ReportDescriptionRequest | undefined>(undefined);
  /*
   * `teamStage`, what a part of Forma's team was doing before the AI was
   * asked ("Forma's vision model is reading the layout"), went on 2026-11-11
   * (the full audit's WS-06 and WS-08): the progress bar's value text was its
   * last reader, and it says "Designing the report" and how far it has got.
   */
  /**
   * AI-generated sample rows for the Preview, keyed by bound field. Null is
   * the one-placeholder-record preview. Cleared whenever the set of bound
   * fields changes, since rows keyed by yesterday's fields would print as
   * blanks; a nudge or a retype leaves them alone.
   */
  const [testRows, setTestRows] = useState<Record<string, string>[] | null>(null);
  const [testDataBusy, setTestDataBusy] = useState(false);
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

    // The page size is worked out per request (lib/autoConfig.ts); this one is
    // the stand-in until the first request does. There is no header or footer
    // here since 2026-11-04: their defaults went into every prompt as "Include
    // Company Logo: No" and "Include Page Numbers: Yes", overruling the source.
    const defaults: ReportConfig = {
      version: '23.2',
      unit: 'HundredthsOfAnInch',
      pageSize: 'Letter',
      customApiKey: ''
    };

    // The version and unit are a standing preference, learned from the reports
    // the user brings: someone targeting DevExpress 20.1 targets it every
    // session. They used to live in state only, so every reload silently reset
    // the version to 23.2 and the next export went out for a designer that
    // would refuse it.
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
  }, [config.provider, config.localUrl, config.localModel, config.openRouterModel, config.openRouterKey, config.visionModel, config.pageReader]);


  /**
   * Whether the workspace is open to work: the Gemini key, whichever AI is
   * chosen (2026-11-05, `workspaceOpen` in lib/aiProvider.ts). Without it the
   * box is locked and its button opens Settings at the key. From 2026-11-02
   * to 2026-11-05 the box handed words to Forma's own model and images to OCR
   * without one; that went, and this comment kept saying it until 2026-11-06.
   */
  const hasApiKey = workspaceOpen(config);

  /** A short conversational turn is in flight (not a report generation). */
  const [isChatting, setIsChatting] = useState(false);
  /** The assistant's answer as it streams in, before it becomes a real message. */
  const [streamingReply, setStreamingReply] = useState('');
  /*
   * The queue (2026-11-05), as Stitch's tray over its box: what is sent while
   * Forma works waits, in order, and the next goes the moment Forma is free.
   * Its words only: anything attached stays in the box for the person to
   * send. Steer puts one first and stops what runs, so it goes next.
   */
  /**
   * A queued message's words; the pictures it carries when the chat moved it
   * to a new project or it steers a request that had some; `steer` when it
   * was sent ahead with Steer, and `steerFrom`, the words of the request it
   * changes (agent audit item 86).
   */
  type Queued = { id: string; text: string; images?: string[]; imageMeta?: PreviewMeta[]; texts?: TextAttachment[]; dropped?: true; steer?: true; steerFrom?: string; go?: true };
  const [queue, setQueue] = useState<Queued[]>([]);
  /**
   * The queue is kept in the tab with its project (2026-11-07, agent audit
   * item 71), so a reload in the middle of a turn does not lose what was
   * waiting; `handleLoadReport` brings it back, paused. Read once, here.
   */
  const keptQueue = useRef<string | null>((() => {
    try {
      return sessionStorage.getItem(QUEUE_KEY);
    } catch {
      return null;
    }
  })());
  /** Resume: the next message goes whatever is waiting, the person having said so. */
  const resumeQueue = () => {
    setQueue((q) => resumed(q));
    setQueuePaused(false);
  };
  /**
   * Whether the queue waits for the person (2026-11-07, agent audit items 27
   * and 28, the owner's choice): Stop pauses it, as do a question Forma asks
   * and a request that failed, and "Resume" in the tray sends the next.
   * Until then Stop stopped one message and the next started at once, and a
   * message queued before a question was taken as its answer.
   */
  const [queuePaused, setQueuePaused] = useState(false);
  useEffect(() => {
    if (!queue.length) setQueuePaused(false);
  }, [queue.length]);
  /** A turn under way, from its first step to its last (see `handleGenerate`). */
  const turnBusyRef = useRef(false);
  const [turnBusy, setTurnBusy] = useState(false);
  /** A different report the chat was asked for, waiting for its turn to end to open a project of its own (agent audit item 20). */
  const [startNewFrom, setStartNewFrom] = useState<Omit<Queued, 'id'> | null>(null);
  useEffect(() => {
    if (isAnalyzing || isChatting || turnBusy || queuePaused) return;
    // A question waiting, or a request that failed, holds what was queued
    // before it was known (item 28); a steer is the person's own word, and
    // goes (lib/chatTurn.ts, `queueStep`).
    const step = queueStep(queue, messages);
    if (!step) return;
    if (step === 'pause') {
      setQueuePaused(true);
      return;
    }
    const { send: next, rest } = step;
    setQueue(rest);
    void handleGenerate(next.text, {
      ...(next.images?.length ? { images: next.images, imageMeta: next.imageMeta } : {}),
      ...(next.texts?.length ? { texts: next.texts } : {}),
      queued: true,
      ...(next.steerFrom ? { steerFrom: next.steerFrom } : {}),
    });
    // handleGenerate is read at the moment Forma is free; it is declared below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzing, isChatting, turnBusy, queue, queuePaused, messages]);
  /*
   * The model picker in the chat box (2026-11-05), as Gemini's: Auto, or one
   * of the models this key has answered for (`readCachedModelSet`, the probe's
   * own list, never a catalogue), with today's requests from this browser
   * (`lib/requestCount.ts`). A choice pins `config.modelName` for this tab
   * only: `toPersistable` never saves it, so a reload is Auto again and a
   * retired id cannot be left pinned, which is how the old dropdown broke
   * every request (gemini.md, *The model is auto-detected*). Read again after
   * each request, when both lists may have moved. Gemini only.
   */
  // The cache moves outside React (Check key fills it after the key was typed), so it says when (2026-11-09).
  const [modelCacheTick, setModelCacheTick] = useState(0);
  useEffect(() => onModelCacheChange(() => setModelCacheTick((n) => n + 1)), []);
  const modelPicker = useMemo(() => {
    if (effectiveProvider(config) !== 'gemini') return null;
    const used = requestsToday();
    return {
      current: config.modelName?.trim() ?? '',
      // The model Auto runs on, named in the menu as Stitch names its tiers' (2026-11-08).
      auto: readCachedModel(),
      choices: (readCachedModelSet() ?? []).map((id) => ({ id, used: used[id] ?? 0 })),
      onChoose: (id: string) => setConfig((prev) => ({ ...prev, modelName: id || undefined })),
    };
    // isChatting and isAnalyzing: a request has just ended, so the lists may have moved; modelCacheTick: the cache did.
  }, [config, isChatting, isAnalyzing, modelCacheTick]);
  /**
   * The turn in flight before any generation (2026-11-05): a chat reply, the
   * questions asked before a design, or a sent page being read. The
   * composer's Stop aborts it, as it aborts a generation. Every await in such
   * a turn checks its signal and, once aborted, touches no state: Stop has
   * already put the composer back, and a new turn may be running.
   */
  const turnAbortRef = useRef<AbortController | null>(null);
  /** The reply as streamed so far, which Stop keeps, as ChatGPT keeps it. */
  const partialReplyRef = useRef('');
  /** Whether the chat turn under way is on an open report, whose reply, stopped, must not claim a change (item 51). */
  const reportTurnRef = useRef(false);
  /*
   * Something finished while the tab was hidden (2026-11-05): a report or a
   * reply. The tab's title says so (`readyTitle`) until the person comes
   * back, when the route's own title returns; the route effect stays the
   * title's writer the rest of the time. Nothing happens in a visible tab.
   */
  const titleBack = useRef<(() => void) | null>(null);
  const announceReady = useCallback((what: ReadyWhat) => {
    if (typeof document === 'undefined' || !document.hidden) return;
    document.title = readyTitle(what);
    if (titleBack.current) return;
    const back = () => {
      if (document.hidden) return;
      document.title = titleForRoute(currentPath());
      document.removeEventListener('visibilitychange', back);
      titleBack.current = null;
    };
    titleBack.current = back;
    document.addEventListener('visibilitychange', back);
  }, []);
  /*
   * How a turn ended, read in one place when it ends (2026-11-07, agent audit
   * item 63): a question waiting or a request that failed changes the title
   * too, and a report or an edit reads as "Report ready", a reply as "Reply
   * ready". Five success paths called `announceReady` each, and none of the
   * others did.
   */
  const wasWorking = useRef(false);
  useEffect(() => {
    if (isAnalyzing || isChatting || turnBusy) {
      wasWorking.current = true;
      return;
    }
    if (!wasWorking.current) return;
    wasWorking.current = false;
    const last = requests[requests.length - 1];
    if (last) announceReady(turnEnding(last, chatChanges));
  }, [isAnalyzing, isChatting, turnBusy, requests, chatChanges, announceReady]);

  const lastKeyRef = useRef(config.customApiKey);
  useEffect(() => {
    // sessionStorage, not localStorage: the key is a live credential, and a
    // tab-scoped store is erased by the browser itself. A beforeunload handler
    // would not be — crashes, force-quit and mobile tab eviction all skip it.
    if (config.customApiKey) {
      cacheKeyForSession(config.customApiKey);
      // Another key replacing this one: the models found for the old key do not carry over (2026-11-09).
      if (lastKeyRef.current && lastKeyRef.current !== config.customApiKey) clearCachedModel();
      // A key that found its models earlier today shows them at once; readDailyModel reads localStorage, no request.
      if (!readCachedModel()) readDailyModel(config.customApiKey);
    } else {
      clearSessionKey();
      // A different key can have different model access, so a choice resolved
      // for the old key must not carry over.
      clearCachedModel();
    }
    lastKeyRef.current = config.customApiKey;
  }, [config.customApiKey]);

  /*
   * A new tab gets the keys from a Forma tab already open (2026-11-08, site
   * audit item 105, lib/keyHandoff.ts): this tab answers one that asks, and
   * asks once if it has no key. A key this tab already has is kept.
   */
  const keysRef = useRef({ gemini: config.customApiKey, openRouter: config.openRouterKey });
  keysRef.current = { gemini: config.customApiKey, openRouter: config.openRouterKey };
  useEffect(
    () =>
      startKeyHandoff({
        getKeys: () => keysRef.current,
        onKeys: (keys) =>
          setConfig((prev) =>
            prev.customApiKey
              ? prev
              : { ...prev, customApiKey: keys.gemini ?? '', openRouterKey: prev.openRouterKey || keys.openRouter || '' },
          ),
      }),
    [],
  );

  /* The encrypted copy of the key (services/keyVault.ts), checking the key,
     and clearing it from this tab live in Settings since its redesign of
     2026-11-07 (components/SettingsDialog.tsx), which loads them when it
     opens. A change there takes effect as it is made, as in ChatGPT and
     Gemini, so the snapshot that Cancel put back went with Cancel. */
  const [activeTab, setActiveTab] = useState<ActiveTab>('ui');
  // Sub-view inside the "Specs & REPX" tab. The tab has always been named for
  // both, but only ever rendered the specification.
  const [specView, setSpecView] = useState<SpecView>('spec');
  // The theme (components/useTheme.ts since 2026-11-08, shared with the public site).
  const { isDarkMode, followsSystem, setTheme } = useTheme();
  // The elapsed-time clock went with the status bar on 2026-11-04. It set state
  // every 100 ms of a generation, re-rendering the whole app ten times a second
  // for a number in the bottom bar.

  // The next tip every few seconds while Forma works (2026-11-06, lib/workingTips.ts).
  const isWorking = isAnalyzing || isChatting;
  useEffect(() => {
    if (!isWorking) return;
    const id = window.setInterval(() => setTipStep((s) => s + 1), TIP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isWorking]);

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
   * needs no dependencies. One handler for every run (`runGeneration`); it
   * was shared with handleResume until pause went on 2026-11-04.
   */
  const handleStreamProgress = useCallback((chunk: StreamProgress) => {
    if (loadingIntervalRef.current) {
      clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }
    setProgress((prev) => applyStreamProgress(prev, { percent: chunk.percent, chars: chunk.chars }));
  }, []);

  /* The transcript follows itself now, inside `ChatThread`, which owns the
     scrolling element. A `messagesEndRef` and a `scrollIntoView` effect stood
     here from before the 2026-08-12 port until 2026-09-08 — the port took the
     sentinel div the ref pointed at, so the effect ran against `null` on every
     message and the thread never scrolled. Removed rather than reattached:
     the element that scrolls is not in this file any more. */

  /**
   * A database's layout or sample rows, arrived in the box or on the Data tab
   * (2026-11-08, the SQL Server programme, checklist items 9 and 10). The
   * layout is kept on this device and becomes the active database; sample
   * rows join the layout of the same database when one is known. Either way
   * the AI is given the result as text, which the owner allowed for names and
   * values. Returns the line to show.
   */
  /** A layout or sample output pasted on the Data tab, or read through the companion: kept, not shared with the AI. */
  const databaseFromText = async (text: string) => {
    const { readDatabaseText } = await import('./lib/sqlSchema');
    const found = readDatabaseText(text);
    return found ? takeDatabase({ ...found, file: 'the Data tab', uploadId: 'data-tab' }, false) : null;
  };
  const takeDatabase = useCallback(async (found: DatabaseText & { file: string; uploadId: string }, attach = true): Promise<string> => {
    const [db, store] = await Promise.all([import('./lib/sqlSchema'), import('./lib/sqlSchemaStore')]);
    const kept = await store.loadDatabases();
    let schema: SqlSchema | null;
    let line: string;
    if (found.kind === 'schema') {
      const previous = kept.find((d) => d.name === store.storedName(found.schema));
      schema = previous?.schema.samples && !found.schema.samples ? db.withSamples(found.schema, previous.schema.samples) : found.schema;
      line = `Database layout read${attach ? ` from "${found.file}"` : ''}: ${db.summarizeSchema(found.schema)}. It stays in this browser.`;
    } else {
      const name = found.database || 'Database';
      const base = activeDatabaseRef.current && store.storedName(activeDatabaseRef.current) === name
        ? activeDatabaseRef.current
        : kept.find((d) => d.name === name)?.schema ?? null;
      schema = base ? db.withSamples(base, found.samples) : null;
      line = base
        ? `Sample rows read for ${name}: ${db.summarizeSamples(found.samples)}.`
        : `Sample rows read for ${name}: ${db.summarizeSamples(found.samples)}. Add its layout too (Forma's layout script) so the report can be bound to it.`;
    }
    if (schema) {
      await store.saveDatabase(schema);
      setActiveDatabase(schema);
    }
    // Shared with the AI when attached; a layout pasted on the Data tab is not, until ticked (batch DE).
    if (attach) setDatabaseShared(true);
    else if (found.kind === 'schema') setDatabaseShared(false);
    // The layout itself goes in the request's own section (lib/databaseAi.ts); the attachment names it.
    const text = schema ? `${db.summarizeSchema(schema)}: the layout and sample values of this SQL Server database are shared with the request.` : db.samplesForAi(found.kind === 'sample' ? found.database : '', found.kind === 'sample' ? found.samples : {});
    // Attached in the box it goes to the AI with the message; pasted on the Data tab it does not.
    if (attach) setAttachmentTexts((prev) => [...prev.filter((t) => t.uploadId !== found.uploadId), { id: `${Date.now()}-${found.file}`, uploadId: found.uploadId, file: found.file, text }]);
    return line;
  }, []);

  /**
   * The one intake path, shared by the picker and drag-and-drop. Runs files
   * sequentially so previews land in the order they were given, and reports
   * anything it could not use instead of failing silently.
   */
  /**
   * The files the box holds, by upload id (2026-11-10, batch AG item 22): a
   * plan that makes a report for each hands Batch the files themselves, since
   * the box keeps a PDF as its pages. Emptied with the box.
   */
  const stagedFiles = useRef(new Map<string, File>());
  /** The pages, texts and files of each plan not yet answered, by the plan's message id. */
  const plannedJobs = useRef(new Map<string, { images: string[]; imageMeta: PreviewMeta[]; texts: TextAttachment[]; base: DesignResult | null; files: Map<string, File> }>());
  /** Files a plan sent to Batch, which the panel takes and starts. */
  const [batchIncoming, setBatchIncoming] = useState<{ files: File[]; id: number } | null>(null);

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
        const uploadId = `${Date.now()}-${i}-${file.name}`;
        stagedFiles.current.set(uploadId, file);
        const result = await ingestFile(file, uploadId, config.unit);
        if (result.images.length) {
          setPreviews(prev => [...prev, ...result.images]);
          setPreviewMeta(prev => [...prev, ...result.imageMeta]);
        }
        if (result.texts.length) setAttachmentTexts(prev => [...prev, ...result.texts]);
        notices.push(...result.notices);
        if (result.database) notices.push(await takeDatabase(result.database));
      }
    } finally {
      setIsIngesting(false);
      setUploadNotices(notices);
    }
  }, [stagedUploads, takeDatabase]);

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
  // The queue, kept with its project (agent audit item 71; `keptQueue` above).
  useEffect(() => {
    try {
      if (!openProjectId || !queue.length) {
        sessionStorage.removeItem(QUEUE_KEY);
        return;
      }
      try {
        sessionStorage.setItem(QUEUE_KEY, keepQueue(openProjectId, queue));
      } catch {
        // Too large with its pictures: kept as its words, each saying its files went.
        sessionStorage.setItem(QUEUE_KEY, keepQueue(openProjectId, withoutFiles(queue)));
      }
    } catch {
      /* storage blocked: the queue lasts as long as the page */
    }
  }, [queue, openProjectId]);
  /*
   * One history for every change to the report (2026-11-05), for the Undo
   * and Redo at the bench's corner, as Stitch keeps them: a drag or retype on
   * Preview, the selection toolbar's Format, the chat's edits and redesigns,
   * a binding on the Data tab. Each change of the REPX keeps the report it
   * replaced; Undo puts that back and keeps the one it left for Redo. A
   * project opened, or New report, starts it again. Fifty steps, in memory:
   * older versions are in Revisions.
   */
  const reportPast = useRef<DesignResult[]>([]);
  const reportFuture = useRef<DesignResult[]>([]);
  const lastReport = useRef<DesignResult | null>(null);
  const movingInHistory = useRef(false);
  /** Set by an edit on Preview, which keeps its own step (`pushHistory`), a drag one step in all. */
  const previewStep = useRef(false);
  const [historyDepth, setHistoryDepth] = useState({ back: 0, forward: 0 });
  const noteHistory = () => setHistoryDepth({ back: reportPast.current.length, forward: reportFuture.current.length });
  const pushHistory = (report: DesignResult | null) => {
    if (!report?.repxContent) return;
    reportPast.current = [...reportPast.current.slice(-49), report];
    reportFuture.current = [];
    noteHistory();
  };
  useEffect(() => {
    const before = lastReport.current;
    lastReport.current = result;
    if (movingInHistory.current) {
      movingInHistory.current = false;
      noteHistory();
      return;
    }
    if (previewStep.current) {
      previewStep.current = false;
      return;
    }
    if (!result) {
      reportPast.current = [];
      reportFuture.current = [];
      noteHistory();
      return;
    }
    if (!before?.repxContent || !result.repxContent || before.repxContent === result.repxContent) return;
    pushHistory(before);
  }, [result]);
  /** A project opened: its history starts with it. */
  const resetReportHistory = () => {
    reportPast.current = [];
    reportFuture.current = [];
    lastReport.current = null;
    noteHistory();
  };
  const undoReport = () => {
    const back = reportPast.current.pop();
    if (!back || !result) return;
    reportFuture.current.push(result);
    movingInHistory.current = true;
    setResult(back);
    setSaveNotice('Undone');
  };
  const redoReport = () => {
    const forward = reportFuture.current.pop();
    if (!forward || !result) return;
    reportPast.current.push(result);
    movingInHistory.current = true;
    setResult(forward);
    setSaveNotice('Redone');
  };
  /** The Preview's zoom over its fit to the width, and the scale it draws at (2026-11-05). */
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);
  /** Bumped to clear the Preview's selection from the toolbar. */
  const [selectionReset, setSelectionReset] = useState(0);
  /**
   * What the conversation is searched for (the request log's until 2026-11-08):
   * the card marks it in its replies, as the chat column's search did. The
   * log searched its titles only, and the thread's marking was never reached.
   */
  const [logQuery, setLogQuery] = useState('');
  /** Bumped to open the conversation's search from the command menu (agent audit item 66; the log's until 2026-11-08). */
  const [searchReveal, setSearchReveal] = useState(0);
  /**
   * The REPX the Preview itself last wrote. Any other change to the file (a
   * chat edit, Undo, a restore, another project) clears the Preview's
   * selection (2026-11-06): it is held as band and control indexes, and after
   * such a change the same indexes can name another control, which Delete
   * would then remove.
   */
  const previewEditedXml = useRef<string | null>(null);
  /**
   * What was last selected on the Preview, for the Data tab's Bind (2026-11-08,
   * the SQL Server programme): the Preview clears its selection when another
   * pane replaces it, rightly for the box's chips, and the Data tab is that
   * other pane. Forgotten whenever the report changes from anywhere else.
   */
  const [bindTarget, setBindTarget] = useState<string[]>([]);
  useEffect(() => {
    if (result?.repxContent === previewEditedXml.current) return;
    previewEditedXml.current = null;
    setSelectionReset((n) => n + 1);
    setBindTarget([]);
  }, [result?.repxContent]);
  /**
   * What the last save kept (`sessionSignature`, 2026-11-05): the ref for the
   * autosave's comparison, the state for the Save button's "Saved".
   */
  const savedSignatureRef = useRef('');
  const [savedSignature, setSavedSignature] = useState('');
  /** The project whose automatic save already said it failed, so it says so once. */
  const autosaveFailedFor = useRef<string | null>(null);
  /** The automatic save waiting for its moment, which `flushAutosave` runs at once. */
  const pendingAutosave = useRef<{ timer: number; run: () => void } | null>(null);
  /** The project open in this tab before a reload, opened again once the list holds it. */
  const restoreProjectId = useRef<string | null>((() => {
    try {
      return sessionStorage.getItem(OPEN_PROJECT_KEY);
    } catch {
      return null;
    }
  })());
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

  /*
   * The settings Forma works out for itself (2026-11-04, lib/autoConfig.ts):
   * the DevExpress version, unit, paper, direction and stored procedure, read
   * from the report, pages and words of the request in hand, where they used
   * to be chosen in Settings. `effectiveConfig` is the stored config with them
   * laid over it; every path that makes a report reads that, not `config`.
   */
  const detectedRef = useRef<DetectedSettings | null>(null);
  const isReportFile = (t: { file: string }) => /\.repx$/i.test(t.file);
  const detectionInput = (sources: DetectionSources, withOpenReport: boolean): DetectInput => ({
    // An uploaded report first, then the one open, which a request refines.
    repx: [...(sources.texts ?? []).filter(isReportFile).map((t) => t.text), ...(withOpenReport ? [result?.repxContent] : [])],
    pages: [
      ...(sources.metas ?? []).flatMap((m) => (m.pagePoints ? [{ ...m.pagePoints, pagePoints: m.pagePoints }] : [])),
      ...(sources.pages ?? []),
    ],
    text: [sources.words, ...(sources.texts ?? []).filter((t) => !isReportFile(t)).map((t) => t.text)].filter(Boolean).join('\n'),
    locale: navigator.language,
    learned: { version: config.version, unit: config.unit },
  });
  /** Work the settings out for the request in hand, and keep them for every path that makes its report. */
  const detectFor = (sources: DetectionSources): DetectedSettings => {
    const detected = detectSettings(detectionInput(sources, true));
    detectedRef.current = detected;
    console.debug(`Forma worked out: ${detected.reasons.join('; ')}.`);
    // A report the user brings teaches the version and unit their designer
    // uses, kept for the requests that bring none.
    const brought = (sources.texts ?? []).filter(isReportFile).map((t) => repxFacts(t.text)).find((f) => f.version || f.unit);
    if (brought && ((brought.version && brought.version !== config.version) || (brought.unit && brought.unit !== config.unit))) {
      setConfig((prev) => ({ ...prev, ...(brought.version ? { version: brought.version } : {}), ...(brought.unit ? { unit: brought.unit } : {}) }));
    }
    return detected;
  };
  const effectiveConfig = (): ReportConfig => (detectedRef.current ? applyDetected(config, detectedRef.current) : config);
  /** Pages OCR read, as detection takes them: their shape, and their words for the direction. */
  const readSources = (read: readonly { meta: PreviewMeta; read: ReadPage }[]) => ({
    pages: read.map(({ meta, read: r }) => ({ width: r.ocr.width, height: r.ocr.height, pagePoints: meta.pagePoints })),
    words: read.flatMap(({ read: r }) => r.ocr.lines.map((l) => l.text)).join('\n'),
  });

  const batchResults = useRef<Map<string, DesignResult>>(new Map());
  const runOneBatchFile = useCallback(async (file: File, signal: AbortSignal, id: string) => {
    const ingested = await ingestFile(file, `batch-${id}`, config.unit);
    const parts = toAttachmentParts(ingested.images, ingested.texts);
    const { analyzeReportDesign } = await loadGemini();
    // Worked out per file and not kept, since up to three files run at once,
    // and from the file alone: the report open on the bench is not its source.
    const fileConfig = applyDetected(config, detectSettings(detectionInput({ texts: ingested.texts, metas: ingested.imageMeta }, false)));
    // On a limit the next AI set up designs it (2026-11-10, batch AG item 23, lib/fallbackChain.ts);
    // when every one gives out, the batch pauses on that error and is kept.
    const { askWithChain } = await import('./lib/fallbackChain');
    const response = (await askWithChain(fileConfig, (asked) => analyzeReportDesign('', parts, asked, undefined, signal), signal)).value;
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
          const settings = effectiveConfig();
          read = await readPage(src, meta, settings.unit, settings.pageSize, (progress) => onProgress?.(i, pages.length, progress));
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

  /**
   * Read the staged pages behind the scenes, after the message is in the
   * thread: the reply shows the working dots, as any reply does, and the
   * composer is held as for any reply. The pages are kept for the review a
   * reply built from their text offers.
   *
   * Dots only since 2026-11-07 (agent audit item 60): the placeholder said
   * "Reading the text on your pages (1 of 3)… 45%", the one place a step and
   * a percentage still reached the chat after the owner asked for every step
   * to stay behind the scenes (2026-11-04).
   */
  const readSentPages = async (pages: readonly { src: string; meta: PreviewMeta }[], signal?: AbortSignal) => {
    if (!pages.length) return [];
    setSentPages((prev) => {
      const next = { ...prev };
      for (const p of pages) next[p.meta.uploadId] = [...(next[p.meta.uploadId] ?? []).filter((q) => ocrKey(q.meta) !== ocrKey(p.meta)), p];
      return next;
    });
    setIsChatting(true);
    setStreamingReply('');
    try {
      return await readPages(pages);
    } finally {
      // Stopped, the composer is already back and another turn may be running.
      if (!signal?.aborted) {
        setIsChatting(false);
        setStreamingReply('');
      }
    }
  };

  /** The upload whose reading is being reviewed, over its image, with Build .repx. */
  const [ocrReview, setOcrReview] = useState<string | null>(null);
  const ocrReviewPages = useMemo(() => (ocrReview ? sentPages[ocrReview] ?? [] : []), [sentPages, ocrReview]);

  /**
   * A report as its source is written: right to left when the request's text
   * or report is (2026-11-04, lib/repxRtl.ts and lib/autoConfig.ts). Applied
   * wherever a report reaches the bench, because the prompt is the only other
   * thing that knows the direction and most of the ways Forma makes a report
   * use no prompt.
   */
  const asConfigured = (xml: string): string => (effectiveConfig().rtl && xml ? makeRightToLeft(xml) : xml);

  /** A report built from OCR alone: every pane, a revision, and a line in the thread. */
  const handleOcrBuild = (built: OcrBuiltReport) => {
    const newResult: DesignResult = {
      content: built.markdown,
      timestamp: new Date(),
      title: built.title,
      layout: built.layout,
      repxContent: asConfigured(built.repxContent),
      usage: null,
    };
    setResult(newResult);
    // Labelled and said by result, not by the part that read the page
    // (2026-11-11, the full audit's WS-05 and CV-11). This is the page's text
    // where it printed, the same copy handleReaderBuild keeps before its build,
    // so it carries the same label (and RevisionsPanel reads the old one,
    // "Read from the page", as this).
    recordRevision('Your page as printed', newResult);
    setActiveTab('ui');
    const unsure = built.flagged
      ? ' A few words were hard to make out; they are marked in the report, so check them against your page.'
      : '';
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'assistant',
      text: `Here is "${built.title}", built from the text of your page, every line where it was printed.${unsure}`,
      result: newResult,
      standalone: true,
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
    // Labelled by result (2026-11-11, the full audit's WS-05): the copy is the
    // page as it printed, the build the report made from it.
    if (copy) recordRevision('Your page as printed', { content: copy.markdown, timestamp: new Date(), title: copy.title, layout: copy.layout, repxContent: asConfigured(copy.repxContent), usage: null });
    const newResult: DesignResult = { content: built.markdown, timestamp: new Date(), title: built.title, layout: built.layout, repxContent: asConfigured(built.repxContent), usage: null };
    setResult(newResult);
    recordRevision('From your page', newResult);
    setActiveTab('ui');
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'assistant',
      text:
        `Here is "${built.title}", built from your page, with its records printing from fields.` +
        (built.placeholders ? ' A few captions still need their words; they are marked in the report.' : '') +
        (copy ? ' Your page exactly as it printed is the version before this one, in Revisions.' : ''),
      result: newResult,
      standalone: true,
    }]);
    setOcrReview(null);
  };

  /** Forma's box reader's report from the pages read, or null when it cannot load or finds no text. */
  const readerBuild = async (read: readonly { meta: PreviewMeta; read: ReadPage }[]): Promise<ReaderBuiltReport | null> => {
    try {
      const [{ loadBoxReader }, { buildWithReader }] = await Promise.all([import('./lib/boxReader'), import('./lib/ocrAttach')]);
      return buildWithReader(read, await loadBoxReader(), effectiveConfig().pageSize);
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
    const { unit, pageSize } = effectiveConfig();
    return ocrTexts(read, unit, pageSize).map((t, i) => ({ ...t, id: `${stamp}-${i}-ocr-${t.file}-p${t.page ?? 1}` }));
  };

  /**
   * The text the page reader on the Local AI server read from the sent
   * pictures, one attachment a page beside OCR's (2026-11-10, batch AF,
   * lib/localModels.ts). Asked one page at a time, since a local server
   * answers one at a time; a reader that is off or fails leaves its text out.
   */
  const pageReaderAttachments = async (pages: readonly { src: string; meta: PreviewMeta }[], signal: AbortSignal): Promise<TextAttachment[]> => {
    const reader = pageReaderOf(effectiveConfig());
    if (!reader || !pages.length) return [];
    try {
      const [{ readPageText }, { pageReaderText }] = await Promise.all([import('./services/pageReader'), import('./lib/localModels')]);
      const stamp = Date.now();
      const out: TextAttachment[] = [];
      for (const [i, { src, meta }] of pages.entries()) {
        if (signal.aborted) break;
        const text = pageReaderText(meta.file, meta.page ?? 1, reader.model, await readPageText(reader, src, signal));
        if (text) out.push({ id: `${stamp}-${i}-reader-${meta.file}-p${meta.page ?? 1}`, uploadId: meta.uploadId, file: meta.file, page: meta.page, text });
      }
      return out;
    } catch (err) {
      if (!signal.aborted) console.warn(`The page reader ${reader.model} could not read the page; the AI designs from OCR's reading alone.`, err);
      return [];
    }
  };

  // Over the bench a drop is allowed, and a file dropped on it is attached.
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /*
   * "Drop to attach" while files are dragged over the workspace (2026-11-07,
   * agent audit item 70), as ChatGPT and Gemini veil the page. Counted, since
   * entering a child fires leave on its parent.
   */
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const handleDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepth.current += 1;
    setDropping(true);
  };
  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDropping(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDropping(false);
    await ingestFiles(Array.from(e.dataTransfer.files));
  };

  /**
   * A new, empty session. `keep` is what happens to the one being left (see
   * `leaveSession`): New report and a batch result keep it, deleting the open
   * project and signing out drop it.
   */
  const handleClearChat = (keep: 'save' | 'drop' = 'save') => {
    leaveSession(keep);
    setResult(null);
    openReportId.current = null;
    setOpenProjectId(null);
    setPreviews([]);
    setPreviewMeta([]);
    setAttachmentTexts([]);
    setUploadNotices([]);
    // A new report starts with an empty box (agent audit item 69): the words
    // of the one left were kept with it by `leaveSession`.
    draftKeyRef.current = NEW_DRAFT;
    keepDraft(NEW_DRAFT, '');
    setPrompt('');
    setError(null);
    setMessages([]);
    setChatChanges({});
    // A new conversation owes no answers to the last one's questions.
    pendingClarifyRef.current = null;
    setShownRequestId(null);
    setChangedHighlight([]);
    setQueue([]);
    setOcrReview(null);
  };

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
   * The read of what is already stored is what lets a project be saved again:
   * since 2026-11-05 saving updates the open project in place (`persistProject`,
   * after every turn), and the plan writes only the versions the collection
   * does not hold yet. Until then every save minted a new `reportId`, the
   * collection always came back empty, and this read waited for that day.
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

  /* `revealSaveFailure` went on 2026-11-06 (the workspace audit). It put the
     chat column back on screen when a save failed, because the error rendered
     in a composer that column hid (measured 2026-09-08). The composer floats
     over the report now and is always seen, so all it still did was pull the
     person off Projects, Revisions, Batch or the library whenever a quiet
     autosave failed. */

  /** A report the user keeps teaches the memory its style, never its words (lib/memory.ts). */
  const rememberKept = (repx: string | undefined) => {
    if (!repx) return;
    void import('./lib/memory').then(m => {
      const style = m.keptStyleOf(repx);
      if (style) m.writeMemory(m.rememberKept(m.readMemory(), style));
    }).catch(() => undefined);
  };

  /**
   * The open session saved (2026-11-05), by the Save button or on its own.
   *
   * Into the open project, which is the change: every save minted a new id
   * until then, so saving twice listed the project twice. A session with no
   * project yet gets one, and from then on it is that project.
   *
   * `quiet` is the save the workspace makes on its own after a turn, as
   * ChatGPT keeps every conversation: no notice, and the memory of the
   * report's style is taught only by a Save the person chose. A failure says
   * so once per project rather than after every turn.
   */
  const persistProject = async (
    quiet: boolean,
    /** The session to keep, when it is not the one on screen: a run cut short by leaving it. */
    session: { messages: ChatMessage[]; result: DesignResult | null } = { messages, result },
  ): Promise<boolean> => {
    // True once the project is kept (2026-11-06): Share asks, and shared a
    // project whose save had failed, which the account did not hold.
    const { messages: kept, result: report } = session;
    if (!report && kept.length === 0) return false;
    if (!quiet) rememberKept(report?.repxContent);
    const reportId = openReportId.current ?? Date.now().toString();
    const ts = Date.now();
    const signature = sessionSignature(kept, report);
    // A report's first save takes the words in its box with it to its id (agent audit item 69).
    if (!openReportId.current && draftKeyRef.current === NEW_DRAFT) {
      draftKeyRef.current = reportId;
      writeDrafts(movedDraft(readDrafts(), NEW_DRAFT, reportId));
    }
    // Saving makes this the open project, so the list marks the row it just
    // created rather than nothing.
    openReportId.current = reportId;
    setOpenProjectId(reportId);
    const fail = (message: string) => {
      if (quiet && autosaveFailedFor.current === reportId) return;
      autosaveFailedFor.current = reportId;
      setError(quiet ? `Forma could not save this conversation on its own. ${message}` : message);
    };
    const saved = () => {
      autosaveFailedFor.current = null;
      // A session left while this was saving is not the one the Save button
      // now speaks for (2026-11-06): its signature would mark the next one saved.
      if (openReportId.current !== reportId) return;
      savedSignatureRef.current = signature;
      setSavedSignature(signature);
    };

    // One report, one shape, converted at the boundary rather than assembled
    // differently in each branch — the two used to compute the display name
    // separately, so the same project could be listed under two names depending
    // on whether it was saved signed in. See src/lib/savedReport.ts.
    const draft: SavedReport = {
      id: reportId,
      name: projectName(savedReportsRef.current.find((r) => r.id === reportId)?.name, report?.title, kept.find((m) => m.role === 'user' && m.text)?.text || prompt),
      timestamp: new Date(ts).toISOString(),
      messages: kept,
      result: report,
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
        const fitted = cloudPayload(draft, user.uid);
        if (!fitted) {
          fail('This project is too large to sync to your account. It is still open here, and Save while signed out keeps it on this device.');
          return false;
        }
        const { payload, imagesDropped } = fitted;

        await sdk.setDoc(docRef, payload);
        // Its index entry after it (site audit item 63), which is what the
        // list listens to; tolerated, since the weekly reconciliation writes
        // a missing one and the save itself has already succeeded.
        await sdk.setDoc(paths.reportIndexDocRef(db, user.uid, reportId), toIndexDocument(draft, user.uid)).catch((error) => {
          console.warn('The project was saved; its entry in the projects index was not.', error);
        });
        saved();

        // After the report, and only after: a version filed under a report that
        // failed to save would be history for something nobody can open.
        const history = await persistRevisions(reportId);
        const historyNote =
          history === 'saved' ? ' Its version history came with it.'
          : history === 'partial' ? ' One version was too large to sync; the rest came with it.'
          : history === 'failed' ? ' Its version history could not be synced — it is still here for this session.'
          : '';

        if (!quiet) {
          setSaveNotice(
            (imagesDropped
              ? 'Saved to your projects — the uploaded images were too large to sync, so the spec and REPX were saved without them.'
              : 'Saved to your projects.') + historyNote
          );
        }
        return true;
      } catch (err) {
        if (quiet && autosaveFailedFor.current === reportId) return false;
        autosaveFailedFor.current = reportId;
        reportFirestoreFailure(err, OperationType.WRITE, `users/${user.uid}/reports/${reportId}`,
          'That project could not be saved to your account. It is still open here — try again in a moment.');
        return false;
      }
    } else {
      // The write happens before the state update, not inside it: a failing
      // setItem used to throw from inside a setSavedReports updater, which put
      // the exception into React rather than in front of the user. Deciding
      // first also means the list never shows a project that was not stored.
      // The project replaces its own earlier save and goes to the top.
      const updated = [draft, ...savedReportsRef.current.filter((r) => r.id !== reportId)];
      const outcome = saveReportsLocally(updated);

      if (!outcome.ok) {
        fail(outcome.message);
        return false;
      }

      setSavedReports(updated);
      saved();
      // Ask the browser to keep it (site audit item 60, lib/storagePersist.ts),
      // once a session, now that there is something on this device to keep.
      void askToKeepStorage();
      if (!quiet) setSaveNotice('Saved on this device. Sign in to sync across devices.');
      return true;
    }
  };

  const handleSaveReport = () => void persistProject(false);

  /*
   * Saving on its own (2026-11-05). The open session is saved once a turn has
   * settled and nothing has changed for a moment, whenever what a save keeps
   * has moved (`sessionSignature`): a reply, a report, an edit on Preview, a
   * rating. New report and opening another project run a waiting save at
   * once rather than drop it (`flushAutosave`); signing out and an account
   * change drop it, so one person's work is never saved where the next
   * person signs in.
   */
  const AUTOSAVE_DELAY_MS = 1200;
  const currentSignature = useMemo(() => sessionSignature(messages, result), [messages, result]);
  /*
   * Not only once a turn has settled (2026-11-07, agent audit item 33): a
   * message is saved as soon as it is sent, so a reload while Forma works
   * keeps it, marked as unanswered when the project opens again
   * (`markInterrupted`). Until then the save waited for the turn, and a reload
   * in the middle of one lost the message. A reply being written is not in
   * `messages`, so a turn still costs two saves, not one per streamed word.
   */
  useEffect(() => {
    if (messages.length === 0) return;
    if (currentSignature === savedSignatureRef.current) return;
    const run = () => {
      if (pendingAutosave.current?.run === run) pendingAutosave.current = null;
      void persistProject(true);
    };
    const timer = window.setTimeout(run, AUTOSAVE_DELAY_MS);
    pendingAutosave.current = { timer, run };
    return () => {
      window.clearTimeout(timer);
      if (pendingAutosave.current?.timer === timer) pendingAutosave.current = null;
    };
    // persistProject is redefined every render; the signature is what decides,
    // and the closure scheduled is the latest render's, holding what moved it.
  }, [currentSignature]);
  /*
   * A page closed, reloaded or put away (2026-11-07, agent audit item 33)
   * runs the waiting save and keeps the unsent words at once, rather than
   * losing whatever changed in the last moment: the save waits 1.2 seconds
   * and the draft 300 milliseconds. `visibilitychange` as well as `pagehide`,
   * because a phone often closes a tab it has hidden without the second.
   */
  useEffect(() => {
    const keepNow = () => {
      const pending = pendingAutosave.current;
      if (pending) {
        window.clearTimeout(pending.timer);
        pendingAutosave.current = null;
        pending.run();
      }
      keepDraft(draftKeyRef.current, draftNow.current);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') keepNow();
    };
    window.addEventListener('pagehide', keepNow);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', keepNow);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);
  /*
   * Offline, said when it happens (2026-11-07, agent audit item 44), as Gemini
   * and ChatGPT say it, and taken away when the connection is back. Until
   * then a request made offline was retried on every model and failed as a
   * stream Google had closed. A notice already saying something else stays.
   */
  useEffect(() => {
    const OFFLINE = "You're offline. Forma needs a connection to reach the AI; what you write is kept, and you can send it once you're back.";
    const offline = () => setError(OFFLINE);
    const online = () => setError((shown) => (shown === OFFLINE ? null : shown));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) offline();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);

  /** Runs a waiting automatic save now, before the session it belongs to is replaced. */
  const flushAutosave = () => {
    const pending = pendingAutosave.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingAutosave.current = null;
    pending.run();
  };
  /** Drops a waiting automatic save: the session it belongs to is being deleted or signed out of. */
  const dropAutosave = () => {
    const pending = pendingAutosave.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingAutosave.current = null;
  };

  /** Which session is open, counted, so work that answers late can tell it is no longer wanted. */
  const sessionId = useRef(0);

  /**
   * The open session left for another (2026-11-06, the workspace audit): New
   * report, a project or a batch result opened, the open project deleted, a
   * sign-out. Until then each of those cleared what it remembered to, and none
   * stopped a run: a report or reply still on its way landed in the session
   * opened next and was saved under its id, a batch result was saved over the
   * project open before it, and the last project's revisions and undo history
   * stayed to be restored onto the next.
   *
   * Whatever is running stops first. `save` keeps the session as it stands, a
   * run cut short marked as stopped as Stop marks it; `drop` keeps nothing,
   * for a project being deleted and for a sign-out, so one person's work is
   * never saved where the next person signs in. Then everything that belonged
   * to it goes: its history, revisions, the changes its replies can undo, the
   * queue, a description's brief, the settings worked out for its request, a
   * selection on the Preview, an open Export panel or Share dialog.
   */
  const leaveSession = (keep: 'save' | 'drop') => {
    if (keep === 'save' && (isAnalyzing || isChatting) && messages.length) {
      dropAutosave();
      const partial = partialReplyRef.current.trim();
      void persistProject(true, {
        messages: [...messages, { id: nextMessageId(), role: 'assistant', text: partial || 'Stopped.' }],
        result,
      });
    } else if (keep === 'save') {
      flushAutosave();
    } else {
      dropAutosave();
    }
    // The words in the box stay with the project they were typed in (agent
    // audit item 69), or go with it when it is deleted or the person signs out.
    keepDraft(draftKeyRef.current, keep === 'save' ? draftNow.current : '');
    sessionId.current += 1;
    abortControllerRef.current?.abort();
    turnAbortRef.current?.abort();
    if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    partialReplyRef.current = '';
    setIsAnalyzing(false);
    setIsChatting(false);
    setStreamingReply('');
    setProgress(IDLE_PROGRESS);
    resetReportHistory();
    setRevisions([]);
    setChatChanges({});
    turnBases.current.clear();
    setChangedHighlight([]);
    setQueue([]);
    setTestRows(null);
    setLogQuery('');
    activeDescribeRef.current = undefined;
    pendingClarifyRef.current = null;
    detectedRef.current = null;
    setIsExportOpen(false);
    setIsShareOpen(false);
    setSelectionReset((n) => n + 1);
    setPreviewZoom(1);
    /*
     * What was said for this project's data goes with it (2026-11-11, the
     * full audit's WS-01 and WS-02), whichever way it is left: Projects,
     * Recent, Ctrl+K, New report, a batch result, a sign-out. The rows
     * answer is asked again, the shared database is ticked again, and the
     * query chosen is the next project's own (`handleLoadReport`); the
     * database itself stays kept on the device.
     */
    setRowsDecision(null);
    setDatabaseShared(false);
    setActiveQuery(null);
  };

  /*
   * A reload opens the project that was open (2026-11-05), as a reloaded chat
   * in ChatGPT is still that chat. The id is kept per tab, in sessionStorage;
   * the project is opened once the list holding it has arrived, which signed
   * in is after Firestore answers, and only into an empty workspace.
   */
  useEffect(() => {
    try {
      if (openProjectId) sessionStorage.setItem(OPEN_PROJECT_KEY, openProjectId);
      // Not while a restore still waits for its list: signed in, Firestore
      // answers after this first runs, and a second reload meanwhile would
      // find nothing to open.
      else if (!restoreProjectId.current) sessionStorage.removeItem(OPEN_PROJECT_KEY);
    } catch {
      /* storage blocked: a reload starts empty, as before */
    }
  }, [openProjectId]);
  /** The open project's reply changes, kept in this tab for a reload (lib/replyChanges.ts). */
  useEffect(() => {
    if (!openProjectId) return;
    const packed = packChanges(
      openProjectId,
      Object.entries(chatChanges).map(([id, c]) => [id, { before: c.before.repxContent ?? '', after: c.after.repxContent ?? '' }] as const),
    );
    try {
      if (packed) sessionStorage.setItem(REPLY_CHANGES_KEY, packed);
      else sessionStorage.removeItem(REPLY_CHANGES_KEY);
    } catch {
      /* storage full or blocked: the Undo lasts as long as the page, as before */
    }
  }, [chatChanges, openProjectId]);
  useEffect(() => {
    const id = restoreProjectId.current;
    if (!id) return;
    const report = savedReports.find((r) => r.id === id);
    if (!report) return;
    restoreProjectId.current = null;
    if (messages.length || result) return;
    void handleLoadReport(report);
    // Once, when the list first holds the project; the ref keeps it to once.
  }, [savedReports]);

  /**
   * Open a saved project, and bring its history with it.
   *
   * The report goes onto the bench synchronously and the history follows,
   * because the history is a second round trip and the report should not wait on
   * it. `setRevisions([])` first is not tidiness: without it the previous
   * project's versions stay in the panel and read as belonging to this one — the
   * one way a revision list can be actively misleading rather than merely empty.
   */
  const handleLoadReport = async (listed: SavedReport) => {
    // Its content first, when the list holds only its index entry (2026-11-08,
    // site audit item 63): an entry has no conversation and no report.
    const report = await fullReport(listed);
    if (!report) return;
    // The session being left keeps its last turn (2026-11-05) and stops what
    // it was doing (2026-11-06, `leaveSession`); the one opened is already
    // saved as it is.
    leaveSession('save');
    const signature = sessionSignature(report.messages, report.result);
    savedSignatureRef.current = signature;
    setSavedSignature(signature);
    // Saved as soon as it was sent (2026-11-07), a message left with no
    // answer was cut off by a reload or a closed page, and says so.
    setMessages(markInterrupted(report.messages));
    setResult(report.result);
    // Questions it was waiting on are answered by the next message, as before the reload (item 24).
    pendingClarifyRef.current = pendingClarifyOf(report.messages);
    // The replies' changes this tab kept for it, so their Undo survives a
    // reload; read once, as only the reload's own project can match.
    const kept = unpackChanges(keptChanges.current, report.id);
    keptChanges.current = null;
    const base = report.result;
    if (kept.length && base) {
      setChatChanges(Object.fromEntries(kept.map(([id, c]) => [id, { before: { ...base, repxContent: c.before }, after: { ...base, repxContent: c.after } }])));
    }
    // The words in the box are the project's own since 2026-11-07 (agent
    // audit item 69), as a chat's draft is in ChatGPT: the left project's
    // were kept by `leaveSession`, and this one's come back. Files attached
    // stay in the box, as before: they are not kept over a reload either.
    draftKeyRef.current = report.id;
    setPrompt(readDrafts()[report.id] ?? '');
    // The queue this tab kept for it (item 71), paused: the turn it waited on
    // was cut off by the reload. Read once, as only the reload's project can match.
    const keptItems = keptQueueFor<Queued>(keptQueue.current, report.id);
    keptQueue.current = null;
    if (keptItems.length) {
      setQueue(keptItems);
      setQueuePaused(true);
    }
    setError(null);
    setShownRequestId(null);
    setRailPanel('review');
    openReportId.current = report.id;
    setOpenProjectId(report.id);
    // What it reads is its own data source's, when it has one and the kept database holds it (WS-02).
    const ownXml = report.result?.repxContent;
    if (ownXml && activeDatabaseRef.current) {
      void import('./lib/sqlDrift').then(({ queryFromRepx }) => {
        if (openReportId.current !== report.id || !activeDatabaseRef.current) return;
        const own = queryFromRepx(ownXml, activeDatabaseRef.current);
        if (own) setActiveQuery(own);
      }).catch((err) => console.warn('The project opened; what it reads could not be read back.', err));
    }

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

  /*
   * Pinned and archived projects (2026-11-05), kept on this device at the
   * owner's choice: lists of ids in localStorage, so the six fields
   * `firestore.rules` allows are untouched. A rename does sync, since `name`
   * is one of them. See `arrangeProjects` in lib/savedReport.ts.
   */
  const [pinnedProjects, setPinnedProjects] = useState(() => readIdList(PINNED_PROJECTS_KEY));
  const [archivedProjects, setArchivedProjects] = useState(() => readIdList(ARCHIVED_PROJECTS_KEY));
  const [showArchived, setShowArchived] = useState(false);
  /** The project whose name is being typed over, and the words so far. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const togglePinned = (id: string) => setPinnedProjects((ids) => {
    const next = toggleId(ids, id);
    writeIdList(PINNED_PROJECTS_KEY, next);
    return next;
  });
  const toggleArchived = (id: string) => setArchivedProjects((ids) => {
    const next = toggleId(ids, id);
    writeIdList(ARCHIVED_PROJECTS_KEY, next);
    return next;
  });

  /** A saved project renamed, where it is kept: the account's document, or this device. */
  const handleRenameProject = async (id: string, typed: string) => {
    setRenaming(null);
    const report = savedReports.find((r) => r.id === id);
    const name = typed.trim().slice(0, 120);
    if (!report || !name || name === report.name) return;
    const renamed = { ...report, name };
    if (user) {
      try {
        const { sdk, paths, db } = await loadFirebase();
        // The name alone (2026-11-08, site audit item 63), never the whole
        // document from the list: an entry listed from the index has no
        // content, and writing it back would empty the project. The rules
        // check the merged document, which keeps every other field. Then its
        // index entry, which the list follows.
        const stored = toFirestoreDocument(renamed, user.uid);
        await sdk.updateDoc(paths.reportDocRef(db, user.uid, id), { name: stored.name });
        await sdk.setDoc(paths.reportIndexDocRef(db, user.uid, id), toIndexDocument(renamed, user.uid)).catch((error) => {
          console.warn('The project was renamed; its entry in the projects index was not.', error);
        });
      } catch (err) {
        reportFirestoreFailure(err, OperationType.WRITE, `users/${user.uid}/reports/${id}`, 'That project could not be renamed in your account. Try again in a moment.');
      }
      return;
    }
    const updated = savedReports.map((r) => (r.id === id ? renamed : r));
    const outcome = saveReportsLocally(updated);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setSavedReports(updated);
  };

  /**
   * The open project copied as a new one (2026-11-06, the title's menu, as
   * Stitch's Duplicate): what is on screen now, not its last save, kept where
   * a save would keep it. The copy is listed; the original stays open.
   */
  const duplicateProject = async (id: string | null = openProjectId) => {
    const listed = savedReports.find((r) => r.id === id);
    if (!listed) return;
    // Its content first, when the list holds only its index entry (item 63).
    const source = listed.id === openProjectId ? listed : await fullReport(listed);
    if (!source) return;
    // The open project as it is on screen; another, from the list's row
    // (2026-11-06), as it was saved.
    const open = source.id === openProjectId;
    const copy: SavedReport = {
      id: Date.now().toString(),
      name: `Copy of ${source.name}`.slice(0, 120),
      timestamp: new Date().toISOString(),
      messages: open ? messages : source.messages,
      result: open ? result : source.result,
    };
    if (user) {
      try {
        const fitted = cloudPayload(copy, user.uid);
        if (!fitted) {
          setError('This project is too large to copy into your account.');
          return;
        }
        const { sdk, paths, db } = await loadFirebase();
        await sdk.setDoc(paths.reportDocRef(db, user.uid, copy.id), fitted.payload);
        await sdk.setDoc(paths.reportIndexDocRef(db, user.uid, copy.id), toIndexDocument(copy, user.uid)).catch((error) => {
          console.warn('The copy was saved; its entry in the projects index was not.', error);
        });
        setSaveNotice(`Duplicated as ${copy.name}`);
      } catch (err) {
        reportFirestoreFailure(err, OperationType.WRITE, `users/${user.uid}/reports/${copy.id}`, 'That project could not be duplicated in your account. Try again in a moment.');
      }
      return;
    }
    const updated = [copy, ...savedReports];
    const outcome = saveReportsLocally(updated);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setSavedReports(updated);
    setSaveNotice(`Duplicated as ${copy.name}`);
  };
  /** The open project deleted from the title's menu, and a new report started in its place. */
  const deleteOpenProject = () => {
    if (!openProjectId) return;
    removeReports([openProjectId]);
  };

  const REMOVE_FADE_MS = 190;

  const removeReports = (ids: string[]) => {
    if (ids.length === 0) return;
    // The open project among them is closed first, and not saved on its way
    // out (2026-11-06): left open, its next save wrote it back under its id.
    if (openReportId.current && ids.includes(openReportId.current)) handleClearChat('drop');
    // A deleted project's unsent words go with it (agent audit item 69).
    writeDrafts(ids.reduce((drafts, id) => withDraft(drafts, id, ''), readDrafts()));
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

  /**
   * What a sign-out leaves behind: nothing that was theirs. Signing out must
   * not leave a live credential for the next person at this browser. The
   * encrypted copy in Firestore is untouched — signing back in and entering
   * the passphrase restores it. The OpenRouter key too (2026-11-06, the
   * workspace audit): it stayed in sessionStorage. And the same for a
   * sign-out made in another tab, which until then cleared the conversation
   * and none of the keys.
   *
   * The credential was never the only thing worth clearing. The workspace also
   * holds the signed-out user's *documents*: uploaded page images, text lifted
   * out of their PDFs, the chat transcript and the generated report. All of it
   * used to survive sign-out and sit there for whoever used the browser next.
   */
  const forgetSignedOut = () => {
    setConfig((prev) => ({ ...prev, customApiKey: '', openRouterKey: '' }));
    clearSessionKey();
    // Settings closes, and with it go a passphrase typed there, the stored
    // key's record and any line about either: they are the dialog's own
    // state since its redesign (2026-11-07), and leave when it unmounts.
    setIsConfigOpen(false);
    handleClearChat('drop');
    // Every project's unsent words and a kept queue go too (agent audit items
    // 69 and 71): the next person to sign in on this machine sees none of them.
    writeDrafts({});
    keptQueue.current = null;
    setRailPanel('review');
    // And every session key a sign-out removes, the list the public site
    // uses too (lib/signOut.ts, 2026-11-08), and the database layouts kept here (2026-11-09).
    forgetSession();
    setActiveDatabase(null);
  };
  useEffect(() => {
    forgetSignedOutRef.current = forgetSignedOut;
  });

  const handleLogOut = async () => {
    try {
      await (await loadAuth()).service.logOut();
    } catch (err) {
      console.error(err);
    }
    setUser(null);
    forgetSignedOut();

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
   * `runGeneration`, after `offlineDesign` below: the generation run itself,
   * ticker, request, result, transcript, error handling, teardown.
   *
   * It is the single copy of what `handleGenerate` and `handleResume` used to
   * do twice (resume went with pause on 2026-11-04). What a run varies is in
   * `copy`; everything that has to stay in step — above all the `catch`,
   * which is the error path for a call that can 404, 429, 503, hang, abort,
   * or return truncated `repxContent` — is there once and cannot drift.
   *
   * The caller owns the setup: a message adds itself to the transcript and
   * may take a chat turn first, and a description passes its request.
   */
  /** A report Forma's own model designs from a description, with no AI: the stand-in when the AI fails (the chat box with no key used it until 2026-11-05). */
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
    // The settings worked out for this request, not the stored ones (lib/autoConfig.ts).
    const config = effectiveConfig();
    let brief = '';
    let draft: TeamPlan['draft'] = null;
    let evidence: ReportLayout | null = null;
    let correct: DraftRequest | null = null;
    if (input.read.length) {
      // OCR's own picture of the source, every row it read, for the audit
      // to check the AI's REPX against (2026-11-05, lib/ocrAttach.ts).
      const { sourceLayoutOf } = await import('./lib/ocrAttach');
      evidence = sourceLayoutOf(input.read, config.unit, config.pageSize);
    }

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
        // The first page, and the upload's last when it has more (2026-11-04),
        // whose footers and totals the first does not show.
        const [firstReading, lastReading] = await (async () => {
          const one = await readSkeleton(vision, input.firstImage!.src, signal);
          const two = input.lastImage ? await readSkeleton(vision, input.lastImage.src, signal).catch(() => null) : null;
          return [one, two] as const;
        })();
        if (!firstReading.skeleton) throw new Error('its answer had no page line');
        const reading = { skeleton: mergePageSkeletons(firstReading.skeleton, ...(lastReading?.skeleton ? [lastReading.skeleton] : [])) };
        const paper = reading.skeleton.paper === 'Custom' ? config.pageSize : reading.skeleton.paper;
        const page = input.read.find(({ meta }) => meta.uploadId === first.uploadId && (meta.page ?? 0) === (first.page ?? 0));
        const texts = page
          ? pageTextsOf(detectLayout([{ ocr: page.read.ocr, page: pageForImage(page.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }))
          : [];
        const design = skeletonToDesign(reading.skeleton, { texts, title: first.file.replace(/\.[^.]+$/, '') });
        brief = draftBrief(reading.skeleton, design.layout, config.unit);
        const { draftToText } = await import('./lib/draftText');
        correct = { text: draftToText(reading.skeleton, design.used), texts, title: design.title, readBy: "Forma's vision model, corrected by the AI" };
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
        const [{ draftBrief }, { draftToText }] = await Promise.all([import('./lib/formaTeam'), import('./lib/draftText')]);
        brief = draftBrief(built.skeleton, built.layout, config.unit, 'reader');
        correct = { text: draftToText(built.skeleton, built.used), texts: built.texts, title: built.title, readBy: "Forma's box reader, corrected by the AI" };
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
      // Forma's own style, unless the box's switch is off (2026-11-08).
      if (houseStyleOn) try {
        const [{ loadFormaModel }, { houseStyleBrief }] = await Promise.all([import('./lib/formaModel'), import('./lib/formaTeam')]);
        const model = await loadFormaModel();
        brief = houseStyleBrief(model.style, model.reports, config.unit);
      } catch (err) {
        console.warn("Forma's own model could not be loaded; the AI designs without its house style.", err);
      }
      draft = async () => ({ result: (await offlineDesign(described, described.description)).result, source: 'offline' });
    }
    return { brief, draft, evidence, correct };
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
    /**
     * The turn it belongs to (2026-11-07): the report it refines, null to
     * design from nothing, absent for the report on the bench (agent audit
     * item 3); and the message that asked, which a failure is marked on
     * (item 5), the person's latest when absent.
     */
    turnOf?: { base?: DesignResult | null; askId?: string },
  ) => {
    // The settings worked out for this request, not the stored ones (lib/autoConfig.ts).
    const config = effectiveConfig();
    const open = turnOf?.base !== undefined ? turnOf.base : result;
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
      if (houseStyleOn && open?.repxContent && canonicalSources.size > 0) {
        try {
          const { retrieveHouseStyle } = await loadLibrary();
          houseStyle = await retrieveHouseStyle(
            open.repxContent,
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
      // A shared database's likeliest objects and sample values, in place of "assume the procedure" (batch DE).
      const db = databaseShared && activeDatabase ? await import('./lib/databaseAi') : null;
      const database = db ? db.designSection(activeDatabase!, { query: activeQuery, words: [currentPrompt, team.brief, ...currentTexts.map((t) => t.text)].join('\n') }) : undefined;
      const askAi = (asked: ReportConfig) =>
        analyzeReportDesign(
          // Passed through empty when the user typed nothing. It used to become
          // "Generate a professional DevExpress report layout based on these
          // visuals." here, which handed the model an instruction nobody gave and
          // then told it to apply that as a modification. See lib/userInstructions.ts.
          currentPrompt,
          attachmentParts,
          asked,
          open ? { repxContent: open.repxContent, houseStyle } : undefined,
          signal,
          handleStreamProgress,
          {
            ...(describeRequest ? { description: describeRequest } : {}),
            remembered,
            formaBrief: team.brief,
            evidence: team.evidence,
            // Forma drafts and the AI corrects, on a first generation from a
            // picture (2026-11-05); the service designs as before otherwise.
            draft: open ? null : team.correct ?? null,
            database,
          },
        );
      /*
       * The free chain (2026-11-10, the AI accuracy programme, batch AF;
       * lib/fallbackChain.ts): when the AI chosen has reached its limit, the
       * next one the person set up answers, and the reply says so. Only on a
       * limit; when every one gives out, the catch below hands over to Forma's
       * own draft as before.
       */
      const { askWithChain } = await import('./lib/fallbackChain');
      const chained = await askWithChain(config, askAi, signal);
      let response = chained.value;
      const answering = chained.config;
      const switched = chained.note;

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
      /** Every answer this report cost, the repairs' too (agent audit item 79). */
      let spent: TokenUsage | null = response.usage ?? null;
      if (describeRequest) {
        const { auditRepx } = await import('./lib/repxAudit');
        let attempt = 1;
        let audit = auditRepx(response.repxContent, response.layout);
        while (shouldRetryForErrors(audit, attempt)) {
          attempt += 1;
          console.warn(`Report has ${audit.errors} structural error(s) after repairs; asking for a fix (attempt ${attempt}).`);
          /*
           * The report so far is a checkpoint (2026-11-10, the AI accuracy
           * programme, batch AG item 23): a fix that fails, on a limit above
           * all, keeps it. Until then a 429 here threw away a whole report the
           * AI had already written, and Forma's draft stood in for it.
           */
          let fixed: Awaited<ReturnType<typeof askAi>>;
          try {
            fixed = await analyzeReportDesign(
              fixInstruction(audit),
              [],
              answering,
              { repxContent: response.repxContent },
              signal,
              handleStreamProgress,
              { description: describeRequest, database },
            );
          } catch (fixError) {
            if (signal.aborted) throw fixError;
            console.warn(`The fix (attempt ${attempt}) did not answer; keeping the report as it was, with ${audit.errors} error(s).`, fixError);
            break;
          }
          if (signal.aborted) {
            console.debug('Generation aborted/paused by user during repair.');
            return;
          }
          spent = addUsage(spent, fixed.usage);
          const next = auditRepx(fixed.repxContent, fixed.layout);
          // Keep the better of the two; a repair that made things worse is not applied.
          if (next.errors <= audit.errors) {
            // The query the first answer named stands unless the repair names another (batch DE).
            response = { ...fixed, dataQuery: fixed.dataQuery ?? response.dataQuery };
            audit = next;
          } else {
            console.warn(`The repair attempt had ${next.errors} error(s) against ${audit.errors}; keeping the earlier report.`);
            break;
          }
        }
      }

      /*
       * The data source, written by Forma from what the AI named (batch DE,
       * lib/databaseAi.ts): the query chosen on the Data tab, the AI's
       * <?forma-query?>, or the object holding most of what it bound. The
       * Mockup and the Spec are read again, since a detail band may be added.
       */
      let dataNote = '';
      if (db && response.repxContent) {
        const out = db.writeFromAnswer(response.repxContent, activeDatabase!, { query: activeQuery, dataQuery: response.dataQuery, version: config.version });
        dataNote = out.note;
        if (out.query) {
          const views = await import('./lib/repxViews');
          const title = response.layout.title;
          response = { ...response, repxContent: out.xml, markdown: views.specFromRepx(out.xml, title), layout: views.layoutFromRepx(out.xml, title) };
          setActiveQuery(out.query);
        }
      }

      console.log('Successfully received response from Gemini API.');
      console.debug(`Generated Layout Title: ${response.layout.title}`);
      console.debug(`Generated REPX length: ${response.repxContent.length} characters`);

      /*
       * A language the words name, carried out on a first report (2026-11-11,
       * the full audit's CV-14): "Make this report in German" with a picture
       * built the report in the picture's language and said it had been
       * updated. Translated before the reply, so the reply says what is so;
       * a translation that fails leaves the report as built, and says nothing
       * of the language.
       */
      let translated: { xml: string; language: string } | null = null;
      const askedLanguage = !open && response.repxContent
        ? await import('./lib/repxTranslate').then((m) => m.languageAsked(currentPrompt || describeRequest?.description || '')).catch(() => null)
        : null;
      if (askedLanguage) {
        try {
          const done = await translateXml(response.repxContent, askedLanguage, signal);
          if (signal.aborted) return;
          translated = { xml: done.xml, language: askedLanguage };
        } catch (translateError) {
          if (signal.aborted) return;
          console.warn(`The report could not be translated into ${askedLanguage}; it stays as built.`, translateError);
        }
      }
      if (translated && translated.xml !== response.repxContent) {
        const views = await import('./lib/repxViews');
        const title = response.layout.title;
        response = { ...response, repxContent: translated.xml, markdown: views.specFromRepx(translated.xml, title), layout: views.layoutFromRepx(translated.xml, title) };
      }

      const newResult = {
        content: response.markdown,
        timestamp: new Date(),
        title: response.layout.title,
        layout: response.layout,
        // The prompt asks for right to left; this makes sure of it.
        repxContent: asConfigured(response.repxContent),
        usage: spent,
        coverage: response.coverage ?? null,
      };

      setResult(newResult);
      // A refinement turn replaces the whole report, so this is the moment the
      // previous one would otherwise be gone for good.
      recordRevision(open ? 'Refined' : 'Generated', newResult);
      setActiveTab('ui');

      // The reply is the result (2026-11-10, the full audit, the owner's
      // rule): who did what is not said. Mock mode alone says a canned report
      // stood in, so nobody reads a mock as the AI's work (agent audit item 96).
      const credits = MOCK_MODE ? await import('./lib/formaTeam').then(m => m.teamLine(true)).catch(() => '') : '';
      // A redesign says what it changed and can be undone, as an edit in
      // place can, and what is wrong with the file, errors only and in plain
      // words (2026-11-11, the full audit's CV-05; lib/agentEdit.ts).
      const [changed, checked] = newResult.repxContent
        ? await Promise.all([import('./lib/agentEdit'), import('./lib/repxAudit')])
            .then(([m, a]) => [
              open?.repxContent ? m.changesMarkdown(m.describeChanges(open.repxContent, newResult.repxContent!)) : '',
              m.checksMarkdown(a.auditRepx(newResult.repxContent, newResult.layout).findings.filter((f) => f.severity === 'error')),
            ])
            .catch(() => ['', ''])
        : ['', ''];
      // What was made, and from what (2026-11-11, the full audit's UI2, `firstReply`).
      const kind: ReplyKind = describeRequest
        ? 'description'
        : open?.repxContent ? 'open'
        : currentTexts.some((t) => /\.repx$/i.test(t.file ?? '')) ? 'repx'
        : currentTexts.some((t) => /\.pdf$/i.test(t.file ?? '')) ? 'pdf'
        : currentPreviews.length ? 'picture' : 'description';
      const said = firstReply(kind, Boolean(currentPrompt.trim()), translated?.language);
      const newAssistantMsg: ChatMessage = {
        id: nextMessageId(),
        role: 'assistant',
        text: [switched, credits ? `${said} ${credits}` : said, dataNote, changed, checked].filter(Boolean).join('\n\n'),
        result: newResult
      };
      // The two imports above are a wait: a session left meanwhile is not this one.
      if (signal.aborted) return;
      if (open && open.repxContent !== newResult.repxContent) rememberChange(newAssistantMsg.id, open, newResult);
      setMessages(prev => [...prev, newAssistantMsg]);
      console.log(copy.done);
      // What Forma may learn from this report (2026-11-10, lib/learning.ts).
      recordLearning({
        kind: 'generation',
        source: (await import('./lib/learning')).sourceOf({
          images: currentPreviews.length,
          pdfs: currentTexts.filter((t) => /\.pdf$/i.test(t.file ?? '')).length,
          repx: currentTexts.filter((t) => /\.repx$/i.test(t.file ?? '')).length,
          words: Boolean(describeRequest) || Boolean(currentPrompt.trim()),
          database: Boolean(databaseShared && activeDatabase),
        }),
        request: describeRequest || !open ? 'new' : 'redesign',
        ai: aiKindOf(chained.by),
        repx: newResult.repxContent,
        prompt: currentPrompt,
      });

    } catch (err: any) {
      if (signal.aborted) {
        console.debug('Generation aborted/paused by user during error handling.');
        return;
      }
      console.error('Error during report generation:', err);

      // No key configured is a setup step, not a failure — send the user straight
      // to the place they can fix it instead of showing a dead-end error.
      if (isMissingApiKey(err)) {
        // Once, on the request, or over the box when there is none (item 54).
        if (messages.some((m) => m.role === 'user')) setMessages((prev) => markAskError(prev, 'Add your own Gemini API key in Settings to generate reports.', turnOf?.askId));
        else setError('Add your own Gemini API key in Settings to generate reports.');
        setIsConfigOpen(true);
        return;
      }

      // A spent quota is not overridden here (2026-11-05): `classifyGeminiError`
      // already says when it resets and what works meanwhile, and this said
      // "check your plan and billing" over it, to a user of a free tool.
      let friendlyMessage = err.message || 'An error occurred during analysis.';
      if (friendlyMessage.includes('Failed to fetch')) {
        friendlyMessage = 'Network error. Please check your internet connection.';
      }

      // A quicker version Forma makes stands in for the AI that could not
      // answer (lib/formaTeam.ts), rather than the request ending in an error. Not
      // over an open report (2026-11-07, agent audit item 21): a refinement
      // that failed replaced the report the person had with an OCR draft of
      // the picture they sent to change it.
      if (team.draft && !open) {
        try {
          const made = await team.draft();
          if (made && !signal.aborted) {
            const { fallbackReply } = await import('./lib/formaTeam');
            if (signal.aborted) return;
            const drafted = { ...made.result, repxContent: asConfigured(made.result.repxContent ?? '') };
            setResult(drafted);
            // Named by what it is to the person (2026-11-11, the full audit's CV-07): "Forma's own draft" until then.
            recordRevision('First version', drafted);
            setActiveTab('ui');
            setMessages(prev => [...prev, {
              id: nextMessageId(),
              role: 'assistant',
              // The provider's own words when the error carries them (agent
              // audit item 15), read for one of a few plain reasons.
              text: fallbackReply(aiName, err?.cause?.message || err?.message || friendlyMessage, made.source === 'offline'),
              result: drafted,
            }]);
            return;
          }
        } catch (draftError) {
          console.warn("Forma's own draft could not be made either.", draftError);
        }
      }
      // On the request that failed (agent audit item 5): the log marks it
      // failed and its card offers Try again, where it read as answered. Not
      // over the box as well, where it was said a second time (item 54),
      // unless there is no request of the person's to carry it.
      if (messages.some((m) => m.role === 'user')) setMessages((prev) => markAskError(prev, friendlyMessage, turnOf?.askId));
      else setError(friendlyMessage);
    } finally {
      if (!signal.aborted) {
        // Done, before the half second the bar takes to finish (2026-11-06):
        // Stop in that half second wrote "Stopped." under a finished report.
        if (abortControllerRef.current?.signal === signal) abortControllerRef.current = null;
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

  /**
   * The composer's Stop. A generation is discarded. A chat reply, the
   * questions asked before a design, or a sent page being read (2026-11-05)
   * is abandoned, and a reply keeps what it had written so far, as ChatGPT's
   * does; with nothing written, Forma answers "Stopped." as for a generation.
   */
  const handleStop = (how?: { steering?: boolean } | unknown) => {
    const steering = Boolean((how as { steering?: boolean } | undefined)?.steering);
    // Stop pauses what is queued (agent audit item 27, the owner's choice);
    // a steer is the next message, and goes.
    if (!steering && queue.length) setQueuePaused(true);
    const stopped = steering ? 'Stopped to change course.' : 'Stopped.';
    /*
     * Once per turn (2026-11-11, the full audit's WS-46): a second Stop, or a
     * Steer after a Stop, came while the turn under way still held
     * `turnBusy`, read `isChatting` as it was before the first, and said
     * "Stopped." again. A turn whose controller is already aborted has been
     * stopped and said so.
     */
    const turnCtl = turnAbortRef.current;
    if (isAnalyzing) {
      const running = abortControllerRef.current;
      setIsAnalyzing(false);
      setProgress(IDLE_PROGRESS);
      if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
      // A run that already finished has nothing to stop and nothing to say.
      if (!running) return;
      running.abort();
      // The turn the run belongs to stops with it, so nothing it was to do next starts.
      turnCtl?.abort();
      abortControllerRef.current = null;
      setMessages(prev => [...prev, {
        id: nextMessageId(),
        role: 'assistant',
        text: stopped,
      }]);
      return;
    }
    if (turnCtl?.signal.aborted) return;
    if (!isChatting) {
      // Between a turn's steps (pages read, the chat not yet asked), the turn
      // is still under way and stops the same way.
      if (turnBusyRef.current) {
        turnCtl?.abort();
        setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text: stopped }]);
      }
      return;
    }
    turnCtl?.abort();
    const partial = partialReplyRef.current.trim();
    partialReplyRef.current = '';
    setIsChatting(false);
    setStreamingReply('');
    /*
     * What a stopped reply keeps (2026-11-07, agent audit item 51): a turn on
     * an open report stopped before its edits were made changes nothing, and
     * its half-written reply ("Made `labelTitle") claimed a change, so it says
     * nothing changed instead; a plain answer keeps its words, marked stopped.
     */
    const text = reportTurnRef.current
      ? `${stopped.replace(/\.$/, '')} before anything was changed.`
      : partial ? `${partial}\n\n*${stopped}*` : stopped;
    setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text }]);
  };

  /**
   * Re-send a turn that failed. The failed message and anything after it are
   * dropped first, so the retry does not stack a second copy of the same
   * question in the transcript.
   */
  const handleRetryMessage = (id: string) => {
    // Nor between a turn's steps (2026-11-11, the full audit's WS-19): the thread
    // was cut here and the turn under way then refused what was sent.
    if (isChatting || isAnalyzing || turnBusyRef.current) return;
    const failed = messages.find((m) => m.id === id);
    if (!failed) return;
    // Questions asked after it go with it, as for an edit (agent audit item 25):
    // the retry is not the answer to a question it came before.
    const pending = pendingClarifyRef.current;
    if (pending && messages.findIndex((m) => m.id === pending.messageId) >= messages.indexOf(failed)) pendingClarifyRef.current = null;

    const transcript = truncateFrom(messages, id);
    setMessages(transcript);
    setError(null);
    void handleGenerate(failed.text, { images: failed.images, imageMeta: failed.imageMeta, transcript, base: baseFor(failed) });
  };

  /**
   * The report a message of the person's found when it was sent (2026-11-07,
   * agent audit item 3), for sending it again: as recorded this session; none
   * when it was sent with none open (`fresh`, which a reload keeps); else the
   * report a reply to it changed, from the change kept for its Undo. Undefined
   * when nothing says, and the report as it is now is used, as before.
   */
  const baseFor = (ask: ChatMessage): DesignResult | null | undefined => turnBase(ask, messages, turnBases.current, chatChanges);

  /**
   * One of Forma's replies, written again (2026-11-05), as ChatGPT's
   * regenerate: the message it answered is sent again, pictures and all, and
   * it and everything after it leave the transcript first. A report the turn
   * built stays in Revisions.
   */
  const handleRegenerate = (id: string) => {
    if (isChatting || isAnalyzing || turnBusyRef.current) return;
    // A reply Forma wrote of its own accord answers no message (agent audit item 75).
    if (messages.find((m) => m.id === id)?.standalone) return;
    const asked = answeredBy(messages, id);
    if (!asked) return;
    const pending = pendingClarifyRef.current;
    if (pending && messages.findIndex((m) => m.id === pending.messageId) >= messages.indexOf(asked)) pendingClarifyRef.current = null;
    // The reply it replaces is kept as a version of the message (2026-11-05).
    const versions = branchesForResend(messages, messages.indexOf(asked), asked.text);
    // The transcript the model is sent is the one without the turns dropped
    // (agent audit item 4); `messages` here still holds them.
    const transcript = truncateFrom(messages, asked.id);
    setMessages(transcript);
    setError(null);
    void handleGenerate(asked.text, { images: asked.images, imageMeta: asked.imageMeta, ...versions, transcript, base: baseFor(asked) });
  };

  /** A change the chat made, kept for its reply's Undo. */
  const rememberChange = (id: string, before: DesignResult, after: DesignResult) =>
    setChatChanges((prev) => ({ ...prev, [id]: { before, after } }));

  /**
   * A reply's change taken back (2026-11-05): the report as it was before it.
   * Offered only while the report is still the one that change left, so an
   * Undo never throws away a later change along with its own; earlier ones
   * are in Revisions.
   */
  const undoableIds = useMemo(
    () => new Set(Object.entries(chatChanges).filter(([, c]) => c.after.repxContent === result?.repxContent).map(([id]) => id)),
    [chatChanges, result?.repxContent],
  );
  /** The replies whose change was taken back with their Undo, while the report is still as that left it. */
  const redoableIds = useMemo(
    () => new Set(
      messages
        .filter((m) => m.undone && chatChanges[m.id] && chatChanges[m.id].before.repxContent === result?.repxContent)
        .map((m) => m.id),
    ),
    [messages, chatChanges, result?.repxContent],
  );
  /*
   * One history (2026-11-07, agent audit item 52). The reply's Undo kept a
   * record of its own and set the report back as a new change, so the
   * corner's Undo then put the change back again and its Redo had nothing.
   * Now, when the change is the corner's last step, the reply's Undo is that
   * step undone, and the corner's Redo, or the reply's own, makes it again;
   * when other steps came between, it is a step of its own, as before.
   */
  const handleUndo = (id: string) => {
    const change = chatChanges[id];
    if (!change || !undoableIds.has(id) || isChatting || isAnalyzing) return;
    if (reportPast.current[reportPast.current.length - 1]?.repxContent === change.before.repxContent) undoReport();
    else setResult(change.before);
    recordRevision('Undone in the chat', change.before);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, undone: true } : m)));
  };
  const handleRedo = (id: string) => {
    const change = chatChanges[id];
    if (!change || !redoableIds.has(id) || isChatting || isAnalyzing) return;
    if (reportFuture.current[reportFuture.current.length - 1]?.repxContent === change.after.repxContent) redoReport();
    else setResult(change.after);
    recordRevision('Redone in the chat', change.after);
  };
  /* A change made again, by either Redo, is no longer undone. */
  useEffect(() => {
    const xml = result?.repxContent;
    if (!xml) return;
    const back = new Set(Object.entries(chatChanges).filter(([, c]) => c.after.repxContent === xml).map(([id]) => id));
    if (!back.size) return;
    setMessages((prev) => (prev.some((m) => m.undone && back.has(m.id))
      ? prev.map((m) => {
          if (!m.undone || !back.has(m.id)) return m;
          const { undone: _undone, ...rest } = m;
          return rest;
        })
      : prev));
  }, [result?.repxContent, chatChanges]);

  /*
   * The Redesign / Not now buttons of a redesign asked about (2026-11-05) and
   * a plan's Start / Not now (2026-11-10) went on 2026-11-11 (the full audit's
   * WS-38): nothing waits on a press. `handleConfirm` and `handlePlan`, which
   * answered them, went with them; a typed yes still answers one an older
   * thread holds (`runTurn`).
   */

  /**
   * A plan settled (2026-11-10, the AI accuracy programme, batch AG item 22,
   * lib/jobPlan.ts). Started, one report goes on as the message would have,
   * with the files kept; a report for each goes to Batch with the original
   * files, one at a time. Left, nothing was read or sent.
   */
  const settlePlan = (id: string, started: boolean, plan?: JobPlan) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.plan ? { ...m, plan: { ...m.plan, ...(plan ?? {}), answered: started ? 'yes' : 'no' } } : m)));
    if (!started) plannedJobs.current.delete(id);
  };
  /*
   * Run inside the turn that said the plan (2026-11-11, the full audit's
   * PL-19), from `handleGenerate`'s continuation or a typed yes: it went
   * through `handleGenerate` after a zero timer, which the turn still under
   * way refused, so the plan said Started for a run that never began. It
   * is marked started only once the run is under way.
   */
  const startPlan = async (id: string, plan: JobPlan & { prompt: string; askId: string }) => {
    const job = plannedJobs.current.get(id);
    plannedJobs.current.delete(id);
    if (!job) {
      settlePlan(id, false, plan);
      return;
    }
    const jobs = await import('./lib/jobPlan');
    settlePlan(id, true, plan);
    if (plan.mode === 'each' && jobs.keptFiles(plan).length > 1) {
      setBatchIncoming({ files: await jobs.filesForBatch(plan, job), id: Date.now() });
      showRailPanel('batch');
      return;
    }
    const next = await runTurn(plan.prompt, { ...jobs.keptAttachments(plan, job), base: job.base, planned: plan.askId });
    if (next) await next();
  };

  /**
   * The rows the Preview prints, for a question about the data (2026-11-10,
   * lib/previewRows.ts): the test rows the AI made up, else a shared
   * database's sample rows for the query chosen, with the fields the report
   * prints; null with none. The companion's live rows are not here: they are
   * the database's own values and are never sent.
   */
  const previewRowsFor = async (open: DesignResult | null): Promise<{ rows: Record<string, unknown>[]; fields: string[]; source: string } | null> => {
    if (!open?.repxContent) return null;
    const fields = boundFields.length ? boundFields : [];
    if (testRows?.length) return { rows: testRows, fields: fields.length ? fields : Object.keys(testRows[0]), source: MADE_UP_ROWS };
    if (previewDatabase?.query) {
      const { sqlPreview } = await import('./lib/sqlPreview');
      const sql = sqlPreview(open.repxContent, previewDatabase.schema, previewDatabase.query);
      if (sql?.rows?.length) return { rows: sql.rows as Record<string, unknown>[], fields: fields.length ? fields : Object.keys(sql.rows[0]), source: 'database sample rows' };
    }
    return null;
  };

  /**
   * The answer to Forma's question whether the Preview's rows may go
   * (2026-11-10): the question is sent again, with them on a yes and without
   * them on a no, and the answer stands for the project (2026-11-11, the full
   * audit's WS-01: a no was sent again as a question and asked at once).
   */
  const handleConsent = async (id: string, yes: boolean) => {
    if (isChatting || isAnalyzing || turnBusyRef.current) return;
    const asked = messages.find((m) => m.id === id)?.consent;
    if (!asked || asked.answered) return;
    setMessages((prev) => prev.map((m) => (m.id === id && m.consent ? { ...m, consent: { ...m.consent, answered: yes ? 'yes' : 'no' } } : m)));
    setRowsDecision(yes ? 'yes' : 'no');
    await handleGenerate(asked.prompt, { planned: asked.askId, base: turnBases.current.get(asked.askId), consented: yes, declined: !yes, transcript: messages.filter((m) => m.id !== id) });
  };

  /** A redesign under way, so a second one waits for it (2026-11-11, the full audit's PL-19). */
  const redesigningRef = useRef(false);
  /** A redesign of the open report from words, as a refinement has always run. */
  const startRedesign = async (words: string) => {
    if (redesigningRef.current) return;
    redesigningRef.current = true;
    try {
      setIsAnalyzing(true);
      setProgress(startProgress());
      setError(null);
      activeDescribeRef.current = undefined;
      await runGeneration(words, [], [], INITIAL_RUN);
    } finally {
      redesigningRef.current = false;
    }
  };

  /** The conversation downloaded as Markdown (2026-11-05, `conversationMarkdown`), named after the report. */
  const exportConversation = () => {
    const title = result?.title || savedReports.find((r) => r.id === openProjectId)?.name || 'Forma conversation';
    const blob = new Blob([conversationMarkdown(messages, title, (ms) => formatSessionStamp(ms))], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'conversation'} - chat.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * What Forma may learn from a turn (2026-11-10, the full audit, the
   * owner's ask that Forma learn from every use; lib/learning.ts): the
   * report's skeleton read off the REPX, never its text, with the request's
   * kind, the AI's kind, the edits' names and the checks' counts; the whole
   * report and the words only on the opt-in tier. Kept on the device, and in
   * the account when signed in and the switch is on. Never in the way: it
   * runs after the reply is posted, and a failure is a console line.
   */
  const recordLearning = (input: {
    kind: 'generation' | 'edit' | 'translate' | 'rating';
    source?: 'image' | 'pdf' | 'repx' | 'words' | 'database' | 'mixed' | 'none';
    request?: 'new' | 'redesign' | 'edit' | 'batch' | 'none';
    ai?: 'gemini' | 'local' | 'openrouter' | 'forma' | 'mock' | 'none';
    repx?: string | null;
    ops?: readonly string[];
    rating?: 'good' | 'bad';
    prompt?: string | null;
  }) => {
    const owner = user;
    void (async () => {
      try {
        const learning = await import('./lib/learning');
        const settings = learning.readLearningSettings();
        let skeleton = null;
        let findings: { severity: string }[] = [];
        if (input.repx) {
          const [{ parseReportStructure }, { skeletonOf }, { auditRepx }] = await Promise.all([import('./lib/reportPreview'), import('./lib/reportSkeleton'), import('./lib/repxAudit')]);
          try {
            skeleton = skeletonOf(parseReportStructure(input.repx));
            findings = auditRepx(input.repx, null).findings;
          } catch {
            skeleton = null;
          }
        }
        const event = learning.learningEvent({ ...input, skeleton, findings }, settings);
        await learning.keepLearningEvent(event);
        if (owner && learning.sendable(event, settings)) {
          const { paths, db } = await loadFirebase();
          await paths.writeLearning(db, owner.uid, event);
        }
      } catch (err) {
        console.warn('A learning event could not be kept.', err);
      }
    })();
  };
  /** The AI's kind for a learning event, from who answered. */
  const aiKindOf = (by: 'gemini' | 'local' | 'openrouter'): 'gemini' | 'local' | 'openrouter' | 'mock' => (MOCK_MODE ? 'mock' : by);

  /** A reply rated, or its rating taken back (2026-11-05). It stays with the message, and with the learning events when it is given. */
  const handleRate = (id: string, rating: 'good' | 'bad' | undefined) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.role === 'assistant' ? { ...m, rating } : m)));
    if (!rating) return;
    const rated = messages.find((m) => m.id === id);
    recordLearning({ kind: 'rating', rating, request: rated?.result ? 'new' : 'edit', repx: (rated?.result as DesignResult | undefined)?.repxContent ?? result?.repxContent ?? null });
  };

  /**
   * A sent message, edited (2026-11-04): as Try again, the message and
   * everything after it leave the transcript and the new text is sent in its
   * place. Questions Forma asked after it go with it, so an open clarification
   * that belonged to them is closed rather than answered by the next message.
   */
  const handleEditMessage = (id: string, text: string) => {
    if (isChatting || isAnalyzing || turnBusyRef.current) return;
    const at = messages.findIndex((m) => m.id === id);
    if (at === -1 || messages[at].role !== 'user' || !text.trim()) return;
    const pending = pendingClarifyRef.current;
    if (pending && messages.findIndex((m) => m.id === pending.messageId) >= at) pendingClarifyRef.current = null;
    // Its pictures go again, and the version it replaces is kept (2026-11-05).
    const old = messages[at];
    const versions = branchesForResend(messages, at, text.trim());
    const transcript = truncateFrom(messages, id);
    setMessages(transcript);
    setError(null);
    void handleGenerate(text.trim(), { images: old.images, imageMeta: old.imageMeta, ...versions, transcript, base: baseFor(old) });
  };

  /** Another version of one of the person's messages, with the conversation that followed it (2026-11-05). */
  const handleShowVersion = (id: string, to: number) => {
    if (isChatting || isAnalyzing) return;
    const next = showBranch(messages, messages.findIndex((m) => m.id === id), to);
    // The version shown decides which questions wait, if any (item 24).
    pendingClarifyRef.current = pendingClarifyOf(next);
    setMessages(next);
    // The card stays on the request flipped (agent audit item 31): a version
    // with a different number of turns after it moved the card to the newest.
    const after = requestsOf(next);
    const shown = after.at(-1)?.id === id ? null : id;
    // Held for the count's effect only when the count changes, or it would outlive this flip.
    keepShownRef.current = after.length !== requestCount ? shown : null;
    setShownRequestId(shown);
  };

  /** One of the person's messages and Forma's answers to it, withdrawn (2026-11-04). See `withdrawTurn`. */
  const handleWithdrawMessage = (id: string) => {
    if (isChatting || isAnalyzing || turnBusyRef.current) return;
    const pending = pendingClarifyRef.current;
    if (pending) {
      const kept = withdrawTurn(messages, id);
      if (!kept.some((m) => m.id === pending.messageId)) pendingClarifyRef.current = null;
    }
    setMessages((prev) => withdrawTurn(prev, id));
  };

  /* `designOffline`, the chat box with no key, went on 2026-11-05: the owner
     made the key the entry point to any work again, and the composer locks
     without one. It answered words with Forma's own model and images with
     OCR from 2026-11-02 (adccf55); `git log -S"const designOffline"` finds
     it. Forma's own model and OCR's build still stand in when the AI set up
     fails to answer (`offlineDesign`, `prepareTeam`'s draft). */

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
  const designFromVision = async (message: string, resend?: { images: string[]; imageMeta: PreviewMeta[] }) => {
    // A message sent again brings its own pictures and leaves the composer alone (see handleGenerate).
    const staged = resend ? [...resend.images] : [...previews];
    const stagedMeta = resend ? [...resend.imageMeta] : [...previewMeta];
    const stagedForOcr = resend ? staged.map((src, i) => ({ src, meta: stagedMeta[i] })) : ocrPages;
    setMessages(prev => [...prev, { id: nextMessageId(), role: 'user', text: message, images: staged, imageMeta: stagedMeta }]);
    if (!resend) {
      setPrompt('');
      setPreviews([]);
      setPreviewMeta([]);
      setAttachmentTexts([]);
      setUploadNotices([]);
    }
    setError(null);
    const say = (text: string, attached?: DesignResult) =>
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text, ...(attached ? { result: attached } : {}) }]);
    // Stop abandons the reading (2026-11-05): see turnAbortRef.
    const turn = new AbortController();
    turnAbortRef.current = turn;
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
      read = await readSentPages(stagedForOcr, turn.signal);
      if (turn.signal.aborted) return;
      const fromPages = readSources(read);
      detectFor({ metas: stagedMeta, pages: fromPages.pages, words: [message, fromPages.words].join('\n') });
      setIsChatting(true);
      const looked = await looking;
      if (turn.signal.aborted) return;
      if ('failed' in looked) throw looked.failed;
      const [firstReading, ...laterReadings] = looked.readings;
      if (!firstReading?.skeleton) throw new Error('its answer had no page line');
      const { mergePageSkeletons } = await import('./lib/skeletonRepx');
      if (turn.signal.aborted) return;
      const reading = {
        skeleton: mergePageSkeletons(firstReading.skeleton, ...laterReadings.flatMap((r) => (r.skeleton ? [r.skeleton] : []))),
        problems: looked.readings.flatMap((r) => r.problems),
      };
      // The words OCR read on the same page, in the skeleton's unit and on its paper.
      const first = stagedMeta[0];
      const page = read.find(({ meta }) => meta.uploadId === first?.uploadId && (meta.page ?? 0) === (first?.page ?? 0));
      const paper = reading.skeleton.paper === 'Custom' ? effectiveConfig().pageSize : reading.skeleton.paper;
      const texts = page
        ? pageTextsOf(detectLayout([{ ocr: page.read.ocr, page: pageForImage(page.read.ocr, 'HundredthsOfAnInch', paper) }], { unit: 'HundredthsOfAnInch' }))
        : [];
      const design = skeletonToDesign(reading.skeleton, { texts, title: first?.file.replace(/\.[^.]+$/, '') });
      const newResult: DesignResult = {
        content: design.markdown,
        timestamp: new Date(),
        title: design.title,
        layout: design.layout,
        repxContent: asConfigured(design.repx),
        usage: null,
      };
      setResult(newResult);
      // Labelled and said by result (2026-11-11, the full audit's WS-05 and
      // WS-08): the label and the reply named the vision model, and the reply
      // counted the captions it read, the lines of its answer it could not
      // read and the pages it looked at, until then.
      recordRevision('From your page', newResult);
      setActiveTab('ui');
      if (reading.problems.length) console.debug(`${reading.problems.length} line(s) of the page's reading were not understood and were left out.`, reading.problems);
      // With no text read at all every caption is a placeholder, and "a few"
      // would understate it, so that case says what handleReaderBuild says.
      say(
        !design.placeholders
          ? `Here is "${design.title}", built from your page.`
          : design.read
            ? `Here is "${design.title}". A few words were hard to make out; they are marked in the report, so check them against your page.`
            : `Here is "${design.title}", built from your page. Its captions still need their words; they are marked in the report.`,
        newResult,
      );
    } catch (err: any) {
      if (turn.signal.aborted) return;
      console.warn('The page could not be read for its layout.', err);
      if (read.length) {
        const { buildFromRead } = await import('./lib/ocrAttach');
        const { unit, pageSize } = effectiveConfig();
        const built = buildFromRead(read, unit, pageSize);
        const banded = await readerBuild(read);
        if (turn.signal.aborted) return;
        // Built from the page's text: the build says "Here is ..." itself, so
        // nothing more is said here (it said the page "could not be read the
        // usual way" and why until 2026-11-11).
        if (banded) return handleReaderBuild(banded, built);
        if (built) return handleOcrBuild(built);
      }
      say("I couldn't read that page. Try a sharper picture or a PDF.");
    } finally {
      if (!turn.signal.aborted) {
        setIsChatting(false);
        setStreamingReply('');
      }
    }
  };

  /**
   * `overridePrompt` exists for sending a message again — Try again on a
   * failed message or on a reply, and an edit — which re-sends that message's
   * own text rather than whatever is in the composer. Every call site passes
   * it explicitly — never wire this straight to onClick, or the click event
   * arrives as the prompt.
   *
   * A message sent again carries its own pictures, `resend` (2026-11-05), and
   * nothing staged in the composer, which it leaves as it is. Until then a
   * retry sent the words alone, so a failed picture turn came back as a chat
   * reply about nothing, while whatever was staged in the composer went with
   * the old words and the box was cleared. Text read from a PDF or a `.repx`
   * is not kept on a message, so a PDF's pages are read again by OCR and a
   * `.repx` cannot be sent again.
   */
  /*
   * One turn at a time, from its first step to its last (2026-11-07, found
   * checking agent audit item 27). A turn reads its pages, then chats, then
   * may generate, and between those steps neither `isChatting` nor
   * `isAnalyzing` was set, so the queue sent its next message into the middle
   * of the turn: a message queued during the reading of a picture arrived
   * before the picture's reply. `turnBusy`, declared beside the queue, covers
   * the whole turn.
   */
  /*
   * What a turn hands on to run once its own chat step has let go
   * (2026-11-11, the full audit's PL-19): a redesign it said it was starting,
   * or a plan's job. Both ran after a zero timer, outside the turn, so the
   * queue could send its next message between them, and a plan's job went
   * through `handleGenerate`, which the turn under way refused. They run
   * here, awaited, with `turnBusy` held until they end.
   */
  const handleGenerate = async (...args: Parameters<typeof runTurn>) => {
    if (isChatting || isAnalyzing || turnBusyRef.current) return;
    turnBusyRef.current = true;
    setTurnBusy(true);
    try {
      const next = await runTurn(...args);
      if (next) await next();
    } finally {
      turnBusyRef.current = false;
      setTurnBusy(false);
    }
  };
  const runTurn = async (
    overridePrompt?: string,
    resend?: {
      images?: string[];
      imageMeta?: PreviewMeta[];
      /** The text of files queued with the words: a PDF's text layer, a `.repx` (agent audit item 71). */
      texts?: TextAttachment[];
      branches?: ChatBranch<DesignResult, PreviewMeta>[];
      branch?: number;
      /**
       * The conversation to send from (2026-11-07, agent audit item 4): the
       * resend has just cut the turns after the message out of `messages`,
       * which this closure still holds, and the model was sent them.
       */
      transcript?: ChatMessage[];
      /**
       * The report as the message first found it, null for none (agent audit
       * item 3, `baseFor`); undefined for the report as it is now.
       */
      base?: DesignResult | null;
      /** Sent from the queue (agent audit item 28): a new message, which answers a waiting question as any is. */
      queued?: boolean;
      /** The words of the request this one steers (agent audit item 86), carried into what the model is told. */
      steerFrom?: string;
      /** The message a started plan carried (batch AG item 22): it is in the thread already, and is not planned again. */
      planned?: string;
      /** Sent again after the person let the Preview's rows go with it (2026-11-10). */
      consented?: boolean;
      /** Sent again after the person kept them back (2026-11-11): answered without them, not asked again. */
      declined?: boolean;
    },
  ): Promise<(() => Promise<void>) | void> => {
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
    // What goes with the words: the composer's staging, or a message's own
    // pictures when it is sent again (see `resend` above).
    const again = overridePrompt !== undefined;
    const transcript = resend?.transcript ?? messages;
    /*
     * The report this turn works on (agent audit item 3). Sent again, it is the
     * one the message first found, put back on the bench, so an edit is not
     * made twice over its own result, a first report is designed again rather
     * than refined, and a report described in words is described again rather
     * than sent to the chat. None is still none: the report on the bench stays
     * until the new one replaces it, and stays if the turn fails.
     */
    const base = resend?.base !== undefined ? resend.base : result;
    if (resend?.base && resend.base.repxContent !== result?.repxContent) setResult(resend.base);
    const stagedImages = again ? resend?.images ?? [] : previews;
    const stagedImageMeta: PreviewMeta[] = again
      ? stagedImages.map((_, i) => resend?.imageMeta?.[i] ?? { uploadId: `again-${i}`, file: 'image' })
      : previewMeta;
    const stagedTexts = again ? resend?.texts ?? [] : attachmentTexts;
    // Sent again, a page whose text came with it (a queued PDF's text layer) is not read twice.
    const againText = new Set(stagedTexts.map((t) => `${t.uploadId}#${t.page ?? 0}`));
    const stagedOcr = again
      ? stagedImages.flatMap((src, i) => (againText.has(`${stagedImageMeta[i].uploadId}#${stagedImageMeta[i].page ?? 0}`) ? [] : [{ src, meta: stagedImageMeta[i] }]))
      : ocrPages;
    /** Clears the composer, unless this is a message sent again, which leaves it as it is. */
    const clearComposer = () => {
      if (again) return;
      stagedFiles.current.clear();
      setPrompt('');
      setPreviews([]);
      setPreviewMeta([]);
      setAttachmentTexts([]);
      setUploadNotices([]);
    };

    if (stagedImages.length === 0 && stagedTexts.length === 0 && !promptText) {
      setError('Please provide at least an image, PDF, or a text description.');
      return;
    }
    // A new request clears the last one's error line (agent audit item 53):
    // it stayed over the box after later turns had succeeded.
    setError(null);

    /*
     * A redesign Forma asked about is answered by the next message, yes or no
     * (2026-11-07, agent audit item 58): one left open behind a "remember"
     * message kept its buttons, and the log said Waiting, for good. Closed as
     * "no" here; the typed yes below marks its own "yes" after this.
     */
    if (promptText.trim() || stagedImages.length || stagedTexts.length) {
      setMessages((prev) => (prev.some((m) => m.confirm && !m.confirm.answered)
        ? prev.map((m) => (m.confirm && !m.confirm.answered ? { ...m, confirm: { ...m.confirm, answered: 'no' as const } } : m))
        : prev));
    }

    // "Remember: always use A4" is kept, not designed or sent (2026-11-02,
    // lib/memory.ts), whichever AI answers and with none.
    if (stagedImages.length === 0 && stagedTexts.length === 0 && isRememberMessage(promptText)) {
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'user', text: promptText }]);
      clearComposer();
      const memory = await import('./lib/memory');
      const kept = memory.memoryFrom(promptText);
      const state = memory.readMemory();
      // Once (2026-11-05): Try again or an edit sends the same words again,
      // and a memory kept twice would be told to the AI twice.
      const known = state.memories.find((m) => m.text.toLowerCase() === kept.text.toLowerCase());
      if (!known) memory.writeMemory({ ...state, memories: [...state.memories, kept] });
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text: memory.rememberedReply(known ?? kept) }]);
      return;
    }

    // The version, unit, paper, direction and data source, worked out from what
    // this request brings (lib/autoConfig.ts); again once its pages are read.
    detectFor({ texts: stagedTexts, metas: stagedImageMeta, words: promptText });

    // No AI set up, no work (2026-11-05): the key is the entry point, as it
    // was until 2026-11-02. The composer is locked without one; this is the
    // guard that makes it true whoever calls.
    if (!hasApiKey) {
      setIsConfigOpen(true);
      return;
    }

    /*
     * The answer to a redesign Forma just asked about (2026-11-05). A typed
     * yes starts it with no request spent on what "yes" means; anything
     * else typed instead is a no, and is answered as the message it is.
     */
    const lastMessage = transcript[transcript.length - 1];
    // A queued message is new words, and answers the question as typed ones do (item 28).
    if ((!again || resend?.queued) && lastMessage?.role === 'assistant' && lastMessage.confirm && !lastMessage.confirm.answered) {
      const yes = AFFIRMATIVE.test(promptText) && stagedImages.length === 0 && stagedTexts.length === 0;
      const asked = lastMessage.confirm;
      setMessages(prev => prev.map(m => (m.id === lastMessage.id ? { ...m, confirm: { ...asked, answered: yes ? 'yes' : 'no' } } : m)));
      if (yes) {
        setMessages(prev => [...prev, { id: nextMessageId(), role: 'user', text: promptText }]);
        clearComposer();
        await startRedesign(asked.prompt);
        return;
      }
    }

    /*
     * A started plan answered by a typed yes, or left by anything else
     * (2026-11-10, batch AG item 22), as a redesign Forma asked about is.
     */
    if ((!again || resend?.queued) && lastMessage?.role === 'assistant' && lastMessage.plan && !lastMessage.plan.answered) {
      const yes = AFFIRMATIVE.test(promptText) && stagedImages.length === 0 && stagedTexts.length === 0;
      if (yes) {
        setMessages(prev => [...prev, { id: nextMessageId(), role: 'user', text: promptText }]);
        clearComposer();
        const asked = lastMessage.plan;
        // After this turn has let go (PL-19), as the plan's own start runs.
        return () => startPlan(lastMessage.id, asked);
      }
      settlePlan(lastMessage.id, false);
    }

    /*
     * A heavy job says its plan and starts (2026-11-10, the AI accuracy
     * programme, batch AG item 22, lib/jobPlan.ts; started at once since the
     * full audit the same day, the owner's rule that a request is carried
     * out, not answered with a Start button): many files or many pages are
     * answered with what is being made, one report from all of them or, when
     * the words say "one report each", a report for each in Batch. The
     * plan's message goes in the thread as the account of it; Stop stops it.
     */
    if (!resend?.planned && (!again || resend?.queued)) {
      const jobs = await import('./lib/jobPlan');
      const plan = jobs.planFor(jobs.planFiles(stagedImageMeta, stagedTexts), promptText);
      if (plan) {
        const askId = nextMessageId();
        const planId = nextMessageId();
        plannedJobs.current.set(planId, {
          images: [...stagedImages],
          imageMeta: [...stagedImageMeta],
          texts: [...stagedTexts],
          base,
          files: new Map(stagedFiles.current),
        });
        setMessages(prev => [
          ...prev,
          { id: askId, role: 'user', text: promptText, images: stagedImages.length ? [...stagedImages] : undefined, imageMeta: stagedImages.length ? [...stagedImageMeta] : undefined, ...(base ? {} : { fresh: true as const }) },
          /*
           * Never a card waiting for Start (2026-11-11, the full audit's
           * WS-38): it draws as words, and `startPlan` marks it started as the
           * run begins, a moment later in this same turn (PL-19). Posted
           * already answered, it said Started before anything had; a turn
           * stopped first leaves it unstarted, and the next message settles it.
           */
          { id: planId, role: 'assistant', text: jobs.planReply(plan), plan: { ...plan, prompt: promptText, askId } },
        ]);
        clearComposer();
        // Once this step has let go, inside the turn (PL-19), so the job's own step starts clean.
        return () => startPlan(planId, { ...plan, prompt: promptText, askId });
      }
    }

    // A picture for Forma's own vision model alone (2026-11-03): the Local AI
    // model is itself "forma-vision", which is asked the one question it was
    // trained on and not the mega-prompt. As a helper beside another AI it
    // helps that AI instead (prepareTeam).
    if (stagedImages.length > 0 && isVisionOnly(config)) {
      await designFromVision(promptText, again ? { images: stagedImages, imageMeta: stagedImageMeta } : undefined);
      return;
    }

    const currentPrompt = promptText;
    const currentPreviews = [...stagedImages];
    // The staged pages whose text is read in the browser, captured before the
    // composer is cleared below; their text joins the attachments after.
    const stagedForOcr = stagedOcr;
    // What Forma's own parts need for a picture (lib/formaTeam.ts), captured
    // before the composer is cleared: the first page for the vision model,
    // when it is an image rather than a PDF. The pages OCR reads join it
    // once they are read, after the message is in the thread.
    const stagedMeta = [...stagedImageMeta];
    const [firstAt, lastAt] = visionPages(currentPreviews, stagedMeta);
    const firstImage = firstAt !== undefined ? { src: currentPreviews[firstAt], meta: stagedMeta[firstAt] } : undefined;
    const lastImage = lastAt !== undefined ? { src: currentPreviews[lastAt], meta: stagedMeta[lastAt] } : undefined;

    // Add user message
    const newUserMsg: ChatMessage = {
      // A planned job's message is in the thread already, above its plan (batch AG item 22).
      id: resend?.planned ?? nextMessageId(),
      role: 'user',
      text: currentPrompt, // Only use the prompt the user actually typed
      images: currentPreviews.length > 0 ? currentPreviews : undefined,
      imageMeta: currentPreviews.length > 0 ? stagedMeta : undefined,
      // The versions it replaces, when it is an edit or Try again (2026-11-05).
      ...(again && resend?.branches ? { branches: resend.branches, branch: resend.branch } : {}),
      // Sent with no report open, which a reload must not forget (agent audit item 3).
      ...(base ? {} : { fresh: true as const }),
    };
    turnBases.current.set(newUserMsg.id, base);

    if (!resend?.planned) setMessages(prev => [...prev, newUserMsg]);
    clearComposer();

    // Stop abandons everything up to a generation (2026-11-05): see turnAbortRef.
    const turn = new AbortController();
    turnAbortRef.current = turn;

    // What OCR reads from the attached images goes with them, as a PDF's text
    // layer does (2026-11-01). It is read now, behind the scenes, with the
    // message already in the thread (2026-11-03).
    // The page reader, when one is set up, reads the same pages on the local
    // server while OCR reads them in the browser (2026-11-10, batch AF).
    const pageReading = pageReaderAttachments(stagedForOcr, turn.signal);
    const read = await readSentPages(stagedForOcr, turn.signal);
    if (turn.signal.aborted) return;
    const fromPages = readSources(read);
    detectFor({ texts: stagedTexts, metas: stagedMeta, pages: fromPages.pages, words: [currentPrompt, fromPages.words].join('\n') });
    const readByOcr = await ocrAttachments(read);
    const readByReader = await pageReading;
    if (turn.signal.aborted) return;
    const currentTexts = [...stagedTexts, ...readByOcr, ...readByReader];
    if (readByOcr.length) console.debug(`Including the text of ${readByOcr.length} page(s) read by OCR.`);
    if (readByReader.length) console.debug(`Including the text of ${readByReader.length} page(s) read by the page reader.`);
    const teamInput: TeamInput | undefined = currentPreviews.length > 0 ? { read, firstImage, lastImage } : undefined;

    /*
     * A reply to the questions a description is waiting on. Typed into the
     * box rather than given in the form, it is taken as the answer, as any
     * chat takes the next message after a question; an attachment instead is a
     * new request, and the questions are dropped.
     */
    /*
     * Not every message typed then is the answer (2026-11-07, agent audit item
     * 87, `pendingReplyKind`): a question of its own is answered by the chat
     * and the questions stay open; a new report asked for in so many words, or
     * anything attached, drops them and is routed as any message is.
     */
    const pending = pendingClarifyRef.current;
    const replyKind = pending && !isGenerationTurn(currentPreviews.length, currentTexts.length) ? pendingReplyKind(currentPrompt) : 'new';
    if (pending && replyKind !== 'question') {
      pendingClarifyRef.current = null;
      setMessages(prev => prev.map(m => (m.id === pending.messageId && m.clarify ? { ...m, clarify: { ...m.clarify, answered: true } } : m)));
      if (replyKind === 'answer') {
        await startDescribedGeneration(withAnswers(pending.request, [{ id: 'reply', question: 'In the reader\'s own words', answer: currentPrompt }]), newUserMsg.id);
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
    // one request of the key's free allowance saying so. Only one that says
    // what the report is (2026-11-07, `isPlainBuild`): "create a report" goes
    // to the chat, which asks what it should show.
    // "Generate the report in German" with nothing open and nothing attached names no
    // report (2026-11-11, the full audit's CV-14): Forma asks which, the one question
    // it asks because nothing can be started. Only a language or a format makes it vague
    // ("create the report as an invoice" is designed): the language table is lazy, so it
    // is loaded only for a message of that shape.
    const nothingGiven = !base && !isGenerationTurn(currentPreviews.length, currentTexts.length);
    const languages = nothingGiven && vagueReportWord(currentPrompt) ? await import('./lib/repxTranslate').catch(() => null) : null;
    if (turn.signal.aborted) return;
    const isLanguage = (word: string) => !!languages && languages.languageAsked(`in ${word}`) !== null;
    if (nothingGiven && isVagueReportAsk(currentPrompt, isLanguage)) {
      const named = languages?.languageAsked(currentPrompt) ?? null;
      setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text: vagueReportReply(named) }]);
      return;
    }
    if (nothingGiven && isPlainBuild(currentPrompt, isLanguage)) {
      await describeFromChat(currentPrompt, turn.signal, newUserMsg.id);
      return;
    }
    /*
     * A steer changes the request it stopped (2026-11-07, agent audit item
     * 86): it was sent alone, so "make it landscape" steering "an invoice
     * from this picture" designed a landscape nothing. The model is told what
     * it changes, and a design is made from both.
     */
    const steered = resend?.steerFrom?.trim();
    const modelWords = steered
      ? `${currentPrompt}\n\n(This changes my request above, which was stopped: "${steered.slice(0, 600)}". Carry over everything from it that still applies.)`
      : currentPrompt;
    /** The words a design is made from: the turn's brief, which carries the whole conversation, or the message. */
    let designWords = steered ? `${steered}\n\n${currentPrompt}` : currentPrompt;
    /*
     * A picture or a file sent with a report open goes to the agent too
     * (2026-11-07, agent audit item 21), which reads it with the report: it
     * may be a question about it, a change to match it, or a design to
     * redesign from. It skipped the agent and redesigned the report every
     * time. With no report open it is a design, and goes straight to one.
     */
    const withPictures = isGenerationTurn(currentPreviews.length, currentTexts.length);
    if (!withPictures || base?.repxContent) {
      setIsChatting(true);
      setStreamingReply('');
      partialReplyRef.current = '';
      try {
        const history: ChatTurn[] = buildChatHistory(transcript, modelWords);
        const { chatReply } = await loadGemini();
        // What the user asked Forma to remember, told to the chat as well (agent audit item 13).
        const memory = await import('./lib/memory').catch(() => null);
        const remembered = memory ? memory.instructionsOf(memory.readMemory()) : '';
        /*
         * With a report open, the turn sees it and may change it in place
         * (2026-11-05, lib/agentEdit.ts): its outline goes with the
         * conversation, and one answer says whether to answer, edit or
         * redesign. Until then the turn saw the conversation alone, and every
         * change went to a second request that wrote the whole REPX again.
         */
        const open = base?.repxContent ? base : null;
        const [agent, factsLib] = open ? await Promise.all([import('./lib/agentEdit'), import('./lib/reportFacts')]) : [null, null];
        /*
         * The report's facts, counted in code (2026-11-10, the AI accuracy
         * programme, batch AG items 21 and 24, lib/reportFacts.ts). A plain
         * question about its fields, totals, groups or bands is answered from
         * them with no AI and no request: the cheapest route, and the exact
         * one. Otherwise they go to the AI beside the outline.
         */
        const facts = open && factsLib ? factsLib.reportFacts(open.repxContent!) : null;
        const known = facts && !withPictures && !steered ? factsLib!.answerFromFacts(currentPrompt, facts) : null;
        if (known) {
          reportTurnRef.current = false;
          setMessages(prev => [...prev, { id: nextMessageId(), role: 'assistant', text: known }]);
          return;
        }
        const outline = open && agent
          ? `${agent.reportOutline(open.repxContent!, { findings: repxAudit?.findings.map((f) => f.message), selected: previewSelection })}${facts ? `\n${factsLib!.factsBlock(facts)}` : ''}`
          : undefined;
        reportTurnRef.current = Boolean(outline);
        // A shared database: its layout and what the report reads, and the `data` edit's writer (batch DE).
        const dbAi = open && databaseShared && activeDatabase ? await import('./lib/databaseAi') : null;
        const database = dbAi ? dbAi.chatSection(activeDatabase!, { query: activeQuery, words: currentPrompt, repx: open!.repxContent }) : undefined;
        // Never a field the report's data lacks, read off the report as each edit leaves it (batch AG item 24).
        const hooks = {
          ...(dbAi ? { data: dbAi.dataEditHook(activeDatabase!, config.version, setActiveQuery) } : {}),
          ...(factsLib ? { fields: (xml: string) => factsLib.dataFieldsOf(xml) } : {}),
        };
        /*
         * A question about the data (2026-11-10, lib/previewRows.ts): the rows
         * the Preview prints go with it once the person has said so, asked in
         * the thread the first time; before that the question waits on the
         * answer, and nothing is sent.
         */
        const previewRows = await previewRowsFor(open);
        const rowsLib = open && previewRows && facts ? await import('./lib/previewRows') : null;
        const aboutData = Boolean(rowsLib && previewRows && facts && rowsLib.asksAboutData(currentPrompt, facts.printed));
        /*
         * Asked once per project, and only of a database's rows (2026-11-11,
         * the full audit's WS-01, CV-03 and CV-19): test rows the AI made up
         * are its own and go without asking, and a yes or a no stands until
         * the project is left (`needsRowsConsent`, `leaveSession`).
         */
        const madeUp = previewRows?.source === MADE_UP_ROWS;
        if (aboutData && rowsLib && previewRows && !madeUp && needsRowsConsent(rowsDecision, resend)) {
          reportTurnRef.current = false;
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: 'assistant',
              // "the AI", not the provider's name (the review, 2026-11-11): the turn goes through the
              // free chain (askWithChain), so on a limit the rows may reach another provider.
              text: rowsLib.consentReply(previewRows.rows.length, previewRows.fields),
              consent: { rows: previewRows.rows.length, fields: previewRows.fields, source: previewRows.source, prompt: currentPrompt, askId: newUserMsg.id },
            },
          ]);
          return;
        }
        const rowsGo = aboutData && (madeUp || rowsDecision === 'yes' || Boolean(resend?.consented)) && !resend?.declined;
        const rowsSent = rowsGo && rowsLib && previewRows ? rowsLib.rowsBlock(previewRows.rows, previewRows.fields) : '';
        // A question about Forma carries the Docs articles it is about (batch AG item 25, lib/docsKnowledge.ts).
        const docs = await import('./lib/docsKnowledge').then(async ({ docsFor }) => {
          const found = await docsFor(currentPrompt, () => import('./components/docsCorpus').then((m) => m.loadDocsSections()));
          if (found.ids.length) console.debug(`Giving the chat ${found.ids.length} Docs article(s): ${found.ids.join(', ')}.`);
          return found.block;
        }).catch((err) => {
          console.warn('The Docs articles could not be read; the chat answers without them.', err);
          return '';
        });
        if (turn.signal.aborted) return;
        // On a limit the next AI set up answers, and the reply says so (2026-11-10, lib/fallbackChain.ts).
        const { askWithChain } = await import('./lib/fallbackChain');
        const chained = await askWithChain(config, (asked) => chatReply(history, asked, turn.signal, (text) => {
          partialReplyRef.current = text;
          setStreamingReply(text);
        }, outline && agent ? { outline, ops: agent.EDIT_OPS, tools: agent.TOOL_LISTS, database } : undefined, remembered, withPictures ? toAttachmentParts(currentPreviews, currentTexts) : undefined, docs, rowsSent), turn.signal);
        if (turn.signal.aborted) return;
        const answered = chained.value;
        /*
         * What the turn cost, kept on the reply it writes (2026-11-07, agent
         * audit item 79; no longer shown since 2026-11-11, WS-38); the
         * second pass below adds its own. The switch to another AI, when there
         * was one, is the reply's first line.
         */
        let turnUsage = answered.usage ?? null;
        const withCost = <T extends ChatMessage>(m: T): T => {
          const costed = turnUsage ? { ...m, usage: turnUsage } : m;
          const notes = [chained.note].filter(Boolean);
          return notes.length ? { ...costed, text: [...notes, costed.text].filter(Boolean).join('\n\n') } : costed;
        };
        // A report turn's answer is checked before anything is acted on.
        // With the message, so an alignment sent with no side takes the one asked for.
        const outcome = agent ? agent.readReportOutcome(answered, currentPrompt) : answered;
        // A reply that names a field the report's data lacks says so (batch AG item 24); a
        // redesign or a new report that hinges on one is declined instead (2026-11-10, the
        // full audit: the chat judge saw "add a column for the customer's email address" go
        // to a whole rebuild around a field the facts said was not there).
        const inventedNames = facts && factsLib ? factsLib.inventedFields(`${outcome.reply ?? ''} ${outcome.brief ?? ''}`, facts) : [];
        if (inventedNames.length && (outcome.action === 'rebuild' || outcome.action === 'new') && !withPictures) {
          outcome.action = 'answer';
          outcome.wantsReport = false;
          outcome.edits = [];
          outcome.reply = factsLib!.declinedForFields(inventedNames, facts!);
        } else if (inventedNames.length) {
          outcome.reply = `${outcome.reply}\n\n${factsLib!.inventedNote(inventedNames)}`;
        }
        // The whole request for a design (agent audit item 19): the brief the
        // turn wrote from the conversation, and on a redesign what is selected.
        designWords = withSelection(outcome.brief || designWords, open ? previewSelection : []);
        /*
         * A different report (2026-11-07, agent audit item 20): "create a new
         * sales report" with an invoice open redesigned the invoice. This
         * project keeps its report and the reply; a new project opens once
         * this turn has ended (`startNewFrom`), with the brief as its message.
         */
        if (open && outcome.action === 'new') {
          setMessages(prev => [...prev, withCost({
            id: nextMessageId(),
            role: 'assistant',
            text: [outcome.reply, 'This report stays in its project; the new one opens in a project of its own.'].filter(Boolean).join(' '),
          })]);
          setStartNewFrom({ text: outcome.brief || currentPrompt, ...(withPictures ? { images: currentPreviews, imageMeta: stagedMeta } : {}) });
          return;
        }
        // Edits that add a label take the remembered font, unless they name one (agent audit item 13).
        const houseFont = memory && outcome.edits?.some((e) => e.op === 'add' && !e.family) ? memory.preferencesOf(memory.readMemory()).fontFamily : undefined;
        if (houseFont && outcome.edits) outcome.edits = outcome.edits.map((e) => (e.op === 'add' && !e.family ? { ...e, family: houseFont } : e));
        /*
         * Forma's own actions the answer asked for (2026-11-05): queued, and
         * run by the effect beside `showPlate` once the edits have rendered,
         * so an export carries the report as edited.
         *
         * An export, the designer or a translation runs only when the
         * person's own words asked for it (2026-11-07, agent audit item 47):
         * a model can be told to bring one by a label in the report or the
         * picture it reads. One the words did not ask for is dropped, with a
         * console line, and never drawn as a button to press (2026-11-11, the
         * full audit's WS-09 and TC-02, the owner's rule that nothing waits
         * on a press; it was offered as one from 2026-11-07).
         */
        /*
         * A translation's language, resolved before anything says it starts
         * (2026-11-11, the review of the full audit's CV-01): the model's, as
         * one English name, else the one the message names (2026-11-10). One
         * with neither is dropped here, so no "Translating it into ..." line
         * is written that no result would ever replace.
         */
        const translateTools = agent && outcome.tools?.some((t) => t.name === 'translate') ? await import('./lib/repxTranslate') : null;
        const asked = translateTools ? translateTools.languageAsked(currentPrompt) : null;
        const fromModel = (outcome.tools ?? []).flatMap((t) => {
          if (t.name !== 'translate' || !translateTools) return [t];
          const language = translateTools.languageName(t.language) || asked;
          return language ? [{ ...t, language }] : [];
        });
        // Said only when the words asked to translate; one the model brought alone is just dropped.
        const noLanguage = !!agent && !!translateTools && (outcome.tools ?? []).some((t) => t.name === 'translate' && !translateTools.languageName(t.language) && !asked && agent.askedFor(t, currentPrompt));
        const split = agent ? agent.splitTools(fromModel, currentPrompt) : { now: [], dropped: [] };
        if (split.dropped.length) console.debug(`Dropped what the person's words did not ask for: ${split.dropped.map((t) => t.name).join(', ')}.`);
        const tools = split.now;
        /*
         * What each tool is doing, one sentence each (2026-11-11, the full
         * audit's UI3), and nothing for one that will not start: sample rows
         * for a report that prints no field, an undo with nothing to undo.
         * Those are said in plain words instead when the reply would
         * otherwise be empty (the review: such a turn posted nothing at all).
         */
        const wontStart = (t: AgentTool) => (t.name === 'testData' && boundFields.length === 0) || (t.name === 'undo' && !undoableIds.size && historyDepth.back === 0);
        const toolsDone = agent
          ? tools
              .filter((t) => !wontStart(t))
              .map((t) => agent.toolSentence(t))
              .filter(Boolean)
              // Once: a reply that already says it is not followed by it again.
              .filter((s) => !(outcome.reply ?? '').includes(s))
          : [];
        const nonStarts = [
          ...(tools.some((t) => t.name === 'testData' && wontStart(t)) ? ["There's nothing to fill yet: the report prints no fields."] : []),
          ...(tools.some((t) => t.name === 'undo' && wontStart(t)) ? ["There's nothing to take back yet."] : []),
          ...(noLanguage ? ["Tell me which language and I'll translate it."] : []),
        ];
        // The reply that says them, which a translation finishes in place (UI3).
        const toolReply = (id: string) => {
          if (tools.length) {
            toolReplyRef.current = id;
            setPendingTools(tools);
          }
        };
        // Tools asked for and refused, said under "Not done" (agent audit item 82).
        const toolsRefused = agent && 'toolsDeclined' in outcome ? outcome.toolsDeclined ?? [] : [];

        if (open && agent && outcome.action === 'edit') {
          /*
           * Onto the report as it is now (agent audit item 8): a drag or a
           * Format made while the turn was working is kept, the edits found by
           * control name as always. A report replaced meanwhile by another
           * project or New report is not this turn's, and the signal says so.
           */
          const now = reportNow.current?.repxContent ? reportNow.current : open;
          let done = agent.applyEdits(now.repxContent!, outcome.edits ?? [], hooks);
          const { auditRepx } = await import('./lib/repxAudit');
          if (turn.signal.aborted) return;
          const errorsOf = (xml: string) => auditRepx(xml, now.layout).findings.filter((f) => f.severity === 'error').map((f) => f.message);
          const errorsBefore = new Set(errorsOf(now.repxContent!));
          const errorsBrought = done.changed ? errorsOf(done.xml).filter((m) => !errorsBefore.has(m)) : [];
          /*
           * One more pass (2026-11-07, agent audit item 23), as an agent checks
           * its own work: when an edit could not be made, or the checks find an
           * error the edits brought, the model is told which, against the
           * report as the edits left it, and its edits are made too. Bounded at
           * one: it costs a request only when something went wrong, and a
           * second answer that changes nothing leaves the first as it was.
           */
          if (done.declined.length || errorsBrought.length) {
            try {
              const again = await chatReply(
                [...history, { role: 'assistant', text: outcome.reply || 'Made the edits.' }, { role: 'user', text: agent.followUpMessage(done.declined, errorsBrought) }],
                chained.config,
                turn.signal,
                undefined,
                { outline: agent.reportOutline(done.xml, { selected: previewSelection }), ops: agent.EDIT_OPS, tools: agent.TOOL_LISTS, database },
                remembered,
              );
              if (turn.signal.aborted) return;
              turnUsage = addUsage(turnUsage, again.usage);
              const second = agent.readReportOutcome(again);
              const more = second.action === 'edit' && second.edits.length ? agent.applyEdits(done.xml, second.edits, hooks) : null;
              if (more?.changed) {
                done = { xml: more.xml, applied: [...done.applied, ...more.applied], declined: more.declined, changed: true };
              }
            } catch (err) {
              if (turn.signal.aborted) return;
              console.warn('The second pass did not answer; the first stands.', err);
            }
          }
          const id = nextMessageId();
          if (done.changed) {
            const next: DesignResult = { ...now, repxContent: done.xml };
            setResult(next);
            recordRevision('Changed in the chat', next);
            rememberChange(id, now, next);
            // What Forma may learn from this edit (2026-11-10, lib/learning.ts): the operations by name.
            recordLearning({ kind: 'edit', request: 'edit', ai: aiKindOf(chained.by), repx: done.xml, ops: (outcome.edits ?? []).map((e) => e.op), prompt: currentPrompt });
            // The tools run once the edits are made (agent audit item 38).
            toolReply(id);
            const changes = agent.describeChanges(now.repxContent!, done.xml);
            // Whatever the edit brought that the checks find, said here (2026-11-05).
            // File against file: the Mockup is read again from the edited file a moment later, so a band
            // the edit added (a group, 2026-11-09) is not a mismatch with the Mockup it had before.
            const brought = agent.checksMarkdown(auditRepx(done.xml, null).findings, auditRepx(now.repxContent!, null).findings);
            setMessages(prev => [...prev, withCost({
              id,
              role: 'assistant',
              text: [
                outcome.reply,
                agent.changesMarkdown(changes, [...done.declined, ...toolsRefused], toolsDone),
                brought,
              ].filter(Boolean).join('\n\n'),
            })]);
            return;
          }
          /*
           * Edits made that change nothing: the report is already that way
           * (2026-11-05, found by the first real-key run, which asked to bold
           * a title that was bold). Said so, with no redesign offered.
           */
          if (done.applied.length) {
            toolReply(id);
            setMessages(prev => [...prev, withCost({
              id,
              role: 'assistant',
              text: ['Nothing needed changing: the report already reads that way.', agent.changesMarkdown([], [...done.declined, ...toolsRefused], toolsDone)].filter(Boolean).join('\n\n'),
            })]);
            return;
          }
          /*
           * Nothing could be made in place: say so, and redesign from the
           * words at once (2026-11-10, the full audit, the owner's rule that a
           * request is carried out and not answered with a question; it asked
           * "Redesign?" with two buttons from 2026-11-05). Stop stops it and
           * Undo takes it back. The tools asked for with the edits do not run
           * on a report the edits never reached (agent audit item 38).
           */
          setMessages(prev => [...prev, withCost({
            id,
            role: 'assistant',
            text: `That cannot be changed in place, so I'm redesigning the report from your words; Undo brings this one back.\n\n${agent.changesMarkdown([], [...done.declined, ...tools.map((t) => `${agent.toolLine(t)}: not started, as the edits were not made`)])}`,
          })]);
          // Inside the turn, once this step has let go (2026-11-11, the full audit's PL-19).
          return () => (turn.signal.aborted ? Promise.resolve() : startRedesign(designWords));
        } else if (open && outcome.wantsReport && !withPictures) {
          /*
           * A change only a redesign can make starts at once (2026-11-10; it
           * was asked first from 2026-11-05, as a costly step). The reply says
           * so; the whole report is rewritten and Undo brings this one back. A
           * question an older thread holds is answered by a typed yes.
           */
          setMessages(prev => [...prev, withCost({
            id: nextMessageId(),
            role: 'assistant',
            text: [outcome.reply, 'Redesigning the whole report now; Undo brings this one back.'].filter(Boolean).join(' '),
          })]);
          // Inside the turn, once this step has let go (PL-19), so the queue waits for it.
          return () => (turn.signal.aborted ? Promise.resolve() : startRedesign(designWords));
        } else if (!outcome.wantsReport) {
          const id = nextMessageId();
          toolReply(id);
          const said = agent && (toolsDone.length || toolsRefused.length) ? [outcome.reply, agent.changesMarkdown([], toolsRefused, toolsDone)].filter(Boolean).join('\n\n') : outcome.reply;
          // A tool turn whose tools will not start, and whose reply was left to Forma, says why in plain words.
          const text = said || nonStarts.join(' ');
          if (text || chained.note) {
            setMessages(prev => [...prev, withCost({ id, role: 'assistant', text: text || '' })]);
          }
          return;
        } else if (outcome.reply || chained.note) {
          // The user does want a report built or redesigned — fall through to
          // generation below, after what the reply says, when it says anything
          // (2026-11-11, the full audit's CV-18: it is left empty, and the
          // report's own first reply says what was made).
          setMessages(prev => [...prev, withCost({
            id: nextMessageId(),
            role: 'assistant',
            text: outcome.reply,
          })]);
        }
        // With no report to refine, a description is designed as the Describe
        // dialog designed one, which the chat box took over on 2026-11-01:
        // a question or two first if it leaves something open, then the brief.
        fromDescription = !base;
      } catch (err: any) {
        if (turn.signal.aborted) return;
        console.error('Chat turn failed:', err);
        const message = isMissingApiKey(err)
          ? 'Add your Gemini API key to use the workspace.'
          : err?.message || 'Could not reach the assistant.';
        // Mark the message that failed, so the transcript shows which turn went
        // wrong instead of leaving it looking merely unanswered. Said there
        // only (agent audit item 54): it was also the line over the box, two
        // alerts for one failure.
        setMessages(prev => markMessageError(prev, newUserMsg.id, message));
        if (isMissingApiKey(err)) setIsConfigOpen(true);
        return;
      } finally {
        partialReplyRef.current = '';
        if (!turn.signal.aborted) {
          setIsChatting(false);
          setStreamingReply('');
        }
      }
    }

    if (fromDescription) {
      // A data source pasted in this message goes with the brief, which may summarise it away.
      const pasted = /```[\s\S]*?```|CREATE\s+TABLE[\s\S]*?\)\s*;?/i.exec(currentPrompt)?.[0];
      await describeFromChat(pasted && !designWords.includes(pasted) ? `${designWords}\n\n${pasted}` : designWords, turn.signal, newUserMsg.id);
      return;
    }
    if (turn.signal.aborted) return;

    setIsAnalyzing(true);
    setProgress(startProgress());
    setError(null);

    activeDescribeRef.current = undefined;
    await runGeneration(designWords, currentPreviews, currentTexts, INITIAL_RUN, undefined, teamInput, { base, askId: newUserMsg.id });
  };

  /*
   * A new project for a different report the chat was asked for (agent audit
   * item 20), once the turn that asked has ended: this project is saved as it
   * stands, and the request is the new one's first message, sent through the
   * queue so it is routed as any message in an empty workspace is.
   */
  useEffect(() => {
    if (!startNewFrom || isChatting || isAnalyzing) return;
    const request = startNewFrom;
    setStartNewFrom(null);
    handleClearChat('save');
    // With its pictures, when it came with any (agent audit item 21).
    setQueue([{ id: nextMessageId(), ...request }]);
    // handleClearChat is read at the moment the turn has ended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNewFrom, isChatting, isAnalyzing]);

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
  const startDescribedGeneration = async (request: ReportDescriptionRequest, askId?: string) => {
    setIsAnalyzing(true);
    activeDescribeRef.current = request;
    // The words are the whole source here, answers included ("on A4", "EXEC dbo.Sales").
    detectFor({ words: [request.description, request.title, request.dataSchema, ...(request.answers ?? []).map((a) => a.answer)].filter(Boolean).join('\n') });
    // The house style is the brief, and Forma's own model the stand-in (lib/formaTeam.ts).
    const teamInput: TeamInput = { read: [], described: request };
    setProgress(startProgress());
    setError(null);
    // A report described is designed from nothing, whatever the bench shows.
    await runGeneration('', [], [], DESCRIBE_RUN, request, teamInput, { base: null, askId });
  };

  /*
   * A report described in the chat (2026-11-01). The Describe dialog's two
   * stages, without the dialog: the typed message is the description, a
   * fenced code block or CREATE TABLE in it the data source; the
   * clarification call may come back with questions, which the thread asks
   * as a form; then the brief. A failure inside the clarification already
   * answers "ready", so the only way out without a generation is a key problem.
   */
  const describeFromChat = async (message: string, signal?: AbortSignal, askId?: string) => {
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
      // Nothing the memory already answers is asked (agent audit item 13).
      const remembered = await import('./lib/memory').then((m) => m.instructionsOf(m.readMemory())).catch(() => '');
      const outcome = await clarifyReportRequest(request, config, signal, remembered);
      if (signal?.aborted) return;
      // Not ready with no question to ask is designed from the words as they stand (the review, 2026-11-11: it said "0 questions first:").
      if (!outcome.ready && outcome.questions.length) {
        const id = nextMessageId();
        setMessages((prev) => [...prev, {
          id,
          role: 'assistant',
          // Said as a person asks (2026-11-11, the full audit's CV-20), the form below holding the suggestions.
          text: `${['One question', 'Two questions', 'Three questions'][outcome.questions.length - 1] ?? `${outcome.questions.length} questions`} first:`,
          // The description goes with the questions, so the form works after a reload (item 24).
          clarify: { questions: outcome.questions, answered: false, request },
        }]);
        pendingClarifyRef.current = { request, messageId: id };
        return;
      }
    } catch (err: any) {
      if (signal?.aborted) return;
      const message = isMissingApiKey(err) ? 'Add your Gemini API key to use the workspace.' : err?.message || 'Could not reach the assistant.';
      // On the request (agent audit item 5), with its Try again, and not over the box too (item 54).
      setMessages((prev) => markAskError(prev, message, askId));
      if (isMissingApiKey(err)) setIsConfigOpen(true);
      return;
    } finally {
      if (!signal?.aborted) setIsChatting(false);
    }
    if (signal?.aborted) return;
    await startDescribedGeneration(request, askId);
  };

  /** The answers given in a message's question form. */
  const handleClarifyAnswers = async (messageId: string, answers: ClarificationAnswer[]) => {
    // The questions in memory, or the description kept with them (item 24).
    const kept = messages.find((m) => m.id === messageId)?.clarify;
    const pending = pendingClarifyRef.current?.messageId === messageId
      ? pendingClarifyRef.current
      : kept && !kept.answered && kept.request ? { request: kept.request as ReportDescriptionRequest, messageId } : null;
    if (!pending || isChatting || isAnalyzing) return;
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
    // Rows that arrive after another session opened are not its rows (2026-11-06).
    const session = sessionId.current;
    try {
      const { generateTestData } = await loadGemini();
      // Each field's SQL type, when a database says it, so the rows come as it holds them (batch DF).
      const types = activeDatabase && activeQuery ? (await import('./lib/sqlPreview')).fieldTypes(activeDatabase, activeQuery) : undefined;
      const rows = await generateTestData(
        boundFields,
        { title: result.title, description: activeDescribeRef.current?.description ?? result.content?.slice(0, 600), types },
        20,
        config,
      );
      if (sessionId.current !== session) return;
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
   * The report's typed texts translated into a language (2026-11-10, the
   * first gap of docs/proposals/ai-designers.md, lib/repxTranslate.ts): one
   * request with every distinct text, the answers put back, the layout
   * untouched, kept as a revision and reported in the thread with its Undo.
   * Run at once when asked for (it was offered as a button first for a few
   * hours on 2026-11-10, until the owner saw it); the next free AI answers
   * on a limit, as any request does.
   */
  /**
   * A report's typed texts in another language (lib/repxTranslate.ts): one
   * request with every distinct text, the answers put back, the layout
   * untouched. Shared by a translation asked for in the chat and a first
   * report whose words name a language (2026-11-11, the full audit's CV-14).
   */
  const translateXml = async (xml: string, language: string, signal: AbortSignal) => {
    const [{ collectTexts, applyTranslations }, { translateTexts }, { askWithChain }] = await Promise.all([import('./lib/repxTranslate'), loadGemini(), import('./lib/fallbackChain')]);
    const texts = collectTexts(xml);
    if (!texts.length) return { xml, changed: 0, any: false, note: '', by: null };
    const answered = await askWithChain(effectiveConfig(), (asked) => translateTexts(texts.map((t) => t.text), language, asked, signal), signal);
    const out = applyTranslations(xml, answered.value);
    return { xml: out.xml, changed: out.changed, any: true, note: answered.note, by: answered.by };
  };

  const translateReport = async (named: string, replyId?: string | null) => {
    const open = result;
    if (!open?.repxContent) return;
    if (!hasApiKey) {
      setIsConfigOpen(true);
      return;
    }
    /*
     * The language as the model named it, else as the person's last message
     * names it (2026-11-11, the full audit's CV-01): with neither, the
     * translation is dropped, quietly. "Which language should the report be
     * translated into?" was asked of "generate the report in German".
     */
    const { languageAsked, languageName } = await import('./lib/repxTranslate');
    const lastAsk = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
    const language = languageName(named) || languageAsked(lastAsk) || '';
    if (!language) {
      console.debug('A translation with no language named anywhere was dropped.');
      return;
    }
    /*
     * One message for the turn (2026-11-11, the full audit's UI3): the reply
     * that said "Translating it into German." becomes the result when it is
     * done, with the Undo on it, where a second message said it again with
     * counts and a pointer at Revisions.
     */
    const doing = `Translating it into ${language}.`;
    const say = (text: string) => setMessages((prev) => (replyId && prev.some((m) => m.id === replyId)
      ? prev.map((m) => (m.id === replyId ? { ...m, text: m.text.includes(doing) ? m.text.replace(doing, () => text) : [m.text, text].filter(Boolean).join('\n\n') } : m))
      : [...prev, { id: nextMessageId(), role: 'assistant', text }]));
    const session = sessionId.current;
    setIsChatting(true);
    setStreamingReply('');
    try {
      // Stop stops it (2026-11-10, the full audit's FE2): the turn's controller, which handleStop aborts.
      const turn = new AbortController();
      turnAbortRef.current = turn;
      const done = await translateXml(open.repxContent, language, turn.signal);
      if (sessionId.current !== session || turn.signal.aborted) return;
      if (!done.any) {
        say('There is nothing to translate: every text in this report prints a field.');
        return;
      }
      if (!done.changed) {
        // Said as it is (2026-11-11, the full audit's WS-29): the texts came
        // back unchanged, which is not proof they were already in the language.
        say('Nothing changed: the texts came back as they were. Try naming the language differently.');
        return;
      }
      const next: DesignResult = { ...open, repxContent: asConfigured(done.xml), timestamp: new Date() };
      setResult(next);
      recordRevision(`Translated into ${language}`, next);
      // The Undo goes on the reply that asked, back to before its edits too when it made some.
      const id = replyId && messages.some((m) => m.id === replyId) ? replyId : null;
      if (id) setChatChanges((prev) => ({ ...prev, [id]: { before: prev[id]?.before ?? open, after: next } }));
      if (done.by) recordLearning({ kind: 'translate', request: 'edit', ai: aiKindOf(done.by), repx: next.repxContent, ops: ['translate'], prompt: language });
      const text = [done.note, `Done, the report is in ${language}. Some labels are longer now; worth a look in the Preview.`].filter(Boolean).join('\n\n');
      if (id) say(text);
      else {
        const fresh = nextMessageId();
        rememberChange(fresh, open, next);
        setMessages((prev) => [...prev, { id: fresh, role: 'assistant', text }]);
      }
    } catch (err: any) {
      if (sessionId.current !== session || turnAbortRef.current?.signal.aborted) return;
      if (isMissingApiKey(err)) setIsConfigOpen(true);
      else say(`The translation could not be made: ${err?.message || 'the AI did not answer'}.`);
    } finally {
      if (sessionId.current === session) {
        setIsChatting(false);
        setStreamingReply('');
      }
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
  useLayer(() => setFullScreenImage(null), !!fullScreenImage, 'image');
  useEffect(() => {
    if (!fullScreenImage) return;
    const onKey = (e: KeyboardEvent) => {
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
    // In plain words (2026-11-11, the full audit's WS-40): it said "This
    // generation produced REPX that no designer will open" and quoted the
    // parser. What failed is in the console for whoever looks.
    console.warn('The report file does not open:', repxCheck.message);
    setError("This report's file is incomplete, so the designer can't open it. Send the request again.");
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
   * The Open in designer dialog (2026-11-09, components/OpenInDesigner.tsx).
   * Until then App kept whether the companion was running, probed when a
   * report arrived and whenever the tab regained focus, and a failed open was
   * one line of error text. The dialog asks the companion when it is clicked
   * and at no other time, from any page, and says what is missing: Forma
   * Designer, DevExpress, the browser's permission, or Windows.
   */
  const [designerOpen, setDesignerOpen] = useState(false);

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
      void import('./components/ChangelogPage').catch(() => {});
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
   * Open in designer, from the Export panel, Ctrl+K and the chat's action:
   * every one opens the same dialog. Only meaningful when the model actually
   * returned XML, and not for a REPX the audit says is cut short.
   */
  const openInDesigner = () => {
    if (!result?.repxContent) return;
    if (blockedByInvalidRepx()) return;
    setError(null);
    setDesignerOpen(true);
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
    // The other public pages, through the switch PublicSite shares (2026-11-08,
    // components/publicPages.tsx); the home, the 404 and a share stay here.
    const publicPage = {
      onEnterWorkspace: () => navigate('/workspace'),
      onSignIn: () => navigate('/login'),
      onSignUp: () => navigate('/signup'),
      user,
      logOut: handleLogOut,
      isDarkMode,
      setIsDarkMode: setTheme,
    };
    const otherPage = publicPageFor(currentRoute, publicPage);

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
          {sharedReportId(currentRoute) ? (
          /* A report shared from the workspace, opened from its link (2026-11-06). */
          <SharedReportPage
            id={sharedReportId(currentRoute)!}
            user={user ? { uid: user.uid, email: user.email } : null}
            onSignIn={() => navigate('/login')}
            onHome={() => navigate('/')}
          />
        ) : isNotFound ? (
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
        ) : otherPage ? (
          otherPage
        ) : (
          <LandingPage {...publicPage} />
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

  /**
   * A request picked in the log (2026-11-05): shown in the card, and the
   * controls its change touched outlined on Preview, as Stitch moves to and
   * outlines the screens a request changed. Only a change made this session
   * is known (`chatChanges`, kept for Undo); one from a reloaded project
   * outlines nothing.
   */
  const showRequest = async (id: string) => {
    setShownRequestId(id === requests[requests.length - 1]?.id ? null : id);
    setIsPanelCollapsed(false);
    const change = requests.find((r) => r.id === id)?.replies.map((m) => chatChanges[m.id]).find(Boolean);
    if (!change?.before.repxContent || !change.after.repxContent) {
      setChangedHighlight([]);
      return;
    }
    const { changedControls } = await import('./lib/agentEdit');
    const names = changedControls(change.before.repxContent, change.after.repxContent);
    setChangedHighlight(names);
    if (names.length && result?.repxContent) showPlate('print');
  };

  /*
   * The selection toolbar (2026-11-05, components/SelectionToolbar.tsx): its
   * edits are the chat's own, by control name, so each is spliced exactly as
   * the chat's are and lands in the one history the corner's Undo walks.
   */
  const editSelection = async (make: (agent: typeof import('./lib/agentEdit'), xml: string) => import('./lib/agentEdit').AgentEdit[]) => {
    if (!result?.repxContent || !previewSelection.length) return null;
    const agent = await import('./lib/agentEdit');
    // The report as it is once the module has loaded, not as it was clicked.
    const now = reportNow.current;
    if (!now?.repxContent) return null;
    const done = agent.applyEdits(now.repxContent, make(agent, now.repxContent));
    if (!done.changed) {
      // Without the edit's name (2026-11-11, the full audit's CV-15).
      setSaveNotice(done.declined[0] ? agent.plainDeclined(done.declined[0]) : 'Nothing needed changing');
      return null;
    }
    setResult({ ...now, repxContent: done.xml });
    setSaveNotice(done.applied.length === 1 ? done.applied[0] : `${done.applied.length} changes`);
    return done;
  };
  const formatSelection = (action: FormatAction) => editSelection((agent, xml) => agent.formatEdits(xml, previewSelection, action));
  /** New words for one control are Forma's to write: the box, started for it. */
  const askForText = (name: string) => {
    addToBox(`Change the text of ${name} to `);
    focusBox();
  };
  /** A sentence about what a control is for (2026-11-10): the chat's `describe` edit writes it to AccessibleDescription. */
  const askToDescribe = (name: string) => {
    addToBox(`Describe ${name} for the AI as `);
    focusBox();
  };

  /*
   * The chat's tools, run (2026-11-05), by the effect beside `pendingTools`.
   * Assigned here, after the early returns above, because `showPlate` and the
   * handlers it calls are; a hook here would not run on every render, which
   * React refuses ("Rendered more hooks than during the previous render", the
   * first draft's crash). It runs after the render that applied the turn's
   * edits, so `downloadDesign` and the Preview's exports read the report as
   * edited. An export other than the REPX is the Preview's to make, so the
   * pane opens and is handed the request (`exportRequest`).
   */
  /* ChatGPT's shortcuts (2026-11-05): a new report, the cursor to the chat
     box, and the last reply on the clipboard, said as a notice beside Save. */
  chatShortcutRef.current = (shortcut) => {
    if (shortcut === 'newReport') {
      handleClearChat();
      showRailPanel('review');
    } else if (shortcut === 'focusBox') {
      document.querySelector<HTMLTextAreaElement>('.wb-composer [aria-label="Message"]')?.focus();
    } else {
      const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.text);
      // Through lib/clipboard.ts (agent audit item 56): on plain HTTP this did nothing and said nothing.
      if (last) void copyText(last.text).then((ok) => setSaveNotice(ok ? 'Copied the last reply.' : 'Could not copy: this browser refused the clipboard.'));
    }
  };

  /** The Preview's zoom, from the corner's menu, the command menu and the keys (2026-11-05). */
  const zoomPreview = (to: 'in' | 'out' | '100' | 'fit' | 'selection' | number) => {
    // The page's own scale is the fit times the zoom; a size is asked of the
    // scale, 10% to 400%, whatever the fit (a number is a typed percentage).
    const fit = Math.max(0.01, previewScale / previewZoom);
    const toScale = (scale: number) => setPreviewZoom(Math.min(4, Math.max(0.1, scale)) / fit);
    if (to === 'in') toScale(previewScale * 1.25);
    else if (to === 'out') toScale(previewScale / 1.25);
    else if (to === 'fit') setPreviewZoom(1);
    else if (to === '100') toScale(1);
    else if (typeof to === 'number') toScale(to / 100);
    else {
      toScale(fit * 2);
      setTimeout(() => document.querySelector('.rp-hit.is-selected')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }), 120);
    }
  };
  const mac = /mac|iphone|ipad/i.test(navigator.platform);
  const keysFor = (s: string) => (mac ? s.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧') : s);
  workspaceShortcutRef.current = (shortcut) => {
    if (shortcut === 'commands') setIsCommandOpen((open) => !open);
    else if (shortcut === 'clean') setIsClean((clean) => !clean);
    else if (shortcut === 'shortcuts') setIsShortcutsOpen(true);
    // On every pane, as the corner's buttons (2026-11-06), and not while
    // Forma works, when those are disabled.
    else if (shortcut === 'undo' || shortcut === 'redo') {
      if (!result || isAnalyzing || isChatting) return false;
      if (shortcut === 'undo') undoReport();
      else redoReport();
    }
    // The Preview's tools (2026-11-08): M marks an area, V selects; only on the Preview.
    else if (shortcut === 'mark' || shortcut === 'select') {
      if (!result?.repxContent || plate !== 'print') return false;
      setPreviewTool(shortcut === 'mark' ? 'mark' : 'select');
    }
    // The selection's zoom wants a selection (2026-11-06); it zoomed to twice the fit without one.
    else if (shortcut === 'zoomSelection' && !previewSelection.length) return false;
    else if (result && plate === 'print') zoomPreview(({ zoomIn: 'in', zoomOut: 'out', zoom100: '100', zoomFit: 'fit', zoomSelection: 'selection' } as const)[shortcut]);
    else return false;
    return true;
  };
  /** Everything the command menu offers, from what is open (2026-11-05, components/CommandMenu.tsx). */
  const buildCommands = (): Command[] => {
    const list: Command[] = [
      { id: 'new', label: 'New report', keys: keysFor('Ctrl+Shift+O'), run: () => chatShortcutRef.current?.('newReport') },
      { id: 'box', label: 'Cursor to the box', keys: keysFor('Shift+Esc'), run: () => chatShortcutRef.current?.('focusBox') },
      { id: 'search', label: 'Search projects', run: openProjectSearch },
      { id: 'settings', label: 'Settings', run: () => setIsConfigOpen(true) },
      { id: 'keys', label: 'Keyboard shortcuts', keys: '?', run: () => setIsShortcutsOpen(true) },
      // The three the corner's "?" offers, less the one in force (2026-11-06).
      ...([
        ['light', 'Light theme', () => setTheme(false)],
        ['dark', 'Dark theme', () => setTheme(true)],
        ['system', 'Theme that follows the system', () => setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches, false)],
      ] as const)
        .filter(([choice]) => choice !== (followsSystem ? 'system' : isDarkMode ? 'dark' : 'light'))
        .map(([choice, label, run]) => ({ id: `theme-${choice}`, label, run })),
      { id: 'sidebar', label: 'Show or hide the sidebar', keys: keysFor('Ctrl+B'), run: toggleSidebar },
      { id: 'clean', label: isClean ? 'Leave the clean screen' : 'Clean screen', keys: keysFor('Ctrl+\\'), run: () => setIsClean((c) => !c) },
    ];
    list.push({ id: 'card', label: isPanelCollapsed ? 'Expand the conversation' : 'Collapse the conversation', run: () => setIsPanelCollapsed((c) => !c) });
    // Stop, the search and a paused queue, in the menu too (2026-11-07, agent audit item 66).
    if (isAnalyzing || isChatting) list.push({ id: 'stop', label: 'Stop what Forma is doing', keys: 'Esc', run: () => handleStop() });
    if (requests.length) list.push({ id: 'search', label: 'Search the conversation', run: () => { setIsPanelCollapsed(false); setSearchReveal((n) => n + 1); } });
    if (queuePaused && queue.length && !isAnalyzing && !isChatting) list.push({ id: 'resume', label: 'Resume the queue', run: resumeQueue });
    if (result) {
      const panes: [Plate, string][] = [['proof', 'Mockup'], ['print', 'Preview'], ['data', 'Data'], ['spec', 'Spec'], ['xml', 'REPX']];
      list.push(...panes.map(([p, name]) => ({ id: `pane-${p}`, label: `Show the ${name}`, run: () => showPlate(p) })));
      if (historyDepth.back) list.push({ id: 'undo', label: 'Undo', keys: keysFor('Ctrl+Z'), run: undoReport });
      if (historyDepth.forward) list.push({ id: 'redo', label: 'Redo', keys: keysFor('Ctrl+Shift+Z'), run: redoReport });
      list.push(
        { id: 'save', label: 'Save the project', run: handleSaveReport },
        { id: 'repx', label: 'Export the .repx', run: downloadDesign },
        { id: 'designer', label: 'Open in the DevExpress designer', run: () => void openInDesigner() },
      );
      /* What has a button and had no command (2026-11-06, the workspace
         audit): every format, Share, the project's menu, the pin, Test data. */
      for (const [format, name] of [['pdf', 'PDF'], ['pdf-outline', 'PDF with outline'], ['xlsx', 'Excel workbook'], ['csv', 'CSV'], ['docx', 'Word document'], ['rtf', 'RTF'], ['html', 'HTML page'], ['png', 'image']] as const) {
        list.push({ id: `export-${format}`, label: `Export as ${name}`, run: () => { showPlate('print'); setExportRequest({ format, nonce: Date.now() }); } });
      }
      if (result.repxContent) list.push({ id: 'share', label: 'Share the report', run: () => setIsShareOpen(true) });
      if (boundFields.length) list.push({ id: 'testdata', label: 'Fill the Preview with test data', run: () => { showPlate('print'); void handleTestData(); } });
      if (plate === 'print') {
        list.push(
          { id: 'zin', label: 'Zoom in', keys: '+', run: () => zoomPreview('in') },
          { id: 'zout', label: 'Zoom out', keys: '−', run: () => zoomPreview('out') },
          { id: 'z100', label: 'Zoom to 100%', keys: keysFor('Shift+0'), run: () => zoomPreview('100') },
          { id: 'zfit', label: 'Zoom to fit', keys: keysFor('Shift+1'), run: () => zoomPreview('fit') },
        );
        if (previewSelection.length) list.push({ id: 'zsel', label: 'Zoom to the selection', keys: keysFor('Shift+2'), run: () => zoomPreview('selection') });
      }
      const names = new Set([...(result.repxContent ?? '').matchAll(/ControlType="XR(?!TableRow|TableCell)\w+"[^>]*?\sName="([^"]+)"/g)].map((m) => m[1]));
      for (const name of names) list.push({ id: `go-${name}`, label: `Go to ${name}`, run: () => { showPlate('print'); setChangedHighlight([name]); } });
    }
    if (messages.some((m) => m.role === 'assistant')) {
      list.push(
        { id: 'copyreply', label: 'Copy the last reply', keys: keysFor('Ctrl+Shift+C'), run: () => chatShortcutRef.current?.('copyReply') },
        { id: 'chatmd', label: 'Export the chat as Markdown', run: exportConversation },
      );
    }
    if (openProjectId && savedReports.some((r) => r.id === openProjectId)) {
      const id = openProjectId;
      list.push(
        { id: 'rename', label: 'Rename the project…', run: () => { setProjectMenuStart('rename'); setIsProjectMenuOpen(true); } },
        { id: 'duplicate', label: 'Duplicate the project', run: () => void duplicateProject() },
        { id: 'pin', label: pinnedProjects.includes(id) ? 'Unpin the project' : 'Pin the project', run: () => togglePinned(id) },
        { id: 'archive', label: archivedProjects.includes(id) ? 'Bring the project back from the archive' : 'Archive the project', run: () => toggleArchived(id) },
        { id: 'delete', label: 'Delete the project…', run: () => { setProjectMenuStart('delete'); setIsProjectMenuOpen(true); } },
      );
    }
    list.push(
      { id: 'p-projects', label: 'Show your projects', run: () => showRailPanel('projects') },
      { id: 'p-revisions', label: 'Show the Revisions panel', run: () => showRailPanel('revisions') },
      { id: 'p-batch', label: 'Show the Batch panel', run: () => showRailPanel('batch') },
      { id: 'p-library', label: 'Show the report library', run: () => showRailPanel('library') },
      ...(user
        ? [
            { id: 'account', label: 'Account settings', run: () => setIsAccountOpen(true) },
            { id: 'signout', label: 'Sign out', run: () => void handleLogOut() },
          ]
        : [{ id: 'signin', label: 'Sign in', run: () => navigate('/login') }]),
    );
    // Each project named with when it was last saved, so two of one name can
    // be told apart, and an archived one says so (2026-11-06).
    for (const p of savedReports) {
      if (p.id === openProjectId) continue;
      const archived = archivedProjects.includes(p.id) ? ', archived' : '';
      list.push({ id: `project-${p.id}`, label: `Open ${p.name} (${formatSessionStamp(p.timestamp)}${archived})`, run: () => void handleLoadReport(p) });
    }
    return list;
  };

  runToolsRef.current = (tools) => {
    const PANE_PLATES: Record<string, Plate> = { mockup: 'proof', preview: 'print', data: 'data', spec: 'spec', repx: 'xml' };
    let exports = 0;
    tools.forEach((tool, i) => {
      if (tool.name === 'show') showPlate(PANE_PLATES[tool.pane ?? 'preview'] ?? 'print');
      else if (tool.name === 'testData') {
        showPlate('print');
        if (boundFields.length) void handleTestData();
      } else if (tool.name === 'export') {
        if (tool.format === 'repx') downloadDesign();
        else if (tool.format) {
          showPlate('print');
          // One at a time (agent audit item 38): the Preview holds one
          // request, and two set in one go made one export.
          const request = { format: tool.format, nonce: Date.now() + i };
          window.setTimeout(() => setExportRequest(request), exports++ * 1500);
        }
      } else if (tool.name === 'designer') void openInDesigner();
      // "Undo that" (agent audit item 85): the reply's own Undo when the last
      // change is a reply's, else the corner's.
      else if (tool.name === 'undo') {
        const last = [...undoableIds].pop();
        if (last) handleUndo(last);
        else undoReport();
      } else if (tool.name === 'translate') void translateReport(tool.language ?? '', toolReplyRef.current);
    });
  };
  const railBtn = (panel: RailPanel, label: string, icon: React.ReactNode) => (
    <button
      data-panel={panel}
      aria-current={railPanel === panel}
      title={label}
      aria-label={label}
      // The open panel's own button closes it again (2026-11-06, the workspace
      // audit), as a sidebar's sections do in Gemini and ChatGPT: the rail's
      // "Chat" item did only that, under a name that opened no chat.
      onClick={() => showRailPanel(railPanel === panel && !isReviewCollapsed ? 'review' : panel)}
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
        // No column at all since 2026-11-08: the side panels float over the
        // report in the chat's place, as the chat does (workspace.css).
        '--wb-review-w': '0px',
      } as React.CSSProperties}
      data-resizing={isResizingReview ? 'true' : undefined}
      /* Stacked, the drawer always shows the labelled column, whatever the
         desktop choice: it is the open sidebar, on a phone. */
      data-rail={isRailExpanded || isStackedLayout ? 'wide' : undefined}
      data-drawer={isStackedLayout && isRailDrawerOpen ? 'open' : undefined}
      data-clean={isClean ? 'true' : undefined}
      // A side panel floats in the chat's place while it is open (2026-11-08).
      data-side={isReviewCollapsed || railPanel === 'review' ? undefined : 'open'}
    >
      {/* ============================================================ top bar
          Stacked only (CSS hides it above 880px): the menu button that opens
          the sidebar as a drawer, and the mark, as Gemini's phone layout has. */}
      <div className="wb-topbar">
        <button
          ref={menuButtonRef}
          className="wb-menu-btn"
          title="Menu"
          aria-label="Open the menu"
          aria-expanded={isRailDrawerOpen}
          aria-controls="wb-rail"
          onClick={() => setIsRailDrawerOpen(true)}
        >
          <IconMenu size={20} />
        </button>
        <a href="/" className="wb-topbar-mark" title="Back to the home page" aria-label="Forma — home page">
          <Logo size={22} />
          <span>Forma</span>
        </a>
      </div>
      {isStackedLayout && isRailDrawerOpen && (
        <div className="wb-scrim" aria-hidden="true" onClick={closeRailDrawer} />
      )}

      {/* ============================================================== rail */}
      <nav id="wb-rail" className="wb-rail" aria-label="Sections">
        {/* The sidebar's head, as Gemini's and ChatGPT's (2026-11-04, measured;
            see lib/sidebar.ts). Open, the mark is at the left and the toggle at
            the right. Closed, the toggle covers the mark's place and shows the
            logo, turning into the panel icon on hover or focus: ChatGPT's logo
            is its "Open sidebar" button the same way. One button element in
            both states, so the focus the user just used survives the toggle.

            The mark is still the home link, as it is in SiteHeader on all five
            marketing pages, while the sidebar is open; closed, the route home
            is one click further, as it is in ChatGPT. A plain <a href>, not an
            onClick: the delegated handler in this file turns in-app anchors
            into client-side navigation, so the link stays right-clickable. */}
        <div className="wb-rail-head">
          <a href="/" className="wb-mark" title="Back to the home page" aria-label="Forma — home page">
            <Logo size={26} />
            <span className="wb-wordmark">Forma</span>
          </a>
          {/* Search sits right before the toggle while the sidebar is open, as
              ChatGPT's does (2026-11-05, measured: Search at x=252 and Hide
              sidebar at x=296, both 36px). Closed, its twin below New report
              shows instead. Two buttons rather than one moved about: each is in
              the tab order where it is seen, and neither is the control just
              used to open or close the sidebar. */}
          <button data-rail-search data-in-head title="Search projects" aria-label="Search projects" onClick={openProjectSearch}>
            <IconSearch size={18} />
          </button>
          <button
            ref={railToggleRef}
            data-toggle-rail
            title={`${sidebarToggleLabel(isStackedLayout, isRailExpanded)} (${sidebarShortcutText(navigator.platform)})`}
            aria-label={sidebarToggleLabel(isStackedLayout, isRailExpanded)}
            aria-expanded={isStackedLayout ? isRailDrawerOpen : isRailExpanded}
            aria-controls="wb-rail"
            aria-keyshortcuts={SIDEBAR_SHORTCUT_ARIA}
            onClick={isStackedLayout ? closeRailDrawer : toggleSidebar}
          >
            <span className="wb-toggle-logo" aria-hidden="true"><Logo size={26} /></span>
            <span className="wb-toggle-icon" aria-hidden="true">
              {isStackedLayout ? <IconClose size={18} /> : <IconPanelLeft size={19} />}
            </span>
          </button>
        </div>

        {/* New report first, as ChatGPT's New chat; Search under it while the
            sidebar is closed, as ChatGPT's rail has it (2026-11-05). They moved
            here from the top of the side panel, where "+ New report" and a
            magnifier sat above every panel. */}
        <button
          data-new-report
          title={`New report (${shortcutText('newReport', navigator.platform)})`}
          aria-label="New report"
          onClick={() => { handleClearChat(); showRailPanel('review'); }}
        >
          <IconCompose size={19} />
          <span className="wb-rail-label">New report</span>
        </button>
        <button data-rail-search title="Search projects" aria-label="Search projects" onClick={openProjectSearch}>
          <IconSearch size={19} />
          <span className="wb-rail-label">Search</span>
        </button>

        {railBtn('projects', 'Saved projects', <IconFolder size={19} />)}
        {railBtn('revisions', 'Revisions', <IconRedo size={19} />)}
        {railBtn('batch', 'Batch', <IconStack size={19} />)}
        {railBtn('library', 'Report library', <IconDoc size={19} />)}
        <button data-open-config title="Configure" aria-label="Configure" onClick={() => { setIsRailDrawerOpen(false); setIsConfigOpen(true); }}>
          <IconTune size={19} />
          <span className="wb-rail-label">Configure</span>
        </button>

        {/* The "Hide panel" chevrons stood here until 2026-11-08, a third way to
            close a side panel beside its own Collapse and its icon here pressed
            again; they went when the workspace's repeated options were taken
            out, at the owner's request. `git log -S"data-toggle-panel"`. */}
        <span className="wb-spacer" />
        {/* The theme is the corner's "?" menu's, Light, System or Dark, as
            Gemini keeps it under Settings and help (2026-11-06, the workspace
            audit): the rail's toggle beside it could only flip light and dark,
            and left System whenever it was pressed. */}

        {/*
          * Signed in: an accent disc with initials — that treatment means
          * "identity". Signed out: a plain rail button, because the accent disc was
          * ALSO what `aria-current` used for the selected rail section (grey
          * since 2026-11-05), so an accent-washed circle here read as "signed
          * in" and as "active" at the same time. Three meanings sharing one appearance is why this looked
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
        className={`wb-review wb-rise wb-rise-1${isReviewCollapsed || railPanel === 'review' ? ' wb-hidden' : ''}`}
        aria-label="Session"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Back to the conversation (2026-11-08): the side panels float in the
            chat's place, as the chat floats, and close with its Collapse. */}
        <button
          type="button"
          className="wb-panel-tool wb-panel-collapse wb-review-close"
          aria-label="Close the panel"
          title="Close"
          onClick={() => showRailPanel('review')}
        >
          <IconCollapse size={18} />
        </button>
        {/* New report and Search are the sidebar's since 2026-11-05, as in
            ChatGPT, where they are always in reach. They sat here, as an orange
            "+ New report" pill and a magnifier above every panel. */}

        {/* The chat's panel went on 2026-11-05: the conversation floats over the
            report a request at a time, as Google Stitch's does (the card, the
            log and the box at the end of the bench below). This column holds
            the other panels; `git log -S"wb-chat-search"` finds the old one. */}

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
            {/* The sidebar's Search (2026-11-05): the projects whose name or
                chat holds what is typed, as ChatGPT's search finds chats. */}
            {projectQuery !== null && (
              <div className="wb-chat-search">
                <IconSearch size={13} />
                <input
                  type="search"
                  value={projectQuery}
                  autoFocus
                  placeholder="Search projects"
                  aria-label="Search projects"
                  onChange={(e) => setProjectQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setProjectQuery(null);
                  }}
                />
                <button type="button" title="Close the search" aria-label="Close the search" onClick={() => setProjectQuery(null)}>
                  <IconClose size={13} />
                </button>
              </div>
            )}
            <div className="wb-list">
              {savedReports.length === 0 ? (
                <div className="wb-empty">No saved projects yet.</div>
              ) : projectQuery && !savedReports.some((r) => projectMatches(r, projectQuery)) ? (
                <div className="wb-empty">No project holds that.</div>
              ) : (
                arrangeProjects(savedReports.filter((r) => projectMatches(r, projectQuery ?? '')), pinnedProjects, archivedProjects, showArchived).map((report) => {
                  // Day and time. A bare clock time was the same six characters
                  // for a session from this morning and one from last month.
                  const stamp = formatSessionStamp(report.timestamp);
                  const leaving = leavingReportIds.includes(report.id);
                  const open = report.id === openProjectId;
                  const pinned = pinnedProjects.includes(report.id);
                  const archived = archivedProjects.includes(report.id);
                  return (
                    <div
                      key={report.id}
                      className={`wb-card${open ? ' wb-is-open' : ''}${leaving ? ' wb-leaving' : ''}`}
                      onClick={() => { if (renaming?.id !== report.id) void handleLoadReport(report); }}
                    >
                      {/* A rename typed in place (2026-11-05): Enter keeps it, Escape or leaving puts it back. */}
                      {renaming?.id === report.id ? (
                        <input
                          className="wb-ctl wb-rename"
                          aria-label={`Rename ${report.name}`}
                          value={renaming.name}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenaming({ id: report.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRenameProject(report.id, renaming.name);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={() => setRenaming(null)}
                        />
                      ) : (
                        <div className="wb-nm">
                          {pinned && <IconPin size={11} />}
                          {report.name}
                        </div>
                      )}
                      <div className="wb-sub">
                        {stamp && `${stamp} · `}
                        {noteCountLabel(report.stub ? report.notes ?? 0 : report.messages.length)}
                      </div>
                      <div className="wb-row-actions">
                        <button
                          aria-label={pinned ? `Unpin ${report.name}` : `Pin ${report.name}`}
                          aria-pressed={pinned}
                          title={pinned ? 'Unpin' : 'Pin to the top (on this device)'}
                          onClick={(e) => { e.stopPropagation(); togglePinned(report.id); }}
                        >
                          <IconPin size={14} />
                        </button>
                        <button
                          aria-label={`Rename ${report.name}`}
                          title="Rename"
                          onClick={(e) => { e.stopPropagation(); setRenaming({ id: report.id, name: report.name }); }}
                        >
                          <IconPencil size={14} />
                        </button>
                        {/* As the title's menu has it (2026-11-06, the workspace audit). */}
                        <button
                          aria-label={`Duplicate ${report.name}`}
                          title="Duplicate"
                          onClick={(e) => { e.stopPropagation(); void duplicateProject(report.id); }}
                        >
                          <IconCopy size={14} />
                        </button>
                        <button
                          aria-label={archived ? `Unarchive ${report.name}` : `Archive ${report.name}`}
                          title={archived ? 'Back to projects' : 'Archive (on this device)'}
                          onClick={(e) => { e.stopPropagation(); toggleArchived(report.id); }}
                        >
                          <IconArchive size={14} />
                        </button>
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
            {/* The archive, kept on this device (2026-11-05): out of the list until opened. */}
            {(showArchived || savedReports.some((r) => archivedProjects.includes(r.id))) && (
              <button type="button" className="wb-mini wb-archive-toggle" onClick={() => setShowArchived((open) => !open)}>
                <IconArchive size={12} />
                {showArchived ? 'Back to projects' : `Archived (${savedReports.filter((r) => archivedProjects.includes(r.id)).length})`}
              </button>
            )}
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
                busy={isAnalyzing || isChatting}
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
                  // By its time, as the notice says it (2026-11-11, the full
                  // audit's WS-05): by its label until then, which could be
                  // the name of a part of Forma.
                  const at = new Date(revision.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  recordRevision(`Restored the ${at} version`, restored);
                  setSaveNotice(`Restored the ${at} version.`);
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
                incoming={batchIncoming}
                ready={hasApiKey}
                onNeedKey={() => setIsConfigOpen(true)}
                runOne={runOneBatchFile}
                onOpen={async (item) => {
                  // A batch kept from an earlier visit has its REPX alone, and the rest is read off it (batch AG item 23).
                  const full: DesignResult | null = batchResults.current.get(item.id) ?? (await import('./lib/batchCheckpoint')).resultFromKept(item);
                  if (!full) return;
                  // A new, unsaved session, never the project that was open
                  // (2026-11-06): it used to keep that project's id, so the
                  // next save wrote the batch report over it.
                  handleClearChat();
                  setResult(full);
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
      {/* The report fills the bench, and the conversation floats over it
          (2026-11-05), as Google Stitch's canvas carries its agent: the card at
          the top left, the log at the bottom left, the box at the foot. A file
          dropped anywhere on it is attached, as on the chat column it replaced. */}
      <main
        className="wb-bench"
        data-panel={isPanelCollapsed ? 'folded' : 'open'}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dropping && (
          <div className="wb-drop-veil" aria-hidden="true">
            <span>Drop to attach</span>
          </div>
        )}
        <div className="wb-bench-bar">
          <div className="wb-doc-id">
            {/* The project's menu, from a button at the top left (2026-11-08),
                where Stitch keeps its hamburger: Rename, Duplicate, Archive and
                Delete. It held the workspace's other options for a day, each a
                repeat of its own place, and the owner asked for those to go. A
                saved project shows its name, the one the projects list shows,
                so a rename is seen where it was made. */}
            <button
              type="button"
              className="wb-menu-btn"
              data-project-toggle
              aria-label="Project menu"
              aria-haspopup="menu"
              aria-expanded={isProjectMenuOpen}
              title="Rename, duplicate, archive or delete this project"
              onClick={() => setIsProjectMenuOpen((open) => !open)}
            >
              <IconMenu size={17} />
            </button>
            <h1>
              <span className="wb-title-btn wb-title-plain">
                <span>{(openProjectId && savedReports.find((r) => r.id === openProjectId)?.name) || result?.title || 'Untitled report'}</span>
              </span>
            </h1>
            {isProjectMenuOpen && (
              <Suspense fallback={null}>
                <ProjectMenu
                  name={savedReports.find((r) => r.id === openProjectId)?.name || result?.title || 'Untitled report'}
                  onRename={openProjectId && savedReports.some((r) => r.id === openProjectId) ? (name) => void handleRenameProject(openProjectId, name) : undefined}
                  onDuplicate={openProjectId && savedReports.some((r) => r.id === openProjectId) ? () => void duplicateProject() : undefined}
                  onArchive={openProjectId && savedReports.some((r) => r.id === openProjectId) ? () => toggleArchived(openProjectId) : undefined}
                  archived={!!openProjectId && archivedProjects.includes(openProjectId)}
                  start={projectMenuStart}
                  onDelete={openProjectId && savedReports.some((r) => r.id === openProjectId) ? deleteOpenProject : undefined}
                  onClose={() => { setIsProjectMenuOpen(false); setProjectMenuStart(undefined); }}
                />
              </Suspense>
            )}
            {/* A count of the report's bands sat beside the title until
                2026-11-11 (the full audit's WS-25): a readout of how the
                report is built, beside its name. */}
            {/* The project's pin, the list's own (2026-11-06); the thumbs are the
                reply's, under it, as ChatGPT's and Gemini's are. */}
            {result && openProjectId && savedReports.some((r) => r.id === openProjectId) && (
              <Suspense fallback={null}>
                <PinProject pinned={pinnedProjects.includes(openProjectId)} onPin={() => togglePinned(openProjectId)} />
              </Suspense>
            )}
          </div>

          {/* The panes stay whatever is selected (2026-11-06): the selection's
              toolbar floats over the report, drawn by the Preview. */}
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

          {/* Nothing to save, share or export on the empty home, so no buttons
              there, greyed (2026-11-06, the workspace audit), as Stitch's
              bar holds none until there is a screen. */}
          {(result || messages.length > 0) && (
          <div className="wb-bar-actions">
            {/* The notice left this bar for a toast at the bottom right
                (2026-11-06): beside the selection toolbar it wrapped the bar
                onto two lines. See `wb-toast` below. */}
            {/* "Saved" while the open session matches its last save (2026-11-05):
                the workspace saves on its own after each turn, so the button is
                there for the moment before that, and after a save that failed. */}
            <button
              className="wb-pill wb-pill--outline wb-save"
              onClick={handleSaveReport}
              disabled={(!result && messages.length === 0) || savedSignature === currentSignature}
              title={savedSignature === currentSignature && (result || messages.length)
                ? user ? 'Saved to your projects' : 'Saved on this device. Sign in to sync across devices.'
                : 'Save this project'}
            >
              {savedSignature === currentSignature && (result || messages.length) ? <IconCheck size={14} /> : <IconSave size={14} />}
              {savedSignature === currentSignature && (result || messages.length) ? 'Saved' : 'Save'}
            </button>
            {/* Open in designer is the Export panel's second row (2026-11-06,
                the owner's choice in the workspace audit): the bar's own button
                was the same action beside it, and its "Starting designer…"
                widened the bar onto two lines while it waited. */}
            {/* Share, as Stitch's beside its Export (2026-11-06): a copy of the
                report for people added by email or anyone with the link. */}
            <button className="wb-pill wb-pill--outline" onClick={() => setIsShareOpen(true)} disabled={!result?.repxContent}>
              Share
            </button>
            {/* Its dialog is drawn with the command menu, not here: the bar's blur
                makes it the containing block of anything fixed inside it. */}
            {/* Export opens every format in one panel (2026-11-06), as Stitch's
                does; the .repx is its first row, and Ctrl+K's "Export the .repx"
                still downloads it at once. */}
            <span className="wb-export-anchor">
              <button
                className="wb-pill wb-pill--accent"
                data-export-toggle
                aria-expanded={isExportOpen}
                onClick={() => setIsExportOpen((open) => !open)}
                disabled={!result}
              >
                <IconDownload size={14} />
                Export
                <IconChevronDown size={13} />
              </button>
              {isExportOpen && result && (
                <Suspense fallback={null}>
                  <ExportPanel
                    onRepx={downloadDesign}
                    onDesigner={result.repxContent && !designerOpen ? () => openInDesigner() : undefined}
                    onPrint={(format) => {
                      showPlate('print');
                      setExportRequest({ format, nonce: Date.now() });
                    }}
                    onClose={() => setIsExportOpen(false)}
                  />
                </Suspense>
              )}
            </span>
          </div>
          )}
        </div>

        {/* The report and what floats over it, under the bar (2026-11-06): the
            floats are placed from here, not from the bench, so the card's top
            follows the bar whatever its height; pinned 74px from the bench's
            top, it went under a bar that wrapped. */}
        <div className="wb-stage">
        {/* A click on the empty ground folded the card until 2026-11-08; the
            panel holds the box now, and Stitch's stays open on such a click. */}
        <div className="wb-bench-body">
          {result ? (
            <>
              {plate === 'proof' && (
                <div className="wb-proof-holder wb-rise wb-rise-2">
                  {/* ReportMockup sits directly in the holder — it carries the
                      artifact's proof frame itself (see its root), so wrapping it
                      in `.wb-proof` would draw that frame twice. */}
                  {/* Said, not thrown (2026-11-06): a result with no layout took
                      the whole app down with it, there being no error boundary
                      short of the app's. */}
                  {result.layout ? (
                    <ErrorBoundary area="the mockup">
                    <Suspense fallback={null}>
                      <ReportMockup layout={result.layout} sourceImages={mockupSourceImages} reportUnit={openUnit} />
                    </Suspense>
                    </ErrorBoundary>
                  ) : (
                    <p className="wb-empty">This report has no layout to draw a mockup from. Preview shows it as it prints.</p>
                  )}
                </div>
              )}

              {plate === 'print' && (
                <div className="wb-proof-holder wb-rise wb-rise-2">
                  {/* Lazy for its own sake: the pane is workspace-only and the
                      marketing pages were just taken off the entry chunk. */}
                  {/* An area of its own (2026-11-08, site audit item 64): a fault in a
                      pane leaves the conversation and the sidebar working. */}
                  <ErrorBoundary area="the Preview">
                  <Suspense fallback={null}>
                    <ReportPreview
                      repxContent={result.repxContent}
                      layout={result.layout}
                      title={result.title}
                      records={testRows}
                      database={previewDatabase}
                      onTestData={handleTestData}
                      onClearTestData={() => setTestRows(null)}
                      testDataBusy={testDataBusy}
                      exportRequest={exportRequest}
                      onExportRequestDone={() => setExportRequest(null)}
                      onSelectionChange={(names) => {
                        setPreviewSelection(names);
                        // An empty list on leaving the Preview is not a choice to forget it.
                        if (names.length) setBindTarget(names);
                      }}
                      marking={previewTool === 'mark'}
                      onMarked={() => setPreviewTool('select')}
                      highlight={changedHighlight}
                      historyElsewhere
                      onEditText={askForText}
                      onDescribe={askToDescribe}
                      zoom={previewZoom}
                      onScaleChange={setPreviewScale}
                      resetSelection={selectionReset}
                      onAddToChat={() => chatShortcutRef.current?.('focusBox')}
                      onFormat={(action) => void formatSelection(action)}
                      onFocusSelection={() => zoomPreview('selection')}
                      onNotice={setSaveNotice}
                      // Every format is in the Export panel (2026-11-06); no second row of them here.
                      exportButtons={false}
                      /* Editing writes the REPX only. The layout and the spec
                         still describe the source document, which is what the
                         Mockup is for — nudging a control in the file does not
                         change what was uploaded. */
                      onEdit={(xml, reason, continues) => {
                        previewEditedXml.current = xml;
                        // One step of the history per edit, and per drag
                        // (2026-11-06): its later frames continue the step its
                        // first opened, which the effect below would have made
                        // a step each.
                        if (!continues) pushHistory(result);
                        previewStep.current = true;
                        setResult({ ...result, repxContent: xml });
                        setSaveNotice(reason);
                      }}
                    />
                  </Suspense>
                  </ErrorBoundary>
                </div>
              )}

              {plate === 'data' && (
                <div className="wb-sheet wb-reg-marks">
                  <ErrorBoundary area="the Data view">
                  <Suspense fallback={null}>
                    <DatabasePanel
                      database={activeDatabase}
                      recent={keptDatabases}
                      shared={databaseShared}
                      onShare={setDatabaseShared}
                      // The report's own data source, shown and checked against the layout (batch DG).
                      repx={result.repxContent}
                      onApplyRepx={(xml, reason) => {
                        const next = { ...result, repxContent: xml };
                        setResult(next);
                        recordRevision('Data source updated', next);
                        setSaveNotice(reason);
                      }}
                      onAdopt={(schema) => {
                        setActiveDatabase(schema);
                        setDatabaseShared(false);
                      }}
                      // Read through the companion on this PC (Phase 2), as a pasted layout is.
                      onLayoutText={databaseFromText}
                      onAskSql={async (sentence) => {
                        const [{ layoutFor }, { promptToSql }] = await Promise.all([import('./lib/databaseAi'), loadGemini()]);
                        return promptToSql(sentence, layoutFor(activeDatabase!, sentence), effectiveConfig());
                      }}
                      onSwitch={async (name) => {
                        const kept = await (await import('./lib/sqlSchemaStore')).loadDatabases();
                        const hit = kept.find((d) => d.name === name);
                        if (hit) {
                          setActiveDatabase(hit.schema);
                          setDatabaseShared(false);
                        }
                      }}
                      onForget={async (name) => {
                        const store = await import('./lib/sqlSchemaStore');
                        await store.forgetDatabase(name);
                        if (activeDatabase && store.storedName(activeDatabase) === name) setActiveDatabase(null);
                        setKeptDatabases((await store.loadDatabases()).map((d) => d.name));
                        setSaveNotice(`${name || 'The database'} is forgotten in this browser.`);
                      }}
                      query={activeQuery}
                      onQuery={setActiveQuery}
                      selectionLabel={bindTarget.length === 1 ? bindTarget[0] : bindTarget.length > 1 ? `${bindTarget.length} controls` : ''}
                      // A field bound to what was last selected on the Preview: the chat's own bind edit.
                      onBindField={async (field) => {
                        const agent = await import('./lib/agentEdit');
                        const now = reportNow.current;
                        if (!now?.repxContent || !bindTarget.length) return;
                        const done = agent.applyEdits(now.repxContent, bindTarget.map((control) => ({ op: 'bind' as const, control, field })));
                        if (!done.changed) {
                          setSaveNotice(done.declined[0] ? agent.plainDeclined(done.declined[0]) : 'Nothing needed changing');
                          return;
                        }
                        const bound = { ...now, repxContent: done.xml };
                        setResult(bound);
                        recordRevision('Bound to data', bound);
                        setSaveNotice(done.applied.length === 1 ? done.applied[0] : `${done.applied.length} changes`);
                      }}
                      onCopy={copyText}
                      onFieldsChange={(fields, label) => setQueryFieldList({ fields, label })}
                      // The chosen query into the report as DevExpress's SqlDataSource, by connection name (batch DD).
                      onWrite={async (options) => {
                        const now = reportNow.current;
                        if (!now?.repxContent || !activeDatabase || !activeQuery) return 'Open a report and choose what it reads first.';
                        const { writeSqlDataSource } = await import('./lib/repxSqlWriter');
                        const done = writeSqlDataSource(now.repxContent, { ...options, schema: activeDatabase, query: activeQuery }, config.version);
                        if (!done.applied) return `Not written: ${done.reason}.`;
                        const written = { ...now, repxContent: done.xml };
                        setResult(written);
                        recordRevision('Data source written', written);
                        setSaveNotice(done.reason);
                        return `${done.reason}.`;
                      }}
                    />
                    <DataBinding
                      repxContent={result.repxContent}
                      databaseFields={activeDatabase ? queryFieldList.fields : undefined}
                      databaseLabel={queryFieldList.label}
                      /* A database's layout or sample rows pasted on the tab (2026-11-08):
                         kept on this device and made the active database. */
                      onDatabase={databaseFromText}
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
                  </ErrorBoundary>
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
                      <ErrorBoundary area="the spec">
                        <Markdown>{result.content}</Markdown>
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                </div>
              )}

              {plate === 'xml' && (
                <div className="wb-sheet wb-reg-marks">
                  <ErrorBoundary area="the REPX view">
                  <Suspense fallback={null}>
                    <RepxViewer
                      xml={result.repxContent || ''}
                      unit={openUnit}
                      audit={repxAudit}
                      usage={summariseUsage(result.usage) ? { short: summariseUsage(result.usage)!, long: describeUsage(result.usage) } : null}
                      coverage={result.coverage ?? null}
                    />
                  </Suspense>
                  </ErrorBoundary>
                </div>
              )}
            </>
          ) : messages.length === 0 && !isAnalyzing && !isChatting ? (
            /* Nothing said and nothing built: the home (2026-11-06), as
               Stitch's, with the recent projects and the starting points. */
            <Suspense fallback={null}>
              <HomeStart
                // The projects whole: lib/startingPoints, which picks the recent
                // ones, holds the six descriptions too, and importing it here
                // put them all in the entry chunk (+3 kB, measured).
                projects={savedReports}
                archived={archivedProjects}
                showRecent={!(railPanel === 'projects' && !isReviewCollapsed)}
                // The lazy component loses its generic, so the project is looked up by id.
                onOpen={(p) => {
                  const report = savedReports.find((r) => r.id === p.id);
                  if (report) void handleLoadReport(report);
                }}
                onAllProjects={() => showRailPanel('projects')}
                onPick={(point) => {
                  addToBox(point.text);
                  focusBox();
                }}
              />
            </Suspense>
          ) : (
            /* The canvas before a report, once something has been said
               (2026-11-07, agent audit item 97): quiet, as the chat apps leave
               an empty canvas, where the 2026-08-12 port's drafting sheet
               stayed, an orange "X 000 · Y 0000 CANVAS" over "Ready to
               process". h2, as it follows the bench's h1. */
            <div className="wb-canvas-empty wb-rise wb-rise-2">
              <h2>{isAnalyzing ? 'Designing the report…' : 'No report yet'}</h2>
              <p>
                {isAnalyzing
                  ? 'It appears here when it is ready.'
                  : 'Describe the report you want, or attach a picture, a PDF or a .repx, and it appears here.'}
              </p>
            </div>
          )}
        </div>

        {/* ------------------------------------------- the conversation */}
        {/* A thread in a panel down the left (2026-11-08), as Stitch's
            workspace has it since it changed: every request, what was asked
            pinned at the top of its own, and the box at the panel's foot.
            Always there, since the box is in it; folded, it is one mark. */}
        <div className="wb-float wb-float-panel">
            <Suspense fallback={null}>
              <ConversationPanel
                requests={requests}
                collapsed={isPanelCollapsed}
                onToggle={() => setIsPanelCollapsed((folded) => !folded)}
                initials={user ? initialsOf(user) : 'Y'}
                isChatting={isChatting}
                isAnalyzing={isAnalyzing}
                busy={turnBusy}
                streamingReply={streamingReply}
                onRetry={handleRetryMessage}
                onOpenAttachment={setFullScreenImage}
                onAnswer={handleClarifyAnswers}
                // The edit form and a withdrawn pill go away under the
                // keyboard's focus; it goes to the box (agent audit item 59).
                onEdit={(id, text) => {
                  handleEditMessage(id, text);
                  focusBox();
                }}
                onWithdraw={(id) => {
                  handleWithdrawMessage(id);
                  focusBox();
                }}
                onRegenerate={handleRegenerate}
                onRate={handleRate}
                undoable={undoableIds}
                onUndo={handleUndo}
                redoable={redoableIds}
                onRedo={handleRedo}
                // No offered tool, Redesign or Start to press (2026-11-11, the full audit's WS-38); the rows question is the one kept.
                onConsent={(id, yes) => void handleConsent(id, yes)}
                aiName={PROVIDER_NAMES[effectiveProvider(config)]}
                onShowVersion={handleShowVersion}
                // The search, marked in the asks and the replies (the log's until 2026-11-08).
                query={logQuery}
                // The lazy component loses its generic; the result is App's own DesignResult.
                // A request's change shown on the Preview, the log's pick until 2026-11-08.
                changed={changedRequests}
                onShowChange={(id) => void showRequest(id)}
                currentId={shownRequestId}
                onQuery={setLogQuery}
                revealSearch={searchReveal}
                onExport={exportConversation}
                foot={
                  <>
                    {/* A tip while Forma works (2026-11-06, lib/workingTips.ts), as Stitch
                        shows one above its bar during a task. The owner chose it knowing
                        it adds a line to the minimal workspace of 2026-11-04. */}
                    {(isAnalyzing || isChatting) && (
                      <p className="wb-tip" key={tipStep}>
                        Tip: {forPlatform(tipAt(tipStart.current, tipStep), mac)}
                      </p>
                    )}
                    {/* Unverified means an address nobody has proved they can read. It is
                        a nudge, not a gate: nothing here is withheld until it is done,
                        because the account only ever holds this person's own reports and
                        locking them out of their own work would cost more than it buys.
                        Google accounts never see this — the popup already proved it. */}
                    {user && !user.emailVerified && user.providerData.some((p) => p.providerId === 'password') && (
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
                    )}
                    <Suspense fallback={null}>
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
                      onDismissError={() => setError(null)}
                      prompt={prompt}
                      onPromptChange={setPrompt}
                      onSend={handleGenerate}
                      onStop={handleStop}
                      fileInputRef={fileInputRef}
                      onFileChange={handleFileChange}
                      hasApiKey={hasApiKey}
                      onAddKey={() => setIsConfigOpen(true)}
                      isAnalyzing={isAnalyzing}
                      // Between a turn's steps the box still queues and stops (see `turnBusy`).
                      isChatting={isChatting || (turnBusy && !isAnalyzing)}
                      isIngesting={isIngesting}
                      onPasteFiles={ingestFiles}
                      selection={result?.repxContent ? previewSelection : []}
                      models={modelPicker}
                      // Local AI's or OpenRouter's model, where Gemini's picker is (agent audit item 74).
                      answering={answeringModel(config)}
                      onChooseAi={() => {
                        setConfigStart('ai');
                        setIsConfigOpen(true);
                      }}
                      queue={queue.map((q) => ({ id: q.id, text: q.text, files: queuedFiles(q), dropped: q.dropped }))}
                      onQueue={(text) => {
                        // The files in the box go with the words (agent audit item 71):
                        // they stayed behind, and the message was sent without them, unsaid.
                        const files = previews.length || attachmentTexts.length
                          ? { ...(previews.length ? { images: previews, imageMeta: previewMeta } : {}), ...(attachmentTexts.length ? { texts: attachmentTexts } : {}) }
                          : {};
                        setQueue((q) => [...q, { id: nextMessageId(), text, ...files }]);
                        if (previews.length || attachmentTexts.length) {
                          setPreviews([]);
                          setPreviewMeta([]);
                          setAttachmentTexts([]);
                          setUploadNotices([]);
                        }
                        setPrompt('');
                      }}
                      onSteer={(id) => {
                        /*
                         * A steer changes the request under way (2026-11-07, agent audit
                         * item 86): it goes next, carrying that request's words, and its
                         * pictures when it had some, rather than alone. Stop here does
                         * not pause the queue: the steer is the person's next message.
                         */
                        setQueue((q) => steered(q, id, messages));
                        setQueuePaused(false);
                        handleStop({ steering: true });
                      }}
                      queuePaused={queuePaused}
                      onResumeQueue={resumeQueue}
                      onEditQueued={(id) => {
                        const item = queue.find((x) => x.id === id);
                        setQueue((q) => q.filter((x) => x.id !== id));
                        // What was being typed stays, under the queued words (2026-11-06,
                        // the workspace audit): Edit replaced it, and it was lost.
                        if (item) setPrompt((typed) => (typed.trim() ? `${item.text}\n${typed}` : item.text));
                        // Its files come back to the box with it (agent audit item 71).
                        if (item?.images?.length) {
                          setPreviews((p) => [...p, ...item.images!]);
                          setPreviewMeta((m) => [...m, ...item.images!.map((_, i) => item.imageMeta?.[i] ?? { uploadId: `queued-${item.id}-${i}`, file: 'image' })]);
                        }
                        if (item?.texts?.length) setAttachmentTexts((t) => [...t, ...item.texts!]);
                      }}
                      onCancelQueued={(id) => setQueue((q) => q.filter((x) => x.id !== id))}
                      history={requests.map((r) => r.ask?.text ?? '').filter(Boolean)}
            // The box's Tools (2026-11-08): sentences for a report, so they wait for one.
            hasReport={!!result?.repxContent}
            houseStyle={{ on: houseStyleOn, onToggle: toggleHouseStyle }}
                    />
                    </Suspense>
                  </>
                }
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
                  // Not a live region (agent audit item 7): the card's status region announces.
                  <article className="wb-note">
                    <div>
                      <div className="wb-who">Forma</div>
                      <p
                        role="progressbar"
                        aria-label="Forma is designing the report"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress.percent)}
                        /* The task and how far it has got, never its steps
                           (2026-11-11, the full audit's WS-06): it read
                           "Constructing DevExpress XML..." until then. */
                        aria-valuetext={`Designing the report, ${Math.round(progress.percent)}%`}
                      >
                        <WorkingDots />
                        {/* The task, never its steps (2026-11-06), as Stitch's "Creating prototype…". */}
                        <span className="wb-task" aria-hidden="true">Designing the report…</span>
                      </p>
                    </div>
                  </article>
                )}
              </ConversationPanel>
            </Suspense>
        </div>
        {/* The clean screen's way back, the one thing it leaves (2026-11-05). */}
        {isClean && (
          <button type="button" className="wb-clean-leave" onClick={() => setIsClean(false)}>
            Clean screen · {keysFor('Ctrl+\\')} to leave
          </button>
        )}
        {/* Undo, Redo and the zoom at the bench's corner (2026-11-05), as
            Stitch has them: one history for every change to the report
            (`undoReport`), and on Preview its scale, with Fit as the start.
            Since 2026-11-06 the corner is always there, for Stitch's "?" at
            its end; the history and the zoom still come with a report. */}
        {/* The Preview's tools at the bench's right edge (2026-11-08), as
            Stitch's rail: Select and Mark an area. Only on the Preview, the one
            pane where a control can be picked. */}
        {result?.repxContent && plate === 'print' && (
          <div className="wb-float wb-float-rail" role="toolbar" aria-label="Preview tools" aria-orientation="vertical">
            <button type="button" aria-label="Select" title="Select (V)" aria-pressed={previewTool === 'select'} onClick={() => setPreviewTool('select')}>
              <IconPointer size={16} />
            </button>
            <button
              type="button"
              aria-label="Mark an area"
              title="Mark an area (M): drag over the report to select everything in it"
              aria-pressed={previewTool === 'mark'}
              onClick={() => setPreviewTool((tool) => (tool === 'mark' ? 'select' : 'mark'))}
            >
              <IconMarquee size={16} />
            </button>
            {/* Upload files stood here for a day (2026-11-08), a repeat of the
                box's "+", and went with the workspace's other repeats. */}
          </div>
        )}
        <div className="wb-float wb-float-corner">
          {/* A notice in its own words (2026-11-04), not always "Saved":
              "Restored the version from 10:15" or "8 sample rows generated" are
              not saves. A toast above the corner since 2026-11-06, as Stitch's,
              gone after four seconds or at its ×; inside the corner, so the
              corner's menus open over it rather than under it. */}
          {saveNotice && (
            <div className="wb-toast" role="status">
              <IconCheck size={14} />
              {/* An edit's own reason starts lower case ("duplicated as label2"). */}
              <span>{saveNotice.charAt(0).toUpperCase() + saveNotice.slice(1)}</span>
              <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => setSaveNotice(null)}>
                <IconClose size={12} />
              </button>
            </div>
          )}
          {result && (
            <div className="wb-corner" role="group" aria-label="History">
              <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!historyDepth.back || isAnalyzing || isChatting} onClick={undoReport}>
                <IconUndo size={15} />
              </button>
              <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!historyDepth.forward || isAnalyzing || isChatting} onClick={redoReport}>
                <IconRedoStep size={15} />
              </button>
            </div>
          )}
            {result && plate === 'print' && (
              <div className="wb-corner" role="group" aria-label="Zoom">
                <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={previewScale <= 0.1} onClick={() => zoomPreview('out')}>
                  <IconMinus size={14} />
                </button>
                {/* The number is a field (2026-11-06): click it and type a size. */}
                <Suspense fallback={<span className="wb-corner-zoom">{Math.round(previewScale * 100)}%</span>}>
                  <ZoomField
                    percent={Math.round(previewScale * 100)}
                    onSet={(percent) => zoomPreview(percent)}
                    onFit={() => zoomPreview('fit')}
                    onSelection={previewSelection.length ? () => zoomPreview('selection') : undefined}
                    mac={mac}
                  />
                </Suspense>
                <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={previewScale >= 4} onClick={() => zoomPreview('in')}>
                  <IconPlus size={14} />
                </button>
              </div>
            )}
            <div className="wb-corner wb-corner-help">
              <button type="button" data-help-toggle aria-label="Help" title="Help" aria-expanded={isHelpOpen} onClick={() => setIsHelpOpen((open) => !open)}>
                <IconHelp size={16} />
              </button>
              {isHelpOpen && (
                <Suspense fallback={null}>
                  <HelpMenu
                    theme={followsSystem ? 'system' : isDarkMode ? 'dark' : 'light'}
                    onTheme={(choice) => {
                      if (choice === 'system') setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches, false);
                      else setTheme(choice === 'dark');
                    }}
                    onShortcuts={() => setIsShortcutsOpen(true)}
                    onCommandMenu={() => setIsCommandOpen(true)}
                    commandKeys={keysFor('Ctrl+K')}
                    onClose={() => setIsHelpOpen(false)}
                  />
                </Suspense>
              )}
            </div>
        </div>
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
            unit={effectiveConfig().unit}
            pageSize={effectiveConfig().pageSize}
            onBuild={handleOcrBuild}
            onClose={() => setOcrReview(null)}
          />
        </Suspense>
      )}
      {isCommandOpen && (
        <Suspense fallback={null}>
          <CommandMenu commands={buildCommands()} onClose={() => setIsCommandOpen(false)} />
        </Suspense>
      )}
      {isShortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog mac={mac} onClose={() => setIsShortcutsOpen(false)} />
        </Suspense>
      )}
      {designerOpen && result?.repxContent && (
        <Suspense fallback={null}>
          <OpenInDesigner
            repxContent={result.repxContent}
            fileName={designerFileName(result.title)}
            onExport={downloadDesign}
            onOpened={(file) => {
              setDesignerOpen(false);
              setSaveNotice(`Opened ${file} in the designer`);
            }}
            onClose={() => setDesignerOpen(false)}
          />
        </Suspense>
      )}
      {isShareOpen && result && (
        <Suspense fallback={null}>
          <ShareDialog
            user={user ? { uid: user.uid, email: user.email, emailVerified: user.emailVerified } : null}
            name={savedReports.find((r) => r.id === openProjectId)?.name || result.title || 'Untitled report'}
            report={result}
            ensureSaved={async () => {
              // Only a project that was kept (2026-11-06): the id was returned
              // even when the save failed, and a share named a project the
              // account did not hold.
              if (!openReportId.current || !savedReports.some((r) => r.id === openReportId.current)) {
                if (!(await persistProject(true))) return null;
              }
              return openReportId.current;
            }}
            onSignIn={() => {
              setIsShareOpen(false);
              navigate('/login');
            }}
            onNotice={setSaveNotice}
            onFailure={(err, path, message) => reportFirestoreFailure(err, OperationType.WRITE, path, message)}
            onClose={() => setIsShareOpen(false)}
          />
        </Suspense>
      )}
      {isConfigOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            config={config}
            onChange={(changes) => setConfig((prev) => ({ ...prev, ...changes }))}
            user={user ? { uid: user.uid } : null}
            workedOut={detectedRef.current?.reasons ?? null}
            start={configStart}
            onExportProjects={exportAllProjects}
            onClose={() => {
              setIsConfigOpen(false);
              setConfigStart(undefined);
            }}
          />
        </Suspense>
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
                    onClick={() => {
                      setFullScreenImage(null);
                      setOcrReview(uploadId);
                    }}
                    title="See the text read on this page, and build a report from it"
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
