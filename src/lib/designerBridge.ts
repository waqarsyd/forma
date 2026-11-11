/**
 * Talks to Forma Designer (tools/RepxDesigner, called "the companion" in the
 * code), the Windows app that opens a generated report in the DevExpress
 * designer. It listens on loopback.
 *
 * **The Open in designer dialog asks when it is clicked, and at no other
 * time** (components/OpenInDesigner.tsx, since 2026-11-09; this comment
 * described a button App kept in its bar until the full audit of 2026-11-11,
 * SD-19). The dialog reads the browser's permission without asking, asks
 * /health, starts Forma Designer through `forma-repx://` and waits when
 * nothing answers, then hands the report over; `designerStep` below decides
 * what each state says. Every step offers Export .repx. The older sentence
 * "if nothing answers, Forma shows no button" had once been copied into the
 * public Terms, which is why a stale comment here is worth correcting rather
 * than tidying.
 *
 * **One exception since 2026-11-11 (CC-10):** once Forma Designer has answered
 * /health in this page and said it answers /inspect, each new report is put
 * through it, with the page's records (`inspectInDesigner`, below). Nothing is
 * asked before the dialog has been used, but "only when it is clicked" no
 * longer holds after it, and the Terms, the privacy policy and the Docs had
 * gone on saying "only then" (the re-audit's R4-02). They say it now
 * (LegalPage.tsx, DocsPage.tsx's designer article, legalDisclosure.test.ts),
 * so a change to when this module reaches 127.0.0.1 is a change to them.
 *
 * Export .repx remains the path that needs none of this, which is the actual
 * degradation guarantee: a Windows-and-DevExpress-only convenience bolted onto
 * a browser app that must keep working without it.
 *
 * Mirrors the shape of `isVaultAvailable()` in `keyVault.ts` — detect the
 * capability, let the UI read it, never assume it.
 */

import { DESIGNER_RELEASE, designerIsOlder } from './designerRelease';
import { inspectionRefusal } from './inspectionGuard';
import type { RepxFinding } from './repxAudit';

/** Loopback only. `--port` on the companion moves both sides; keep them equal. */
export const DESIGNER_ORIGIN = 'http://127.0.0.1:7317';

/**
 * Sent on every open request. It is deliberately *not* a CORS-safelisted
 * header: an unsafe header forces the browser to preflight, which is what lets
 * the companion reject an origin before the real request is sent. Renaming this
 * without renaming it there disables that check.
 */
export const DESIGNER_CLIENT_HEADER = 'x-forma-client';

/**
 * The filename the designer will show, derived the same way `downloadDesign`
 * derives the download name so one report does not arrive under two names.
 *
 * Sanitising here is a courtesy, not a defence — the companion re-sanitises,
 * because a value this side sends is a value an attacker could send too.
 */
/**
 * Windows resolves these as devices in **every** directory, with or without an
 * extension, so `%TEMP%\Forma\CON.repx` addresses the console rather than a
 * file. Neither sanitiser knew about them (audit BUG-002).
 */
const RESERVED_DEVICE_NAMES =
  /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Long enough to stay readable in the designer's title bar, short enough that
 * the companion's `%TEMP%\Forma\<name>.repx` cannot approach MAX_PATH.
 * `firestore.rules` permits a 256-character report name, so an untruncated one
 * produced a ~306-character path and a PathTooLongException (audit BUG-003).
 */
const MAX_STEM = 60;

export function designerFileName(title?: string): string {
  let base = (title || 'report-design').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-.]/g, '');
  if (!base) base = 'report-design';
  if (base.length > MAX_STEM) base = base.slice(0, MAX_STEM);
  // Prefixed rather than replaced, so the name a user chose is still legible.
  if (RESERVED_DEVICE_NAMES.test(base)) base = `_${base}`;
  return `${base}.repx`;
}

/*
 * There was a DESIGNER_RECHECK_GAP_MS and a shouldRecheckDesigner here, which
 * throttled the probe App sent when a report arrived and whenever the tab
 * regained focus (four bug reports had their consoles filled with
 * ERR_CONNECTION_REFUSED from it). Removed on 2026-11-09 with that probe: the
 * Open in designer dialog (components/OpenInDesigner.tsx) asks the companion
 * when it is clicked and at no other time, so nothing probes on load or focus,
 * from any page.
 */

