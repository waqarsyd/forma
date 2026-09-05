/**
 * The shape of a generated report: what the model returns, and what the mockup
 * and the REPX writer both read.
 *
 * These lived in `services/geminiService.ts` and were imported *upward* by three
 * modules in `lib/` — the only edges in the graph pointing that way (audit
 * ARC-005). They are erased at compile time so they carried no runtime cost,
 * but they meant a file in `lib/`, whose whole purpose is to be readable and
 * testable on its own, could not be understood without opening a 1,500-line
 * service.
 *
 * The direction matters more than the tidiness. `lib/` is the layer that has no
 * dependencies; a type living in `services/` and consumed by `lib/` is an
 * invitation to move a *value* the same way later, and that one would not be
 * free.
 *
 * `geminiService.ts` re-exports everything here, so `import type { ReportLayout }
 * from '../services/geminiService'` keeps working for callers that think of
 * these as part of the service's contract — which, from `App.tsx`'s side, they
 * are.
 */

/** One cell of a real `table` element. Weights are relative, like XRTableCell's. */
export interface ReportCell {
  content: string;
  /** Relative width within the row. Cells default to equal shares when omitted. */
  weight?: number;
  bold?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
}

export interface ReportRow {
  cells: ReportCell[];
  /** Relative height within the table. Rows default to equal shares when omitted. */
  weight?: number;
  /** Header rows are drawn with the table's header emphasis. */
  isHeader?: boolean;
}

/**
 * A rectangle inside one of the uploaded source images, expressed as fractions
 * of that image's width/height (0..1). It lets the mockup crop the real artwork
 * out of the user's upload instead of drawing a grey placeholder — see
 * cropSourceRegion() in App.tsx. Fractions rather than pixels because the model
 * does not know the file's true pixel dimensions.
 */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReportElement {
  id: string;
  type: 'label' | 'table' | 'chart' | 'gauge' | 'image' | 'line' | 'barcode' | 'checkbox';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  /** Legacy "all four sides" flag. Still honoured; prefer the per-side flags below. */
  hasBorder?: boolean;

  /* --- Type fidelity, added so the mockup can resemble the source design. --- *
   * Every field is optional and the renderer falls back to the old behaviour
   * when absent, so layouts saved by earlier builds still render. */

  /**
   * `checkbox` only: is the box ticked in the source design?
   *
   * Optional and absent-means-false, which mirrors the REPX exactly — DevExpress
   * writes neither state attribute for an unchecked box, so the empty box is
   * the silent default on both sides.
   */
  checked?: boolean;

  bold?: boolean;
  italic?: boolean;
  /** Font family name as seen in the design, e.g. "Arial". Rendered best-effort. */
  fontFamily?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** True when the text flows onto multiple lines instead of being clipped. */
  wrap?: boolean;

  /** Per-side borders. Reports commonly rule only the bottom of a heading. */
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderColor?: string;

  /** Real grid content for `type: "table"`. Without it the table renders empty. */
  rows?: ReportRow[];

  /** Shape hint for `type: "chart"`, and the bar/point heights to draw. */
  chartType?: 'bar' | 'line' | 'pie' | 'area';
  chartValues?: number[];

  /**
   * Where this element's artwork sits in the upload, as Gemini's own detection
   * format: `[ymin, xmin, ymax, xmax]`, each normalised to 0-1000.
   *
   * This is deliberately not the more obvious {x, y, width, height} shape.
   * Asked for fractions the model reliably answered "the whole page"
   * ({0,0,1,1}) for every picture in a multi-image design; asked in the format
   * it was actually trained to emit for object detection, it localises. Order
   * really is y-first — swapping it silently transposes every crop.
   */
  box2d?: number[];

  /** Legacy fractional rectangle. Still honoured for reports saved earlier. */
  sourceRect?: SourceRect;
  /** Which uploaded file the box refers to. Defaults to the first. */
  sourceImageIndex?: number;
}

export interface ReportSection {
  id: string;
  name: string;
  type: 'header' | 'detail' | 'footer' | 'group';
  height: number;
  elements: ReportElement[];
}

export interface ReportLayout {
  title: string;
  pageWidth: number;
  sections: ReportSection[];
}

export interface AnalysisResponse {
  markdown: string;
  layout: ReportLayout;
  repxContent: string;
}

/** One part of a request: an inline image, or text lifted out of an upload. */
export type AttachmentPart =
  | { inlineData: { data: string; mimeType: string } }
  | { text: string };
