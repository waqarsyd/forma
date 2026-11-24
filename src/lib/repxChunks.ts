/**
 * Split a `.repx` into the units a house-style example is made of.
 *
 * Milestone 1 of `docs/proposals/rag.md`, and the only part of that proposal that
 * earns its place whether or not the rest is ever built: a structural chunker with
 * the data stripped out is useful for diffing two reports and for explaining an
 * audit finding, neither of which needs an embedding.
 *
 * ## Why the split is structural and not by length
 *
 * The obvious chunker cuts every N characters. A `.repx` is a tree, and cutting it
 * by length severs a control from the band that positions it: the fragment keeps
 * `LocationFloat="0,240"` and loses the fact that 240 is measured inside a page
 * footer. What comes back from a search is then a coordinate with no frame of
 * reference, which is worse than no result because it reads like an answer.
 *
 * So the unit is the band, and the control directly inside it. Those are the two
 * grains a person means by "our reports look like this" — how a footer is laid out,
 * and how a total is styled.
 *
 * ## Nested things ride with their parent, deliberately
 *
 * A control is chunked only when its nearest `ControlType`-bearing ancestor is a
 * band. Anything deeper — the labels inside an `XRPanel`, the cells inside an
 * `XRTable` — stays part of that parent's fragment instead of becoming a chunk of
 * its own. Emitting both would return the same XML twice for one query and spend
 * the retrieval budget saying one thing.
 *
 * **Do not reach for the rule that a collection item carries no `ControlType`.**
 * That holds for chart series and is measured in `docs/notes/gemini.md`; it does
 * not hold here. In `rptWorkerLedger_DJ.repx` all 47 `XRTableCell` elements carry
 * one, `Text` and all. They stay out of the chunk list because of the nesting rule
 * above and for no other reason, which is worth knowing before anyone "simplifies"
 * that rule away.
 *
 * Bands nest too — a `SubBand` inside a `DetailBand` — and the same rule applies
 * upward: **the chunkable band is the outermost one**, and a control anywhere
 * inside it is attributed to that band however many sub-bands sit in between. The
 * first version attributed to the *nearest* band, and against a real report that
 * produced nine bands captioned `empty` with all 44 controls filed under `sub
 * band`, which is both wrong and useless: "in the sub band" locates nothing.
 *
 * ## Everything that is data is replaced before it is stored
 *
 * `REDACTIONS` lists the attributes whose values are content rather than style, and
 * each is replaced with a placeholder as the fragment is cut. Three reasons, in
 * descending order of how badly it goes wrong:
 *
 * 1. **A model given an example copies it.** A retrieved fragment carrying
 *    `Text="Acme Ltd"` is one plausible step from an invoice generated for somebody
 *    else with Acme's name on it. The whole feature is an argument for putting other
 *    people's reports into a prompt, so this is the failure it has to answer for.
 * 2. **`Ref` is identity, and duplicating it destroys content.** Two controls
 *    sharing a `Ref` make the DevExpress loader discard one with no error — the
 *    defect recorded in `docs/notes/gemini.md`. An example fragment that keeps its
 *    original `Ref` is an invitation to copy it into a document that already has
 *    one. Redacting it costs nothing, because a number identifying a control in
 *    another file cannot mean anything in this one.
 * 3. Field names are schema, not style, and they are the part of a report most
 *    likely to be commercially specific.
 *
 * Geometry, fonts, colours, borders, alignment and format strings are all **kept**.
 * `TextFormatString` in particular is style rather than content — `{0:c2}` is a
 * decision about how money is shown, which is exactly what this is for.
 *
 * **The residual risk is stated rather than solved.** The list is explicit, so an
 * attribute nobody thought of is kept, and a DevExpress release that adds a
 * content-bearing attribute widens the hole quietly. The alternative — keep only
 * what is on an allowlist — fails the other way, dropping appearance the moment the
 * vendor adds any attribute, and a chunker that silently loses style is useless for
 * the one job it has. Revisit this if a real library turns up something leaking.
 *
 * ## What it does not do
 *
 * No network, no embedding, no storage, no ranking. This produces chunks and
 * captions from a string, deterministically, and stops there.
 */

/** One complete `<Tag …>`, `</Tag>` or `<Tag … />`, as the other repx helpers read them. */
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

/** Comments, CDATA and the declaration, which contain no elements. */
const NON_ELEMENT = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

/** One `name="value"` pair inside a tag's attribute run. */
const ATTR = /([\w.:-]+)\s*=\s*"([^"]*)"/g;

/**
 * Attribute values replaced before a fragment is kept, and what replaces them.
 *
 * Exported because the test asserts against this map rather than against a copy of
 * it — a list duplicated in a test is a list that drifts.
 */
