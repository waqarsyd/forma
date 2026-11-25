/**
 * The fonts Node measures text in (2026-11-24, the CLI and Forma Designer
 * work's wave 1: findings GAP2-1 to GAP2-4, and owner decision OC7 for
 * Carlito and Caladea).
 *
 * In Node, lib/textMeasure.ts measures on the @napi-rs/canvas
 * nodeGeneration.ts hands it (`measureOn`), and the canvas finds a family
 * among the fonts the host has. Windows has Arial, Times New Roman, Courier
 * New, Calibri and Cambria. A Linux host may have none of them: WSL's Ubuntu
 * 24.04, with DejaVu and Ubuntu's own fonts only, measured "AVATAR Wave To LT
 * Yo" at 20pt as 325.982 units in Arial and in Times New Roman alike, against
 * 311.822 and 307.020, and with no fonts at all it measured every width as
 * 0, so nothing wrapped, nothing grew and the print check found no extra
 * page. GitHub's ubuntu-24.04 runner most likely measured the first three
 * right by accident: Google Chrome's package depends on fonts-liberation, and
 * with Liberation installed @napi-rs/canvas found the three names through an
 * alias it does not document (measured on such a host, not on the runner).
 *
 * `useMetricFonts` registers, for each of the five families the host lacks,
 * Forma's own metric-compatible face under the family's name: Liberation
 * Sans, Serif and Mono 2.1.5 (assets/pdf-fonts, the faces the PDF/A export
 * embeds) for Arial, Times New Roman and Courier New, and Carlito 1.104 for
 * Calibri, each with the same advance widths, and Caladea 1.002 for Cambria,
 * whose widths are Cambria's rounded to its 1000-unit em, within 0.015 em a
 * line unkerned and 0.049 em kerned (assets/metric-fonts, whose README says
 * where they came from and how close they measured). Each face goes in
 * with its own weight and style, never bare: @napi-rs/canvas 1.2.0's
 * index.d.ts says "Without descriptors every face is `auto` and the newest
 * face wins; give `{ weight, style, stretch }` for each file of a family",
 * and four bare calls measured every style of Arial in its last face
 * (GAP2-2). Never `GlobalFonts.setAlias`, which measured every style as
 * Regular, and never `loadFontsFromDir`, which finds Arial in Liberation Sans
 * only through that undocumented alias. A file is registered in the process
 * alone; none is changed.
 *
 * GlobalFonts belongs to the process and its worker threads share it, and
 * `has` is true once a family is registered, so the faces are registered
 * once however many workers assemble Node's parts.
 *
 * `standInFamilies` (GAP2-4) names the families a report asks for that this
 * machine measured in a face of another family: on Linux, Tahoma, Segoe UI
 * or Verdana; on Windows too, a name @napi-rs/canvas does not find (Arial
 * Black, Calibri Light; and until 2026-11-25 Franklin Gothic Demi, asked for
 * as the browser names it, Franklin Gothic, which the canvas does not find,
 * where now it is asked for as GDI names it when the canvas finds that,
 * `familyFinder`). It asks the canvas for the very
 * font the widths come from (`measuringFont`) twice, once with Courier New
 * behind it and once with Times New Roman, both there on any machine once
 * `useMetricFonts` has run, and measures each letter, figure and stop of a
 * sample alone: a character the face has measures the same both times, and
 * one it lacks falls through to the two, which never measure alike on the
 * sample (Courier New's every advance is 1229/2048 of an em, and none of
 * Times New Roman's there is). So a family counts as found when any
 * character of the sample measures alike. Compared as a whole line, a face
 * the canvas finds but that lacks some of the sample's characters was named:
 * a Code 39 barcode font, with no lowercase, whose report text ("*12345*")
 * is measured in it exactly (the wave-1 review's FONTS-R2). The space is
 * left out, since a face with no letter of the sample, a symbol font or a
 * subset of accented letters such as src/fonts/inter-latin-ext.woff2, still
 * has one. That needs no list of names, Times New Roman, the canvas's own
 * fallback, included; asking `GlobalFonts.has` instead is wrong both ways:
 * false for Arial on a Linux host with Liberation installed, which the canvas
 * finds through its alias, and true for Franklin Gothic Demi, whose face is
 * asked for under another name.
 *
 * Text from a report never ends a job here: a font's name is decoded by
 * lib/xmlEscape.ts's `unescapeXml`, the one decoder, which leaves a
 * reference to no character as written (`&#x110000;`; a copy of its own
 * here threw on one, and the job lost a report its AI had made, FONTS-R1),
 * and genJobs.ts asks inside a guard.
 *
 * Pure ASCII.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalFonts } from '@napi-rs/canvas';
import { measuringFont } from '../lib/textMeasure';
import { unescapeXml } from '../lib/xmlEscape';

/** One file Forma registers for a family the host lacks. */
export interface MetricFace {
  /** The family a report names, which this face has the widths of. */
  readonly family: string;
  /** The file, from the clone's root. */
  readonly file: readonly string[];
  readonly weight: 'normal' | 'bold';
  readonly style: 'normal' | 'italic';
}

