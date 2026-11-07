import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {createServer, defineConfig, type Plugin} from 'vite';
import {createReadStream, existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execSync} from 'node:child_process';
import {resolve} from 'node:path';
import {atomFeed, RELEASES} from './src/lib/releases';
import {headFor, llmsTxt, pageFile, robotsTxt, securityTxt, sitemapXml, softwareJsonLd, withHead} from './src/lib/seo';
import {ROUTES} from './src/lib/router';
import {licenceNotice, licenseOf, packageDirOf, type LicensedWork} from './src/lib/licenceNotice';

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
  // The languages OCR reads besides English (2026-11-04), each fetched only when
  // a page turns out to need it (lib/ocrScript.ts): Arabic, Urdu and Hindi to
  // probe a page English garbled, French, German and Spanish for a page in one.
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

/**
 * Handwriting (2026-11-04, lib/handwriting.ts): TrOCR-small-handwritten, read
 * by Transformers.js on ONNX Runtime's WebAssembly, every file served from
 * this site, the owner's choice over a CDN, and fetched only when a page
 * looks handwritten (lib/ocrScript.ts, since 2026-11-04; a switch in Settings
 * before that). The runtime's WebAssembly Vite emits into
 * `assets/` itself, from the `new URL(…, import.meta.url)` onnxruntime-web
 * writes; the model is served at `/handwriting/models/` from
 * `vendor/handwriting/`, which `npm run fetch:handwriting` fills and git
 * ignores. A build without the model leaves those files out, and OCR then
 * keeps Tesseract's reading of a handwritten page (`handwritingServed`).
 */
const HANDWRITING_MODEL = 'vendor/handwriting/Xenova/trocr-small-handwritten';
/*
 * Only when the build is asked for it (2026-11-07, site audit item 2):
 * `FORMA_HANDWRITING=1 npm run build`. It was included whenever
 * vendor/handwriting held the model, so a deploy from a machine that had once
 * run fetch:handwriting shipped 68 MB of model onto the free plan's 360 MB a
 * day without anyone deciding to. README's *Handwriting* has the decision.
 */
const WITH_HANDWRITING = process.env.FORMA_HANDWRITING === '1';
const HANDWRITING_ASSETS: Record<string, string> = WITH_HANDWRITING
  ? Object.fromEntries(
      ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']
        .map((f) => [`models/Xenova/trocr-small-handwritten/${f}`, `${HANDWRITING_MODEL}/${f}`])
        .filter(([, source]) => existsSync(resolve(source))),
    )
  : {};

/**
 * A folder name for a set of files, from their contents (2026-11-07, site
 * audit item 91): ten hex digits of a SHA-256 over every name and every byte,
 * so a new engine, font or model gets a new URL and the old one can be cached
 * for good, as the hashed bundle is (`VERSIONED_DIRS` in src/server/
 * staticCache.ts, and firebase.json's rules). The client reads the paths from
 * `__FORMA_ASSETS__` (src/lib/assetPaths.ts).
 */
function versionOf(files: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    hash.update(name);
    const source = resolve(files[name]);
    if (existsSync(source)) hash.update(readFileSync(source));
  }
  return hash.digest('hex').slice(0, 10);
}

const CONTENT_TYPES: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.json': 'application/json' };

/**
 * Files served at `/<dir>/<version>/` from their sources in development and
 * copied into `dist/<dir>/<version>/` at build; `version` names the contents
 * (`versionOf`), since 2026-11-07.
 */
function servedAssets(dir: string, files: Record<string, string>, version: string): Plugin {
  return {
    name: `forma-${dir}-assets`,
    configureServer(server) {
      server.middlewares.use(`/${dir}/${version}`, (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (!(name in files)) return next();
        const ext = /\.[a-z]+$/.exec(name)?.[0] ?? '';
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? (name === 'LICENSE' ? 'text/plain' : 'application/octet-stream'));
        createReadStream(resolve(files[name])).on('error', () => next()).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `${dir}/${version}/${name}`, source: readFileSync(resolve(source)) });
      }
    },
  };
}

/** The served sets' folder names, computed once per build or dev server. */
const VERSIONS = {
  ocr: versionOf(OCR_ASSETS),
  pdfFonts: versionOf(PDF_FONT_ASSETS),
  model: versionOf(MODEL_ASSETS),
  handwriting: versionOf(HANDWRITING_ASSETS),
};

