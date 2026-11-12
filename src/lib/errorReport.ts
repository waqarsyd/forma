/**
 * Error reports, sent only when the person asks for them (2026-11-12, Owner
 * decision 10, the full audit's SA-15). The owner heard of breakage after a
 * deploy only when someone with a GitHub account filed an issue; a fault in
 * the Preview, a save the rules refused or a promise nobody caught stayed in
 * the visitor's console. With "Send error reports" on in Settings → General,
 * off until turned on and offered to signed-in people only, each error the
 * error boundaries catch, and each error or rejection nothing caught, becomes
 * one short document at `errors/{id}`:
 *
 * - `day`, the server's day (firestore.rules holds it to `request.time`);
 * - `version`, the release and commit (lib/buildInfo.ts);
 * - `area`, which part failed, from a fixed list (`ERROR_AREAS`, which the
 *   rules name and a test holds together);
 * - `code`, the error's code or name (`permission-denied`, `TypeError`);
 * - `message`, scrubbed of anything that could be personal and cut to 200
 *   characters (`scrubMessage`).
 *
 * No uid, no report, no words, no path of the page. The account's write
 * counts (`users/{uid}/meta/usage`) move in the same batch, as every counted
 * write does (persistence.md, *What one account may write*): at most
 * `MAX_ERRORS_A_DAY` a server day, `ERROR_SPACING_MS` apart.
 *
 * Noise is left out before anything is built (`isNoise`): an abort, a lazy
 * chunk a deploy removed (staleChunks.ts reloads for it), the browser's
 * ResizeObserver note, an error from an extension or a cross-origin script,
 * a lost connection, and a rejection that is not an Error at all. One broken
 * render throws the same error again and again, and React's development mode
 * reports each twice, so a report is made once per page for each area, code
 * and message, and at most `MAX_PER_PAGE` a page (`createErrorReporter`).
 *
 * The owner reads them with `scripts/admin/pull-errors.ts`, which saves them
 * on their own PC and deletes them from Firestore.
 */
import { BUILD, type BuildInfo } from './buildInfo';
import { isStaleChunkError } from './staleChunks';
import { setErrorSink } from './errorSink';

/** The parts of Forma an error is filed under; firestore.rules lists the same. */
export const ERROR_AREAS = ['page', 'mockup', 'preview', 'data', 'spec', 'repx', 'conversation', 'uncaught', 'rejection', 'other'] as const;
export type ErrorArea = (typeof ERROR_AREAS)[number];

/** The longest message kept, after scrubbing. */
export const MAX_MESSAGE = 200;
/** How many reports one page sends at most, whatever goes wrong on it. */
export const MAX_PER_PAGE = 5;
/** Matches firestore.rules and lib/accountData.ts: how far apart two reports from one account must be. */
export const ERROR_SPACING_MS = 10_000;

/** What the error boundaries call their areas, as the person reads them, to the area a report files them under. */
const AREA_OF: Record<string, ErrorArea> = {
  forma: 'page',
  'the mockup': 'mockup',
  'the preview': 'preview',
  'the data view': 'data',
  'the spec': 'spec',
  'the repx view': 'repx',
  'the conversation': 'conversation',
  uncaught: 'uncaught',
  rejection: 'rejection',
};

export function areaKey(area: string): ErrorArea {
  return AREA_OF[area.trim().toLowerCase()] ?? 'other';
}

/*
 * What a message may carry that is the person's rather than the code's, each
 * said as what it was. In order: a key before anything could split it, a
 * link before its address could be read as an email or a path, then quoted
 * text, which is where an error repeats its input ("…" is not valid JSON).
 */
