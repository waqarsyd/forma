import { build } from 'esbuild';

// Bundles server.ts into the CommonJS artifact that `npm start` runs.
// NODE_ENV is baked in: this output is the production server, so it serves
// dist/ statically instead of booting Vite in middleware mode.
await build({
  entryPoints: ['server.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Keep node_modules external and resolved at runtime — bundling Vite and
  // @google/genai into the output buys nothing on a server.
  packages: 'external',
  define: {
    'process.env.NODE_ENV': '"production"',
    // geminiService.ts reads import.meta.env because Vite is the only thing that
    // populates it. There is no import.meta in a CJS bundle, so collapse it here
    // rather than let esbuild substitute {} and warn.
    //
    // The module then reads `(import.meta as any).env ?? {}` and gets an empty
    // object. This comment used to say it "falls through to process.env", which
    // it does not and never did (audit INV-009). Harmless — the server never
    // takes that path — but a reader acting on it would add a server-side flag
    // and watch it silently do nothing. Do not add the fallback either: a
    // server-side env read on a key-adjacent module is the pattern this project
    // deliberately removed.
    'import.meta.env': 'undefined',
  },
});
