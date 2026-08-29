import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
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
    // There is deliberately no `resolve.alias` here. An `'@'` alias pointing at
    // the repo root was declared in this file, in `vitest.config.ts` and in
    // `tsconfig.json`'s `paths` — three declarations, nothing checking they
    // agreed, and **zero imports using any of them**: every import in this
    // project is relative. Removed 2026-08-29. If you want path aliases, add
    // them back to all three in one commit and actually use them; see
    // docs/cleanup/03-duplicates.md §3.4.
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
