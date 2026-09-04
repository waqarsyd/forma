/**
 * Making the model's `Ref` values unique, because a duplicate deletes content.
 *
 * ## The defect
 *
 * DevExpress uses `Ref` as object identity when it loads a `.repx`. Two
 * elements carrying the same `Ref` are not two objects with a clashing label;
 * the loader treats the second as *the same object* as the first, and whatever
 * the second one actually said is discarded.
 *
 * Measured on 2026-09-04 against the installed 20.1, on one document differing
 * only in its `Ref` values:
 *
 *     unique Refs      ->  6 cells, 3 bindings, all six texts present
 *     duplicated Refs  ->  3 cells, 0 bindings, the whole detail row gone
 *
 * No exception, no warning, and a report that opens cleanly in the designer
 * with controls missing. It is the exact failure profile this codebase keeps
 * turning up: plausible output, silently wrong, discovered by the user.
 *
 * ## Why the model produces them
 *
 * Nothing ever asked it not to. The prompt does not mention uniqueness,
 * `checkRepx` parses for well-formedness and does not look at `Ref` at all,
 * and -- the part that makes this likely rather than merely possible -- the
 * cheat sheet's snippets each restart numbering from the bottom. The label
 * example opens `<Item1 Ref="1" ControlType="XRLabel" …>` while the ROOT
 * STRUCTURE above it has already used `Ref="1"` for the TopMarginBand. By the
 * rule gemini.md draws from the version-attribute incident -- an example in
 * the prompt outranks an instruction below it, and a second concrete value
 * wins -- copying those snippets side by side is how a collision arrives.
 *
 * ## Why this is code and not a prompt rule
 *
 * Both, ideally, but this half first. Asking for globally unique numbering is
 * asking the model to maintain a counter across a document it writes in one
 * pass, which is the class of bookkeeping it is worst at -- and a rule that is
 * *usually* followed still leaves the silent failure in place for the times it
 * is not. Renumbering is arithmetic: exact every time, and it can state
 * afterwards exactly what it changed.
 *
 * ## What it does, and what it deliberately will not touch
 *
 * Keeps the first occurrence of each `Ref` and renumbers later ones above the
 * document's current maximum. Minimal by design: a document that is already
 * unique comes back byte-identical, and one with a single collision has one
 * attribute changed rather than every `Ref` rewritten.
 *
 * **Only elements carrying a `ControlType` are renumbered.** In this format an
 * element that defines something always has one; the bindings this codebase
 * emits, and anything that might legitimately be a bare back-reference to an
 * object defined earlier, do not. Renumbering a genuine back-reference would
 * split one object into two, which is the same class of damage in the opposite
 * direction, so those are left exactly as found and reported instead.
 */

/** One complete `<Tag …>`, `</Tag>` or `<Tag … />`, as the other repx helpers read them. */
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

/** Comments, CDATA and the declaration, which carry no elements. */
const NON_ELEMENT = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

const REF = /\sRef\s*=\s*"([^"]*)"/;
const CONTROL_TYPE = /\sControlType\s*=\s*"/;

export interface RefOccurrence {
  /** The `Ref` value as written. */
  ref: string;
  /** Index of the element's opening `<`. */
  start: number;
  /** Index just past the element's opening tag `>`. */
  tagEnd: number;
  /** True when the element carries a `ControlType`, i.e. it defines something. */
  defines: boolean;
}

export interface RefAudit {
  /** Every element carrying a `Ref`, in document order. */
  occurrences: RefOccurrence[];
  /** Values used more than once, with how many times. */
  duplicates: { ref: string; count: number }[];
  /** Largest numeric `Ref` in the document, or -1 when there are none. */
  max: number;
}

/** Every `Ref` in the document, and which of them collide. */
export function auditRefs(xml: string | undefined | null): RefAudit {
  const text = xml ?? '';
  const scannable = text.replace(NON_ELEMENT, (m) => ' '.repeat(m.length));
  const occurrences: RefOccurrence[] = [];
  const counts = new Map<string, number>();
  let max = -1;

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(scannable)) !== null) {
    const [, closing, , attrs] = m;
    if (closing) continue;
    const ref = REF.exec(attrs);
    if (!ref) continue;

    occurrences.push({
      ref: ref[1],
      start: m.index,
      tagEnd: TAG.lastIndex,
      defines: CONTROL_TYPE.test(attrs),
    });
    counts.set(ref[1], (counts.get(ref[1]) ?? 0) + 1);

    const n = Number(ref[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([ref, count]) => ({ ref, count }));

  return { occurrences, duplicates, max };
}

export interface RefRepair {
  /** The document, rewritten only where it had to be. */
  xml: string;
  applied: boolean;
  /** Worth logging either way. */
  reason: string;
  /** How many elements were given a new `Ref`. */
  renumbered: number;
}

/**
 * Give every element a `Ref` nothing else uses.
 *
 * Returns the input untouched when it is already unique -- which is the
 * expected case, and is why this reports `applied: false` with a reason rather
 * than treating "nothing to do" as a failure.
 */
export function ensureUniqueRefs(xml: string | undefined | null): RefRepair {
  const text = xml ?? '';
  if (!text.trim()) return { xml: text, applied: false, reason: 'there is no REPX to check', renumbered: 0 };

  const { occurrences, duplicates, max } = auditRefs(text);
  if (!duplicates.length) {
    return {
      xml: text,
      applied: false,
      reason: `all ${occurrences.length} Ref values are already unique`,
      renumbered: 0,
    };
  }

  const seen = new Set<string>();
  const rewrites: { start: number; tagEnd: number; from: string; to: string }[] = [];
  let next = max + 1;
  let skipped = 0;

  for (const occ of occurrences) {
    if (!seen.has(occ.ref)) {
      seen.add(occ.ref);
      continue;
    }
    // A repeat. Only definitions may be renumbered; a bare reference is left
    // alone rather than split into a second object.
    if (!occ.defines) {
      skipped++;
      continue;
    }
    rewrites.push({ start: occ.start, tagEnd: occ.tagEnd, from: occ.ref, to: String(next++) });
  }

  if (!rewrites.length) {
    return {
      xml: text,
      applied: false,
      reason: `${skipped} repeated Ref value(s) look like back-references, so nothing was renumbered`,
      renumbered: 0,
    };
  }

  // Back to front, so each edit leaves the offsets before it valid.
  let out = text;
  for (let i = rewrites.length - 1; i >= 0; i--) {
    const { start, tagEnd, to } = rewrites[i];
    const tag = out.slice(start, tagEnd);
    out = out.slice(0, start) + tag.replace(REF, ` Ref="${to}"`) + out.slice(tagEnd);
  }

  const which = duplicates.map((d) => `${d.ref}x${d.count}`).join(', ');
  return {
    xml: out,
    applied: true,
    reason:
      `renumbered ${rewrites.length} element(s) that reused a Ref (${which})` +
      (skipped ? `; left ${skipped} back-reference(s) alone` : ''),
    renumbered: rewrites.length,
  };
}
