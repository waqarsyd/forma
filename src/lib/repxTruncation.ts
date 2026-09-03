/**
 * Did the model finish writing the REPX, or did it stop part-way?
 *
 * ## Two different truncations, and only one of them was ever visible
 *
 * **The loud one.** The response is cut off mid-flight, `finishReason` comes
 * back `MAX_TOKENS`, and the JSON does not parse. `analysisResponse.ts` owns
 * that case and tells the user what happened. Nothing here applies: there is no
 * report to inspect.
 *
 * **The quiet one, and the reason this file exists.** The model returns a
 * *complete, valid* JSON object — `finishReason` is normal, `layout.sections`
 * is intact, the mockup draws, the markdown spec reads fine — and inside it the
 * `repxContent` string simply stops. Observed on a real generation: 896 bytes
 * ending mid-attribute at `... Name=`. Every signal the app had said success.
 * The only artifact that was wrong was the only one the user actually opens in
 * DevExpress, and they found out at Export, after the wait.
 *
 * ## Why not `checkRepx`
 *
 * `checkRepx` in `repx.ts` would catch it — it parses the document — but it does
 * so with `DOMParser`, which exists in a browser and not in the service's tests,
 * and it runs at Export and at Open in designer, which is the far end of the
 * journey. It also answers a different question: *will the designer open this*,
 * which a hand-written malformation fails just as a truncation does. This
 * answers *did the model stop early*, which is a specific enough diagnosis to
 * act on — it is what justifies spending another request to rewrite the XML,
 * where a generic parse failure would not.
 *
 * So: no DOM, no dependencies, pure string work, and it runs at the moment the
 * response is parsed rather than at the moment the user tries to leave with it.
 */

/** Comments and the XML declaration, which carry no nesting. */
const NON_ELEMENT = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

/** One complete `<Tag …>`, `</Tag>` or `<Tag … />`. */
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

const ROOT = 'XtraReportsLayoutSerializer';

export interface RepxCompleteness {
  /** False when the document stops before it is finished. */
  complete: boolean;
  /** Why, in a form worth logging. Empty when complete. */
  reason: string;
  /** Characters received, so a log line can say how far it got. */
  length: number;
}

/**
 * Is this REPX a whole document?
 *
 * Deliberately conservative: it reports incomplete only for things that cannot
 * be anything else — a missing root, an unterminated tag, elements left open.
 * Anything it is unsure about it calls complete, because the cost of a false
 * positive is a wasted request and a rewritten report, while the cost of a
 * false negative is only the status quo.
 */
export function checkRepxComplete(xml: string | undefined | null): RepxCompleteness {
  const text = xml?.trim() ?? '';
  const length = text.length;
  const incomplete = (reason: string): RepxCompleteness => ({ complete: false, reason, length });

  if (!length) return incomplete('no REPX was returned at all');
  if (!text.includes(`<${ROOT}`)) return incomplete(`no opening <${ROOT}> — the XML never really started`);

  // Strip what does not nest, so the depth count below sees only elements. The
  // replacement keeps the length, so offsets stay meaningful for the tail check.
  const scannable = text.replace(NON_ELEMENT, (m) => ' '.repeat(m.length));

  let depth = 0;
  let lastTagEnd = 0;
  let rootClosed = false;

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(scannable)) !== null) {
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      depth--;
      if (name === ROOT) rootClosed = true;
    } else if (!selfClosing) {
      depth++;
    }
    lastTagEnd = TAG.lastIndex;
    // A stray `</Foo>` past the root is malformation, not truncation, and is
    // checkRepx's business. Stop counting rather than reporting a negative.
    if (depth < 0) break;
  }

  // Anything but whitespace after the last complete tag is a tag that was still
  // being written when the model stopped — the `... Name=` case exactly.
  const tail = text.slice(lastTagEnd).trim();
  if (tail) {
    return incomplete(
      `stops mid-tag after ${length} characters: ${JSON.stringify(tail.slice(0, 60))}`
    );
  }

  if (!rootClosed) return incomplete(`the closing </${ROOT}> is missing after ${length} characters`);
  if (depth > 0) return incomplete(`${depth} element(s) were opened and never closed`);

  return { complete: true, reason: '', length };
}

/**
 * Pull the report document out of a plain-text model reply.
 *
 * The main generation is constrained by a `responseSchema`, so its
 * `repxContent` arrives as a bare string. A repair request is not — asking for
 * raw XML rather than XML escaped inside JSON is most of the point, since the
 * escaping is pure overhead on the one artifact that ran out of room. The cost
 * of leaving the schema behind is that the reply may arrive wrapped: a ```xml
 * fence, or a sentence of preamble before the declaration.
 *
 * Returns the document from its first tag to the last closing root tag, or the
 * input trimmed when there is no root to find — never null, so the caller's
 * completeness check stays the single place that decides whether the repair is
 * usable.
 */
export function extractRepxDocument(text: string | undefined | null): string {
  const raw = text?.trim() ?? '';
  if (!raw) return '';

  const close = `</${ROOT}>`;
  const end = raw.lastIndexOf(close);
  const open = raw.indexOf('<?xml');
  const rootOpen = raw.indexOf(`<${ROOT}`);

  // Prefer the declaration when it is there and sits before the root; a fenced
  // reply puts ```xml ahead of both, and neither belongs in the file.
  const start = open >= 0 && (rootOpen < 0 || open < rootOpen) ? open : rootOpen;
  if (start < 0) return raw;

  return end > start ? raw.slice(start, end + close.length) : raw.slice(start);
}
