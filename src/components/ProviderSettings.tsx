/**
 * Which AI designs a report: the provider setup the owner asked for on
 * 2026-11-02, in the manner of Hermes Agent (docs/proposals/own-model.md,
 * milestone 3). The AI section of Settings (SettingsDialog.tsx), loaded only
 * when it opens.
 *
 * Three choices, all free to use, since the owner merged Automatic and Forma
 * Offline on 2026-11-05 and made an AI the entry point to any work:
 * - Automatic: Gemini, with the key in the Gemini key section.
 * - Local AI: Ollama or LM Studio on this computer.
 * - OpenRouter: its free models, with a key of the user's own.
 * For a local server or OpenRouter, "Find models" asks the server what it
 * offers, and a model that reads images is listed first. Below them,
 * Forma's vision model can be named as a helper to any of them
 * (2026-11-03, lib/formaTeam.ts).
 *
 * The three are a segmented control since the redesign of 2026-11-07, as the
 * theme is in the corner's "?" menu; they were radio buttons in a column.
 *
 * Since 2026-11-10 (the AI accuracy programme, batch AF): Local AI suggests a
 * writer and a page reader for the computer's memory, filled in with one click
 * (lib/localModels.ts); the page reader is a helper beside Forma's vision
 * model; and OpenRouter says what a free model's provider may do with what is
 * sent, and where the account decides which providers it may reach.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconAlert, IconCheck } from './landing/icons';
import { aiReady, DEFAULT_LOCAL_URL, isVisionOnly, OPENROUTER_URL, PROVIDER_NAMES, PROVIDERS, type AiProvider } from '../lib/aiProvider';
import { presetPair, pullCommands } from '../lib/localModels';
import type { ReportConfig } from '../services/geminiService';

const NOTES: Record<AiProvider, string> = {
  auto: 'Google Gemini with your own free key. Forma starts once a key is in.',
  local: 'Ollama or LM Studio on this computer: free, unlimited and private. Choose a model that reads images to design from pictures.',
  openrouter: "OpenRouter's free models, with a key of your own. Free models have a limit a minute and a day; when one is reached, another AI you set up answers.",
};

export interface ProviderSettingsProps {
  config: ReportConfig;
  onChange: (changes: Partial<ReportConfig>) => void;
  /** Open the Gemini key section, which Forma needs whichever AI designs. */
  onKey: () => void;
}

