/**
 * Forma's own model (2026-11-02): what a set of reports teaches about how a
 * report is laid out, learned from their skeletons (reportSkeleton.ts) with no
 * neural network and no service, so it runs offline in the browser for free.
 *
 * The owner asked for an AI of Forma's own, trained on the reports their
 * company has built, with training on this machine's processors first. It
 * learns two things:
 * - **House style:** the fonts and sizes each role is set in, the margins of
 *   each paper, how tall each kind of band usually is, how tall a record's row
 *   is. These are medians and shares over every report.
 * - **Archetypes:** the kinds of report the set holds, found by clustering the
 *   reports' feature vectors with k-medoids. Each kind keeps the skeleton of
 *   its most typical report (its medoid) as the pattern a new report of that
 *   kind is built on, plus the share of the set it covers and the generic
 *   categories (invoice, payroll, label…) its reports were filed under.
 *
 * A category is a word from `CATEGORY_WORDS`, never the folder name it was
 * found in: the folders carry client names. The model is plain JSON, so the
 * same code learns the shipped model from the training set and a personal one
 * from the reports a user keeps.
 */
import { FEATURE_NAMES, skeletonFeatures, skeletonTexts, type ReportSkeleton, type SkeletonRole } from './reportSkeleton';
import type { BandKind } from './reportPreview';

/**
 * The generic report categories a folder or a request can name, each with the
 * words that point to it. A category is only ever one of these keys.
 */
export const CATEGORY_WORDS: Record<string, string[]> = {
  document: ['document', 'invoice', 'bill', 'receipt', 'voucher', 'delivery', 'quotation', 'quote', 'order', 'proforma', 'credit note', 'debit note'],
  label: ['label', 'tag', 'barcode', 'sticker'],
  payroll: ['payroll', 'salary', 'payslip', 'pay slip', 'wage'],
  stock: ['stock', 'inventory', 'warehouse', 'movement', 'balance of stock'],
  sales: ['sales', 'revenue', 'customer', 'sold'],
  accounts: ['account', 'ledger', 'trial balance', 'balance sheet', 'journal', 'statement', 'aging', 'age analysis', 'audit'],
  manufacturing: ['manufactur', 'production', 'job card', 'work order', 'casting', 'melting', 'refin', 'assay'],
  cheque: ['cheque', 'check print'],
  catalogue: ['catalog', 'catalogue', 'price list'],
};

/** Where the browser fetches the shipped model from (see MODEL_ASSETS in vite.config.ts). */
export const MODEL_URL = '/model/formaModel.json';

let loading: Promise<FormaModel> | null = null;

