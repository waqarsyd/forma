/**
 * Forma's memory (2026-11-02, milestone 4 of docs/proposals/own-model.md).
 *
 * The owner asked for the memory Hermes Agent has: the app remembers how its
 * user works and gets better at it. Here, local-first and free:
 * - **What the user tells it.** A message such as "remember: always use A4"
 *   or "from now on use Tahoma" is kept as a memory, not sent to a model.
 *   Only those two openings (2026-11-07, the owner's rule): "always", "never"
 *   and the rest go to the agent, which applies them to the open report.
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
 *
 * Kept per account since 2026-11-11 (the full audit's WS-28, LM-18, SA-07 and
 * SE-17): `forma.memory:<uid>` for whoever is signed in, and `forma.memory`,
 * the one key there was until then, for use signed out. On a shared computer
 * the next person to sign in was told the last one's "remember" lines and kept
 * style, and so was their AI on every request. App names the account with
 * `setMemoryAccount` as it signs in and out; a caller that knows it may pass it.
 * The signed-out key is not moved into an account on sign-in: whose it was
 * cannot be known.
 */
import { parseReportStructure } from './reportPreview';
import { skeletonOf } from './reportSkeleton';
import { learnStyle } from './formaModel';
import { REMEMBER } from './chatTurn';

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
  /**
   * Which report it is (2026-11-11, the full audit's LM-28): its project's id,
   * or a hash of its skeleton when it has no project. Keeping one report five
   * times counted it five times until then, and two are enough to make a style.
   * Absent on a style kept before the key.
   */
  key?: string;
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

/** Who is signed in, whose memory a read or write without one reaches; null signed out. */
let account: string | null = null;

/** Names the account signed in, or null on signing out. */
export function setMemoryAccount(uid: string | null): void {
  account = uid || null;
}

/** Where an account's memory is kept: its own key, or the signed-out one. */
export function memoryKey(uid: string | null = account): string {
  return uid ? `${STORAGE_KEY}:${uid}` : STORAGE_KEY;
}

/** Set once the signed-out memory has been cleared of what came from before it was per account. */
const RETIRED_KEY = 'forma.memoryRetired';

/**
 * Clears `forma.memory` once, at the first sign-out after a signed-in
 * session (2026-11-11, the full audit, a wave-4 follow-up). Until the memory
 * was kept per account, everyone wrote that one key, signed in or out, so on
 * a shared browser it may still hold an account's "remember" lines and kept
 * style; now that it is the signed-out memory, the next person to use Forma
 * signed out would be read them. Whose they were cannot be known, so they go,
 * once: what is kept signed out after that stays. True when it cleared.
 */