/**
 * Forma's own website, which the companion also answers, for `/health` and
 * `/open` alone (2026-11-09, the owner's decision in the download programme).
 * Kept equal to `SiteOrigins` in tools/RepxDesigner/Program.cs by a test. A
 * preview channel is not on the list: its address changes with each preview.
 */
export const DESIGNER_SITE_ORIGINS = ['https://openforma.web.app', 'https://forma-201ba.web.app'] as const;

/**
 * A page served from this PC: npm run dev, npm start. The only one the
 * companion's `/sql/` routes answer (Phase 2 of the SQL Server programme),
 * so `companionReachableFrom` in sqlCompanion.ts is this, not the wider
 * `designerReachableFrom`.
 *
 * Any port, as /open accepts. Since 2026-11-11 (SE-05) the `/sql/` routes
 * answer only ports 3000 and 3001 and those Forma Designer was started with
 * `--page-port N`, which a page cannot ask about: a refusal there reaches the
 * page as no answer at all (no CORS header), so `COMPANION_PAGE_PORTS` in
 * sqlCompanion.ts says it where the Data tab reports one.
 */
export function designerLocalOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
const isLocalOrigin = designerLocalOrigin;

/**
 * Whether the page can reach the companion at all. Until 2026-11-09 only a
 * page served from this PC could (site audit item 95, `IsAllowedOrigin` in the
 * companion); since then Forma's website can too, for opening a report. Any
 * other origin, a preview channel included, is refused by the companion, so
 * such a page never asks.
 */
export function designerReachableFrom(origin: string): boolean {
  return isLocalOrigin(origin) || (DESIGNER_SITE_ORIGINS as readonly string[]).includes(origin);
}

export type LoopbackPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * What the browser will do with a request to 127.0.0.1 from this page, without
 * sending one: granted, denied (the visitor blocked it, and only the site's
 * settings undo that), prompt (it will ask), or unknown (a browser with no such
 * permission, which simply sends it). Chrome named the permission
 * `local-network-access` until 145 split it, loopback becoming
 * `loopback-network`; both are asked, the newer first.
 */
export async function loopbackPermission(): Promise<LoopbackPermission> {
  const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions;
  if (!permissions?.query) return 'unknown';
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      const status = await permissions.query({ name } as unknown as PermissionDescriptor);
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state;
    } catch {
      // A name this browser does not know: try the next.
    }
  }
  return 'unknown';
}

/**
 * The fetch options every request to the companion carries: Chrome's hint that
 * the target is on this machine, which lets it ask the right question up front
 * instead of failing the request (developer.chrome.com, Local Network Access).
 * A browser that does not know the field ignores it.
 */
const LOOPBACK_FETCH = { targetAddressSpace: 'loopback' } as unknown as RequestInit;

/**
 * Is the companion running? Resolves false rather than throwing — a refused
 * connection is the normal case for anyone who has not installed it.
 *
 * The timeout matters: an unanswered loopback port fails fast, but a firewall
 * that drops rather than refuses would otherwise leave this pending for as long
 * as the tab is open.
 */