const fourFaces = (family: string, folder: string, base: string): MetricFace[] =>
  (
    [
      ['Regular', 'normal', 'normal'],
      ['Bold', 'bold', 'normal'],
      ['Italic', 'normal', 'italic'],
      ['BoldItalic', 'bold', 'italic'],
    ] as const
  ).map(([name, weight, style]) => ({ family, file: ['assets', folder, `${base}-${name}.ttf`], weight, style }));

/** Every face, the one table the registration and its tests share. */
export const METRIC_FACES: readonly MetricFace[] = Object.freeze([
  ...fourFaces('Arial', 'pdf-fonts', 'LiberationSans'),
  ...fourFaces('Times New Roman', 'pdf-fonts', 'LiberationSerif'),
  ...fourFaces('Courier New', 'pdf-fonts', 'LiberationMono'),
  ...fourFaces('Calibri', 'metric-fonts', 'Carlito'),
  ...fourFaces('Cambria', 'metric-fonts', 'Caladea'),
]);

/** A face's file in a clone. */
export function facePath(clone: string, face: MetricFace): string {
  return join(clone, ...face.file);
}

/** One face registered under `as`, its family by default, with its weight and style; an error that names the file when the canvas cannot read it. */
export function registerFace(clone: string, face: MetricFace, as: string = face.family): void {
  const path = facePath(clone, face);
  if (!GlobalFonts.registerFromPath(path, as, { weight: face.weight, style: face.style })) {
    throw new Error(`The font that measures ${face.family} could not be read from this clone (${path}). It is committed with Forma: restore it with git, then start again.`);
  }
}

/**
 * Registers the faces of each family in `faces` the host lacks, and returns
 * those families. Every file of them is looked for before any is registered,
 * so one missing file is an error naming it (NODE-3: never a quieter
 * report), with no family half registered.
 */
export function useMetricFonts(clone: string, faces: readonly MetricFace[] = METRIC_FACES): string[] {
  const missing = [...new Set(faces.map((f) => f.family))].filter((family) => !GlobalFonts.has(family));
  const wanted = faces.filter((f) => missing.includes(f.family));
  for (const face of wanted) {
    const path = facePath(clone, face);
    let found = false;
    try {
      found = statSync(path).isFile();
    } catch {
      found = false;
    }
    if (!found) throw new Error(`The font that measures ${face.family} on a machine without it is missing from this clone (${path}). It is committed with Forma: restore it with git, then start again.`);
  }
  for (const face of wanted) registerFace(clone, face);
  return missing;
}

/** What the measuring check says when the canvas measures nothing. */
export const NOTHING_MEASURES =
  'Text cannot be measured on this machine: the canvas measured "Arial" as nothing wide, so no line would wrap and the print check would find nothing. Reinstall the clone\'s dependencies (npm ci), then start again.';

/** Throws when the canvas `make` gives measures text as nothing wide (GAP2-1, NODE-3's rule): every width would be 0. */
export function checkMeasuring(make: () => CanvasRenderingContext2D | null): void {
  const context = make();
  if (context) context.font = '2048px "Arial"';
  const width = context?.measureText('Hg').width ?? 0;
  if (!(width > 0)) throw new Error(NOTHING_MEASURES);
}

/** A face a report's fonts name. */
export interface ReportFace {
  family: string;
  bold: boolean;
  italic: boolean;
}

