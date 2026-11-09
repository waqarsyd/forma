// Fetch PaddleOCR's models into vendor/paddle/ (2026-11-10, the owner's AI
// accuracy programme, batch AC).
//
//   npm run fetch:paddle
//
// Forma reads a picture of a page with PaddleOCR's PP-OCRv5 mobile models
// (src/lib/paddleOcr.ts, lib/paddle.ts): PaddlePaddle's own ONNX exports of the
// text detector and the English recogniser, Apache-2.0, about 12.7 MB. They are
// served from Forma's own site, as every OCR file is, never from a CDN, so a
// visitor's browser contacts no one but this site and the picture never leaves
// it. Too large to commit (the pre-commit hook refuses files over 1 MB), so this
// script downloads them once into vendor/paddle/, which git ignores, and
// vite.config.ts copies them into dist/paddle/ at build when they are there.
//
// Every file is pinned to one commit of its repository and to its SHA-256, so a
// build serves exactly the models that were measured (docs/notes/app-shell.md,
// *OCR reads the text of an image or a scan*). A file whose hash differs is
// refused and deleted. Files already present and correct are kept.
//
// scripts/deploy.mjs runs it before building. A build without the models reads
// pictures with Tesseract alone, as Forma did until 2026-11-10.
//
// Pure ASCII, like the other scripts here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('vendor', 'paddle');

/** Each served file: its repository, the commit it is pinned to, its name there, and its SHA-256. */
const FILES = {
  'det.onnx': ['PaddlePaddle/PP-OCRv5_mobile_det_onnx', 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d', 'inference.onnx', 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d'],
  'rec-en.onnx': ['PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx', '3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b', 'inference.onnx', 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f'],
  'rec-en.yml': ['PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx', '3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b', 'inference.yml', '27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067'],
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
mkdirSync(OUT, { recursive: true });
let fetched = 0;
let kept = 0;
for (const [name, [repo, commit, remote, want]] of Object.entries(FILES)) {
  const path = join(OUT, name);
  if (existsSync(path) && sha256(readFileSync(path)) === want) {
    kept++;
    continue;
  }
  const url = `https://huggingface.co/${repo}/resolve/${commit}/${remote}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`${name}: ${res.status} ${res.statusText} from ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) {
    if (existsSync(path)) rmSync(path);
    console.error(`${name}: SHA-256 ${got} is not the pinned ${want}; refused.`);
    process.exit(1);
  }
  writeFileSync(path, buf);
  fetched++;
}
console.log(`PaddleOCR models in ${OUT}: ${fetched} fetched, ${kept} already there and correct.`);
