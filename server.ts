import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

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
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
