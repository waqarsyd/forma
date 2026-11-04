/**
 * Drawn pages read by OCR the way the app reads an attached image
 * (2026-11-04, taken out of evaluate.ts so the box reader's training can use
 * it too): enlarged twice when narrower than 1,600 pixels, as lib/ocr.ts
 * does, then Tesseract with the app's own language data, then `ocrPageFrom`.
 *
 * Readings are kept in a JSON file beside the pages and saved as they come,
 * so a long run that stops resumes where it stopped. The enlarged copies are
 * drawn by Pillow, which render.py needs anyway, into an `x2` folder.
 */
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ocrPageFrom, type OcrPage } from '../../src/lib/ocr';

/** The app's threshold: a page narrower than this is read at twice its size (lib/ocr.ts). */
const ENLARGE_BELOW = 1600;

/** A PNG's width and height, from its header. */
function pngSize(path: string): [number, number] {
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(24);
  readSync(fd, head, 0, 24, 0);
  closeSync(fd);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

/**
 * The readings of `images` in `dir`, from `cachePath` where already read and
 * by OCR where not, with `workers` Tesseract workers at once.
 */
export async function readWithOcr(dir: string, images: readonly string[], cachePath: string, workers = 1, log = true): Promise<Record<string, OcrPage>> {
  const cache: Record<string, OcrPage> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const missing = images.filter((name) => !cache[name]);
  if (!missing.length) return cache;

  const sizes = new Map(missing.map((name) => [name, pngSize(join(dir, name))]));
  const small = missing.filter((name) => sizes.get(name)![0] < ENLARGE_BELOW);
  const big = join(dir, 'x2');
  mkdirSync(big, { recursive: true });
  const enlarge =
    'import sys, os\nfrom PIL import Image\nsrc, dst = sys.argv[1], sys.argv[2]\n' +
    'for name in sys.argv[3:]:\n    im = Image.open(os.path.join(src, name))\n' +
    '    im.resize((im.width * 2, im.height * 2), Image.BILINEAR).save(os.path.join(dst, name))\n';
  const toEnlarge = small.filter((name) => !existsSync(join(big, name)));
  // In batches, to stay under Windows' command-line length.
  for (let i = 0; i < toEnlarge.length; i += 150) execFileSync('python', ['-c', enlarge, dir, big, ...toEnlarge.slice(i, i + 150)], { stdio: 'inherit' });

  const { createWorker, createScheduler, OEM } = await import('tesseract.js');
  const scheduler = createScheduler();
  for (let w = 0; w < workers; w++) {
    scheduler.addWorker(
      await createWorker('eng', OEM.LSTM_ONLY, {
        langPath: resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
        gzip: true,
        cachePath: join(dir, '.tesseract'),
      }),
    );
  }
  let done = 0;
  let saved = Date.now();
  await Promise.all(
    missing.map(async (name) => {
      const [width, height] = sizes.get(name)!;
      const scale = width < ENLARGE_BELOW ? 2 : 1;
      const result = (await scheduler.addJob('recognize', join(scale === 2 ? big : dir, name), {}, { blocks: true })) as { data: { blocks: unknown } };
      cache[name] = ocrPageFrom(result.data.blocks as never, { width, height, dpi: null }, scale);
      done++;
      if (log && (done % 25 === 0 || done === missing.length)) console.error(`OCR ${done}/${missing.length} in ${dir}`);
      if (Date.now() - saved > 60_000) {
        writeFileSync(cachePath, JSON.stringify(cache));
        saved = Date.now();
      }
    }),
  );
  await scheduler.terminate();
  writeFileSync(cachePath, JSON.stringify(cache));
  return cache;
}