export default function ProviderSettings({ config, onChange, onKey }: ProviderSettingsProps) {
  const provider = (config.provider ?? 'auto') as AiProvider;
  const [models, setModels] = useState<{ id: string; vision: boolean }[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // A list belongs to the provider it was found for (2026-11-06, the
  // workspace audit): Local AI's models, found while OpenRouter was chosen,
  // were listed under OpenRouter with their note.
  const providerNow = useRef(provider);
  providerNow.current = provider;
  useEffect(() => {
    setModels(null);
    setNote(null);
  }, [provider]);

  const choose = (p: AiProvider) => {
    onChange({ provider: p });
    setModels(null);
    setNote(null);
  };
  // A radio group's keys: the arrows move the choice and the focus with it.
  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const next = (PROVIDERS.indexOf(provider) + by + PROVIDERS.length) % PROVIDERS.length;
    choose(PROVIDERS[next]);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  const find = async () => {
    const asked = provider;
    setFinding(true);
    setNote(null);
    try {
      const { listModels } = await import('../services/compatClient');
      const found =
        asked === 'local'
          ? await listModels({ kind: 'local', baseUrl: (config.localUrl || DEFAULT_LOCAL_URL).replace(/\/+$/, '') })
          : await listModels({ kind: 'openrouter', baseUrl: OPENROUTER_URL, apiKey: config.openRouterKey?.trim() });
      if (providerNow.current !== asked) return;
      setModels(found);
      setNote(found.length ? `${found.length} model${found.length === 1 ? '' : 's'} found${found.some((m) => m.vision) ? ', those that read images first' : ''}.` : 'No models found.');
    } catch (err) {
      if (providerNow.current !== asked) return;
      setModels(null);
      setNote(
        asked === 'local'
          ? `Could not reach ${config.localUrl || DEFAULT_LOCAL_URL}. Is the server running, and does it allow this site? For Ollama set OLLAMA_ORIGINS to this address; in LM Studio turn on CORS. (${err instanceof Error ? err.message : String(err)})`
          : `Could not list OpenRouter's models: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFinding(false);
    }
  };

  const modelField = (value: string | undefined, set: (v: string) => void, id: string) => (
    <div className="wb-set-row is-stack">
      <div className="wb-set-text">
        <label className="wb-set-label" htmlFor={id}>Model</label>
        <p>{provider === 'openrouter' ? 'Find free models lists the ones your key can use.' : 'Find models lists what the server has, those that read images first.'}</p>
      </div>
      <div className="wb-set-field">
        {models?.length ? (
          <select className="wb-set-input" id={id} value={value || ''} onChange={(e) => set(e.target.value)}>
            <option value="">Choose a model</option>
            {/* The model already chosen stays chosen when the list lacks it (2026-11-06). */}
            {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.vision ? ' (reads images)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <input className="wb-set-input" id={id} type="text" placeholder={provider === 'local' ? 'e.g. qwen3.5:9b' : 'e.g. google/gemma-4-31b-it:free'} value={value || ''} onChange={(e) => set(e.target.value)} autoComplete="off" spellCheck={false} />
        )}
        <button type="button" className="wb-pill wb-pill--outline" onClick={find} disabled={finding || (provider === 'openrouter' && !config.openRouterKey?.trim())}>
          {finding ? 'Finding…' : provider === 'openrouter' ? 'Find free models' : 'Find models'}
        </button>
      </div>
      {note && (
        <p className="wb-set-note" role="status">
          <IconAlert size={13} />
          <span>{note}</span>
        </p>
      )}
    </div>
  );

  return (
    <>
      <div className="wb-set-row is-stack">
        <div className="wb-set-text">
          <span className="wb-set-label" id="wb-set-provider">AI provider</span>
          <p>{NOTES[provider]}</p>
        </div>
        <div className="wb-set-seg" role="radiogroup" aria-labelledby="wb-set-provider" onKeyDown={step}>
          {PROVIDERS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={provider === p} tabIndex={provider === p ? 0 : -1} onClick={() => choose(p)}>
              {PROVIDER_NAMES[p]}
            </button>
          ))}
        </div>
        {(provider === 'local' || provider === 'openrouter') && (
          <p className={`wb-set-note ${aiReady(config) ? 'is-ok' : 'is-bad'}`}>
            {aiReady(config) ? <IconCheck size={13} /> : <IconAlert size={13} />}
            <span>
              {aiReady(config)
                ? `${PROVIDER_NAMES[provider]} is ready.`
                : `${PROVIDER_NAMES[provider]} needs ${provider === 'openrouter' && !config.openRouterKey?.trim() ? 'a key and ' : ''}a model.`}
            </span>
          </p>
        )}
        {/* The Gemini key opens the workspace whichever AI designs (2026-11-05),
            so choosing another one does not let anyone past it. */}
        {provider !== 'auto' && !config.customApiKey?.trim() && (
          <p className="wb-set-note is-bad">
            <IconAlert size={13} />
            <span>
              Forma also needs your Gemini key to start.{' '}
              <button type="button" className="wb-set-link" onClick={onKey}>Add it</button>
            </span>
          </p>
        )}
      </div>

      {provider === 'local' && (
        <>
          <div className="wb-set-row is-stack">
            <div className="wb-set-text">
              <label className="wb-set-label" htmlFor="cfg-local-url">Server address</label>
              <p>Ollama answers at port 11434, LM Studio at 1234.</p>
              {/* Ollama's default context drops the head of a long request without a word (agent audit item 18). */}
              <p>A report request is long: start Ollama with <code>OLLAMA_CONTEXT_LENGTH=32768</code>, or load the model in LM Studio with a context of 32,768, or the model reads only its end.</p>
            </div>
            <input className="wb-set-input" id="cfg-local-url" type="text" value={config.localUrl || DEFAULT_LOCAL_URL} onChange={(e) => onChange({ localUrl: e.target.value })} autoComplete="off" spellCheck={false} />
          </div>
          {modelField(config.localModel, (v) => onChange({ localModel: v }), 'cfg-local-model')}
          <div className="wb-set-row is-stack">
            <div className="wb-set-text">
              <span className="wb-set-label" id="wb-set-presets">Suggested for this computer</span>
              <p>A model that writes reports and reads pictures, and a page reader that reads a picture's text beside Forma's own. Fetch them with Ollama, then choose the pair for the memory this computer has.</p>
            </div>
            <ul className="wb-set-presets" aria-labelledby="wb-set-presets">
              {(['8 GB', '16 GB or more'] as const).map((memory) => {
                const pair = presetPair(memory);
                const chosen = config.localModel === pair.writer.model && config.pageReader === pair.reader.model;
                return (
                  <li key={memory}>
                    <span>
                      <span>
                        <b>{memory} of memory</b>: {pair.writer.model} ({pair.writer.download}) and {pair.reader.model} ({pair.reader.download})
                      </span>
                      <code>{pullCommands(pair)}</code>
                    </span>
                    <button type="button" className="wb-pill wb-pill--outline" onClick={() => onChange({ localModel: pair.writer.model, pageReader: pair.reader.model })} disabled={chosen}>
                      {chosen ? 'In use' : 'Use these'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {provider === 'openrouter' && (
        <>
          <div className="wb-set-row is-stack">
            <div className="wb-set-text">
              <label className="wb-set-label" htmlFor="cfg-or-key">OpenRouter key</label>
              <p>Held for this tab only, like the Gemini key.</p>
            </div>
            {/* Not in a form, for the reason the Gemini key field gives: a
                password manager offering to save it would undo keeping it off disk. */}
            <input
              className="wb-set-input"
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
          {/* The data terms (2026-11-10, batch AF item 19): who may keep what is sent. */}
          <div className="wb-set-row is-stack">
            <div className="wb-set-text">
              <span className="wb-set-label">What a free model's provider may do</span>
              <p>
                Each free model is served by a provider of its own, and some keep what they are sent or train on it: Google AI Studio's free service, which serves the Gemma models,
                may use it to improve Google's products, and people may read it. OpenRouter sends a request only to providers your account allows, and free models have a setting of their
                own, at openrouter.ai/settings/privacy. Send nothing you would not share.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Forma's team (2026-11-03, lib/formaTeam.ts): the vision model as a
          helper beside whichever AI designs. Hidden when the AI chosen above
          is the vision model itself, which then works alone. */}
      <h4 className="wb-set-sub">Helpers on this computer</h4>
      {/* The page reader (2026-11-10, lib/localModels.ts): a second reading of a
          picture's text, beside OCR's, whichever AI designs. */}
      <div className="wb-set-row is-stack">
        <div className="wb-set-text">
          <label className="wb-set-label" htmlFor="cfg-page-reader">Page reader</label>
          <p>
            Optional. A model on Ollama or LM Studio that reads a picture&apos;s text, such as glm-ocr. Its reading goes to the AI beside the text Forma&apos;s OCR read, so a word
            the two read differently is checked against the picture. Leave it empty for none.
          </p>
        </div>
        <input
          className="wb-set-input"
          id="cfg-page-reader"
          type="text"
          placeholder="e.g. glm-ocr"
          value={config.pageReader || ''}
          onChange={(e) => onChange({ pageReader: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {!isVisionOnly(config) && (
        <>
          <div className="wb-set-row is-stack">
            <div className="wb-set-text">
              <label className="wb-set-label" htmlFor="cfg-vision-model">Forma&apos;s vision model</label>
              <p>
                Optional. Forma&apos;s own vision model, on Ollama or LM Studio on this computer, reads a picture&apos;s layout and OCR places its
                words in it. The AI above designs from that draft, and if it cannot answer, the draft is your report. Leave it empty for none.
              </p>
            </div>
            <input
              className="wb-set-input"
              id="cfg-vision-model"
              type="text"
              placeholder="e.g. forma-vision"
              value={config.visionModel || ''}
              onChange={(e) => onChange({ visionModel: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {provider !== 'local' && (
            <div className="wb-set-row is-stack">
              <div className="wb-set-text">
                <label className="wb-set-label" htmlFor="cfg-vision-url">Server address</label>
                <p>Where the helpers run.</p>
              </div>
              <input className="wb-set-input" id="cfg-vision-url" type="text" value={config.localUrl || DEFAULT_LOCAL_URL} onChange={(e) => onChange({ localUrl: e.target.value })} autoComplete="off" spellCheck={false} />
            </div>
          )}
        </>
      )}
    </>
  );
}