export async function pingDesigner(timeoutMs = 1200): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${DESIGNER_ORIGIN}/health`, {
      ...LOOPBACK_FETCH,
      method: 'GET',
      signal: controller.signal,
    });
    if (response.ok) answered = true;
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * There was a `probeDesigner` here that also read `designerVersion` out of the
 * health body, and a `designerVersionWarning` that told the user when the
 * report targeted a newer DevExpress than the installed designer. Both were
 * removed on 2026-09-06, the day after they were added, because the thing they
 * warned about does not happen: `RepxProbe inspect` loaded a generated 24.1
 * report through the installed 20.1 assemblies with nothing lost, and the
 * loader rewrote the tag to 20.1.3.0 on save.
 *
 * The companion still reports its version on /health, and that is worth
 * keeping -- but nothing consumes it, so nothing here reads it. If a real
 * version hazard is ever found, it will be about a specific control the older
 * assembly lacks, and that is what the warning should name. See
 * *SerializerVersion is a label, not a gate* in docs/notes/gemini.md.
 */

/**
 * The URL scheme `RepxDesigner.exe --register` writes under HKCU. Renaming it
 * here without renaming `Scheme` in `Program.cs` breaks the launch silently —
 * an unregistered scheme does not error, it simply does nothing.
 */
export const DESIGNER_PROTOCOL = 'forma-repx';

/**
 * Ask Windows to start the companion.
 *
 * This is the *only* way a web page may cause a local program to run, and it is
 * gated on purpose: the browser asks the user to confirm the first time, with an
 * "Always allow" box. Nothing here can tell whether it worked — an unregistered
 * scheme, a declined prompt and a successful launch are indistinguishable from
 * script — which is why the caller must follow this with `waitForDesigner()`
 * and treat a timeout as failure.
 *
 * `location.href` rather than a hidden iframe: Chromium blocks protocol launches
 * from iframes, and assigning to `href` for an external scheme does not navigate
 * the page away, so the workspace and its unsaved state survive.
 */
export function launchDesigner(): void {
  try {
    window.location.href = `${DESIGNER_PROTOCOL}://serve`;
  } catch {
    /* a blocked or unknown scheme is not an error we can see or act on */
  }
}

/**
 * Poll until the companion answers, or give up. Used after `launchDesigner()`:
 * a cold start has to load the DevExpress assemblies before it binds the port,
 * which is slow enough that a single ping straight after the launch always
 * fails.
 */
export async function waitForDesigner(timeoutMs = 12000, everyMs = 400): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingDesigner(600)) return true;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return false;
}

/**
 * How long to wait for the companion to accept a report.
 *
 * Much longer than `pingDesigner`'s 1200ms, and for a different reason: a bound
 * port answers a health check instantly, whereas accepting a report means
 * writing a temp file and handing it to the designer. A budget copied from the
 * ping would abort work that was about to succeed.
 */
const SEND_TIMEOUT_MS = 15000;

/**
 * Hand the XML to the companion, which writes it to a temp file and opens the
 * designer on it. Resolves once the companion has accepted the report — not
 * when the designer closes, since that dialog is modal and can stay open for as
 * long as the user is editing.
 *
 * The timeout is not optional. A refused connection rejects on its own and
 * always did, but a companion that accepts the socket and then stops answering
 * — a modal dialog already open, a mid-crash, a debugger holding it — leaves
 * this pending indefinitely, and the user is left having clicked *Open in
 * designer* with no result and no error. That was the state until the
 * 2026-08-27 audit (REL-002); `pingDesigner` had guarded itself against the
 * same failure since it was written.
 */
