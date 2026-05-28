#!/usr/bin/env node
// Prerenders any Lovable build into static HTML by running a local origin
// server and crawling it with a headless browser.
//
// Two clearly separated modes, picked from BUILD_MODE:
//
//   - "static" (default): the build already emitted index.html plus assets.
//     We serve OUTPUT_DIR over a tiny Node static server with SPA fallback.
//     See serve-static.mjs.
//
//   - "ssr":              the build emitted a Cloudflare Worker (TanStack
//     Start CF preset). We boot it locally via Miniflare and crawl that.
//     See serve-ssr.mjs.
//
// Inputs (all via env):
//   OUTPUT_DIR              required, dir to write rendered HTML into
//   BUILD_MODE              "static" (default) or "ssr"
//   SSR_ENTRY               required when BUILD_MODE=ssr, path to worker entry
//   PRERENDER_ROUTES        optional, newline-separated extra seed paths
//   PRERENDER_EXCLUDE       optional, newline-separated globs to skip
//   PRERENDER_MAX_PAGES     optional, safety cap (default 500)
//   PRERENDER_PAGE_TIMEOUT  optional, per-page timeout in ms (default 15000)
//   PRERENDER_WAIT          optional, Playwright waitUntil (default networkidle)
//   PRERENDER_CONCURRENCY   optional, parallel page workers (default 4)
//   DEBUG                   optional, "true" enables verbose logging

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";

import { ensureStaticOutput, startStaticServer } from "./serve-static.mjs";
import { startSsrServer } from "./serve-ssr.mjs";

const config = readConfig();
const log = makeLogger(config.debug);

main().catch((err) => {
  console.error("::error::Prerender failed:", err?.stack || err);
  process.exit(1);
});

async function main() {
  const server = await startServerForMode(config);
  log(`Origin server (${config.mode}) listening on ${server.origin}`);

  const browser = await chromium.launch();
  try {
    const result = await crawl({
      browser,
      origin: server.origin,
      outputDir: config.outputDir,
      seedPaths: ["/", ...config.seedRoutes, ...readSitemapPaths(config.outputDir)],
      excludeMatchers: config.excludePatterns.map(globToRegExp),
      maxPages: config.maxPages,
      pageTimeoutMs: config.pageTimeoutMs,
      waitUntil: config.waitUntil,
      concurrency: config.concurrency,
      disableHydration: config.disableHydration,
    });
    console.log(`Prerendered ${result.rendered} page(s); skipped ${result.skipped}; failed ${result.failed}.`);
    if (result.failed > 0) {
      console.log("::warning::One or more pages failed to prerender. The site will still work via SPA fallback at runtime.");
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  // Final sanity check, independent of mode: the deploy step expects an
  // index.html at the root of OUTPUT_DIR. Static mode comes with one; SSR
  // mode has to produce one via the crawl. If neither happened, fail loud.
  if (!existsSync(join(config.outputDir, "index.html"))) {
    throw new Error(`Prerender finished but ${config.outputDir}/index.html is missing — nothing to deploy.`);
  }
}

// --- mode dispatch ----------------------------------------------------------

async function startServerForMode(cfg) {
  if (cfg.mode === "ssr") {
    if (!cfg.ssrEntry) {
      throw new Error("BUILD_MODE=ssr requires SSR_ENTRY to be set.");
    }
    return startSsrServer({ ssrEntry: cfg.ssrEntry, assetsDir: cfg.outputDir });
  }
  ensureStaticOutput(cfg.outputDir);
  return startStaticServer({ outputDir: cfg.outputDir });
}

// --- config -----------------------------------------------------------------

function readConfig() {
  const outputDir = required("OUTPUT_DIR");
  const mode = (process.env.BUILD_MODE || "static").toLowerCase();
  if (mode !== "static" && mode !== "ssr") {
    throw new Error(`Unknown BUILD_MODE: ${mode} (expected "static" or "ssr")`);
  }
  return {
    mode,
    outputDir: resolvePath(outputDir),
    ssrEntry: process.env.SSR_ENTRY ? resolvePath(process.env.SSR_ENTRY) : null,
    seedRoutes: splitLines(process.env.PRERENDER_ROUTES),
    excludePatterns: splitLines(process.env.PRERENDER_EXCLUDE),
    maxPages: positiveInt(process.env.PRERENDER_MAX_PAGES, 500),
    pageTimeoutMs: positiveInt(process.env.PRERENDER_PAGE_TIMEOUT, 15000),
    waitUntil: process.env.PRERENDER_WAIT || "networkidle",
    concurrency: positiveInt(process.env.PRERENDER_CONCURRENCY, 4),
    disableHydration: process.env.DISABLE_HYDRATION === "true",
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
  disableHydration,
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
          const finalHtml = disableHydration ? neutralizeHydration(html) : html;
          writeStaticPage(outputDir, path, finalHtml);
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

// Strips locally-hosted `<script type="module">` tags from the rendered HTML
// so the framework's hydration entry never runs in the visitor's browser.
//
// Why we need this: Playwright's `page.content()` returns a DOM snapshot
// that has already been hydrated by the headless browser. Reloading that
// snapshot in a real browser kicks the framework into a *second* hydration
// pass against state that no longer exists; TanStack Router (and similar
// SSR-only setups) trip a `tiny-invariant` assertion and React unmounts
// the whole tree, leaving a blank page.
//
// Killing the entry script keeps the SSR'd DOM exactly as captured: text,
// images, CSS animations, videos, iframes, native forms, hover effects,
// and any third-party (external `src`) scripts all still work. The cost
// is React-driven interactivity — modals, client-side routing, Framer
// Motion, Lottie, etc. That trade-off is the deal Parkstatic users sign
// up for; the input `disable-hydration: false` opts back in.
//
// Heuristics:
//   - Only `<script type="module">` is targeted. Vite-style builds put
//     their entry there; classic `<script>` tags (analytics, third-party
//     widgets) are left alone.
//   - Module scripts with an `src` starting with `http://` or `https://`
//     are preserved — these are almost always external libraries the user
//     added, not the framework's own entry.
//   - Inline `<script type="module">` blocks are removed; Vite occasionally
//     emits inline hydration glue.
//   - `<link rel="modulepreload">` tags are also removed. Without the
//     hydration entry there is nothing to import these chunks, and on a
//     slow shared host every preload is a full request that ties up a
//     connection slot during the critical render window — which can be
//     enough on its own to time out Lighthouse / PageSpeed Insights runs.
//     Same-origin only: cross-origin preloads (rare, but valid for users
//     hosting chunks on a CDN) are preserved on the assumption that the
//     user wired them up deliberately.
function neutralizeHydration(html) {
  return html
    .replace(
      /<script\b([^>]*\btype\s*=\s*["']?module["']?[^>]*)>([\s\S]*?)<\/script>/gi,
      (match, attrs) => {
        const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        if (srcMatch && /^https?:\/\//i.test(srcMatch[1])) {
          return match;
        }
        return "";
      },
    )
    .replace(
      /<link\b([^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*)\/?>/gi,
      (match, attrs) => {
        const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch && /^https?:\/\//i.test(hrefMatch[1])) {
          return match;
        }
        return "";
      },
    );
}

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
