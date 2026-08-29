import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Only VITE_* reaches the client. GEMINI_* was previously allowlisted here,
    // which inlined GEMINI_API_KEY into the shipped bundle — Google's secret
    // scanner found that key and revoked it (403 "reported as leaked").
    //
    // Forma is bring-your-own-key: the user supplies their own Gemini key at
    // runtime and the browser calls Google directly with it. There is no
    // application-owned key to expose, so nothing Gemini-related belongs in
    // import.meta.env. Do not re-add a 'GEMINI_' prefix here.
    envPrefix: ['VITE_'],
    // Declared in THREE files with nothing checking they agree: here,
    // `tsconfig.json` (as `paths`) and `vitest.config.ts`. Change one and the
    // build and the tests resolve `@` differently, silently — each config stays
    // valid on its own and every tool reports success. See
    // docs/cleanup/03-duplicates.md §3.4 for why it was not collapsed into a
    // shared module. **If you edit this, edit the other two.**
    //
    // And note the alias has **zero usages** as of 2026-08-29 — every import in
    // the project is relative. Use it or delete all three; do not keep a
    // three-way agreement nothing depends on.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
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
