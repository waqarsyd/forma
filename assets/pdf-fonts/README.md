# Fonts embedded in Forma's PDF/A files

Forma's own PDF ("PDF with outline" in the Preview) draws text in the PDF
standard fonts. PDF/A forbids a font that is not embedded, so when a report
asks for PDF/A (`<ExportOptions><Pdf PdfACompatibility="PdfA1b|PdfA2b|PdfA3b">`)
the text is drawn in Liberation fonts and a subset of each face used goes into
the file (parity row 72; `src/lib/pdfFonts.ts`, `src/lib/trueType.ts`).

| Draws | With |
|---|---|
| Arial and the other sans families (PDF Helvetica) | Liberation Sans |
| Times New Roman and the serif families (PDF Times) | Liberation Serif |
| Courier New and the monospace families (PDF Courier) | Liberation Mono |

Each Liberation face has the same advance widths as the Windows font it stands
for, so a line keeps its length.

## Where they come from

These twelve files, unmodified, from the Liberation Fonts 2.1.5 release
(`liberation-fonts-ttf-2.1.5.tar.gz`, SHA-256
`7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`,
<https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5>),
downloaded on 2026-11-02 with the owner's approval.

Not the Liberation Sans inside `pdfjs-dist/standard_fonts/`, though it would
have saved committing four files: that one is version 1.07.4, from the
Liberation 1.x line, whose licence is the GPL with a font exception rather
than the OFL the licence file beside it states. One release under one licence
was the owner's choice.

| File | Bytes | SHA-256 |
|---|---|---|
| `LiberationMono-Bold.ttf` | 307,996 | `bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb` |
| `LiberationMono-BoldItalic.ttf` | 284,068 | `79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130` |
| `LiberationMono-Italic.ttf` | 281,536 | `605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1` |
| `LiberationMono-Regular.ttf` | 319,508 | `f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1` |
| `LiberationSans-Bold.ttf` | 414,456 | `788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173` |
| `LiberationSans-BoldItalic.ttf` | 408,996 | `698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee` |
| `LiberationSans-Italic.ttf` | 415,816 | `e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0` |
| `LiberationSans-Regular.ttf` | 410,712 | `76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8` |
| `LiberationSerif-Bold.ttf` | 370,096 | `d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce` |
| `LiberationSerif-BoldItalic.ttf` | 376,772 | `f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7` |
| `LiberationSerif-Italic.ttf` | 375,632 | `0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e` |
| `LiberationSerif-Regular.ttf` | 393,576 | `058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74` |

## Licence

SIL Open Font License 1.1, with "Liberation" as a Reserved Font Name; the full
text is `LICENSE` beside these files, from the same release. Do not edit the
files here: a modified font may not carry the Liberation name. Cutting a face
down to the glyphs a document uses when it is embedded is not a modification
the licence restricts, and is what `subsetTrueType` does to a copy.

## How they reach the browser

`pdfFontAssets` in `vite.config.ts` serves these faces and `LICENSE` at
`/pdf-fonts/` in development and copies them into `dist/pdf-fonts/` at build,
as OCR's engine is served at `/ocr/`. A browser fetches a face only when it
writes a PDF/A file that uses it. `scripts/check-bundle-size.mjs` budgets
`dist/pdf-fonts/` apart from the rest of the site.
