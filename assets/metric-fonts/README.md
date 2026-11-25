# Fonts that measure Calibri and Cambria in Node

In Node, Forma (its MCP server, its command line, and the fidelity benchmark,
which make reports with the same parts) measures text on @napi-rs/canvas: for the print check,
the fit to the page and the box reader's widths. The canvas finds a family among the fonts the machine
has. Windows has Calibri and Cambria; a Linux host or a container usually has
neither, and every line in them would be measured in another family's widths.
Calibri is Office's default body font, and the one Forma reads a Word or Excel
template in when the template names none (`docxLayout.ts`, `xlsxLayout.ts`);
on such a host it measured 16% wide.

So where the machine lacks Calibri or Cambria, `src/mcp/nodeFonts.ts`
(`useMetricFonts`) registers these faces under those names, each with its own
weight and style, in the process only. Nothing changes the files, nothing
serves them: the site's build copies only the files `vite.config.ts` names
(`PDF_FONT_ASSETS` takes Liberation's from `assets/pdf-fonts`, none from here),
and no PDF embeds them. Arial, Times New Roman and Courier New are measured the
same way in the Liberation faces of `assets/pdf-fonts` (its README).

| Measures | With | Licence |
|---|---|---|
| Calibri | Carlito 1.104 | SIL Open Font License 1.1, Reserved Font Name "Carlito" (`OFL-carlito.txt`) |
| Cambria | Caladea 1.002 | Apache License 2.0 (`Apache-2.0-caladea.txt`) |

## How close they measure

Measured on 2026-11-24 with @napi-rs/canvas 1.2.0 at 2048 pixels, the size
`lib/textMeasure.ts` measures at, against the Calibri and Cambria installed on
Windows 11, on twelve lines of Latin text in all four faces:

- **Carlito** has Calibri's advance widths in every face: no difference,
  unkerned. Kerned, one line in Bold Italic differed by 6/2048 of an em.
  "AVATAR Wave To LT Yo" at 20pt: 263.685 units unkerned and 248.562 kerned,
  as Calibri. It has no glyph for five punctuation marks Calibri has (U+2010,
  U+2011, U+2024, U+2032, U+2038), which fall back to another face.
- **Caladea** is drawn on a 1000-unit em where Cambria's is 2048, so its widths
  are Cambria's rounded: the largest difference was 0.015 em unkerned (a line
  of figures, in Bold Italic) and 0.049 em kerned (a line made of kerning
  pairs, in Italic). "AVATAR Wave To LT Yo"
  at 20pt: 286.749 units unkerned and 269.055 kerned, against Cambria's 286.743
  and 269.097. It has no Greek or Cyrillic, which fall back to another face.

On WSL's Ubuntu 24.04, with these registered as `nodeFonts.ts` registers them,
the same rows came out the same, with the host's own fonts and with none.

## Where they come from

Downloaded on 2026-11-24 for the owner's decision OC7 (the CLI and Forma
Designer audit: commit Carlito and Caladea with checksums, for measuring on
Linux). Unmodified.

**Carlito 1.104**: the four TrueType files and `OFL.txt` (here
`OFL-carlito.txt`) from <https://github.com/googlefonts/carlito> at commit
`3a810cab78ebd6e2e4eed42af9e8453c4f9b850a` ("Carlito 1.104", 2023-03-09),
fetched from `https://raw.githubusercontent.com/googlefonts/carlito/<commit>/fonts/ttf/<file>`.
They are the files Google Fonts ships (`google/fonts`, `ofl/carlito`, which
took version 1.104 from that commit): the same git blob for each. The project
publishes no release archive, so there is no archive checksum; the commit and
the files' own checksums below pin them.

**Caladea 1.002**: the four TrueType files of `crosextrafonts-20130214.tar.gz`
(SHA-256 `c48d1c2fd613c9c06c959c34da7b8388059e2408d2bb19845dc3ed35f76e4d09`,
112,756 bytes), the ChromeOS release, from
<https://commondatastorage.googleapis.com/chromeos-localmirror/distfiles/crosextrafonts-20130214.tar.gz>.
Each file's name table says "Copyright (c) 2012 Huerta Tipografia" and
"Licensed under the Apache License, Version 2.0"; the archive holds no licence
file, so `Apache-2.0-caladea.txt` is the licence's text as
<https://www.apache.org/licenses/LICENSE-2.0.txt> serves it, unmodified.

Not the Caladea Google Fonts ships (`ofl/caladea`, version 1.001, under the
OFL, from <https://github.com/huertatipografica/Caladea> at `336a529c`), though
its licence is the one the audit expected: its widths are its own, not
Cambria's. "AVATAR Wave To LT Yo" at 20pt measured 273.527 units against
Cambria's 286.743, and its figures are proportional (the 1 is 741/2048 of an
em wide where Cambria's is 1134/2048), so it would have measured Cambria 4.6%
narrow while the result named no stand-in. Version 1.002 is the one with
Cambria's widths.

| File | Bytes | SHA-256 |
|---|---|---|
| `Caladea-Bold.ttf` | 58,892 | `74eda4fc5ffba0d8dc4aa76d41499f5ab76168d9ed6141c6417064c6244db9b6` |
| `Caladea-BoldItalic.ttf` | 61,828 | `f47a35ad6cd0efa9914d93f9d03c93e30c55da43674bccfabac73b3c0d522c01` |
| `Caladea-Italic.ttf` | 61,860 | `9c968bf60ba1e851cdfea77c71e3540c57792f77482dd241acc29d1425569c4e` |
| `Caladea-Regular.ttf` | 58,964 | `d2f6cad33f191e65b68bd74e6d4f7708080a41b32db635866109df3090265d91` |
| `Carlito-Bold.ttf` | 682,468 | `bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db` |
| `Carlito-BoldItalic.ttf` | 808,508 | `b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517` |
| `Carlito-Italic.ttf` | 615,236 | `0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c` |
| `Carlito-Regular.ttf` | 628,032 | `f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595` |
| `OFL-carlito.txt` | 4,424 | `58402f82a7c332a700294988fe7554fbb0a63a8d27ccc1ee3bbc640311990a00` |
| `Apache-2.0-caladea.txt` | 11,358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |

Each file is under the pre-commit hook's 1 MB, and `.gitattributes` keeps
`*.ttf` binary.

## Licence

Carlito: SIL Open Font License 1.1, with "Carlito" as a Reserved Font Name;
the full text is `OFL-carlito.txt`. Caladea: Apache License 2.0, the licence
Forma itself is under; the full text is `Apache-2.0-caladea.txt`. Do not edit
the files here: a modified Carlito may not carry its name, and the point of
both is that their widths are the originals'.
