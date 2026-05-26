#!/usr/bin/env node
// Prerenders a built Vite SPA into static HTML files by running a local
// static server with SPA fallback and crawling it with a headless browser.
//
// Treats the build output as a black box: no assumptions about the
// framework (Vite SPA, TanStack Start client bundle, anything else that
// outputs an index.html plus assets). One code path for every Lovable
// variant past, present, and future.
//
// Inputs (all via env):
//   OUTPUT_DIR              required, dir containing index.html
//   PRERENDER_ROUTES        optional, newline-separated extra seed paths
//   PRERENDER_EXCLUDE       optional, newline-separated globs to skip
//   PRERENDER_MAX_PAGES     optional, safety cap (default 500)
//   PRERENDER_PAGE_TIMEOUT  optional, per-page timeout in ms (default 15000)
//   PRERENDER_WAIT          optional, Playwright waitUntil (default networkidle)
//   PRERENDER_CONCURRENCY   optional, parallel page workers (default 4)
//   DEBUG                   optional, "true" enables verbose logging

import { chromium } from "playwright";
import http from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { extname, join, resolve as resolvePath, dirname } from "node:path";

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

const config = readConfig();
const log = makeLogger(config.debug);

main().catch((err) => {
  console.error("::error::Prerender failed:", err?.stack || err);
  process.exit(1);
});

