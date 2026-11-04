/**
 * The languages OCR reads besides English, in Settings (2026-11-04,
 * lib/ocrLanguages.ts). Loaded with the dialog, like ProviderSettings.
 *
 * English is always read and is not offered as a choice: a report in Arabic
 * or Hindi still carries English codes, totals and page numbers. Each
 * language chosen is fetched the first time OCR runs with it, from this site,
 * and the line under the boxes says how much that is, since a chosen language
 * slows every reading a little whether the page holds it or not.
 */
import { OCR_LANGUAGES, validOcrLanguages, type OcrLanguage } from '../lib/ocrLanguages';
import type { ReportConfig } from '../services/geminiService';

export interface OcrSettingsProps {
  config: ReportConfig;
  onChange: (changes: Partial<ReportConfig>) => void;
}

/** Each language's data, in megabytes, as the build serves it (check-bundle-size.mjs). */
const SIZE_MB: Record<OcrLanguage, number> = { ara: 1.7, hin: 1.4, urd: 1.0, fra: 0.7, deu: 1.3, spa: 2.1 };

export default function OcrSettings({ config, onChange }: OcrSettingsProps) {
  const chosen = validOcrLanguages(config.ocrLanguages ?? []);
  const toggle = (code: OcrLanguage, on: boolean) => {
    const next = on ? [...chosen, code] : chosen.filter((c) => c !== code);
    onChange({ ocrLanguages: validOcrLanguages(next) });
  };
  const extra = chosen.reduce((t, c) => t + SIZE_MB[c], 0);
  return (
    <div className="wb-fset">
      <div className="wb-eyebrow"><b>ocr</b>Text in pictures<span className="wb-fade" /></div>
      <p className="wb-hint">OCR always reads English. Add the languages your scans and screenshots are written in.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px 12px' }}>
        {OCR_LANGUAGES.map((l) => (
          <label key={l.code} className="wb-checkrow">
            <input type="checkbox" checked={chosen.includes(l.code)} onChange={(e) => toggle(l.code, e.target.checked)} />
            {l.name}
          </label>
        ))}
      </div>
      {chosen.length > 0 && (
        <p className="wb-hint" role="status">
          {`${extra.toFixed(1)} MB more the first time OCR runs, kept by the browser after; each language makes every reading a little slower.`}
        </p>
      )}
    </div>
  );
}