/** A font as DevExpress writes it, `Arial, 9.75pt, style=Bold, Italic`: its family and style; null with no family. */
function faceOf(value: string): ReportFace | null {
  const text = unescapeXml(value);
  const family = text.split(',')[0].trim();
  if (!family) return null;
  return { family, bold: /style=[^"]*bold/i.test(text), italic: /style=[^"]*italic/i.test(text) };
}

/** The distinct faces a report's fonts name, in the order they first appear: each Font and DXFont, and each localized Font. */
export function reportFaces(xml: string): ReportFace[] {
  const values = [
    ...[...xml.matchAll(/\s(?:Font|DXFont)="([^"]*)"/g)].map((m) => m[1]),
    ...[...xml.matchAll(/<Item\d+\b([^>]*\bPath="Font"[^>]*)>/g)].flatMap((m) => /\sData="([^"]*)"/.exec(m[1])?.[1] ?? []),
  ];
  const seen = new Map<string, ReportFace>();
  for (const value of values) {
    const face = faceOf(value);
    const key = face && `${face.family.toLowerCase()}\u0000${face.bold}\u0000${face.italic}`;
    if (face && key && !seen.has(key)) seen.set(key, face);
  }
  return [...seen.values()];
}

/** At most this many distinct faces are asked about, so a report naming thousands costs no more. */
export const MAX_FACES_CHECKED = 64;

/** The characters a face is asked about, each alone: the letters, figures and stop of a line of an invoice, never the space (the header). */
const SAMPLE = [...new Set('Invoice No. 1234 Wim'.replace(/\s/g, ''))];
const RESET = '10px "Forma measuring reset"';

/**
 * The families of `xml`'s fonts that were measured in a face of another
 * family here (the header), in the order they first appear, as the report
 * spells them: text from the report, so a result carries them as data.
 */
export function standInFamilies(xml: string, make: () => CanvasRenderingContext2D | null): string[] {
  const faces = reportFaces(xml).slice(0, MAX_FACES_CHECKED);
  if (!faces.length) return [];
  const context = make();
  if (!context) return [];
  context.fontKerning = 'none';
  const named = new Map<string, string>();
  for (const face of faces) {
    const key = face.family.toLowerCase();
    if (named.has(key)) continue;
    const { css, stretch } = measuringFont(face);
    if (!foundIn(context, css, stretch)) named.set(key, face.family);
  }
  return [...named.values()];
}

/** Each sample character's width in `css`, or null when the canvas refused the font, as it refuses a family with a quote in it. */
function sampleWidths(context: CanvasRenderingContext2D, css: string, stretch: string): number[] | null {
  context.font = RESET;
  const before = context.font;
  context.font = css;
  if (context.font === before) return null;
  context.fontStretch = stretch as CanvasFontStretch;
  return SAMPLE.map((c) => context.measureText(c).width);
}

/** Whether the canvas finds the face `css` names: any sample character measuring alike behind Courier New and behind Times New Roman (the header). */
function foundIn(context: CanvasRenderingContext2D, css: string, stretch: string): boolean {
  const behindMono = sampleWidths(context, `${css}, "Courier New"`, stretch);
  const behindSerif = sampleWidths(context, `${css}, "Times New Roman"`, stretch);
  return behindMono !== null && behindSerif !== null && behindMono.some((width, i) => width === behindSerif[i]);
}

/**
 * Whether the canvas `make` gives finds a family by the name given, asked as
 * `standInFamilies` asks (the header), each family once (2026-11-25).
 * nodeGeneration.ts hands it to lib/textMeasure.ts with the canvas
 * (`measureOn`), which then asks for a family GDI names apart from the
 * browser by GDI's own name where the canvas finds that one: on Windows,
 * Franklin Gothic Demi measured in a fallback face under the browser's name,
 * Franklin Gothic, and exactly under its own (textMeasure.ts `nodeGdiFace`).
 */
export function familyFinder(make: () => CanvasRenderingContext2D | null): (family: string) => boolean {
  const known = new Map<string, boolean>();
  let context: CanvasRenderingContext2D | null | undefined;
  return (family: string) => {
    const key = family.toLowerCase();
    const was = known.get(key);
    if (was !== undefined) return was;
    if (context === undefined) {
      context = make();
      if (context) context.fontKerning = 'none';
    }
    const found = !!context && !/["\\]/.test(family) && foundIn(context, `2048px "${family}"`, 'normal');
    known.set(key, found);
    return found;
  };
}