export async function sendToDesigner(repxContent: string, fileName: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${DESIGNER_ORIGIN}/open`, {
      ...LOOPBACK_FETCH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        [DESIGNER_CLIENT_HEADER]: '1',
        'x-forma-filename': fileName,
      },
      body: repxContent,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    // Distinguish "it never answered" from "it could not be reached": the first
    // means the companion is running and stuck, and the remedy is to look at
    // it; the second means it stopped between /health and /open. Both in the
    // product's name and plain words (2026-11-11, the full audit, SD-18): the
    // dialog showed "The designer companion did not respond within 15
    // seconds" and, for the second, the browser's own "Failed to fetch".
    if ((error as { name?: string } | null)?.name === 'AbortError') throw new Error(DESIGNER_STUCK);
    throw new Error(DESIGNER_GONE);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The status stays on the error for designerStep (424: no DevExpress); the words carry none.
    throw new DesignerRefused(response.status, DESIGNER_REFUSED);
  }
}

/** Forma Designer accepted the connection and then said nothing: a dialog of its own is the usual cause. */
const DESIGNER_STUCK = 'Forma Designer did not answer. If a window of it is open, close it and try again.';
/** It answered /health a moment before and could not be reached for the report. */
export const DESIGNER_GONE = 'Forma Designer stopped answering before it took the report. Start it from the Start menu, then try again.';
/** It answered, and refused the report. */
const DESIGNER_REFUSED = 'Forma Designer could not open this report.';

/** A refusal by the companion, with its status: 424 says there is no DevExpress to open it in. */
export class DesignerRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DesignerRefused';
    this.status = status;
  }
}

/* ------------------------------------------------------------------ *
 * The Open in designer dialog (2026-11-09, the owner's download
 * programme, batch WF): what is missing, said plainly, with the way to
 * get it. The steps are decided here, as a pure function of what was
 * found, and components/OpenInDesigner.tsx only draws them.
 * ------------------------------------------------------------------ */

/** What the companion says on /health, read from either shape it has had. */
export interface DesignerHealth {
  /** Forma Designer's own version, or null from a companion older than 2026-11-09. */
  version: string | null;
  /** The DevExpress it runs on, or null when none it can use is installed. */
  devexpress: { version: string; build: string | null } | null;
  /** Every DevExpress version it found, newest first. */
  found: string[];
  /** The oldest DevExpress it runs on. */
  oldest: string;
  /** It answers /inspect and /render (2026-11-11, CC-10); absent from every release before. */
  inspects?: true;
}

/**
 * Reads /health. A companion from before 2026-11-09 answers only
 * `{"app":"RepxDesigner","designerVersion":"20.1.3.0"}`: it was compiled
 * against 20.1 and could not have started without it, so that is the
 * DevExpress it has.
 */
export function readDesignerHealth(body: unknown): DesignerHealth | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.app !== 'RepxDesigner') return null;
  const dx = b.devexpress && typeof b.devexpress === 'object' ? (b.devexpress as Record<string, unknown>) : null;
  const legacy = !('devexpress' in b) && typeof b.designerVersion === 'string';
  const devexpress =
    dx && typeof dx.version === 'string'
      ? { version: dx.version, build: typeof dx.build === 'string' ? dx.build : null }
      : legacy
        ? { version: (b.designerVersion as string).split('.').slice(0, 2).join('.'), build: null }
        : null;
  return {
    version: typeof b.version === 'string' ? b.version : null,
    devexpress,
    found: Array.isArray(b.found) ? b.found.filter((v): v is string => typeof v === 'string') : devexpress ? [devexpress.version] : [],
    oldest: typeof b.oldest === 'string' ? b.oldest : '20.1',
    ...(b.inspects === true ? { inspects: true as const } : {}),
  };
}

/**
 * How long to wait for /health, by what the browser will do with the request
 * (2026-11-11, the full audit, SD-08). Chrome holds a loopback request while
 * it asks whether this site may reach apps on the device, so 1.5 s, right
 * for an answer or a refused connection, cut off anyone who read the question
 * before answering it: the dialog then started Forma Designer, which the
 * browser asked about a second time, and called it not installed. While the
 * browser will ask, the wait is long enough to read and answer.
 */
const HEALTH_WAIT_MS = 1500;
const PROMPT_WAIT_MS = 30_000;
export function healthTimeout(permission: LoopbackPermission): number {
  return permission === 'prompt' ? PROMPT_WAIT_MS : HEALTH_WAIT_MS;
}

/** Asks the companion who it is; null when nothing answers, as pingDesigner. */
export async function askDesigner(timeoutMs = HEALTH_WAIT_MS): Promise<DesignerHealth | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DESIGNER_ORIGIN}/health`, { ...LOOPBACK_FETCH, method: 'GET', signal: controller.signal });
    const health = response.ok ? readDesignerHealth(await response.json()) : null;
    if (health) {
      answered = true;
      inspects = health.inspects === true;
    }
    return health;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether this browser runs on Windows: true, false, or null when it does not
 * say. The designer is Windows only; a Mac is told so instead of being sent
 * after a Windows download. null is treated as Windows, and the dialog offers
 * "try anyway" when it says no, for a browser that hides its platform.
 */