export const REDACTIONS: Readonly<Record<string, string>> = {
  Text: '{text}',
  Name: '{name}',
  Tag: '{tag}',
  Ref: '{ref}',
  FieldName: '{field}',
  DataMember: '{field}',
  DataSource: '{field}',
  Expression: '{expr}',
  FilterString: '{filter}',
  NavigateUrl: '{url}',
  ImageUrl: '{url}',
  ImageSource: '{url}',
};

/** Appearance attributes worth naming in a caption, in the order a caption reads them. */
const DESCRIBED = ['Font', 'ForeColor', 'BackColor', 'TextAlignment', 'TextFormatString'] as const;

export interface RepxChunk {
  /** A band, or a control sitting directly inside one. */
  kind: 'band' | 'control';
  /** The short `ControlType`, namespace removed: `DetailBand`, `XRLabel`. */
  controlType: string;
  /** The band this chunk is in. A band chunk names itself. Empty when unknown. */
  band: string;
  /** Plain words, and the thing that gets embedded. Angle brackets embed badly. */
  caption: string;
  /** The fragment, redacted. Retrieval returns this; the caption only finds it. */
  xml: string;
  /** Where it came from, for showing a result. Empty when the caller gave no name. */
  source: string;
  /** How many attribute values were replaced, so a caller can say so. */
  redacted: number;
  /** Byte offset of the fragment in the original document. Chunks are in this order. */
  start: number;
}

/**
 * `DevExpress.XtraReports.UI.XRLabel` -> `XRLabel`.
 *
 * **The comma comes first, and a real report is why.** A `ControlType` may be
 * assembly-qualified — `rptWorkerLedger_DJ.repx` names its own root class as
 * `SBS.JMS.frmReport_DevViewer, SBS.JMS, Version=2.12.15.101, Culture=neutral,
 * PublicKeyToken=null`. Splitting that on `.` and taking the last segment answers
 * `101, Culture=neutral, PublicKeyToken=null`, which is not a type, reaches the
 * caption, and would be embedded as though it meant something. Any report
 * subclassed in a host application carries this shape, so it is the normal case
 * rather than an oddity.
 */
function shortType(value: string): string {
  const typeName = value.split(',')[0];
  const last = typeName.split('.').pop() ?? '';
  return last.trim();
}

/**
 * `GroupHeaderBand` -> `group header band`, `XRLabel` -> `label`.
 *
 * The `XR` prefix goes because a caption is read by an embedding model and by a
 * person, and neither gains anything from the vendor's naming convention.
 */
function readable(type: string): string {
  const bare = type.replace(/^XR/, '');
  const words = bare.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words || type.toLowerCase();
}

/** Parse a tag's attribute run into a map. Later duplicates lose, as in XML. */
function attributesOf(run: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(run)) !== null) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/** Replace every content-bearing attribute value in a fragment. */
function redact(fragment: string): { xml: string; redacted: number } {
  let redacted = 0;
  const xml = fragment.replace(/([\w.:-]+)(\s*=\s*)"([^"]*)"/g, (whole, name: string, eq: string, value: string) => {
    const placeholder = REDACTIONS[name];
    if (placeholder === undefined) return whole;
    // An already-empty value is not a leak, and counting it overstates the work.
    if (value !== '') redacted++;
    return `${name}${eq}"${placeholder}"`;
  });
  return { xml, redacted };
}

/** `Tahoma, 9pt, style=Bold` -> `Tahoma 9pt bold`, which reads as words. */
function describeFont(font: string): string {
  const parts = font.split(',').map((p) => p.trim()).filter(Boolean);
  const styles = parts
    .filter((p) => p.toLowerCase().startsWith('style='))
    .map((p) => p.slice(p.indexOf('=') + 1).replace(/,/g, ' ').toLowerCase());
  const rest = parts.filter((p) => !p.toLowerCase().startsWith('style='));
  return [...rest, ...styles].join(' ').trim();
}

/** The caption for one control: what it is, where it is, how it looks. */
function controlCaption(type: string, band: string, attrs: Record<string, string>): string {
  const where = band ? `in the ${readable(band)}` : 'in the report';
  const looks: string[] = [];
  for (const name of DESCRIBED) {
    // A font DevExpress 22.2 and later wrote as DXFont reads as one (GAP1-4).
    const value = attrs[name] || (name === 'Font' ? attrs.DXFont : undefined);
    if (!value) continue;
    if (name === 'Font') looks.push(describeFont(value));
    else if (name === 'TextAlignment') looks.push(`${readable(value)} aligned`);
    else if (name === 'TextFormatString') looks.push(`formatted ${value}`);
    else looks.push(`${readable(name)} ${value}`);
  }
  const head = `${readable(type)} ${where}`;
  return looks.length ? `${head}: ${looks.join(', ')}` : head;
}

