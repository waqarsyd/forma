/* ------------------------------------------------------------------ *
 * REPX source viewer
 *
 * Moved out of App.tsx on 2026-11-06 and loaded lazily, so the entry chunk
 * does not carry a pane only an open report shows; the text below moved with
 * it unchanged.
 *
 * The "Specs & REPX" tab used to render only the markdown specification, so
 * the XML that Forma actually produces could never be inspected before it was
 * downloaded — a malformed report only revealed itself once DevExpress refused
 * to open it. This shows the real thing, checks that it parses, and lets it be
 * copied straight into the designer.
 * ------------------------------------------------------------------ */
import { useMemo, useState } from 'react';
import { formatXml, tokenizeXml, checkRepx } from '../lib/repx';
import type { RepxAudit } from '../lib/repxAudit';
import { unitsPerInch } from '../lib/reportGeometry';
import { IconAlert, IconCheck, IconCheckCircle, IconCopy, IconWarn } from './landing/icons';

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

export default RepxViewer;