/** The commit the build is made from, or "unknown" outside a git checkout. */
function commitOf(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The page says which commit it was built from (2026-11-07, site audit item
 * 3): `<meta name="forma-version">`, so anyone, and the scheduled check in
 * .github/workflows/live.yml, can tell what the live site runs. It served the
 * 28 October build for weeks while README said it was main. A meta element,
 * not a script, so the inline script's CSP hash in securityHeaders.ts holds.
 */
function versionMeta(): Plugin {
  const commit = commitOf();
  return {
    name: 'forma-version',
    transformIndexHtml(html) {
      return html.replace('</head>', `  <meta name="forma-version" content="${commit}" />\n  </head>`);
    },
  };
}

/** The files a crawler asks for by name (site audit items 36 and 118), from src/lib/seo.ts. */
const CRAWLER_FILES = (): Record<string, { type: string; body: string }> => ({
  'robots.txt': { type: 'text/plain; charset=utf-8', body: robotsTxt() },
  'sitemap.xml': { type: 'application/xml; charset=utf-8', body: sitemapXml(RELEASES[0]?.date ?? new Date().toISOString().slice(0, 10)) },
  '.well-known/security.txt': { type: 'text/plain; charset=utf-8', body: securityTxt(new Date()) },
  'llms.txt': { type: 'text/plain; charset=utf-8', body: llmsTxt() },
});

/**
 * One page per route, each with its own head, the marketing pages drawn in
 * full, and the files crawlers ask for (2026-11-08, the site audit's batch
 * SB). Until then every route was one index.html: the home page's title,
 * description and preview on every page, no canonical address, and an empty
 * `<div id="root">` for anything that runs no script.
 *
 * After the bundle is written, the built index.html, its developer comments
 * taken out (item 73: 5 kB every visitor downloaded), is the template for
 * every page: `withHead` writes each route's title, description, preview,
 * canonical address and robots into it (src/lib/seo.ts), and the seven
 * marketing pages are rendered into their `<div id="root">` by
 * src/prerender.tsx through Vite's SSR loader, so a crawler and a link
 * preview read the page itself (item 54). The app replaces that markup with
 * the same page when its bundle runs. `pageFile` names each file, and
 * firebase.json and `npm start` serve them by it: `features.html` for
 * /features, `share.html` for /s/{id}, `404.html` for anything else.
 */
function pagesAndCrawlers(): Plugin {
  let outDir = 'dist';
  return {
    name: 'forma-pages-and-crawlers',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      for (const [name, file] of Object.entries(CRAWLER_FILES())) {
        server.middlewares.use(`/${name}`, (_req, res) => {
          res.setHeader('Content-Type', file.type);
          res.end(file.body);
        });
      }
    },
    generateBundle() {
      for (const [name, file] of Object.entries(CRAWLER_FILES())) this.emitFile({ type: 'asset', fileName: name, source: file.body });
    },
    async closeBundle() {
      const index = resolve(outDir, 'index.html');
      if (!existsSync(index)) return;
      const shell = readFileSync(index, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
      // The marketing pages, rendered by the same components the app draws.
      const ssr = await createServer({
        configFile: false,
        root: process.cwd(),
        logLevel: 'error',
        plugins: [react()],
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
        appType: 'custom',
        define: { __FORMA_ASSETS__: 'undefined' },
      });
      try {
        const { PRERENDERED, renderRoute } = (await ssr.ssrLoadModule('/src/prerender.tsx')) as {
          PRERENDERED: readonly string[];
          renderRoute: (route: string) => string;
        };
        for (const route of ROUTES) {
          const body = PRERENDERED.includes(route) ? renderRoute(route) : undefined;
          const page = withHead(shell, headFor(route), { body, extraHead: route === '/' ? softwareJsonLd() : undefined });
          writeFileSync(resolve(outDir, pageFile(route)), page);
        }
      } finally {
        await ssr.close();
      }
      writeFileSync(resolve(outDir, 'share.html'), withHead(shell, headFor(`/s/${'x'.repeat(16)}`)));
      writeFileSync(resolve(outDir, '404.html'), withHead(shell, headFor('/404')));
    },
  };
}

/**
 * The changelog's Atom feed (2026-11-07), written from src/lib/releases.ts:
 * served at /changelog.xml in development and emitted into dist/ at build, so
 * it needs no server and costs nothing. Firebase serves a file before its `**`
 * rewrite, so the static file is what a feed reader gets.
 */
function changelogFeed(): Plugin {
  const feed = () => atomFeed(RELEASES);
  return {
    name: 'forma-changelog-feed',
    configureServer(server) {
      server.middlewares.use('/changelog.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
        res.end(feed());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'changelog.xml', source: feed() });
    },
  };
}

