/**
 * Talks to RepxDesigner, the local companion that opens a generated report in
 * the DevExpress designer.
 *
 * A browser cannot start a program, and it should not be able to — so the
 * "Open in designer" button works by asking something already running on the
 * machine. `tools/RepxDesigner` listens on loopback; if nothing answers, Forma
 * shows no button and Export is the whole story. That degradation is the point:
 * this is a Windows-and-DevExpress-only convenience bolted onto a browser app
 * that must keep working without it.
 *
 * Mirrors the shape of `isVaultAvailable()` in `keyVault.ts` — detect the
 * capability, gate the UI on it, never assume it.
 */

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
export function designerFileName(title?: string): string {
  const base = (title || 'report-design').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-.]/g, '');
  return `${base || 'report-design'}.repx`;
}

/**
 * Is the companion running? Resolves false rather than throwing — a refused
 * connection is the normal case for anyone who has not installed it.
 *
 * The timeout matters: an unanswered loopback port fails fast, but a firewall
 * that drops rather than refuses would otherwise leave this pending and the
 * button missing for as long as the tab is open.
 */
export async function pingDesigner(timeoutMs = 1200): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${DESIGNER_ORIGIN}/health`, {
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
    throw new Error(`The designer companion refused the report (HTTP ${response.status}).`);
  }
}
