/**
 * Forma's memory (2026-11-02, milestone 4 of docs/proposals/own-model.md).
 *
 * The owner asked for the memory Hermes Agent has: the app remembers how its
 * user works and gets better at it. Here, local-first and free:
 * - **What the user tells it.** A message such as "remember: always use A4"
 *   or "from now on use Tahoma" is kept as a memory, not sent to a model.
 * - **What their reports show.** Each report they keep, by exporting or
 *   saving it, leaves its style: paper, orientation, face, and the size of
 *   titles, captions and values. Never its words; this is the skeleton's
 *   rule (reportSkeleton.ts) applied to their own reports.
 * Both are used on the next report. Forma's own model takes the paper, the
 * orientation, the face and the sizes as its preferences. An AI provider is
 * told them as the user's standing preferences, ahead of the request.
 *
 * Everything is in this browser's localStorage, and the Memory section of
 * Settings shows each memory, to switch off, change or forget.
 */
import { parseReportStructure } from './reportPreview';
import { skeletonOf } from './reportSkeleton';
import { learnStyle } from './formaModel';

/** What Forma's own model can apply from a memory. */
export interface MemoryHints {
  paper?: string;
  landscape?: boolean;
  fontFamily?: string;
  /** Points, by the role a text plays. */
  sizes?: Partial<Record<'title' | 'caption' | 'value' | 'total', number>>;
}

export interface Memory {
  id: string;
  /** What it says, as shown in Settings and as an AI is told it. */
  text: string;
  source: 'chat' | 'settings';
  created: string;
  enabled: boolean;
  hints: MemoryHints;
}

/** The style one kept report leaves: no word of it. */
export interface KeptStyle {
  at: string;
  paper: string;
  landscape: boolean;
  fontFamily: string;
  sizes: Partial<Record<'title' | 'caption' | 'value' | 'total', number>>;
}

export interface MemoryState {
  memories: Memory[];
  kept: KeptStyle[];
  /** Whether what kept reports show is used; the memories each have their own switch. */
  learnFromKept: boolean;
}

const STORAGE_KEY = 'forma.memory';
/** Enough reports to know a house style, few enough to follow it as it changes. */
export const MAX_KEPT = 30;

const EMPTY: MemoryState = { memories: [], kept: [], learnFromKept: true };

export function readMemory(): MemoryState {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<MemoryState> | null;
    if (!s) return { ...EMPTY };
    return {
      memories: Array.isArray(s.memories) ? s.memories : [],
      kept: Array.isArray(s.kept) ? s.kept : [],
      learnFromKept: s.learnFromKept !== false,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeMemory(state: MemoryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled or full: memory holds for this session only */
  }
}

/** A message that asks Forma to remember something, rather than to design. */
export const REMEMBER = /^\s*(please\s+)?(remember(\s+that)?|always|from now on|never|i\s+(always\s+)?prefer|by default|note that)\b[\s:,-]*/i;

const PAPERS = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Executive'];
const FAMILIES = ['Arial', 'Tahoma', 'Verdana', 'Calibri', 'Segoe UI', 'Times New Roman', 'Georgia', 'Courier New', 'Microsoft Sans Serif', 'DIN Pro', 'Helvetica'];

/** The hints in a memory's words: a paper, an orientation, a face, sizes by role. */
export function hintsOf(text: string): MemoryHints {
  const hints: MemoryHints = {};
  const paper = PAPERS.find((p) => new RegExp(`\\b${p}\\b`, 'i').test(text));
  if (paper) hints.paper = paper;
  if (/\blandscape\b/i.test(text)) hints.landscape = true;
  else if (/\bportrait\b/i.test(text)) hints.landscape = false;
  const family = FAMILIES.find((f) => new RegExp(`\\b${f}\\b`, 'i').test(text));
  if (family) hints.fontFamily = family;
  const sizes: MemoryHints['sizes'] = {};
  for (const role of ['title', 'caption', 'value', 'total'] as const) {
    const words = { title: 'titles?|headings?', caption: 'captions?|labels?|column headings?', value: 'values?|data|body|text', total: 'totals?' }[role];
    const m = new RegExp(`(?:${words})[^.\\d]{0,20}?(\\d{1,2}(?:\\.\\d+)?)\\s*(?:pt|point)`, 'i').exec(text) ?? new RegExp(`(\\d{1,2}(?:\\.\\d+)?)\\s*(?:pt|point)s?\\s+(?:${words})`, 'i').exec(text);
    if (m) sizes[role] = Number(m[1]);
  }
  if (Object.keys(sizes).length) hints.sizes = sizes;
  return hints;
}

/** A memory from a message: the words after "remember", capitalised. */
export function memoryFrom(message: string, source: Memory['source'] = 'chat', now = new Date()): Memory {
  const rest = message.replace(REMEMBER, '').trim().replace(/[.!]+$/, '');
  const lead = /^(always|never)\b/i.exec(message.trim())?.[1];
  const text = (lead && !/^(always|never)\b/i.test(rest) ? `${lead} ${rest}` : rest) || message.trim();
  return {
    id: `m${now.getTime().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    source,
    created: now.toISOString(),
    enabled: true,
    hints: hintsOf(message),
  };
}

/** What the thread says when a memory is kept. */
export function rememberedReply(m: Memory): string {
  const applied = [
    m.hints.paper && `${m.hints.paper} paper`,
    m.hints.landscape !== undefined && (m.hints.landscape ? 'landscape' : 'portrait'),
    m.hints.fontFamily,
    ...Object.entries(m.hints.sizes ?? {}).map(([role, pt]) => `${pt}pt ${role}s`),
  ].filter(Boolean);
  return (
    `I'll remember that: "${m.text}". ` +
    (applied.length ? `Forma's own model will apply ${applied.join(', ')} from now on, and ` : 'From now on ') +
    'any AI you use is told it before each report. See or change your memories in Settings, under Memory.'
  );
}

/** The style a kept report leaves, or null when it cannot be read. */
export function keptStyleOf(repx: string, now = new Date()): KeptStyle | null {
  try {
    const skeleton = skeletonOf(parseReportStructure(repx));
    if (!skeleton.bands.length) return null;
    const style = learnStyle([skeleton]);
    const sizes: KeptStyle['sizes'] = {};
    for (const role of ['title', 'caption', 'value', 'total'] as const) if (style.roles[role]) sizes[role] = style.roles[role]!.size;
    return { at: now.toISOString(), paper: skeleton.paper, landscape: skeleton.landscape, fontFamily: style.fonts[0]?.family ?? 'Arial', sizes };
  } catch {
    return null;
  }
}

/** Keep a report's style, the newest MAX_KEPT. */
export function rememberKept(state: MemoryState, style: KeptStyle): MemoryState {
  return { ...state, kept: [...state.kept, style].slice(-MAX_KEPT) };
}

const most = <T>(xs: T[]): T | undefined => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const medianOf = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : undefined);

