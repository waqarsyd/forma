import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';
import {createReadStream, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/**
 * OCR's runtime, served from this site rather than a CDN (2026-11-01). The
 * owner approved Tesseract.js in the browser so that nothing an upload holds
 * leaves it; fetching the engine from jsDelivr, its default, would put a
 * third party back in front of every OCR run and need a new origin in the
 * CSP. So the worker, the three LSTM-only core builds tesseract.js picks
 * between by the browser's SIMD support, and the English data are served at
 * `/ocr/` straight from `node_modules` in development and copied into
 * `dist/ocr/` at build. Nothing is committed: they come with `npm ci`. Each
 * browser downloads one core build, and only when OCR first runs.
 */
const OCR_ASSETS: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  // The languages Settings offers besides English (2026-11-04, lib/ocrLanguages.ts),
  // each fetched only by someone who chose it.
  ...Object.fromEntries(
    ['ara', 'hin', 'urd', 'fra', 'deu', 'spa'].map((l) => [`${l}.traineddata.gz`, `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`]),
  ),
};

/**
 * The fonts a PDF/A file embeds (parity row 72, 2026-11-02): Liberation Sans,
 * Serif and Mono 2.1.5, committed unmodified under assets/pdf-fonts with
 * their SIL OFL licence, served at `/pdf-fonts/` and fetched only when a
 * PDF/A file is written. assets/pdf-fonts/README.md has where they came from.
 */
const PDF_FONT_ASSETS: Record<string, string> = Object.fromEntries([
  ...['Sans', 'Serif', 'Mono'].flatMap((family) =>
    ['Regular', 'Bold', 'Italic', 'BoldItalic'].map((style) => {
      const file = `Liberation${family}-${style}.ttf`;
      return [file, `assets/pdf-fonts/${file}`];
    }),
  ),
  ['LICENSE', 'assets/pdf-fonts/LICENSE'],
]);

/**
 * Forma's own model (2026-11-02): learned by scripts/model/train.ts from the
 * structure of the owner's reports, never their words, and fetched only when
 * the offline generator first runs. docs/proposals/own-model.md has the rest.
 */
const MODEL_ASSETS: Record<string, string> = {
  'formaModel.json': 'assets/model/formaModel.json',
  // Forma's box reader (2026-11-04, src/lib/boxReader.ts): the band and role of each text OCR reads, learned on the CPU.
  'boxReader.json': 'assets/model/boxReader.json',
};

const CONTENT_TYPES: Record<string, string> = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.json': 'application/json' };

/** Files served at `/<dir>/` from their sources in development and copied into `dist/<dir>/` at build. */
function servedAssets(dir: string, files: Record<string, string>): Plugin {
  return {
    name: `forma-${dir}-assets`,
    configureServer(server) {
      server.middlewares.use(`/${dir}`, (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!(name in files)) return next();
        const ext = /\.[a-z]+$/.exec(name)?.[0] ?? '';
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? (name === 'LICENSE' ? 'text/plain' : 'application/octet-stream'));
        createReadStream(resolve(files[name])).on('error', () => next()).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `${dir}/${name}`, source: readFileSync(resolve(source)) });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), servedAssets('ocr', OCR_ASSETS), servedAssets('pdf-fonts', PDF_FONT_ASSETS), servedAssets('model', MODEL_ASSETS)],
    // Only VITE_* reaches the client. GEMINI_* was previously allowlisted here,
    // which inlined GEMINI_API_KEY into the shipped bundle — Google's secret
    // scanner found that key and revoked it (403 "reported as leaked").
    //
    // Forma is bring-your-own-key: the user supplies their own Gemini key at
    // runtime and the browser calls Google directly with it. There is no
    // application-owned key to expose, so nothing Gemini-related belongs in
    // import.meta.env. Do not re-add a 'GEMINI_' prefix here.
    envPrefix: ['VITE_'],
    build: {
      rollupOptions: {
        output: {
          /**
           * The Firebase SDK in two chunks: `firebase` (the app, auth and the
           * `@firebase` internals both halves share) and `firestore` (the
           * database and its channel).
           *
           * Until 2026-11-01 this kept the whole SDK in one 619 kB chunk, on the
           * reasoning that `lib/firebaseClient.ts` always loaded both halves
           * together, so splitting would only add a request: Rollup's default
           * gave 129.52 kB + 492.32 kB, about 3 kB less than one chunk, and the
           * two did not duplicate shared internals. That premise stopped holding
           * when the repository audit found the "lazy" chunk fetched by every
           * page, because the header asks for the auth state on mount. Now
           * `loadAuth` loads auth alone and Firestore waits for a signed-in user,
           * which a single chunk would undo: the grouping would put the database
           * back in front of every visitor.
           *
           * The shared internals are named into `firebase` rather than left to
           * Rollup, because left alone they could land in whichever chunk asks
           * first, and auth is always first. If a static import of either half
           * reappears in the entry graph it turns eager again — the entry chunk's
           * own budget is what will catch that.
           */
          manualChunks(id: string) {
            if (/node_modules[\\/](@firebase[\\/](firestore|webchannel-wrapper)|firebase[\\/]firestore)[\\/]/.test(id)) {
              return 'firestore';
            }
            if (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase')) {
              return 'firebase';
            }
          },
        },
      },
    },
    // There is deliberately no `resolve.alias` here. An `'@'` alias pointing at
    // the repo root was declared in this file, in `vitest.config.ts` and in
    // `tsconfig.json`'s `paths` — three declarations, nothing checking they
    // agreed, and **zero imports using any of them**: every import in this
    // project is relative. Removed 2026-08-29 in commit 1e9b4e5, whose message
    // carries the full reasoning. If you want path aliases, add them back to all
    // three in one commit and actually use them.
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // tools/ holds a .NET project (RepxDesigner). MSBuild rewrites and briefly
      // locks files under its bin/ and obj/, and chokidar throws EBUSY when it
      // tries to watch one mid-build — which does not degrade, it takes the dev
      // server down with an unhandled 'error' event. Observed 2026-08-13: a
      // build while `npm run dev:log` was running killed it on
      // obj/Release/RepxDesigner.exe. Nothing under tools/ reaches the client
      // bundle, so there is nothing there worth watching.
      watch: { ignored: ['**/tools/**'] },
    },
  };
});
