/**
 * Talks to RepxDesigner, the local companion that opens a generated report in
 * the DevExpress designer.
 *
 * A browser cannot start a program unaided, so the "Open in designer" button
 * first asks whether something is already running on the machine.
 * `tools/RepxDesigner` listens on loopback.
 *
 * **The probe decides what a click does, not whether the button is drawn.**
 * This comment said "if nothing answers, Forma shows no button and Export is
 * the whole story", and that stopped being true when `launchDesigner()` was
 * added: `App.tsx` keeps the button in the bar always and says so at
 * `designerReady`, because requiring someone to remember a tray app before a
 * one-click action works is most of the reason the button went unused. A
 * running companion is handed the report; a silent port gets a
 * `forma-repx://` launch and a wait. Worth correcting rather than tidying —
 * the stale sentence had been copied into the public Terms, where it told
 * visitors the button would stay hidden (fixed 2026-09-08).
 *
 * Export .repx remains the path that needs none of this, which is the actual
 * degradation guarantee: a Windows-and-DevExpress-only convenience bolted onto
 * a browser app that must keep working without it.
 *
 * Mirrors the shape of `isVaultAvailable()` in `keyVault.ts` — detect the
 * capability, let the UI read it, never assume it.
 */

import { DESIGNER_RELEASE, designerIsOlder } from './designerRelease';

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
export const LOOPBACK_FETCH = { targetAddressSpace: 'loopback' } as unknown as RequestInit;

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
  } catch (error: any) {
    // Distinguish "it never answered" from "it could not be reached": the first
    // means the companion is running and stuck, and the remedy is to look at
    // it; the second means it is not running at all.
    if (error?.name === 'AbortError') {
      throw new Error(
        `The designer companion did not respond within ${SEND_TIMEOUT_MS / 1000} seconds. ` +
          'It may be waiting on a dialog — check the RepxDesigner window.'
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new DesignerRefused(response.status, `The designer companion refused the report (HTTP ${response.status}).`);
  }
}

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
  };
}

/** Asks the companion who it is; null when nothing answers, as pingDesigner. */
export async function askDesigner(timeoutMs = 1500): Promise<DesignerHealth | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DESIGNER_ORIGIN}/health`, { ...LOOPBACK_FETCH, method: 'GET', signal: controller.signal });
    return response.ok ? readDesignerHealth(await response.json()) : null;
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