/** The caption for one band: what it is, how tall, and what it holds. */
function bandCaption(type: string, attrs: Record<string, string>, children: string[]): string {
  const bits: string[] = [readable(type)];

  const height = attrs.HeightF;
  if (height) bits.push(`${Math.round(Number(height) || 0)} tall`);

  if (children.length === 0) {
    bits.push('empty');
  } else {
    const counts = new Map<string, number>();
    for (const child of children) counts.set(child, (counts.get(child) ?? 0) + 1);
    const listed = [...counts.entries()].map(([name, n]) => (n > 1 ? `${n} ${name}s` : `1 ${name}`));
    bits.push(`containing ${listed.join(', ')}`);
  }

  return bits.join(', ');
}

interface Frame {
  /** Short `ControlType`, or `''` for a wrapper like `<Controls>`. */
  type: string;
  isBand: boolean;
  attrs: Record<string, string>;
  start: number;
  /** The band in scope when this element opened. */
  band: string;
  /** Readable names of the controls chunked directly inside this band. */
  children: string[];
}

/**
 * Chunk a report into bands and the controls directly inside them.
 *
 * Returns `[]` rather than throwing for anything it cannot read — empty input, a
 * fragment with no bands, a truncated document. A half-written `.repx` is a real
 * input here (see `repxTruncation.ts`), and a chunker that throws on one would take
 * an import of two hundred files down on the first bad one.
 */
export function chunkRepx(xml: string | undefined | null, source = ''): RepxChunk[] {
  const text = xml ?? '';
  if (!text.trim()) return [];

  // Blank out what does not nest, preserving length so offsets stay valid.
  const scannable = text.replace(NON_ELEMENT, (m) => ' '.repeat(m.length));

  const chunks: RepxChunk[] = [];
  const stack: Frame[] = [];

  /** The nearest enclosing element that has a ControlType, ignoring wrappers. */
  const enclosing = (): Frame | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type) return stack[i];
    }
    return undefined;
  };

  /**
   * The outermost enclosing band — the one that gets chunked.
   *
   * Sub-bands are transparent for attribution: a control eight levels down inside
   * a `SubBand` inside a `DetailBand` belongs to the detail band, because that is
   * the band a person means when they ask how the detail is laid out.
   */
  const owningBand = (): Frame | undefined => stack.find((f) => f.isBand);

  const emit = (frame: Frame, end: number): void => {
    const fragment = text.slice(frame.start, end);
    const { xml: redacted, redacted: count } = redact(fragment);
    chunks.push({
      kind: frame.isBand ? 'band' : 'control',
      controlType: frame.type,
      band: frame.isBand ? frame.type : frame.band,
      caption: frame.isBand
        ? bandCaption(frame.type, frame.attrs, frame.children)
        : controlCaption(frame.type, frame.band, frame.attrs),
      xml: redacted,
      source,
      redacted: count,
      start: frame.start,
    });
  };

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(scannable)) !== null) {
    const [, closing, , run, selfClosing] = m;

    if (closing) {
      const frame = stack.pop();
      if (frame?.type && shouldChunk(frame, stack)) emit(frame, TAG.lastIndex);
      continue;
    }

    const attrs = attributesOf(run);
    const type = attrs.ControlType ? shortType(attrs.ControlType) : '';
    const parent = enclosing();
    const owner = owningBand();
    const frame: Frame = {
      type,
      isBand: type.endsWith('Band'),
      attrs,
      start: m.index,
      band: owner?.type ?? '',
      children: [],
    };

    // Register with the outermost band before anything else can close. Only
    // chunked controls are counted, so a band's caption lists what retrieval can
    // actually return rather than everything nested anywhere inside it.
    if (type && !frame.isBand && parent?.isBand && owner) owner.children.push(readable(type));

    if (selfClosing) {
      if (type && shouldChunk(frame, stack)) emit(frame, TAG.lastIndex);
      continue;
    }
    stack.push(frame);
  }

  // Bands close after the controls inside them, so emission order is not document
  // order. Callers expect the report read top to bottom.
  return chunks.sort((a, b) => a.start - b.start);
}

/**
 * A band, or a control whose nearest typed ancestor is a band or the report root.
 *
 * The band arm is what makes the *outermost* band the chunk: a `SubBand` has a band
 * for a parent and so is not one of its own, and its contents travel inside the band
 * that holds it.
 *
 * The root arm is for cross-band controls. An `XRCrossBandBox` lives in the report's
 * own `<CrossBandControls>` rather than in any band — it spans several, which is the
 * point of it — so a rule that only looked for a band parent dropped it silently.
 * `rptWorkerLedger_DJ.repx` has one.
 *
 * `stack` is the ancestry *excluding* the frame itself in both call sites: on a
 * self-closing tag nothing was pushed, and on a closing tag the frame has already
 * been popped.
 */
function shouldChunk(frame: Frame, stack: readonly Frame[]): boolean {
  let parent: Frame | undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type) {
      parent = stack[i];
      break;
    }
  }
  if (frame.isBand) return !parent?.isBand;
  return parent?.isBand === true || (parent !== undefined && parent === stack[0]);
}
