// Fetch the handwriting model into vendor/handwriting/ (2026-11-04).
//
//   npm run fetch:handwriting
//
// Forma reads handwriting with TrOCR-small-handwritten (Microsoft, fine-tuned
// on IAM English lines), as the MIT-licensed ONNX conversion
// Xenova/trocr-small-handwritten, quantized: about 64 MB. The owner chose on
// 2026-11-04 to serve it from Forma's own site, opt-in, never from a CDN, so
// visitors' browsers contact no one but this site. It is too large to commit
// (the pre-commit hook refuses files over 1 MB), so this script downloads it
// once into vendor/handwriting/, which is gitignored, and vite.config.ts
// copies it into dist/handwriting/ at build when it is there.
//
// Every file is pinned to one commit of the model repository and to its
// SHA-256, so a build serves exactly the model that was measured (scores in
// docs/notes/app-shell.md, *Handwriting*). A file whose hash differs is
// refused and deleted. Files already present and correct are kept.
//
// Run it before `npm run build` for the deployed site. A build without it
// has no handwriting files, and the switch in Settings says so.
//
// Pure ASCII, like the other scripts here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REPO = 'Xenova/trocr-small-handwritten';
const COMMIT = '02bea33ca09a70e2e2d91140a7e6e1a729606a5b';
const OUT = join('vendor', 'handwriting', REPO);

const FILES = {
  'config.json': 'ab388d889bdead2a554fc77ae4899caabdb279318e660b457afd29394e8ee43d',
  'generation_config.json': 'cce308da91e0d656e07404c70d4b9c9f5839d426f679eff6fda6dcc0e727e3b6',
  'preprocessor_config.json': '70da3434c33eedb3b56caf4067851741dfeed02f67576dcc3c6407c2533bfaf0',
  'tokenizer.json': '68bcb5468c854362a615f3d2ff6a5e4091a85f4c8198993ed9a30afe0b143737',
  'tokenizer_config.json': 'ce50304582ca15b925982e96dfe56548ddbaba89b584e73176d6bb3a5a0b4713',
  'onnx/encoder_model_quantized.onnx': '2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03',
  'onnx/decoder_model_merged_quantized.onnx': '51076aa396ab5939c4668db9de901ad51765094b4c05c4c8c1f8ae2012ba1e08',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
let fetched = 0;
let kept = 0;
for (const [name, want] of Object.entries(FILES)) {
  const path = join(OUT, name);
  if (existsSync(path) && sha256(readFileSync(path)) === want) {
    kept++;
    continue;
  }
  const url = `https://huggingface.co/${REPO}/resolve/${COMMIT}/${name}`;
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  fetched++;
  console.log(`${name}: ${buf.length.toLocaleString('en-US')} B`);
}
console.log(`handwriting model in ${OUT}: ${fetched} fetched, ${kept} already there and correct`);
