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
    build: {
      rollupOptions: {
        output: {
          /**
           * Keep the whole Firebase SDK in one chunk.
           *
           * `lib/firebaseClient.ts` dynamically imports `services/firebase` and
           * `firebase/firestore` separately, and Rollup's default splitting gave
           * each its own chunk: 129.52 kB + 492.32 kB. Grouping them yields one
           * 619.08 kB chunk — worth about 3 kB, so this is **not** a size fix. It
           * was tried as one, on the theory that the two chunks were duplicating
           * shared `@firebase` internals, and the measurement says they were not.
           *
           * What it buys is one request instead of two on the sign-in path, and
           * a single artifact that `check:size` can hold a budget against.
           *
           * It costs nothing in load behaviour: nothing in the eager graph
           * references `@firebase` any more, so this chunk is fetched only when
           * something actually asks for Firebase. If a static import of it
           * reappears in the entry graph the chunk turns eager again — the entry
           * chunk's own budget is what will catch that.
           */
          manualChunks(id: string) {
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
