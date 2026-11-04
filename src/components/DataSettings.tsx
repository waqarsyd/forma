/**
 * Right to left and the stored procedure, in Settings (2026-11-04). The
 * generation prompt honoured both before anything in the UI set them, which
 * the PRD listed as "supported by the engine but not yet exposed". Loaded
 * with the settings dialog, like ProviderSettings.
 *
 * - **Right to left** is also written into reports Forma makes with no model
 *   (lib/repxRtl.ts), so the checkbox means the same with or without a key.
 * - **The stored procedure** names where the data comes from; the prompt says
 *   so to the model.
 *
 * The third item that sentence listed, a data schema, is deliberately not
 * here: it left this dialog for the **Data** tab, because a schema belongs
 * beside the report it binds, not in a modal shared with the API key
 * (README, *Roadmap*). The group says where it went.
 */
import { MAX_SP_NAME } from '../lib/reportConfigStore';
import type { ReportConfig } from '../services/geminiService';

export interface DataSettingsProps {
  config: ReportConfig;
  onChange: (changes: Partial<ReportConfig>) => void;
}

export default function DataSettings({ config, onChange }: DataSettingsProps) {
  return (
    <div className="wb-fset">
      <div className="wb-eyebrow"><b>data</b>Direction and data source<span className="wb-fade" /></div>
      <label className="wb-checkrow">
        <input type="checkbox" checked={!!config.rtl} onChange={(e) => onChange({ rtl: e.target.checked })} />
        Right to left (Arabic, Urdu, Persian, Hebrew)
      </label>
      <div>
        <label className="wb-lbl" htmlFor="cfg-sp">Stored procedure</label>
        <input
          className="wb-ctl"
          id="cfg-sp"
          type="text"
          maxLength={MAX_SP_NAME}
          placeholder="e.g., dbo.GetMonthlySales"
          value={config.spName || ''}
          onChange={(e) => onChange({ spName: e.target.value })}
        />
        <p className="wb-hint">The fields themselves are pasted in the Data tab, beside the report they bind.</p>
      </div>
    </div>
  );
}
