/**
 * Turning Google's model catalogue into a candidate list.
 *
 * ## Why this exists
 *
 * `MODEL_PREFERENCE` is a hand-written list, and a hand-written list of model
 * ids has a shelf life. Two of its five entries are `-latest` aliases that
 * Google repoints as models are superseded, so the list is not as frozen as it
 * looks — but a family shipped under a genuinely new name, or a retired alias,
 * would leave a user pasting a fresh key into an app that only knows about
 * models their key can no longer call. That is a slow, silent failure that
 * arrives a year after anyone last thought about it.
 *
 * ## The rule this does not break
 *
 * `docs/notes/gemini.md` says **never resolve models from `models.list`**, and
 * that stands: the catalogue advertised `gemini-2.5-flash` with
 * `generateContent` support while the real call returned 404. The distinction
 * that makes both things true is that the catalogue is unreliable about what a
 * key can **call** and perfectly good about what **exists**. So it is used for
 * discovery only, and every candidate it produces is still confirmed by a real
 * 1-token request before anything depends on it. Catalogue proposes, probe
 * disposes.
 *
 * Everything here is pure so the filtering and ordering can be tested without a
 * key: both fail *plausibly* — a bad filter sends a report to an embedding
 * model, and a bad order silently spends the user's money on a pro tier.
 */

/** One entry as `GET /v1beta/models` returns it. Extra fields are ignored. */
export interface CatalogEntry {
  /** Fully qualified, e.g. "models/gemini-2.5-flash". */
  name?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Families that cannot produce a report, whatever the catalogue claims about
 * `generateContent`. Embedding and AQA models answer a different shape
 * entirely; the media families produce images, video or audio; `gemma` and
 * `learnlm` are separate lines that do not share the Gemini feature set.
 */
const NOT_A_REPORT_MODEL = /embedding|embed|aqa|imagen|veo|tts|audio|gemma|learnlm/i;

/**
 * Dated, experimental and preview variants are skipped deliberately.
 *
 * They are numerous — one family can carry half a dozen dated snapshots — and
 * probing is a real request per candidate, so admitting them would multiply the
 * cost of the first generation of every session to reach models that are, by
 * their own labelling, not the ones to depend on. The stable name for the same
 * generation is always in the list beside them.
 */
const UNSTABLE = /(-exp\b|-exp-|-preview\b|-preview-|-\d{4}$|-\d{2}-\d{2}$|-latest-)/i;

/** "models/gemini-2.5-flash" -> "gemini-2.5-flash". */
function bareName(name: string): string {
  return name.replace(/^models\//, '');
}

/**
 * Model ids from a catalogue response that could plausibly generate a report.
 *
 * Conservative on purpose: an unknown id that slips through costs a wasted
 * probe at worst, but one that is *wrongly admitted* and then wins the probe
 * becomes the model every generation uses. `supportedGenerationMethods` must be
 * present and contain `generateContent` — an entry that does not say is not
 * given the benefit of the doubt.
 */
export function usableFromCatalog(entries: ReadonlyArray<CatalogEntry> | undefined): string[] {
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string') continue;
    if (!Array.isArray(entry.supportedGenerationMethods)) continue;
    if (!entry.supportedGenerationMethods.includes('generateContent')) continue;

    const name = bareName(entry.name);
    if (!name.startsWith('gemini-')) continue;
    if (NOT_A_REPORT_MODEL.test(name)) continue;
    if (UNSTABLE.test(name)) continue;
    if (seen.has(name)) continue;

    seen.add(name);
    out.push(name);
  }

  return out;
}

/** flash < flash-lite < pro. Cost order, because the user pays for their own key. */
function tierOf(name: string): number {
  if (/lite/.test(name)) return 1;
  if (/flash/.test(name)) return 0;
  if (/pro/.test(name)) return 2;
  return 3; // an unrecognised shape goes last rather than being guessed at
}

/**
 * Generation number, newest first. An alias has no number and is treated as
 * newest by definition — that is what the alias *means*, and it is the one id
 * that cannot go stale.
 */
function versionOf(name: string): number {
  if (/-latest$/.test(name)) return Number.POSITIVE_INFINITY;
  const match = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return match ? Number(match[1]) : 0;
}

/**
 * Order models nobody curated: cheapest tier first, then newest within it.
 *
 * The tier ordering is the part that matters and the part that would fail
 * quietly. Ranking by recency alone would put a brand-new pro model at the top
 * of the probe list, and the first key with pro access would start paying pro
 * prices for every report with nothing in the UI to say so.
 */
export function rankDiscovered(names: ReadonlyArray<string>): string[] {
  return [...names].sort((a, b) => {
    const tier = tierOf(a) - tierOf(b);
    if (tier !== 0) return tier;
    const version = versionOf(b) - versionOf(a);
    if (version !== 0) return version;
    return a.localeCompare(b); // stable, so the order cannot wobble between runs
  });
}

/**
 * The full probe list: the curated preference order, then anything the
 * catalogue knows about that it does not mention.
 *
 * **Curated ids keep their positions.** They are the tuned, measured order and
 * they lead with an alias that tracks whatever Google currently issues, so
 * there is nothing for discovery to improve there. Discovery's job is the case
 * the curated list cannot cover: every name in it retired, or a family shipped
 * under a name nobody here has heard of. Those go after, ranked among
 * themselves, and only matter when the curated ones fail — which is exactly
 * when being able to reach them is the difference between working and not.
 *
 * `limit` caps the probe cost: each candidate is a live request, and the
 * catalogue can list dozens.
 */
export function mergeCandidates(
  curated: ReadonlyArray<string>,
  discovered: ReadonlyArray<string>,
  limit = 10
): string[] {
  const known = new Set(curated);
  const extras = rankDiscovered(discovered.filter((name) => !known.has(name)));
  return [...curated, ...extras].slice(0, Math.max(0, limit));
}
