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
    // rather than let esbuild substitute {} and warn — the module then falls
    // through to process.env, which is what the server wants anyway.
    'import.meta.env': 'undefined',
  },
});