export function onWindows(nav: { userAgent?: string; userAgentData?: { platform?: string } } | undefined = typeof navigator === 'undefined' ? undefined : (navigator as never)): boolean | null {
  const platform = nav?.userAgentData?.platform;
  if (platform) return /windows/i.test(platform);
  const agent = nav?.userAgent ?? '';
  if (/Windows/i.test(agent)) return true;
  if (/Macintosh|Mac OS X|Linux|Android|iPhone|iPad|CrOS/i.test(agent)) return false;
  return null;
}

export type DesignerStep =
  | { kind: 'checking' }
  | { kind: 'starting' }
  | { kind: 'sending' }
  /** A page the companion does not answer: a preview channel, a copy hosted elsewhere. */
  | { kind: 'unreachable' }
  | { kind: 'not-windows' }
  /** The browser was told not to let this site reach apps on the PC. */
  | { kind: 'blocked' }
  /** Nothing answered, even after asking Windows to start it. */
  | { kind: 'no-companion' }
  /** It answered, and has no DevExpress it can run on; `found` names any too old. */
  | { kind: 'no-devexpress'; found: string[]; oldest: string }
  /** Handed over; `newer` is the download's version when it is newer than this one's. */
  | { kind: 'opened'; version: string | null; newer: string | null }
  | { kind: 'error'; message: string };

/** What the dialog has found so far. */
export interface DesignerFacts {
  origin: string;
  /** onWindows(), or true once the person chose "try anyway". */
  windows: boolean | null;
  permission: LoopbackPermission;
  /** undefined: not asked yet; null: nothing answered. */
  health: DesignerHealth | null | undefined;
  /** Whether a forma-repx:// launch was tried and waited out. */
  started: boolean;
  /** undefined: not sent yet. */
  sent?: { ok: true } | { ok: false; status?: number; message: string };
  /** The download's version, for "a newer Forma Designer". */
  latest?: string;
}

/** The step to show for what has been found: one place, tested case by case. */
export function designerStep(f: DesignerFacts): DesignerStep {
  if (!designerReachableFrom(f.origin)) return { kind: 'unreachable' };
  if (f.windows === false) return { kind: 'not-windows' };
  if (f.permission === 'denied') return { kind: 'blocked' };
  if (f.health === undefined) return { kind: 'checking' };
  if (f.health === null) return f.started ? { kind: 'no-companion' } : { kind: 'starting' };
  if (!f.health.devexpress) return { kind: 'no-devexpress', found: f.health.found, oldest: f.health.oldest };
  if (!f.sent) return { kind: 'sending' };
  if (f.sent.ok) {
    const latest = f.latest ?? DESIGNER_RELEASE.version;
    // A companion from before 2026-11-09 reports no version, and is older than any download.
    const older = f.health.version === null || designerIsOlder(f.health.version, latest);
    return { kind: 'opened', version: f.health.version, newer: older ? latest : null };
  }
  if (f.sent.status === 424) return { kind: 'no-devexpress', found: f.health.found, oldest: f.health.oldest };
  return { kind: 'error', message: f.sent.message };
}

/* ------------------------------------------------------------------ *
 * The installed DevExpress asked what it makes of a report (2026-11-11,
 * the full audit's CC-10): Forma Designer's read-only /inspect and
 * /render (tools/RepxDesigner/Probe.cs). Every rule Forma checks a report
 * by was learned by putting files through DevExpress by hand, and the last
 * one (Margins must be four whole numbers) was found by chance, nine
 * probes deep; a person running Forma Designer has the real loader on
 * their PC, so it is asked after a generation instead.
 *
 * Asked only once Forma Designer has answered in this page, from the Open
 * in designer dialog: nothing knocks on 127.0.0.1 unasked, which would
 * fill the console of everyone without it with refused connections (the
 * probe removed on 2026-11-09, above) and could put the browser's
 * question about reaching apps on the PC in front of someone who never
 * started Forma Designer. The public copy says the same, in plain words:
 * after one Open in designer, each new report and the page's records go to
 * Forma Designer on the PC, and nowhere else (the re-audit's R4-02, the
 * header above).
 * ------------------------------------------------------------------ */