/**
 * `/licenses.txt` (2026-11-08, site audit item 97): the licence of every npm
 * package the build put into the bundle, read from the package's own licence
 * file, with the packages and data the site serves beside it (Tesseract and
 * its language data, the three typefaces, the PDF fonts, and TrOCR when the
 * build carries it). `src/lib/licenceNotice.ts` writes the text; the footer
 * links it. In development it lists the project's direct dependencies, since
 * there is no bundle to read.
 */
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i;

function packageWork(dir: string): LicensedWork | null {
  const manifest = resolve(dir, 'package.json');
  if (!existsSync(manifest)) return null;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string; license?: unknown; licenses?: unknown; homepage?: string };
  if (!pkg.name) return null;
  const file = readdirSync(dir).find((f) => LICENCE_FILE.test(f));
  return {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg.license ?? pkg.licenses),
    text: file ? readFileSync(resolve(dir, file), 'utf8') : '',
    homepage: pkg.homepage,
  };
}

/** What the site serves beside the bundle, and the licence each comes with. */
function servedWorks(): LicensedWork[] {
  const ofl = (name: string, file: string): LicensedWork => ({ name, license: 'OFL-1.1', text: readFileSync(resolve(file), 'utf8') });
  const served = [
    'tesseract.js',
    'tesseract.js-core',
    ...['eng', 'ara', 'hin', 'urd', 'fra', 'deu', 'spa'].map((l) => `@tesseract.js-data/${l}`),
  ].map((name) => packageWork(resolve('node_modules', name)));
  return [
    ...served.filter((w): w is LicensedWork => w !== null),
    ofl('Inter (typeface)', 'src/fonts/OFL-inter.txt'),
    ofl('Hanken Grotesk (typeface)', 'src/fonts/OFL-hankengrotesk.txt'),
    ofl('JetBrains Mono (typeface)', 'src/fonts/OFL-jetbrainsmono.txt'),
    ofl('Liberation Sans, Serif and Mono 2.1.5 (fonts embedded in PDF/A files)', 'assets/pdf-fonts/LICENSE'),
    ...(Object.keys(HANDWRITING_ASSETS).length
      ? [{ name: 'TrOCR small handwritten (Microsoft), ONNX conversion Xenova/trocr-small-handwritten', license: 'MIT', text: '', homepage: 'https://huggingface.co/Xenova/trocr-small-handwritten' }]
      : []),
  ];
}

const LICENCE_HEADING = `Third-party notices for Forma (https://openforma.web.app)

Forma is open source under the Apache-2.0 licence, (c) 2026 Waqar Sayyed.
It ships the open-source code, data and typefaces below, each under its own
licence, which follows its name. Written when this build was made.`;

function thirdPartyLicences(): Plugin {
  return {
    name: 'forma-third-party-licences',
    configureServer(server) {
      server.middlewares.use('/licenses.txt', (_req, res) => {
        const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { dependencies?: Record<string, string> };
        const works = Object.keys(pkg.dependencies ?? {}).map((name) => packageWork(resolve('node_modules', name)));
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(licenceNotice([...works.filter((w): w is LicensedWork => w !== null), ...servedWorks()], LICENCE_HEADING));
      });
    },
    generateBundle(_options, bundle) {
      const dirs = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(output.modules)) {
          const dir = info.renderedLength > 0 ? packageDirOf(id) : null;
          if (dir) dirs.add(dir);
        }
      }
      const bundled = [...dirs].map(packageWork).filter((w): w is LicensedWork => w !== null);
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: licenceNotice([...bundled, ...servedWorks()], LICENCE_HEADING) });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      servedAssets('ocr', OCR_ASSETS, VERSIONS.ocr),
      servedAssets('pdf-fonts', PDF_FONT_ASSETS, VERSIONS.pdfFonts),
      servedAssets('model', MODEL_ASSETS, VERSIONS.model),
      servedAssets('handwriting', HANDWRITING_ASSETS, VERSIONS.handwriting),
      changelogFeed(),
      thirdPartyLicences(),
      versionMeta(),
      pagesAndCrawlers(),
    ],
    // The served sets' paths, for src/lib/assetPaths.ts (site audit item 91).
    define: {
      __FORMA_ASSETS__: JSON.stringify({
        ocr: `/ocr/${VERSIONS.ocr}/`,
        pdfFonts: `/pdf-fonts/${VERSIONS.pdfFonts}/`,
        model: `/model/${VERSIONS.model}/`,
        handwriting: `/handwriting/${VERSIONS.handwriting}/`,
      }),
    },
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