async function main() {
  ensureIndexHtml(config.outputDir);

  const server = await startStaticServer(config.outputDir);
  const origin = `http://127.0.0.1:${server.port}`;
  log(`Static server listening on ${origin}`);

  const browser = await chromium.launch();
  try {
    const result = await crawl({
      browser,
      origin,
      outputDir: config.outputDir,
      seedPaths: ["/", ...config.seedRoutes, ...readSitemapPaths(config.outputDir)],
      excludeMatchers: config.excludePatterns.map(globToRegExp),
      maxPages: config.maxPages,
      pageTimeoutMs: config.pageTimeoutMs,
      waitUntil: config.waitUntil,
      concurrency: config.concurrency,
    });
    console.log(`Prerendered ${result.rendered} page(s); skipped ${result.skipped}; failed ${result.failed}.`);
    if (result.failed > 0) {
      console.log("::warning::One or more pages failed to prerender. The site will still work via SPA fallback at runtime.");
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

// --- config -----------------------------------------------------------------

function readConfig() {
  const outputDir = required("OUTPUT_DIR");
  return {
    outputDir: resolvePath(outputDir),
    seedRoutes: splitLines(process.env.PRERENDER_ROUTES),
    excludePatterns: splitLines(process.env.PRERENDER_EXCLUDE),
    maxPages: positiveInt(process.env.PRERENDER_MAX_PAGES, 500),
    pageTimeoutMs: positiveInt(process.env.PRERENDER_PAGE_TIMEOUT, 15000),
    waitUntil: process.env.PRERENDER_WAIT || "networkidle",
    concurrency: positiveInt(process.env.PRERENDER_CONCURRENCY, 4),
    debug: process.env.DEBUG === "true",
  };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

function splitLines(value) {
  if (!value) return [];
  return value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function makeLogger(debug) {
  return (...args) => {
    if (debug) console.log("[prerender]", ...args);
  };
}

// --- static server ----------------------------------------------------------

// Tiny static file server. Returns index.html for any URL whose path resolves
// to a directory or to a missing file with no extension (the classic SPA
// fallback). This matches what hosting platforms — and the Parkstatic WP
// plugin — do at serve time, so the crawler sees the same view a real user
// would.
function startStaticServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handleRequest(root, req, res));
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
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

// --- crawler ----------------------------------------------------------------

async function crawl({
  browser,
  origin,
  outputDir,
  seedPaths,
  excludeMatchers,
  maxPages,
  pageTimeoutMs,
  waitUntil,
  concurrency,
}) {
  const queue = [];
  const seen = new Set();
  const enqueue = (path) => {
    const normalized = normalizePath(path);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    if (excludeMatchers.some((re) => re.test(normalized))) {
      log(`Excluded by pattern: ${normalized}`);
      return;
    }
    seen.add(normalized);
    queue.push(normalized);
  };

  for (const path of seedPaths) enqueue(path);

  const context = await browser.newContext();
  const counters = { rendered: 0, skipped: 0, failed: 0 };

  const worker = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(pageTimeoutMs);
    try {
      while (queue.length > 0 && counters.rendered + counters.failed < maxPages) {
        const path = queue.shift();
        if (!path) continue;
        try {
          const { html, discovered } = await renderPage(page, origin, path, waitUntil);
          if (html === null) {
            counters.skipped++;
            continue;
          }
          writeStaticPage(outputDir, path, html);
          counters.rendered++;
          log(`Rendered ${path} (+${discovered.length} link(s))`);
          for (const next of discovered) enqueue(next);
        } catch (err) {
          counters.failed++;
          console.log(`::warning::Failed to prerender ${path}: ${err?.message || err}`);
        }
      }
    } finally {
      await page.close();
    }
  };

  const workers = Array.from({ length: Math.max(1, concurrency) }, worker);
  await Promise.all(workers);
  await context.close();

  if (queue.length > 0) {
    console.log(`::warning::Hit max-pages cap (${maxPages}); ${queue.length} path(s) remain in queue. Raise PRERENDER_MAX_PAGES if needed.`);
  }

  return counters;
}

async function renderPage(page, origin, path, waitUntil) {
  const response = await page.goto(origin + path, { waitUntil });

  // If the SPA bounced us to a different path (e.g. login redirect, 404
  // route), follow the redirect target instead of writing the source path.
  // We intentionally write whatever the final DOM looks like — that matches
  // what a real visitor would see.
  if (response && response.status() >= 400) {
    return { html: null, discovered: [] };
  }

  const [html, hrefs] = await Promise.all([
    page.content(),
    page.$$eval("a[href]", (els) => els.map((el) => el.getAttribute("href"))),
  ]);

  const finalPath = new URL(page.url()).pathname;
  const discovered = collectInternalLinks(hrefs, origin, finalPath);

  return { html, discovered };
}

function collectInternalLinks(hrefs, origin, currentPath) {
  const results = [];
  for (const raw of hrefs) {
    if (!raw) continue;
    if (raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    if (raw.startsWith("#")) continue;
    let url;
    try {
      url = new URL(raw, origin + currentPath);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (url.hash && url.pathname === currentPath) continue;
    results.push(url.pathname || "/");
  }
  return results;
}

// --- output -----------------------------------------------------------------

// Writes the rendered DOM to OUTPUT_DIR. The root path overwrites
// OUTPUT_DIR/index.html; nested paths become OUTPUT_DIR/<path>/index.html so
// any static host (and the Parkstatic WP plugin's directory-style resolver)
// can serve them with no rewrite rules.
function writeStaticPage(outputDir, path, html) {
  const target = path === "/"
    ? join(outputDir, "index.html")
    : join(outputDir, path.replace(/^\/+/, ""), "index.html");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, "utf8");
}

function normalizePath(input) {
  if (typeof input !== "string") return null;
  if (!input.startsWith("/")) input = "/" + input;
  let path = input.split("#")[0].split("?")[0];
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  // Guard: only same-origin, no traversal. We're using URL parsing for safety.
  try {
    const url = new URL(path, "http://internal");
    return url.pathname || "/";
  } catch {
    return null;
  }
}

// --- helpers ----------------------------------------------------------------

function ensureIndexHtml(outputDir) {
  const index = join(outputDir, "index.html");
  if (!existsSync(index)) {
    throw new Error(`No index.html found in ${outputDir}. Did the build succeed?`);
  }
}

// Pulls extra seed routes out of sitemap.xml if the build emitted one.
// Best-effort and tolerant: regex over <loc>...</loc>, ignore malformed files.
function readSitemapPaths(outputDir) {
  const sitemap = join(outputDir, "sitemap.xml");
  if (!existsSync(sitemap)) return [];
  try {
    const xml = readFileSync(sitemap, "utf8");
    const paths = [];
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const url = new URL(match[1]);
        paths.push(url.pathname);
      } catch {
        // Relative URLs in sitemaps are non-standard, but accept them.
        paths.push(match[1]);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

// Minimal glob -> RegExp. Supports `*` (single path segment) and `**` (any).
// Other regex metacharacters are escaped. Pattern is anchored.
function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (".+?^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
