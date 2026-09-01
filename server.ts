import "dotenv/config";
import compression from "compression";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { securityHeadersFor } from "./src/server/securityHeaders";
import { resolveBindHost } from "./src/server/bindHost";
import { cacheControlFor, REVALIDATE } from "./src/server/staticCache";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Express advertises itself with X-Powered-By by default. It tells an
  // attacker which stack to look up and tells a user nothing.
  app.disable("x-powered-by");

  // Security headers, before anything that can answer a request — the SPA
  // fallback below responds to almost every path, so a middleware registered
  // after it would cover nothing. HSTS is opt-in via HTTPS=true because
  // sending it over plain http://localhost poisons the whole machine's
  // localhost for a year; see src/server/securityHeaders.ts.
  // Declared here rather than at its old position further down, because the CSP
  // depends on it and the header middleware has to be registered before
  // anything that can answer a request.
  const isProduction = process.env.NODE_ENV === "production";

  const headers = securityHeadersFor({
    https: process.env.HTTPS === "true",
    // Vite's HMR client is inline script and its transform needs eval, so the
    // dev policy is looser. It is reachable from loopback only.
    development: !isProduction,
  });
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    next();
  });

  /*
   * gzip, in production only.
   *
   * Without this the server sent no Content-Encoding at all: the main bundle
   * went out at 1,121,864 bytes where gzip is 308,020, and a cold load of `/`
   * transferred 1.22 MB against roughly 0.43 MB compressed. Nothing in the
   * build was wrong -- Vite already reports the gzip figures -- the server was
   * simply never asked to use them.
   *
   * Production only, deliberately. In development this process runs Vite in
   * middleware mode, which transforms and streams modules on demand; wrapping
   * that in a compressor buys nothing (one machine, loopback) and adds a
   * failure mode to the path used for every hot reload. `npm start` serves
   * finished files off disk, which is the simple case compression is for.
   *
   * Registered before the routes and the static handler so it can see their
   * responses, and after the security headers so those are set regardless.
   *
   * On BREACH: compressing a response that mixes a secret with
   * attacker-influenced input can leak the secret. It does not apply here --
   * this server holds no user data, issues no session cookie or CSRF token, and
   * has no key-bearing routes by design (see the note below). It is worth
   * re-checking if that ever stops being true.
   */
  if (isProduction) app.use(compression());

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API routes FIRST
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // NOTE: /api/debug-key and /api/generate-report used to live here and have been
  // removed deliberately. Forma is bring-your-own-key — the user's Gemini key goes
  // straight from their browser to Google and never reaches this server. Proxying
  // generation through here would make the server a custodian of every user's
  // third-party credential, and /api/debug-key echoed key material to any caller
  // (it was not dev-gated, so it shipped in `npm start` too). Do not reintroduce
  // either route: the server must stay key-free.

  // Unknown /api/* paths must fail as JSON, and must be registered after every
  // real API route but before the SPA fallback below. Without this the
  // production catch-all answers *any* /api/* probe with 200 + index.html — so
  // the deleted /api/generate-report and /api/debug-key read as "endpoint
  // exists, returned HTML" to anything that checks the status code rather than
  // the body. Matches all methods and subpaths; /api/health is already bound
  // above and still wins.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Vite middleware for development
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    // chokidar emits 'error' on the watcher when it cannot watch a file, and an
    // unhandled 'error' event on an EventEmitter is a process-level throw — so
    // one locked file kills the dev server outright, mid-session, with a stack
    // trace that names node:internal/fs/watchers and looks like a Node bug.
    //
    // vite.config.ts already ignores tools/ because MSBuild locks its bin/ and
    // obj/ during a build (2026-08-13). That removed the trigger that was known
    // at the time, not the defect: EBUSY is a property of *any* file another
    // process has open. Observed again 2026-08-28 on a plain markdown file the
    // user had open in an editor:
    //
    //   Error: EBUSY: resource busy or locked, watch
    //   '...\docs\claude-code-cleanup-and-restructure-prompt.md'
    //
    // A file we cannot watch costs a missed hot reload for that one file. It
    // must not cost the server. Logged rather than swallowed, so a watcher that
    // is failing everywhere is still visible as the reason HMR went quiet.
    vite.watcher.on("error", (error: NodeJS.ErrnoException) => {
      console.warn(
        `[vite] watcher error (${error.code ?? "unknown"}) on ${error.path ?? "an unknown path"} -- ` +
          `continuing without watching it; edits to that file will not hot-reload.`,
      );
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Without `setHeaders`, express.static sends `public, max-age=0` on
    // everything, so Vite's content-hashed bundles are revalidated on every
    // load despite their URLs being unable to change meaning. See
    // src/server/staticCache.ts for why index.html must NOT get the same
    // treatment.
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', cacheControlFor(filePath));
        },
      }),
    );
    // A hashed asset that is not on disk must 404, not fall through to the SPA
    // catch-all below. Registered after express.static, so anything that does
    // exist has already been served.
    //
    // Same defect as the /api/* guard above, one layer down: without this, a
    // request for a bundle from a previous deploy answers 200 with index.html,
    // and the browser reports a syntax error from parsing HTML as JavaScript --
    // which reads as a corrupt build rather than a missing file. Verified by
    // requesting a stale hash after a rebuild.
    app.use('/assets', (_req, res) => {
      res.status(404).type('text/plain').send('Not found');
    });

    // The SPA fallback answers with index.html, and `sendFile` does NOT run the
    // `setHeaders` above -- that hook belongs to express.static. Set it here
    // too, or every deep link (which is most navigations) gets a different
    // caching policy from the same file served at `/`.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', REVALIDATE);
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Loopback in development, every interface in production, HOST overrides
  // both. In development this process runs Vite in middleware mode, so binding
  // it to every interface publishes the module graph to anyone who can reach
  // the machine — see src/server/bindHost.ts.
  const host = resolveBindHost({ production: isProduction, host: process.env.HOST });

  app.listen(PORT, host, () => {
    console.log(`Server running on http://localhost:${PORT} (bound to ${host})`);
  });
}

startServer();
