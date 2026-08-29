import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { securityHeadersFor } from "./src/server/securityHeaders";
import { resolveBindHost } from "./src/server/bindHost";

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
  // localhost for a year; see src/lib/securityHeaders.ts.
  const headers = securityHeadersFor({ https: process.env.HTTPS === "true" });
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    next();
  });

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

  const isProduction = process.env.NODE_ENV === "production";

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
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Loopback in development, every interface in production, HOST overrides
  // both. In development this process runs Vite in middleware mode, so binding
  // it to every interface publishes the module graph to anyone who can reach
  // the machine — see src/lib/bindHost.ts.
  const host = resolveBindHost({ production: isProduction, host: process.env.HOST });

  app.listen(PORT, host, () => {
    console.log(`Server running on http://localhost:${PORT} (bound to ${host})`);
  });
}

startServer();