/** Whether Forma Designer has answered in this page. */
let answered = false;
/**
 * Whether the one that answered /health said it has /inspect. Every Forma
 * Designer released before 2026-11-11 (1.0.0, in the 1.4.x zips) has not:
 * from the website its preflight is refused, so asking it anyway cost each
 * generation after an Open in designer one certain failure and a CORS error
 * in the console. Only askDesigner reads the body that says so.
 */
let inspects = false;

/** Whether a generation may ask Forma Designer about its report: only once one that can has answered here. */
export function designerAnswered(): boolean {
  return answered && inspects;
}

/** What DevExpress made of a report. */
export interface DesignerInspection {
  /** Controls and bands the file declares that DevExpress did not build, by name. */
  lost: string[];
  /** The report's attributes DevExpress did not keep as written, with what it uses instead. */
  dropped: { attribute: string; declared: string; loaded: string | null }[];
  /** The margins DevExpress prints with, left, right, top, bottom; null when it did not say. */
  margins: number[] | null;
  /** The pages DevExpress printed with the records sent; null when it did not print. */
  pages: number | null;
}

const numbers = (v: unknown): number[] | null => (Array.isArray(v) && v.every((n) => typeof n === 'number') ? (v as number[]) : null);

/** /inspect's and /render's answers as one; null when /inspect said nothing readable. */
export function readInspection(inspect: unknown, render: unknown): DesignerInspection | null {
  if (!inspect || typeof inspect !== 'object') return null;
  const i = inspect as Record<string, unknown>;
  if (!Array.isArray(i.lost) || !Array.isArray(i.dropped)) return null;
  const r = render && typeof render === 'object' ? (render as Record<string, unknown>) : {};
  return {
    lost: i.lost.filter((n): n is string => typeof n === 'string'),
    dropped: i.dropped.flatMap((d) => {
      const o = d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
      return o && typeof o.attribute === 'string' && typeof o.declared === 'string'
        ? [{ attribute: o.attribute, declared: o.declared, loaded: typeof o.loaded === 'string' ? o.loaded : null }]
        : [];
    }),
    margins: numbers(r.margins) ?? numbers(i.margins),
    pages: typeof r.pages === 'number' ? r.pages : null,
  };
}

/** How long DevExpress has to load and print a report: it loads its assemblies on the first. */
const INSPECT_TIMEOUT_MS = 20_000;

/**
 * Forma Designer's account of a report, printed with `rows` (the page's own
 * records, each value as text); null when it has not answered in this page,
 * or does not answer now, or answers something unreadable. A connection it
 * refuses stops the asking until it answers again.
 */