export function retireLegacyMemory(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(RETIRED_KEY)) return false;
    storage.removeItem(STORAGE_KEY);
    storage.setItem(RETIRED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function readMemory(uid: string | null = account): MemoryState {
  try {
    const s = JSON.parse(localStorage.getItem(memoryKey(uid)) || 'null') as Partial<MemoryState> | null;
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

export function writeMemory(state: MemoryState, uid: string | null = account): void {
  try {
    localStorage.setItem(memoryKey(uid), JSON.stringify(state));
  } catch {
    /* storage disabled or full: memory holds for this session only */
  }
}

/** A message that asks Forma to remember something; the one copy is lib/chatTurn.ts (2026-11-07). */
export { REMEMBER };

const PAPERS = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Executive'];
const FAMILIES = ['Arial', 'Tahoma', 'Verdana', 'Calibri', 'Segoe UI', 'Times New Roman', 'Georgia', 'Courier New', 'Microsoft Sans Serif', 'DIN Pro', 'Helvetica'];

/** Words that turn what follows them in the same clause into what is not wanted. */
const NEGATION = /\b(not|never|no|don't|dont|do not|avoid|without|instead of|rather than|other than|except|but not)\b/i;

/**
 * Where each of `names` is said in `text`, and whether it is said as not
 * wanted (2026-11-07, agent audit item 14): a negation earlier in its clause
 * ("never use Letter", "Tahoma instead of Arial"). The clause starts after
 * the last full stop, comma, semicolon, colon or "but" before the name.
 */
function mentions(text: string, names: readonly string[]): { name: string; at: number; negated: boolean }[] {
  const found: { name: string; at: number; negated: boolean }[] = [];
  for (const name of names) {
    const re = new RegExp(`\\b${name}\\b`, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const before = text.slice(0, m.index);
      const cut = Math.max(before.search(/[.,;:][^.,;:]*$/), ...[...before.matchAll(/\bbut\b/gi)].map((b) => (b.index ?? -1) + 3));
      found.push({ name, at: m.index, negated: NEGATION.test(before.slice(cut + 1)) });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** The first of `names` said as wanted, or undefined. */
const firstWanted = (text: string, names: readonly string[]) => mentions(text, names).find((m) => !m.negated)?.name;

/**
 * The hints in a memory's words: a paper, an orientation, a face, sizes by
 * role. A name said as not wanted is not a hint ("never use Letter" asks for
 * no paper; "Tahoma instead of Arial" is Tahoma), and of two wanted the first
 * said wins. "Never landscape" is portrait, and "never portrait" landscape.
 * Until 2026-11-07 the first name in Forma's own list won, wherever it stood.
 */
export function hintsOf(text: string): MemoryHints {
  const hints: MemoryHints = {};
  const paper = firstWanted(text, PAPERS);
  if (paper) hints.paper = PAPERS.find((p) => p.toLowerCase() === paper.toLowerCase());
  const turn = mentions(text, ['landscape', 'portrait'])[0];
  if (turn) hints.landscape = (turn.name.toLowerCase() === 'landscape') !== turn.negated;
  const family = firstWanted(text, FAMILIES);
  if (family) hints.fontFamily = FAMILIES.find((f) => f.toLowerCase() === family.toLowerCase());
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
  const text = message.replace(REMEMBER, '').trim().replace(/[.!]+$/, '') || message.trim();
  return {
    id: `m${now.getTime().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    source,
    created: now.toISOString(),
    enabled: true,
    hints: hintsOf(message),
  };
}

/**
 * What the thread says when a memory is kept: what it means for the next
 * report, and where to change it (2026-11-11, the full audit's CV-06). It
 * said "Forma's own model will apply A4 paper from now on, and any AI you
 * use is told it before each report and each reply" until then, which named
 * the parts of Forma and promised it for Batch, which is not told it.
 */
export function rememberedReply(m: Memory): string {
  const applied = [
    m.hints.paper && `${m.hints.paper} paper`,
    m.hints.landscape !== undefined && (m.hints.landscape ? 'landscape' : 'portrait'),
    m.hints.fontFamily,
    ...Object.entries(m.hints.sizes ?? {}).map(([role, pt]) => `${pt}pt ${role}s`),
  ].filter(Boolean);
  return applied.length
    ? `Got it: ${applied.join(', ')} from now on. You can change it in Settings, under Memory.`
    : "Got it, I'll keep that in mind for every report. You can change it in Settings, under Memory.";
}

/** A short hash of a string (FNV-1a, 32 bits), enough to tell one kept report from another. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The style a kept report leaves, or null when it cannot be read. `key` is
 * the report's project id when it has one; otherwise its skeleton's hash.
 */
export function keptStyleOf(repx: string, now = new Date(), key?: string): KeptStyle | null {
  try {
    const skeleton = skeletonOf(parseReportStructure(repx));
    if (!skeleton.bands.length) return null;
    const style = learnStyle([skeleton]);
    const sizes: KeptStyle['sizes'] = {};
    for (const role of ['title', 'caption', 'value', 'total'] as const) if (style.roles[role]) sizes[role] = style.roles[role]!.size;
    return { key: key || `s${hashOf(JSON.stringify(skeleton))}`, at: now.toISOString(), paper: skeleton.paper, landscape: skeleton.landscape, fontFamily: style.fonts[0]?.family ?? 'Arial', sizes };
  } catch {
    return null;
  }
}

/** Keep a report's style, the newest MAX_KEPT; a report kept again replaces what it left before. */
export function rememberKept(state: MemoryState, style: KeptStyle): MemoryState {
  const others = style.key ? state.kept.filter((k) => k.key !== style.key) : state.kept;
  return { ...state, kept: [...others, style].slice(-MAX_KEPT) };
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
