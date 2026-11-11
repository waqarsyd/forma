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
 *
 * A third kind since 2026-11-11 (the full audit's D4): **what their changes
 * show.** A change the person makes to the same kind of part in two reports
 * Forma made (a title's size, a caption's face, a total's alignment, a
 * margin) becomes a memory of its own, `source: 'learned'`, which Settings
 * lists under "Learned from your changes" with a Forget. The changes are
 * kept as a ledger in this state (`ledger`, lib/corrections.ts), and an Undo
 * of what Forma did counts against it.
 */
import { parseReportStructure } from './reportPreview';
import { skeletonOf, skeletonTexts, type ReportSkeleton } from './reportSkeleton';
import { learnStyle, type HouseStyle } from './formaModel';
import { DEFAULT_UNIT, unitsPerInch } from './reportGeometry';
import { REMEMBER } from './chatTurn';
import { roundSkeleton, scrubSkeleton } from './learning';
import type { Correction } from './corrections';

/** What Forma's own model can apply from a memory. */
export interface MemoryHints {
  paper?: string;
  landscape?: boolean;
  fontFamily?: string;
  /** Points, by the role a text plays. */
  sizes?: Partial<Record<'title' | 'caption' | 'value' | 'total', number>>;
  /** The page's margins, in hundredths of an inch whatever the kept reports' own unit, from them (D1). */
  margins?: { top: number; bottom: number; left: number; right: number };
  /** Whether each role is bold, from the kept reports (D1). */
  bold?: Partial<Record<'title' | 'caption' | 'value' | 'total', boolean>>;
  /** The height of a record's row, in hundredths of an inch, from the kept reports (D1). */
  rowHeight?: number;
}

export interface Memory {
  id: string;
  /** What it says, as shown in Settings and as an AI is told it. */
  text: string;
  /** Said in the chat, added in Settings, or learned from the person's changes (D4, lib/corrections.ts). */
  source: 'chat' | 'settings' | 'learned';
  created: string;
  enabled: boolean;
  hints: MemoryHints;
  /**
   * The project it was said for (2026-11-11, the full audit's CP-13), when the
   * words said "for this client" or "for this project": it applies there and
   * nowhere else. Absent: everywhere, as every memory did until then.
   */
  projectId?: string;
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
  /**
   * Its skeleton's hash whatever `key` is (2026-11-11, a wave-4 follow-up to
   * LM-28): a report downloaded before it was ever saved was kept under that
   * hash, and kept again under its project's id once saved, so it counted
   * twice. A style kept under a project replaces one kept under its shape.
   */
  shape?: string;
  at: string;
  paper: string;
  landscape: boolean;
  fontFamily: string;
  sizes: Partial<Record<'title' | 'caption' | 'value' | 'total', number>>;
  /**
   * The report's skeleton, scrubbed as a learning event's is and rounded
   * (2026-11-11, the full audit's D1 and LM-22): what a personal house style
   * is learned from. Absent on a style kept before, or one too large to keep.
   */
  skeleton?: ReportSkeleton;
  /**
   * Set when `skeleton`'s geometry was read into hundredths of an inch
   * (`skeletonInHundredths`, 2026-11-11, the LRN2 review). A skeleton kept
   * before it is in the report's own unit, which `geometryKnown` tells apart.
   */
  hundredths?: true;
}

export interface MemoryState {
  memories: Memory[];
  kept: KeptStyle[];
  /** Whether what kept reports show is used; the memories each have their own switch. */
  learnFromKept: boolean;
  /**
   * The changes the person made to what Forma made, and the ones they undid
   * (2026-11-11, D4): what a learned memory is counted from. Never a word of
   * a report, only a part's kind and the value it was set to. Absent on a
   * state written before it, read back as empty.
   */
  ledger?: Correction[];
}

const STORAGE_KEY = 'forma.memory';
/** Enough reports to know a house style, few enough to follow it as it changes. */
export const MAX_KEPT = 30;
/**
 * The longest skeleton kept with a style: thirty of them stay under about
 * 600 kB of this browser's storage, which signed out also holds the projects.
 */
export const MAX_KEPT_SKELETON_CHARS = 20_000;

const EMPTY: MemoryState = { memories: [], kept: [], learnFromKept: true, ledger: [] };

/** Who is signed in, whose memory a read or write without one reaches; null signed out. */
let account: string | null = null;

/** Names the account signed in, or null on signing out. */
export function setMemoryAccount(uid: string | null): void {
  account = uid || null;
}

/** The account named last, for Settings' Forget, which clears that account's kept reports too. */
export const memoryAccount = (): string | null => account;

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
    if (!s) return { ...EMPTY, ledger: [] };
    return {
      memories: Array.isArray(s.memories) ? s.memories : [],
      kept: Array.isArray(s.kept) ? s.kept : [],
      learnFromKept: s.learnFromKept !== false,
      ledger: Array.isArray(s.ledger) ? s.ledger : [],
    };
  } catch {
    return { ...EMPTY, ledger: [] };
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

/** Words that say a memory is for the open project alone (CP-13). */
export const FOR_THIS_PROJECT = /\bfor\s+(this|the\s+current)\s+(client|customer|project|report)\b/i;

/**
 * A memory from a message: the words after "remember", capitalised. Said
 * "for this client" or "for this project" with a project open, it is that
 * project's alone (2026-11-11, CP-13).
 */
export function memoryFrom(message: string, source: Memory['source'] = 'chat', now = new Date(), projectId?: string | null): Memory {
  const text = message.replace(REMEMBER, '').trim().replace(/[.!]+$/, '') || message.trim();
  return {
    id: `m${now.getTime().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    source,
    created: now.toISOString(),
    enabled: true,
    hints: hintsOf(message),
    ...(projectId && FOR_THIS_PROJECT.test(message) ? { projectId } : {}),
  };
}

/** The memory as one small file (CP-13): what Settings' Export writes and Import reads back. */
export function exportMemory(state: MemoryState): string {
  // Not what was learned from changes (D4): like the kept reports, it is learned from this browser's own reports.
  const memories = state.memories.filter((m) => m.source !== 'learned');
  return JSON.stringify({ forma: 'memory', version: 1, memories, learnFromKept: state.learnFromKept }, null, 1);
}

/**
 * A memory file read back: its memories added to these, one already here (by
 * id) not twice, each checked to the shape a memory has. Null when the file
 * is not one. The kept reports' styles are not in the file: they are learned
 * from this browser's own reports.
 */
export function importMemory(state: MemoryState, file: string): MemoryState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file);
  } catch {
    return null;
  }
  const p = parsed as { forma?: unknown; memories?: unknown };
  if (!p || p.forma !== 'memory' || !Array.isArray(p.memories)) return null;
  const have = new Set(state.memories.map((m) => m.id));
  const added = (p.memories as Partial<Memory>[]).flatMap((m): Memory[] => {
    if (!m || typeof m.text !== 'string' || !m.text.trim() || typeof m.id !== 'string') return [];
    // By the id as kept, and each one taken added to `have` (2026-11-11): a
    // file holding one id twice added it twice, and Settings then listed two
    // rows under one key and Forget removed both.
    const id = m.id.slice(0, 40);
    if (have.has(id)) return [];
    have.add(id);
    const text = m.text.slice(0, 500);
    return [{
      id,
      text,
      source: m.source === 'chat' ? 'chat' : 'settings',
      created: typeof m.created === 'string' ? m.created : new Date().toISOString(),
      enabled: m.enabled !== false,
      hints: hintsOf(text),
      ...(typeof m.projectId === 'string' && m.projectId ? { projectId: m.projectId.slice(0, 128) } : {}),
    }];
  });
  return { ...state, memories: [...state.memories, ...added] };
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
 * A report's skeleton with its geometry read into hundredths of an inch,
 * whatever its ReportUnit and Dpi (2026-11-11, the LRN2 review). A skeleton
 * is measured in hundredths everywhere it is used: Forma's model and its
 * features, `paperName`, and the margins and row height `preferencesOf` hands
 * offlineGenerator. Read in its own unit, a millimetre report's 1 cm margins
 * (100) printed as 1 inch, 2.54 times too large, and never threw. The
 * conversion is reportPreview's own, through reportGeometry's units.
 */
export function skeletonInHundredths(repx: string): ReportSkeleton {
  return skeletonOf(parseReportStructure(repx, { dpi: unitsPerInch(DEFAULT_UNIT), unit: DEFAULT_UNIT }));
}

/**
 * Whether a kept style's skeleton is in hundredths of an inch: read so since
 * the LRN2 review, or, kept before, on a paper `paperName` knew, which only a
 * page measured in hundredths matches (a millimetre A4 reads as Custom).
 */
const geometryKnown = (k: KeptStyle): boolean => !!k.skeleton && (k.hundredths === true || k.skeleton.paper !== 'Custom');

/**
 * The style a kept report leaves, or null when it cannot be read. `key` is
 * the report's project id when it has one; otherwise its skeleton's hash.
 */
export function keptStyleOf(repx: string, now = new Date(), key?: string): KeptStyle | null {
  try {
    const skeleton = skeletonInHundredths(repx);
    if (!skeleton.bands.length) return null;
    const style = learnStyle([skeleton]);
    const sizes: KeptStyle['sizes'] = {};
    for (const role of ['title', 'caption', 'value', 'total'] as const) if (style.roles[role]) sizes[role] = style.roles[role]!.size;
    const shape = `s${hashOf(JSON.stringify(skeleton))}`;
    const clean = roundSkeleton(scrubSkeleton(skeleton));
    const keep = JSON.stringify(clean).length <= MAX_KEPT_SKELETON_CHARS;
    return { key: key || shape, shape, at: now.toISOString(), paper: skeleton.paper, landscape: skeleton.landscape, fontFamily: style.fonts[0]?.family ?? 'Arial', sizes, ...(keep ? { skeleton: clean, hundredths: true as const } : {}) };
  } catch {
    return null;
  }
}

/**
 * Keep a report's style, the newest MAX_KEPT; a report kept again replaces
 * what it left before, by its key, and by its shape when it was kept before
 * it had a project (LM-28's remainder).
 */
export function rememberKept(state: MemoryState, style: KeptStyle): MemoryState {
  const same = (k: KeptStyle) => (style.key !== undefined && k.key === style.key) || (style.shape !== undefined && k.key === style.shape);
  const others = state.kept.filter((k) => !same(k));
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
 * The person's own house style (2026-11-11, the full audit's D1 and LM-22):
 * the style Forma's model learns, learned from the skeletons of the reports
 * they kept rather than from the owner's set, once two are kept and the
 * memory may learn from them. It stands in for Forma's own house style in the
 * brief a described report is given (App, `houseStyleBrief`), so a person
 * who keeps A4 reports in Tahoma 9pt gets the next one that way. Null until
 * then. Nothing of it leaves this browser but that brief.
 *
 * Only skeletons known to be in hundredths of an inch count (`geometryKnown`,
 * the LRN2 review): learnStyle's margins and row height are read as
 * hundredths by everything downstream, and one kept in millimetres would skew
 * them by 2.54. A report kept before then counts again once kept again.
 */
export function personalStyle(state: MemoryState): { style: HouseStyle; reports: number } | null {
  if (!state.learnFromKept) return null;
  const skeletons = state.kept.flatMap((k) => (geometryKnown(k) && Array.isArray(k.skeleton!.bands) ? [k.skeleton!] : []));
  if (skeletons.length < 2) return null;
  return { style: learnStyle(skeletons), reports: skeletons.length };
}

/**
 * What Forma's own model applies: what the kept reports show, then every
 * memory switched on, the newest last, so what the user said wins over what
 * their reports show and a later word over an earlier one. Since 2026-11-11
 * (D1) the kept reports also give their margins, how bold each role is and
 * the height of a record's row, from `personalStyle`.
 *
 * `projectId` (CP-13): a memory said for one project applies there and
 * nowhere else; one said for none applies everywhere.
 */
export function preferencesOf(state: MemoryState, projectId?: string | null): MemoryHints {
  const out: MemoryHints = {};
  const apply = (h: MemoryHints) => {
    if (h.paper && h.paper !== 'Custom') out.paper = h.paper;
    if (h.landscape !== undefined) out.landscape = h.landscape;
    if (h.fontFamily) out.fontFamily = h.fontFamily;
    if (h.sizes) out.sizes = { ...out.sizes, ...h.sizes };
    // A role's weight learned from the person's changes (D4) wins over what their reports show.
    if (h.bold) out.bold = { ...out.bold, ...h.bold };
  };
  const kept = keptSummary(state);
  if (kept) apply(kept);
  const mine = personalStyle(state);
  if (mine) {
    const paper = out.paper ?? mine.style.papers[0]?.paper;
    if (paper && mine.style.margins[paper]) out.margins = mine.style.margins[paper];
    const bold: NonNullable<MemoryHints['bold']> = {};
    for (const role of ['title', 'caption', 'value', 'total'] as const) {
      const r = mine.style.roles[role];
      if (r) bold[role] = r.bold >= 0.5;
    }
    if (Object.keys(bold).length) out.bold = bold;
    // Only when a kept report has a record's row to measure (2026-11-11):
    // learnStyle answers 20 when none has, which is its default, not theirs.
    const measured = state.kept.some((k) => geometryKnown(k) && Array.isArray(k.skeleton!.bands) && skeletonTexts(k.skeleton!).some((t) => t.band === 'Detail' && t.h > 0));
    if (measured) out.rowHeight = mine.style.rowHeight;
  }
  for (const m of appliesTo(state, projectId)) apply(m.hints);
  return out;
}

/** The memories switched on that apply in a project: those said for it, and those said for none. */
function appliesTo(state: MemoryState, projectId?: string | null): Memory[] {
  return state.memories.filter((m) => m.enabled && (!m.projectId || m.projectId === projectId));
}

/** What an AI provider is told: the user's standing preferences, or '' when there are none. In a project, its own memories too (CP-13). */
export function instructionsOf(state: MemoryState, projectId?: string | null): string {
  const lines = appliesTo(state, projectId).map((m) => `- ${m.text}`);
  const kept = keptSummary(state);
  if (kept) {
    const sizes = Object.entries(kept.sizes ?? {}).map(([role, pt]) => `${role}s ${pt}pt`).join(', ');
    lines.push(`- Their ${kept.reports} kept reports use ${kept.paper}${kept.landscape ? ' landscape' : ''} paper and ${kept.fontFamily}${sizes ? `: ${sizes}` : ''}.`);
  }
  return lines.length ? `THE USER'S REMEMBERED PREFERENCES (apply them unless this request says otherwise):\n${lines.join('\n')}` : '';
}
