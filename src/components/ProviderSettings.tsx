/**
 * Which AI designs a report: the provider setup the owner asked for on
 * 2026-11-02, in the manner of Hermes Agent (docs/proposals/own-model.md,
 * milestone 3). Lives in the settings dialog, loaded only when it opens.
 *
 * Five choices, all free to use:
 * - Automatic: Gemini when a key is in, Forma Offline otherwise.
 * - Forma Offline: Forma's own model and OCR, no key and no quota.
 * - Gemini: with the key below.
 * - Local AI: Ollama or LM Studio on this computer.
 * - OpenRouter: its free models, with a key of the user's own.
 * For a local server or OpenRouter, "Find models" asks the server what it
 * offers, and a model that reads images is listed first.
 */
import { useState } from 'react';
import { IconAlert, IconCheck } from './landing/icons';
import { aiReady, DEFAULT_LOCAL_URL, OPENROUTER_URL, PROVIDER_NAMES, PROVIDERS, type AiProvider } from '../lib/aiProvider';
import type { ReportConfig } from '../services/geminiService';

const NOTES: Record<AiProvider, string> = {
  auto: 'Gemini when a key is in below, Forma Offline otherwise.',
  offline: "Forma's own model designs from your words, and OCR builds from an image's text. No key, no quota, nothing leaves the browser.",
  gemini: 'Google Gemini with your own free key, below.',
  local: 'Ollama or LM Studio on this computer: free, unlimited and private. Choose a model that reads images to design from pictures.',
  openrouter: "OpenRouter's free models, with a key of your own. Free models have daily limits, and their providers may log requests.",
};

export interface ProviderSettingsProps {
  config: ReportConfig;
  onChange: (changes: Partial<ReportConfig>) => void;
}

export default function ProviderSettings({ config, onChange }: ProviderSettingsProps) {
  const provider = (config.provider ?? 'auto') as AiProvider;
  const [models, setModels] = useState<{ id: string; vision: boolean }[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const find = async () => {
    setFinding(true);
    setNote(null);
    try {
      const { listModels } = await import('../services/compatClient');
      const found =
        provider === 'local'
          ? await listModels({ kind: 'local', baseUrl: (config.localUrl || DEFAULT_LOCAL_URL).replace(/\/+$/, '') })
          : await listModels({ kind: 'openrouter', baseUrl: OPENROUTER_URL, apiKey: config.openRouterKey?.trim() });
      setModels(found);
      setNote(found.length ? `${found.length} model${found.length === 1 ? '' : 's'} found${found.some((m) => m.vision) ? ', those that read images first' : ''}.` : 'No models found.');
    } catch (err) {
      setModels(null);
      setNote(
        provider === 'local'
          ? `Could not reach ${config.localUrl || DEFAULT_LOCAL_URL}. Is the server running, and does it allow this site? For Ollama set OLLAMA_ORIGINS to this address; in LM Studio turn on CORS. (${err instanceof Error ? err.message : String(err)})`
          : `Could not list OpenRouter's models: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFinding(false);
    }
  };

  const modelField = (value: string | undefined, set: (v: string) => void, id: string) => (
    <div>
      <label className="wb-lbl" htmlFor={id}>
        Model
      </label>
      <div className="wb-keyrow">
        {models?.length ? (
          <span className="wb-sel">
            <select className="wb-ctl" id={id} value={value || ''} onChange={(e) => set(e.target.value)}>
              <option value="">Choose a model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.vision ? ' (reads images)' : ''}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <input className="wb-ctl" id={id} type="text" placeholder={provider === 'local' ? 'e.g. qwen2.5vl:7b' : 'e.g. a model ending :free'} value={value || ''} onChange={(e) => set(e.target.value)} autoComplete="off" spellCheck={false} />
        )}
        <button className="wb-pill wb-pill--outline" onClick={find} disabled={finding || (provider === 'openrouter' && !config.openRouterKey?.trim())}>
          {finding ? 'Finding…' : provider === 'openrouter' ? 'Find free models' : 'Find models'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="wb-fset">
      <div className="wb-eyebrow">
        <b>ai</b>AI provider<span className="wb-fade" />
      </div>
      <div role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((p) => (
          <label key={p} className="wb-checkrow" style={{ alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="ai-provider"
              checked={provider === p}
              onChange={() => {
                onChange({ provider: p });
                setModels(null);
                setNote(null);
              }}
            />
            <span>
              <b>{PROVIDER_NAMES[p]}</b>
              {provider === p && <span style={{ display: 'block', opacity: 0.75, fontSize: '0.92em' }}>{NOTES[p]}</span>}
            </span>
          </label>
        ))}
      </div>

      {provider === 'local' && (
        <>
          <div>
            <label className="wb-lbl" htmlFor="cfg-local-url">
              Server address
            </label>
            <input className="wb-ctl" id="cfg-local-url" type="text" value={config.localUrl || DEFAULT_LOCAL_URL} onChange={(e) => onChange({ localUrl: e.target.value })} autoComplete="off" spellCheck={false} />
          </div>
          {modelField(config.localModel, (v) => onChange({ localModel: v }), 'cfg-local-model')}
        </>
      )}

      {provider === 'openrouter' && (
        <>
          <div>
            <label className="wb-lbl" htmlFor="cfg-or-key">
              OpenRouter key
            </label>
            {/* Not in a form, for the reason the Gemini key field gives: a
                password manager offering to save it would undo keeping it off disk. */}
            <input
              className="wb-ctl"
              id="cfg-or-key"
              type="password"
              placeholder="sk-or-…"
              value={config.openRouterKey || ''}
              onChange={(e) => onChange({ openRouterKey: e.target.value })}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {modelField(config.openRouterModel, (v) => onChange({ openRouterModel: v }), 'cfg-or-model')}
        </>
      )}

      {note && (
        <div className="wb-note-line" role="status"><span className="wb-ic"><IconAlert size={13} /></span><span>
          {note}
        </span></div>
      )}
      {(provider === 'local' || provider === 'openrouter') && (
        <div className={`wb-note-line ${aiReady(config) ? 'wb-ok' : 'wb-warn'}`}>
          <span className="wb-ic">{aiReady(config) ? <IconCheck size={13} /> : <IconAlert size={13} />}</span>
          <span>{aiReady(config) ? `${PROVIDER_NAMES[provider]} is ready.` : `${PROVIDER_NAMES[provider]} needs ${provider === 'openrouter' && !config.openRouterKey?.trim() ? 'a key and ' : ''}a model.`}</span>
        </div>
      )}
    </div>
  );
}