/** What the kept reports show, by majority and median; null with fewer than two. */
export function keptSummary(state: MemoryState): (MemoryHints & { reports: number }) | null {
  if (!state.learnFromKept || state.kept.length < 2) return null;
  const sizes: MemoryHints['sizes'] = {};
  for (const role of ['title', 'caption', 'value', 'total'] as const) {
    const m = medianOf(state.kept.flatMap((k) => (k.sizes[role] ? [k.sizes[role]!] : [])));
    if (m) sizes[role] = m;
  }
  return { reports: state.kept.length, paper: most(state.kept.map((k) => k.paper)), landscape: most(state.kept.map((k) => k.landscape)), fontFamily: most(state.kept.map((k) => k.fontFamily)), sizes };
}

/**
 * What Forma's own model applies: what the kept reports show, then every
 * memory switched on, the newest last, so what the user said wins over what
 * their reports show and a later word over an earlier one.
 */
export function preferencesOf(state: MemoryState): MemoryHints {
  const out: MemoryHints = {};
  const apply = (h: MemoryHints) => {
    if (h.paper && h.paper !== 'Custom') out.paper = h.paper;
    if (h.landscape !== undefined) out.landscape = h.landscape;
    if (h.fontFamily) out.fontFamily = h.fontFamily;
    if (h.sizes) out.sizes = { ...out.sizes, ...h.sizes };
  };
  const kept = keptSummary(state);
  if (kept) apply(kept);
  for (const m of state.memories) if (m.enabled) apply(m.hints);
  return out;
}

/** What an AI provider is told: the user's standing preferences, or '' when there are none. */
export function instructionsOf(state: MemoryState): string {
  const lines = state.memories.filter((m) => m.enabled).map((m) => `- ${m.text}`);
  const kept = keptSummary(state);
  if (kept) {
    const sizes = Object.entries(kept.sizes ?? {}).map(([role, pt]) => `${role}s ${pt}pt`).join(', ');
    lines.push(`- Their ${kept.reports} kept reports use ${kept.paper}${kept.landscape ? ' landscape' : ''} paper and ${kept.fontFamily}${sizes ? `: ${sizes}` : ''}.`);
  }
  return lines.length ? `THE USER'S REMEMBERED PREFERENCES (apply them unless this request says otherwise):\n${lines.join('\n')}` : '';
}
