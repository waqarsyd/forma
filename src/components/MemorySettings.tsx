/**
 * What Forma remembers, in Settings (2026-11-02, milestone 4 of
 * docs/proposals/own-model.md): every memory, to switch off, change or
 * forget, and what the reports the user kept have taught it. Loaded with the
 * dialog. Everything shown lives in this browser only (lib/memory.ts).
 */
import { useState } from 'react';
import { IconKey } from './landing/icons';
import { hintsOf, keptSummary, memoryFrom, readMemory, writeMemory, type MemoryState } from '../lib/memory';

export default function MemorySettings() {
  const [state, setState] = useState<MemoryState>(() => readMemory());
  const [draft, setDraft] = useState('');
  const save = (next: MemoryState) => {
    setState(next);
    writeMemory(next);
  };
  const kept = keptSummary(state);

  return (
    <div className="wb-fset">
      <div className="wb-eyebrow">
        <b>mem</b>Memory<span className="wb-fade" />
      </div>
      <div className="wb-note-line"><span className="wb-ic"><IconKey size={13} /></span><span>
        What Forma remembers about how you work. Tell it in the chat ("remember: always use A4"), or add one here. It stays in this browser.
      </span></div>

      {state.memories.length === 0 && <div className="wb-note-line"><span className="wb-ic"><IconKey size={13} /></span><span>Nothing remembered yet.</span></div>}
      {state.memories.map((m) => (
        <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            aria-label={m.enabled ? 'Use this memory' : 'This memory is off'}
            checked={m.enabled}
            onChange={(e) => save({ ...state, memories: state.memories.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)) })}
          />
          <input
            className="wb-ctl"
            type="text"
            aria-label="Memory"
            value={m.text}
            onChange={(e) => save({ ...state, memories: state.memories.map((x) => (x.id === m.id ? { ...x, text: e.target.value, hints: hintsOf(e.target.value) } : x)) })}
          />
          <button className="wb-pill" onClick={() => save({ ...state, memories: state.memories.filter((x) => x.id !== m.id) })}>
            Forget
          </button>
        </div>
      ))}

      <div className="wb-keyrow">
        <input
          className="wb-ctl"
          type="text"
          placeholder="e.g. Always use A4 and Tahoma"
          aria-label="A new memory"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim()) {
              save({ ...state, memories: [...state.memories, memoryFrom(draft, 'settings')] });
              setDraft('');
            }
          }}
        />
        <button
          className="wb-pill wb-pill--outline"
          disabled={!draft.trim()}
          onClick={() => {
            save({ ...state, memories: [...state.memories, memoryFrom(draft, 'settings')] });
            setDraft('');
          }}
        >
          Remember
        </button>
      </div>

      <label className="wb-checkrow">
        <input type="checkbox" checked={state.learnFromKept} onChange={(e) => save({ ...state, learnFromKept: e.target.checked })} />
        Learn the style of reports I keep (export or save)
      </label>
      <div className="wb-note-line"><span className="wb-ic"><IconKey size={13} /></span><span>
        {kept
          ? `Learned from ${kept.reports} kept reports: ${kept.paper}${kept.landscape ? ' landscape' : ''}, ${kept.fontFamily}${Object.keys(kept.sizes ?? {}).length ? `; ${Object.entries(kept.sizes ?? {}).map(([role, pt]) => `${role}s ${pt}pt`).join(', ')}` : ''}.`
          : state.kept.length
            ? `${state.kept.length} kept report${state.kept.length === 1 ? '' : 's'} so far; Forma learns a style from two.`
            : 'No kept reports yet.'}
      </span></div>
      {(state.memories.length > 0 || state.kept.length > 0) && (
        <div className="wb-keyrow">
          {state.kept.length > 0 && (
            <button className="wb-pill" onClick={() => save({ ...state, kept: [] })}>
              Forget kept reports
            </button>
          )}
          <button className="wb-pill" onClick={() => save({ memories: [], kept: [], learnFromKept: state.learnFromKept })}>
            Forget everything
          </button>
        </div>
      )}
    </div>
  );
}