/** The shipped model, fetched once per session; a failed fetch is tried again next time. */
export function loadFormaModel(): Promise<FormaModel> {
  if (!loading) {
    loading = fetch(MODEL_URL).then(async (r) => {
      if (!r.ok) throw new Error(`Forma's own model could not be loaded (HTTP ${r.status}).`);
      const model = (await r.json()) as FormaModel;
      if (model.version !== 1 || !model.archetypes?.length) throw new Error("Forma's own model is not one this version can read.");
      return model;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The category a folder path or a request names, by the first category word it contains, or null. */
export function categoryOf(text: string): string | null {
  const t = text.toLowerCase();
  let best: { name: string; at: number } | null = null;
  for (const [name, words] of Object.entries(CATEGORY_WORDS)) {
    for (const w of words) {
      const at = t.indexOf(w);
      if (at >= 0 && (!best || at < best.at)) best = { name, at };
    }
  }
  return best?.name ?? null;
}

export interface RoleStyle {
  family: string;
  /** Median size, points. */
  size: number;
  /** Share of texts in this role set bold. */
  bold: number;
}

export interface HouseStyle {
  fonts: { family: string; share: number }[];
  roles: Partial<Record<SkeletonRole, RoleStyle>>;
  papers: { paper: string; landscape: boolean; share: number }[];
  /** Median margins per paper name. */
  margins: Record<string, { top: number; bottom: number; left: number; right: number }>;
  /** Median height per band kind, report units. */
  bands: Partial<Record<BandKind, number>>;
  /** Median height of one line of a record, report units. */
  rowHeight: number;
}

export interface Archetype {
  id: string;
  label: string;
  /** Share of the training reports this kind covers. */
  share: number;
  categories: { name: string; share: number }[];
  /** The medoid's features, as learned (unscaled). */
  features: number[];
  skeleton: ReportSkeleton;
}

export interface FormaModel {
  version: 1;
  /** How many reports it learned from. */
  reports: number;
  learnedOn: string;
  featureNames: readonly string[];
  /** Each feature's mean and spread over the set, which distances are measured in. */
  scale: { mean: number[]; sd: number[] };
  style: HouseStyle;
  archetypes: Archetype[];
}

export interface TrainingReport {
  skeleton: ReportSkeleton;
  /** A generic category (a `CATEGORY_WORDS` key), or null. */
  category: string | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const round = (v: number) => Math.round(v * 100) / 100;

function tally<T extends string>(items: T[]): { key: T; share: number }[] {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, share: round(n / items.length) }));
}

/** The house style of a set of skeletons. Fonts used by fewer than `minFontReports` reports are left out. */
export function learnStyle(skeletons: ReportSkeleton[], minFontReports = 1): HouseStyle {
  const texts = skeletons.flatMap((k) => skeletonTexts(k));
  const fontReports = new Map<string, number>();
  for (const k of skeletons) for (const f of new Set(skeletonTexts(k).flatMap((t) => (t.font ? [t.font.family] : [])))) fontReports.set(f, (fontReports.get(f) ?? 0) + 1);
  const allowed = (f: string) => (fontReports.get(f) ?? 0) >= minFontReports;
  const fonts = tally(texts.flatMap((t) => (t.font && allowed(t.font.family) ? [t.font.family] : [])))
    .slice(0, 8)
    .map(({ key, share }) => ({ family: key, share }));
  const roles: Partial<Record<SkeletonRole, RoleStyle>> = {};
  for (const role of ['title', 'caption', 'value', 'total', 'pageInfo'] as SkeletonRole[]) {
    const own = texts.filter((t) => t.role === role && t.font && allowed(t.font.family));
    if (!own.length) continue;
    roles[role] = {
      family: tally(own.map((t) => t.font!.family))[0].key,
      size: round(median(own.map((t) => t.font!.size))),
      bold: round(own.filter((t) => t.font!.bold).length / own.length),
    };
  }
  const papers = tally(skeletons.map((k) => `${k.paper}|${k.landscape}`)).map(({ key, share }) => {
    const [paper, landscape] = key.split('|');
    return { paper, landscape: landscape === 'true', share };
  });
  const margins: HouseStyle['margins'] = {};
  for (const name of new Set(skeletons.map((k) => k.paper))) {
    const own = skeletons.filter((k) => k.paper === name).map((k) => k.margins);
    margins[name] = {
      top: round(median(own.map((m) => m.top))),
      bottom: round(median(own.map((m) => m.bottom))),
      left: round(median(own.map((m) => m.left))),
      right: round(median(own.map((m) => m.right))),
    };
  }
  const bands: HouseStyle['bands'] = {};
  for (const kind of new Set(skeletons.flatMap((k) => k.bands.map((b) => b.kind)))) {
    bands[kind] = round(median(skeletons.flatMap((k) => k.bands.filter((b) => b.kind === kind).map((b) => b.height))));
  }
  const rowHeight = round(median(texts.filter((t) => t.band === 'Detail' && t.h > 0).map((t) => t.h)) || 20);
  return { fonts, roles, papers, margins, bands, rowHeight };
}

/** Each feature's mean and standard deviation over the vectors; a constant feature gets a spread of 1. */
function scaleOf(vectors: number[][]): { mean: number[]; sd: number[] } {
  const n = vectors.length;
  const dims = vectors[0]?.length ?? 0;
  const mean = Array.from({ length: dims }, (_, d) => vectors.reduce((s, v) => s + v[d], 0) / Math.max(1, n));
  const sd = Array.from({ length: dims }, (_, d) => {
    const v = vectors.reduce((s, x) => s + (x[d] - mean[d]) ** 2, 0) / Math.max(1, n);
    return Math.sqrt(v) || 1;
  });
  return { mean: mean.map(round), sd: sd.map((s) => round(s) || 1) };
}

/** The distance between two feature vectors, each feature in units of its spread. */
export function featureDistance(a: number[], b: number[], scale: { sd: number[] }): number {
  let s = 0;
  for (let d = 0; d < a.length; d++) s += ((a[d] - b[d]) / (scale.sd[d] || 1)) ** 2;
  return Math.sqrt(s);
}

/** A small seeded random number generator (mulberry32), so learning is repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * k-medoids over the feature vectors. Each start seeds its medoids the
 * k-means++ way, every next one drawn with a chance proportional to its
 * squared distance from the nearest so far. Then it alternates assigning
 * each report to its nearest medoid with moving each medoid to the member
 * nearest the rest of its cluster, until nothing moves. Of `restarts` starts,
 * the one with the smallest total distance is kept. Seeding from the most
 * central report and adding the furthest, the first version, made outliers
 * medoids: one cluster held 63% of the owner's reports. Repeatable for a
 * given set and seed.
 */
export function kMedoids(
  vectors: number[][],
  k: number,
  scale: { sd: number[] },
  options: { restarts?: number; seed?: number } = {},
): { medoids: number[]; assignment: number[] } {
  const n = vectors.length;
  if (!n) return { medoids: [], assignment: [] };
  const all = vectors.map((_, i) => i);
  const memo = new Map<number, number>();
  const dist = (i: number, j: number) => {
    if (i === j) return 0;
    const key = i < j ? i * n + j : j * n + i;
    let d = memo.get(key);
    if (d === undefined) memo.set(key, (d = featureDistance(vectors[i], vectors[j], scale)));
    return d;
  };
  const random = seeded(options.seed ?? 1);
  let best: { medoids: number[]; assignment: number[]; cost: number } | null = null;
  for (let r = 0; r < (options.restarts ?? 16); r++) {
    const medoids = [Math.floor(random() * n)];
    while (medoids.length < Math.min(k, n)) {
      const weights = all.map((i) => Math.min(...medoids.map((m) => dist(i, m))) ** 2);
      const sum = weights.reduce((s, w) => s + w, 0);
      if (!sum) break;
      let pick = random() * sum;
      let chosen = all.findIndex((i) => (pick -= weights[i]) <= 0);
      if (chosen < 0) chosen = n - 1;
      medoids.push(chosen);
    }
    let assignment = all.map(() => 0);
    for (let iter = 0; iter < 50; iter++) {
      assignment = all.map((i) => medoids.reduce((b, m, c) => (dist(i, m) < dist(i, medoids[b]) ? c : b), 0));
      let moved = false;
      medoids.forEach((m, c) => {
        const members = all.filter((i) => assignment[i] === c);
        if (!members.length) return;
        const total = (i: number) => members.reduce((s, j) => s + dist(i, j), 0);
        const centre = members.reduce((b, i) => (total(i) < total(b) ? i : b), m);
        if (centre !== m) {
          medoids[c] = centre;
          moved = true;
        }
      });
      if (!moved) break;
    }
    const cost = all.reduce((s, i) => s + dist(i, medoids[assignment[i]]), 0);
    if (!best || cost < best.cost) best = { medoids: [...medoids], assignment, cost };
  }
  return { medoids: best!.medoids, assignment: best!.assignment };
}

/** The member of `members` nearest all the others. */
function medoidOf(members: number[], vectors: number[][], scale: { sd: number[] }): number {
  const total = (i: number) => members.reduce((s, j) => s + featureDistance(vectors[i], vectors[j], scale), 0);
  return members.reduce((b, i) => (total(i) < total(b) ? i : b), members[0]);
}

/** A plain name for a kind of report, from its shape. */
export function archetypeLabel(k: ReportSkeleton): string {
  const f = Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, skeletonFeatures(k)[i]]));
  const turned = k.landscape ? ', landscape' : '';
  if (f.smallPage && k.width < 400) return 'Label';
  if (f.groupHeaders > 0 && f.detailValues > Math.log1p(2)) return `Grouped register${turned}`;
  if (f.headerCaptions > Math.log1p(5) && f.detailValues > 0) return `Document with line items${turned}`;
  if (f.detailValues > Math.log1p(3)) return `List${turned}`;
  return `Form${turned}`;
}