export async function inspectInDesigner(
  repxContent: string,
  rows: readonly Readonly<Record<string, string>>[] | null,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DesignerInspection | null> {
  if (!designerAnswered() || typeof fetch === 'undefined' || !repxContent) return null;
  // A type or a file outside the report is not handed to DevExpress unasked
  // (2026-11-11, the re-audit's R5-03, lib/inspectionGuard.ts): asked here as
  // well as in Forma Designer, so an older one without the check is spared it.
  const refused = inspectionRefusal(repxContent);
  if (refused) {
    console.info(`Forma Designer was not asked about this report: ${refused}.`);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? INSPECT_TIMEOUT_MS);
  const stop = () => controller.abort();
  options.signal?.addEventListener('abort', stop, { once: true });
  const post = async (route: string, type: string, body: string) => {
    const response = await fetch(`${DESIGNER_ORIGIN}${route}`, {
      ...LOOPBACK_FETCH,
      method: 'POST',
      headers: { 'Content-Type': type, [DESIGNER_CLIENT_HEADER]: '1' },
      body,
      signal: controller.signal,
    });
    // A body that is not JSON is an unreadable answer, not Forma Designer gone:
    // left to throw, its SyntaxError would stop the asking as a refusal does.
    return response.ok ? ((await response.json().catch(() => null)) as unknown) : null;
  };
  try {
    const inspect = await post('/inspect', 'application/xml', repxContent);
    if (!inspect) return null;
    // With no records from the page there is no page count to hold the print
    // to, and the second load would be time spent for nothing; /inspect's
    // margins stand. (The reply no longer waits for any of this: since
    // 2026-11-11 App asks once the report is on screen, `inspect` in
    // geminiService.ts.)
    const render = rows?.length
      ? await post('/render', 'application/json', JSON.stringify({ repx: repxContent, rows })).catch(() => null)
      : null;
    return readInspection(inspect, render);
  } catch (error: unknown) {
    // Not running any more (a refused connection, not a timeout): ask again only once it answers.
    if ((error as { name?: string } | null)?.name !== 'AbortError') answered = false;
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
}

/*
 * What DevExpress found in the reports Forma made in this page, by the text
 * of each (2026-11-11, the full audit's PERF batch). The generation asks once
 * the report is on screen (`inspect` in geminiService.ts) instead of before
 * the reply, and the REPX pane shows what comes back, for that file only:
 * an edit makes another file, which was not asked about. The last few only.
 */
const INSPECTIONS_KEPT = 4;
const inspections = new Map<string, RepxFinding[]>();
const inspectionListeners = new Set<() => void>();

/** Keep what DevExpress found in `repxContent`, and tell whoever is showing it. */
export function keepInspection(repxContent: string, findings: RepxFinding[]): void {
  inspections.delete(repxContent);
  inspections.set(repxContent, findings);
  for (const key of inspections.keys()) if (inspections.size > INSPECTIONS_KEPT) inspections.delete(key);
  for (const listener of inspectionListeners) listener();
}

/** What DevExpress found in exactly this file, when it was asked. */
export function inspectionOf(repxContent: string): readonly RepxFinding[] {
  return inspections.get(repxContent) ?? [];
}

/** Called whenever an inspection is kept; the function returned stops it. */
export function onInspection(listener: () => void): () => void {
  inspectionListeners.add(listener);
  return () => inspectionListeners.delete(listener);
}

/**
 * Forgets every kept inspection, for a test (2026-11-11, the full audit's
 * cleanup after the PERF batch): the map lives as long as the module, so what
 * one test kept was still there, under the same file, for the next. The page
 * never calls it; a reload is its reset.
 */
export function forgetInspectionsForTests(): void {
  inspections.clear();
}

/** The attributes' own names, as a person reads them. */
const ATTRIBUTE_WORDS: Record<string, string> = {
  Margins: 'margins',
  PaperKind: 'paper',
  PageWidth: 'page width',
  PageHeight: 'page height',
  Landscape: 'orientation',
  ReportUnit: 'unit',
};

/**
 * What DevExpress made of a report, said plainly, beside the print's own
 * findings: a part it could not build (an error), the report's settings it
 * did not keep as written (a warning), and more pages than the page shows
 * when it printed the page's records (an error), each of which the report
 * would show when it is opened there.
 */
export function inspectionFindings(seen: DesignerInspection, options: { pagesShown?: number } = {}): RepxFinding[] {
  const out: RepxFinding[] = [];
  if (seen.lost.length) {
    const named = `${seen.lost.slice(0, 4).join(', ')}${seen.lost.length > 4 ? ', ...' : ''}`;
    out.push({
      severity: 'error',
      code: 'designer-lost-controls',
      message: `DevExpress could not build ${seen.lost.length === 1 ? 'one part' : `${seen.lost.length} parts`} of the report (${named}), so ${seen.lost.length === 1 ? 'it is' : 'they are'} missing when it opens.`,
    });
  }
  if (seen.dropped.length) {
    const said = seen.dropped.map((d) => `the ${ATTRIBUTE_WORDS[d.attribute] ?? d.attribute} as ${d.declared}${d.loaded !== null ? ` (it uses ${d.loaded})` : ''}`);
    out.push({ severity: 'warning', code: 'designer-dropped', message: `DevExpress did not keep ${said.join(', ')}.` });
  }
  if (options.pagesShown && seen.pages !== null && seen.pages > options.pagesShown) {
    out.push({
      severity: 'error',
      code: 'designer-extra-pages',
      message: `Printed in DevExpress with the page's records, the report runs to ${seen.pages} pages where the page has ${options.pagesShown}.`,
    });
  }
  return out;
}
