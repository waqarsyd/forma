/**
 * The offline worker, `/sw.js` (2026-11-08, the site audit's batch SG, item
 * 55), written at build by `offlineWorker` in vite.config.ts. Hand-written
 * rather than vite-plugin-pwa's Workbox: the rules are short, and a
 * dependency the size of Workbox for them would be most of what it shipped.
 *
 * - A page is fetched from the network first and kept, so a deploy reaches a
 *   returning visitor at once (Firebase serves every page `no-cache`), and a
 *   lost connection gets the copy last seen, or the home page's.
 * - A hashed file (`/assets/`, and the versioned `/ocr/`, `/paddle/`,
 *   `/pdf-fonts/` and `/model/` folders, lib/assetPaths.ts) is answered from
 *   the cache first, so a picture can still be read offline:
 *   its name changes whenever its bytes do, so a kept copy is never stale.
 * - Everything else goes to the network untouched: other origins (Google,
 *   Firebase, an AI), any request but GET, the worker itself, the
 *   handwriting model, 68 MB the site only serves when a build asks for it,
 *   and a shared report's page (`/s/`), whose address is never kept.
 * - The home page, the entry script and its stylesheet are kept on install,
 *   so a second visit, or one offline, paints without the network.
 * - Each build's cache is its own (`forma-<version>`); an older one is
 *   deleted when the new worker takes over.
 */

export type SwStrategy = 'page' | 'asset' | 'network';

/**
 * How the worker answers a same-origin GET. Self-contained on purpose: the
 * build writes this function's own text into sw.js, so it may use nothing
 * from outside its body.
 */
export function swStrategy(pathname: string, isNavigation: boolean): SwStrategy {
  if (pathname === '/sw.js' || pathname.indexOf('/__/') === 0 || pathname.indexOf('/handwriting/') === 0) return 'network';
  // A shared report's page (2026-11-11, the full audit's SE-17): the cache's
  // keys are its address, so a kept copy would let the next person at the
  // browser list the links the last one opened, and a sign-out cannot reach
  // the worker's cache. Shared reports need the network to load anyway.
  if (pathname.indexOf('/s/') === 0) return 'network';
  if (isNavigation) return 'page';
  if (pathname.indexOf('/assets/') === 0) return 'asset';
  if (/^\/(ocr|paddle|pdf-fonts|model)\/[0-9a-f]{10}\//.test(pathname)) return 'asset';
  return 'network';
}

/** The worker's source, for one build. */
export function serviceWorkerSource(opts: { version: string; precache: readonly string[] }): string {
  const cache = `forma-${opts.version}`;
  return `/* Forma's offline worker, written at build (src/lib/serviceWorker.ts). */
'use strict';
const CACHE = ${JSON.stringify(cache)};
const PRECACHE = ${JSON.stringify([...new Set(opts.precache)])};
const swStrategy = ${swStrategy.toString()};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.indexOf('forma-') === 0 && key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const strategy = swStrategy(url.pathname, request.mode === 'navigate');
  if (strategy === 'network') return;

  if (strategy === 'asset') {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then((hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }),
        ),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.open(CACHE).then((cache) =>
          cache.match(request).then((hit) => hit || cache.match('/')).then((hit) =>
            hit || new Response('Forma is offline, and this page was not kept for offline use.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }),
          ),
        ),
      ),
  );
});
`;
}
