/**
 * Text onto the clipboard, with a fallback for a page that is not a secure
 * context (plain HTTP on a LAN address), where `navigator.clipboard` is
 * absent. RepxViewer's Copy XML had it; the Preview's "Copy the name" did
 * not, and on plain HTTP did nothing and said nothing (2026-11-06, the
 * workspace audit). One copy now, for both. True when the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
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
