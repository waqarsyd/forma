/**
 * Nested groups written without `Level`, which DevExpress nests inside out.
 *
 * ## The measurement
 *
 * Two group headers over the same records, printed through DevExpress 20.1
 * seven ways (case s19 of `docs/proposals/devexpress-parity.md`, 2026-10-30):
 *
 * - the higher `Level` is the outer group, whatever the file order;
 * - a missing `Level` is 0, and between equal levels the band LATER in the
 *   file is the outer one -- so Region then Category written outer-first with
 *   no `Level` printed Category outside Region;
 * - a designer-saved file writes `Level="1"` on the outer band and omits the
 *   inner band's default 0, and nests correctly in either file order;
 * - a group footer closes the group whose header declares its level, ties
 *   paired in file order.
 *
 * Nothing in the prompt mentioned `Level` until parity row 29, so every nested
 * grouping the model wrote came out inverted. The prompt now asks for it, and
 * this repair covers the reports where the model leaves it off.
 *
 * ## What it assumes, and when it declines
 *
 * Only a band list with two or more group headers and no `Level` anywhere on
 * its group bands is touched. A single `Level` means someone decided, and a
 * single group cannot nest the wrong way. Headers are taken as written
 * outermost first, the way the page shows them, and numbered from the top.
 *
 * Footers are the harder half, because they print innermost first and
 * nothing measured says which order a model writes them in. A footer that names
 * a group's field, in its text or its bindings ("Region total", `[Region]`),
 * closes that group, and the innermost one when it names more than one, since
 * an outer group's footer has no single inner value to show. A footer that
 * names none is taken in the order the page prints them: innermost first. More
 * footers than headers is declined rather than guessed at.
 *
 * `Level` is written only where it is not 0, as the designer writes it. Each
 * report's own `<Bands>` is a separate list, so a detail report's groups are
 * numbered on their own.
 */

export interface GroupLevelRepair {
  xml: string;
  applied: boolean;
  reason: string;
  /** Every group band given a level, in file order, 0 included. */
  levels: { band: string; level: number }[];
}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

const attrOf = (attrs: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

interface GroupBand {
  kind: 'header' | 'footer';
  name: string;
  attrs: string;
  /** Offset of the opening tag and of the attribute list inside it. */
  at: number;
  attrsAt: number;
  /** A header's group fields. */
  fields: string[];
  /** A footer's texts and binding expressions, decoded. */
  texts: string[];
}

interface Open {
  name: string;
  /** The group band this element is, or sits in. */
  group: GroupBand | null;
  /** The band list this element is, or null. */
  list: GroupBand[] | null;
}

/** Every `<Bands>` element's group bands, in file order, one array per list. */
function bandLists(xml: string): GroupBand[][] {
  const lists: GroupBand[][] = [];
  const stack: Open[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const parent = stack[stack.length - 1];
    let group = parent?.group ?? null;
    let list: GroupBand[] | null = null;

    if (name === 'Bands') {
      list = [];
      lists.push(list);
    } else if (parent?.list) {
      const type = attrOf(attrs, 'ControlType') ?? '';
      if (type === 'GroupHeaderBand' || type === 'GroupFooterBand') {
        group = {
          kind: type === 'GroupHeaderBand' ? 'header' : 'footer',
          name: attrOf(attrs, 'Name') ?? `Item ${parent.list.length + 1}`,
          attrs,
          at: m.index,
          attrsAt: m.index + 1 + name.length,
          fields: [],
          texts: [],
        };
        parent.list.push(group);
      } else {
        group = null;
      }
    } else if (group) {
      if (group.kind === 'header' && parent?.name === 'GroupFields') {
        const field = attrOf(attrs, 'FieldName');
        if (field) group.fields.push(decode(field));
      }
      if (group.kind === 'footer') {
        for (const key of ['Text', 'Expression']) {
          const value = attrOf(attrs, key);
          if (value) group.texts.push(decode(value));
        }
      }
    }

    if (!selfClosing) stack.push({ name, group, list });
  }
  return lists;
}

const names = (texts: readonly string[], field: string) => {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`);
  return texts.some((t) => word.test(t));
};

/**
 * Each group band's level for one band list, or why it is left alone.
 * Headers are numbered from the top; footers follow the header they close.
 */
function levelsFor(list: readonly GroupBand[]): Map<GroupBand, number> | string {
  const headers = list.filter((b) => b.kind === 'header');
  const footers = list.filter((b) => b.kind === 'footer');
  if (headers.length < 2) return 'fewer than two group headers';
  if (list.some((b) => attrOf(b.attrs, 'Level') !== null)) return 'a Level is already declared';
  if (footers.length > headers.length) return `${footers.length} group footers for ${headers.length} headers`;

  const n = headers.length;
  const levels = new Map<GroupBand, number>();
  headers.forEach((h, i) => levels.set(h, n - 1 - i));

  // Innermost first: the last header written is the innermost group.
  const open = [...headers].reverse();
  const unnamed: GroupBand[] = [];
  for (const footer of footers) {
    const at = open.findIndex((h) => h.fields.some((f) => names(footer.texts, f)));
    if (at >= 0) levels.set(footer, levels.get(open.splice(at, 1)[0])!);
    else unnamed.push(footer);
  }
  unnamed.forEach((footer, i) => levels.set(footer, levels.get(open[i])!));
  return levels;
}

/**
 * Give every nested group band the `Level` that nests it as written.
 *
 * Inserts `Level="n"` after the band's `Name`, or after its `ControlType`
 * when it has no name, for every level above 0. Running it twice is a no-op,
 * since the first run leaves a `Level` on the outer bands.
 */
export function repairGroupLevels(xml: string | undefined | null): GroupLevelRepair {
  const text = xml ?? '';
  const edits: { at: number; insert: string }[] = [];
  const levels: { band: string; level: number }[] = [];
  const declined: string[] = [];

  for (const list of bandLists(text)) {
    if (!list.some((b) => b.kind === 'header')) continue;
    const result = levelsFor(list);
    if (typeof result === 'string') {
      if (list.filter((b) => b.kind === 'header').length > 1) declined.push(result);
      continue;
    }
    for (const band of list) {
      const level = result.get(band) ?? 0;
      levels.push({ band: band.name, level });
      if (level === 0) continue;
      const anchor = /\sName\s*=\s*"[^"]*"/.exec(band.attrs) ?? /\sControlType\s*=\s*"[^"]*"/.exec(band.attrs);
      const offset = anchor ? anchor.index + anchor[0].length : 0;
      edits.push({ at: band.attrsAt + offset, insert: ` Level="${level}"` });
    }
  }

  if (!edits.length) {
    return {
      xml: text,
      applied: false,
      reason: declined.length ? `nested groups left as written: ${declined.join('; ')}` : 'no nested groups without a Level',
      levels: [],
    };
  }

  let out = text;
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.insert + out.slice(edit.at);
  }
  return {
    xml: out,
    applied: true,
    reason: 'numbered nested groups outermost-highest: ' + levels.map((l) => `${l.band} ${l.level}`).join(', '),
    levels,
  };
}
