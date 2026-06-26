// Node fetch-handler SSR server.
//
// Used when the build emitted a plain Web Fetch handler — TanStack Start and
// every other Vite-SSR build without a deploy preset export
// `export default { fetch(request) }` into dist/server/server.js (or
// dist/server/index.js). It is the WinterCG-standard handler shape, the same
// interface Cloudflare Workers use, minus any CF-specific bindings.
//
// Unlike the Cloudflare preset, this entry does NOT serve its own static
// assets. So we stand up a tiny Node HTTP server that serves the client
// assets directory first and delegates every other request to the handler's
// `fetch`, bridging node:http <-> the Web Request/Response API (both globals
// in Node 18+). That's enough for the crawler to drive real SSR responses.
//
// Sibling files: serve-static.mjs (no server entry) and serve-ssr.mjs
// (Cloudflare via Miniflare). All expose the same surface:
//   start(...) -> { origin: string, stop: () => Promise<void> }

import http from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

import { resolveStaticFile, sendFile, safeDecode } from "./serve-static.mjs";

export async function startFetchServer({ ssrEntry, assetsDir }) {
  const fetchHandler = await loadFetchHandler(ssrEntry);
  const root = resolvePath(assetsDir);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest({ req, res, root, fetchHandler }).catch((err) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end(`SSR handler error: ${err?.stack || err}`);
      });
    });
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

// Static assets win first (so /assets/*.js, css, images resolve to real
// files); anything else is server-rendered by the handler.
async function handleRequest({ req, res, root, fetchHandler }) {
  const url = new URL(req.url, "http://internal");
  const decoded = safeDecode(url.pathname);

  if (decoded !== null) {
    const filePath = resolveStaticFile(root, decoded);
    if (filePath) {
      sendFile(res, filePath);
      return;
    }
  }

  const origin = `http://127.0.0.1:${req.socket.localPort}`;
  const request = toWebRequest(req, origin);
  const response = await fetchHandler(request);

  if (!response) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
    return;
  }
  await sendWebResponse(res, response);
}

// Resolves the handler from the entry module. TanStack Start exports
// `export default { fetch }`; we also tolerate a bare default fetch function
// or a named `fetch` export.
async function loadFetchHandler(ssrEntry) {
  const mod = await import(pathToFileURL(resolvePath(ssrEntry)).href);
  const entry = mod.default ?? mod;

  if (typeof entry === "function") return entry;
  if (entry && typeof entry.fetch === "function") return entry.fetch.bind(entry);
  if (typeof mod.fetch === "function") return mod.fetch.bind(mod);

  throw new Error(
    `SSR entry '${ssrEntry}' does not export a Web Fetch handler ` +
      "(expected `export default { fetch(request) }`)."
  );
}

function toWebRequest(req, origin) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value != null) headers.set(key, value);
  }

  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(origin + req.url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

async function sendWebResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(res);
}