/** Learn the model from a set of reports: the house style and `k` archetypes. */
export function learnModel(
  set: TrainingReport[],
  options: { k?: number; date?: string; minFontReports?: number; minCategoryReports?: number; seed?: number } = {},
): FormaModel {
  const vectors = set.map((r) => skeletonFeatures(r.skeleton));
  const scale = scaleOf(vectors);
  const { medoids, assignment } = kMedoids(vectors, options.k ?? 10, scale, { seed: options.seed });
  const style = learnStyle(set.map((r) => r.skeleton), options.minFontReports ?? 1);
  // A face the house style does not list (one few reports use) is written as
  // the house face, so the model names no font only one report had.
  const known = new Set(style.fonts.map((f) => f.family));
  const houseFace = style.fonts[0]?.family ?? 'Arial';
  const face = <T extends { family: string } | null>(f: T): T => (f && !known.has(f.family) ? { ...f, family: houseFace } : f);
  const normalise = (k: ReportSkeleton): ReportSkeleton => ({
    ...k,
    bands: k.bands.map((b) => ({
      ...b,
      controls: b.controls.map((c) => ({ ...c, font: face(c.font), ...(c.rows ? { rows: c.rows.map((r) => r.map((cell) => ({ ...cell, font: face(cell.font) }))) } : {}) })),
    })),
  });
  const make = (m: number, members: TrainingReport[]): Omit<Archetype, 'id'> => ({
    label: archetypeLabel(set[m].skeleton),
    share: round(members.length / set.length),
    categories: tally(members.flatMap((r) => (r.category ? [r.category] : []))).map(({ key, share }) => ({ name: key, share })),
    features: vectors[m].map(round),
    skeleton: normalise(set[m].skeleton),
  });
  // The shapes the set falls into, found without its categories...
  const shapes = medoids.map((m, c) => make(m, set.filter((_, i) => assignment[i] === c)));
  // ...and, for each category with enough reports, its most typical report:
  // the pattern a request naming that category is built on.
  const byCategory: Omit<Archetype, 'id'>[] = [];
  for (const name of Object.keys(CATEGORY_WORDS)) {
    const members = set.flatMap((r, i) => (r.category === name ? [i] : []));
    if (members.length < (options.minCategoryReports ?? 5)) continue;
    const m = medoidOf(members, vectors, scale);
    if (medoids.includes(m)) continue;
    byCategory.push(make(m, members.map((i) => set[i])));
  }
  const archetypes: Archetype[] = [...shapes, ...byCategory]
    .sort((a, b) => b.share - a.share)
    .map((a, i) => ({ id: `a${i + 1}`, ...a }));
  return {
    version: 1,
    reports: set.length,
    learnedOn: options.date ?? new Date().toISOString().slice(0, 10),
    featureNames: FEATURE_NAMES,
    scale,
    style,
    archetypes,
  };
}

