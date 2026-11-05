/**
 * The box's model menu as named tiers (2026-11-05), as Google Stitch names
 * its two ("Speed", "Balanced"), each with one line saying which Gemini model
 * is behind it. The owner approved Auto, Fast and Balanced in the Stitch
 * study: Auto is Forma's detection, as before; Fast is the first Flash-Lite
 * the key answered for, and Balanced the first Flash, in the order the probe
 * prefers them (`readCachedModelSet`). A tier the key has no model for is not
 * offered. Imported by `Composer.tsx` only, which is loaded on demand, so the
 * entry chunk does not carry it.
 */

export type Tier = 'fast' | 'balanced';

export interface TierChoice {
  tier: Tier;
  id: string;
  /** Requests sent to it from this browser today. */
  used: number;
  label: string;
  /** The model behind it and what it is for, one line. */
  note: string;
}

/** A model's id as a person reads it: "gemini-3.6-flash" is "Gemini 3.6 Flash". */
export function displayModel(id: string): string {
  const bare = id.replace(/^models\//, '').replace(/^gemini-/, '');
  const latest = /-latest$/.test(bare);
  const words = bare
    .replace(/-latest$/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
  return `Gemini ${words.join(' ').replace('Flash Lite', 'Flash-Lite')}${latest ? ' (latest)' : ''}`;
}

/** Families that make no report, whatever their name says. */
const NOT_TEXT = /image|tts|audio|live|embedding|native/;

/** The tiers this key can offer, Fast then Balanced, from the models it answered for. */
export function modelTiers(choices: ReadonlyArray<{ id: string; used: number }>): TierChoice[] {
  const usable = choices.filter((c) => /flash/.test(c.id) && !NOT_TEXT.test(c.id));
  const fast = usable.find((c) => /flash-lite/.test(c.id));
  const balanced = usable.find((c) => !/lite/.test(c.id));
  const tiers: TierChoice[] = [];
  if (fast) tiers.push({ tier: 'fast', id: fast.id, used: fast.used, label: 'Fast', note: `${displayModel(fast.id)}. Quick answers and edits.` });
  if (balanced) tiers.push({ tier: 'balanced', id: balanced.id, used: balanced.used, label: 'Balanced', note: `${displayModel(balanced.id)}. New reports and redesigns.` });
  return tiers;
}
