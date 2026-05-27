// Static-mode server.
//
// Used when the build already produced an index.html (classic Vite SPA shape:
// dist/client/index.html, dist/index.html, or build/index.html). We just need
// to serve those files to the crawler with the same SPA fallback the
// Parkstatic WP plugin uses at serve time, so the crawler sees the same view
// a real visitor would.
//
// Pair file: serve-ssr.mjs. Both expose the same surface:
//   start(...) -> { origin: string, stop: () => Promise<void> }

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve as resolvePath } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

export function ensureStaticOutput(outputDir) {
  const index = join(outputDir, "index.html");
  if (!existsSync(index)) {
    throw new Error(`No index.html found in ${outputDir}. Did the build succeed?`);
  }
}

export function startStaticServer({ outputDir }) {
  const root = resolvePath(outputDir);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handleRequest(root, req, res));
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        stop: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function handleRequest(root, req, res) {
  const url = new URL(req.url, "http://internal");
  const decoded = safeDecode(url.pathname);
  if (decoded === null) {
    res.writeHead(400).end("Bad Request");
    return;
  }

  const filePath = resolveRequestPath(root, decoded);
  if (!filePath) {
    res.writeHead(404).end("Not Found");
    return;
  }

  const mime = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "content-type": mime });
  createReadStream(filePath).pipe(res);
}

function resolveRequestPath(root, pathname) {
  const cleaned = pathname.replace(/^\/+/, "");
  const candidate = cleaned === "" ? root : resolvePath(root, cleaned);

  if (!candidate.startsWith(root)) return null;

  if (existsSync(candidate)) {
    const stat = statSync(candidate);
    if (stat.isFile()) return candidate;
    if (stat.isDirectory()) {
      const index = join(candidate, "index.html");
      if (existsSync(index)) return index;
    }
  }

  // SPA fallback: paths without an extension fall back to root index.html.
  if (!extname(pathname)) {
    const index = join(root, "index.html");
    if (existsSync(index)) return index;
  }
  return null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