const KEYS = /AIza[0-9A-Za-z_-]{35}|sk-or-v1-[0-9a-f]+|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g;
const LINKS = /\b(?:https?|wss?|ftp|file|blob:https?|chrome-extension|moz-extension):\/\/[^\s'"<>()]+/gi;
const EMAILS = /[^\s@<>()"'`,;:]+@[^\s@<>()"'`,;:]+\.[A-Za-z]{2,}/g;
const QUOTED = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|«[^»\n]*»|`[^`\n]*`/g;
/** A single-quoted part is code more often than not ('foo' of undefined); long or with a space, it is text. */
const SINGLE_QUOTED = /'([^'\n]{25,}|[^'\n]*\s[^'\n]*)'/g;
const WINDOWS_PATHS = /\b[A-Za-z]:\\[^\s'"<>|]*/g;
/** A word with two slashes or more in it is a path: a file's, or a document's in the database, which names an account. */
const SLASHED = /[^\s'"<>]*\/[^\s'"<>]*\/[^\s'"<>]*/g;
const FILES = /[^\s'"<>\\/]+\.(?:repx|pdf|png|jpe?g|gif|bmp|tiff?|webp|heic|svg|docx?|xlsx?|xlsm|csv|rtf|html?|txt|json|xml|zip|rdl|rdlc|frx|rpt|mdb|accdb|sql|mdf|ldf)\b/gi;
/** Six digits or more, a space, dot or dash allowed between them: an id, a phone, an account or an address. */
const LONG_NUMBERS = /\d(?:[\s.-]?\d){5,}/g;
/** A run of letters and digits long enough to be an id: an account's, a project's or a share's. */
const IDS = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b|\b[A-Za-z0-9_-]{24,}\b/g;

/** An error's message with anything that could be the person's taken out, on one line, at most MAX_MESSAGE characters. */
export function scrubMessage(text: string): string {
  const said = text
    .replace(KEYS, '(a key)')
    .replace(LINKS, (link) => {
      const origin = /^[a-z:-]+:\/\/[^/?#\s]+/i.exec(link.replace(/^blob:/i, ''))?.[0] ?? '(a link)';
      return origin.length < link.replace(/^blob:/i, '').length ? `${origin}/…` : origin;
    })
    .replace(EMAILS, '(an address)')
    .replace(QUOTED, '(text)')
    .replace(SINGLE_QUOTED, '(text)')
    .replace(WINDOWS_PATHS, '(a path)')
    .replace(SLASHED, (word) => (/^[a-z:-]+:\/\/[^/\s]+(?:\/…)?$/i.test(word) ? word : '(a path)'))
    .replace(FILES, '(a file)')
    .replace(LONG_NUMBERS, '(a number)')
    .replace(IDS, '(an id)')
    .replace(/\s+/g, ' ')
    .trim();
  if (said.length <= MAX_MESSAGE) return said;
  // Cut by characters, never inside one, to 200 in every count the rules might use.
  let chars = Array.from(said).slice(0, MAX_MESSAGE - 1);
  while (chars.join('').length > MAX_MESSAGE - 1) chars = chars.slice(0, -1);
  return `${chars.join('')}…`;
}

const CODE = /^[0-9A-Za-z/._-]{1,40}$/;
const VERSION = /^[0-9A-Za-z/._+-]{1,40}$/;

/** The error's code when it has one the rules take (Firestore's, Forma's own), else its name, else "Error". */
export function errorCode(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown } | null;
  if (e && typeof e === 'object') {
    if (typeof e.code === 'string' && CODE.test(e.code)) return e.code;
    if (typeof e.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(e.name)) return e.name;
  }
  return 'Error';
}

/** The release and commit, as `1.6.0+558d18e`; `dev` for a build that names neither. */
export function versionTag(build: BuildInfo | null = BUILD): string {
  if (!build) return 'dev';
  const commit = /^[0-9a-f]{7,40}$/.test(build.commit) ? build.commit.slice(0, 7) : '';
  const tag = [build.version, commit].filter(Boolean).join('+') || 'dev';
  return VERSION.test(tag) ? tag : 'dev';
}

const messageOf = (error: unknown): string => {
  if (typeof error === 'string') return error;
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
};

/** Whether an error is not worth a report: see the module's comment. */
export function isNoise(area: ErrorArea, error: unknown): boolean {
  if (error === null || error === undefined) return true;
  const isErrorLike = typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string';
  // A rejection with a string, a number or nothing in it says nothing a report could use.
  if (area === 'rejection' && !isErrorLike) return true;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return true;
  if (isStaleChunkError(error)) return true;
  const message = messageOf(error);
  const stack = String((error as { stack?: unknown }).stack ?? '');
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/^Script error\.?$/i.test(message.trim())) return true;
  if (/(?:chrome|moz|safari|safari-web)-extension:\/\//i.test(`${message}\n${stack}`)) return true;
  // A lost connection, for what nothing caught; inside an area it is that area's fault to show.
  if ((area === 'uncaught' || area === 'rejection') && (/^(?:Failed to fetch|Load failed|NetworkError\b)/i.test(message) || (error as { code?: unknown }).code === 'unavailable')) return true;
  return false;
}

/** One report, as the account writes it: the id it is filed under and the five fields the rules take. */
export interface ErrorReport {
  id: string;
  day: string;
  version: string;
  area: ErrorArea;
  code: string;
  message: string;
}

/** An id the rules take, as Firestore's own are: twenty letters and digits. */
export function errorReportId(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 20 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

/** The report an error makes, or null when it is noise. The day is set again as it is sent. */
export function errorReportOf(area: string, error: unknown, now = new Date(), build: BuildInfo | null = BUILD): ErrorReport | null {
  const key = areaKey(area);
  if (isNoise(key, error)) return null;
  return {
    id: errorReportId(),
    day: now.toISOString().slice(0, 10),
    version: versionTag(build),
    area: key,
    code: errorCode(error),
    message: scrubMessage(messageOf(error)) || '(no message)',
  };
}

/**
 * A sink for lib/errorSink.ts: each error made a report, once per page for
 * its area, code and message, at most `maxPerPage` a page, sent one at a time
 * `spacingMs` apart, as the rules require. A send that fails is dropped: an
 * error report is never worth a retry loop.
 */
export function createErrorReporter(
  send: (report: ErrorReport) => Promise<void>,
  o: { maxPerPage?: number; spacingMs?: number; now?: () => number; wait?: (ms: number) => Promise<void> } = {},
): (area: string, error: unknown) => void {
  const maxPerPage = o.maxPerPage ?? MAX_PER_PAGE;
  const spacing = o.spacingMs ?? ERROR_SPACING_MS;
  const now = o.now ?? Date.now;
  const wait = o.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const seen = new Set<string>();
  let queued = 0;
  let last = -Infinity;
  let chain: Promise<void> = Promise.resolve();
  return (area, error) => {
    const report = errorReportOf(area, error);
    if (!report) return;
    const key = `${report.area}|${report.code}|${report.message}`;
    if (seen.has(key) || queued >= maxPerPage) return;
    seen.add(key);
    queued++;
    chain = chain.then(async () => {
      const due = last + spacing - now();
      if (due > 0) await wait(due);
      last = now();
      await send({ ...report, day: new Date(now()).toISOString().slice(0, 10) }).catch(() => undefined);
    });
  };
}

/* ---- The switch, and who it belongs to ---- */

/**
 * The switch as this browser keeps it: on, and for which account. Another
 * account's "on" is not read, so the next person to sign in here sends
 * nothing until they turn it on themselves. Off by default.
 */
const ERROR_REPORTS_KEY = 'forma:errorReports';

export function readErrorReporting(uid: string | null, storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  if (!uid) return false;
  try {
    const raw = storage?.getItem(ERROR_REPORTS_KEY);
    const kept = raw ? (JSON.parse(raw) as { uid?: unknown; on?: unknown }) : null;
    return !!kept && kept.uid === uid && kept.on === true;
  } catch {
    return false;
  }
}

export function writeErrorReporting(uid: string, on: boolean, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(ERROR_REPORTS_KEY, JSON.stringify({ uid, on }));
  } catch {
    /* storage refused: nothing is sent */
  }
  refreshErrorReports();
}

/** Who may send, and how: set by the workspace on sign-in, null signed out, unverified or in mock mode. */
let account: { uid: string; send: (report: ErrorReport) => Promise<void> } | null = null;

/** The workspace's account, or null; reporting starts when its switch is on and stops when not. */
export function startErrorReports(next: { uid: string; send: (report: ErrorReport) => Promise<void> } | null): void {
  account = next;
  refreshErrorReports();
}

/** The sink set or cleared, as the account and its switch now say. */
export function refreshErrorReports(): void {
  if (account && readErrorReporting(account.uid)) setErrorSink(createErrorReporter(account.send));
  else setErrorSink(null);
}