/**
 * Every string a model holds that is not one of the words a model may hold:
 * a font the house style lists, an archetype label, a category, a band kind, a
 * role, a control kind, an alignment, a paper, a feature name, an id or the
 * date. Empty for a sound model. A model learned from client reports is
 * shipped only when this is empty: it is how "structure only" is enforced
 * rather than promised.
 */
export function unexpectedStrings(model: FormaModel): string[] {
  const allowed = new Set<string>([
    ...model.style.fonts.map((f) => f.family),
    ...Object.keys(CATEGORY_WORDS),
    ...model.featureNames,
    'TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'DetailReport', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin', 'Unknown',
    'title', 'caption', 'value', 'total', 'pageInfo', 'decoration',
    'label', 'table', 'line', 'picture', 'panel', 'richText', 'shape', 'barcode', 'subreport', 'chart', 'checkbox', 'other',
    'left', 'center', 'right',
    'A4', 'Letter', 'Legal', 'A5', 'A3', 'Executive', 'Custom',
    model.learnedOn,
  ]);
  const found = new Set<string>();
  const visit = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      const ok = allowed.has(v) || (key === 'id' && /^a\d+$/.test(v)) || (key === 'label' && /^(Label|Form|List|Grouped register|Document with line items)(, landscape)?$/.test(v));
      if (!ok) found.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(model, '');
  return [...found];
}

/**
 * The archetypes nearest a wish, best first: a category named in the request
 * counts for most, then the shape the request implies (grouped, totals, a
 * label, turned), then how much of the set the archetype covers.
 */
export function rankArchetypes(
  model: FormaModel,
  want: { category?: string | null; grouped?: boolean; totals?: boolean; landscape?: boolean; label?: boolean; columns?: number },
): Archetype[] {
  const score = (a: Archetype) => {
    const f = Object.fromEntries(model.featureNames.map((name, i) => [name, a.features[i]]));
    let s = a.share;
    if (want.category) s += 3 * (a.categories.find((c) => c.name === want.category)?.share ?? 0);
    if (want.label !== undefined) s += want.label === (a.label === 'Label') ? 1 : -1;
    if (want.grouped !== undefined) s += want.grouped === f.groupHeaders > 0 ? 1 : -1;
    if (want.totals) s += f.totals > 0 ? 0.5 : -0.5;
    if (want.landscape !== undefined) s += want.landscape === (f.landscape === 1) ? 0.5 : -0.5;
    if (want.columns) s -= Math.abs(Math.expm1(f.detailValues) - want.columns) / 20;
    return s;
  };
  return [...model.archetypes].sort((a, b) => score(b) - score(a));
}
