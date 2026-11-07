#!/usr/bin/env node
/**
 * The app's icons, drawn from public/logo.png (2026-11-08, site audit item
 * 74): the home-screen icon iOS asks for (180, on white, as iOS fills a
 * transparent icon with black), the two sizes an installable web app needs
 * (192 and 512), a maskable 512 with the mark inside the safe zone a launcher
 * may crop to, and /favicon.ico, which browsers and crawlers ask for whatever
 * the page says and which was a 404.
 *
 *   node scripts/make-icons.mjs
 *
 * Run by hand when the logo changes, and commit what it writes under
 * public/icons/ and public/favicon.ico. The logo is a 256 px raster, so the
 * 512 sizes are scaled up from it, slightly soft; a vector master would make
 * them sharp, and the logo's design is the owner's (docs/notes/styling.md).
 * Uses sharp, which is in node_modules as Transformers.js's dependency (see
 * package.json's overrides.sharp); nothing ships it.
 *
 * Pure ASCII, as every script here.
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const SOURCE = 'public/logo.png';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** The logo at `size`, its mark scaled to `scale` of the square, on `background`. */
async function icon(file, size, scale, background) {
  const inner = Math.round(size * scale);
  const mark = await sharp(SOURCE).resize(inner, inner, { fit: 'contain', background: CLEAR, kernel: 'lanczos3' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    // A palette, as the mark is a few flat colours and two gradients: about a quarter of the bytes (49 kB for the four, from 180).
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
    .toFile(`${OUT}/${file}`);
  console.log(`${OUT}/${file}`);
}

await icon('apple-touch-icon.png', 180, 0.86, WHITE);
await icon('icon-192.png', 192, 1, CLEAR);
await icon('icon-512.png', 512, 1, CLEAR);
// Maskable: a launcher may crop to a circle of 80% of the square, so the mark sits inside it.
await icon('icon-512-maskable.png', 512, 0.72, WHITE);
// PNG data under the .ico name, which every current browser reads.
copyFileSync('public/favicon.png', 'public/favicon.ico');
console.log('public/favicon.ico');
