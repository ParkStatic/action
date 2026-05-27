// SSR-mode server.
//
// Used when the build produced a worker bundle instead of an index.html
// (TanStack Start with the @cloudflare/vite-plugin / Cloudflare Workers
// preset). We boot the worker locally in a real Workers runtime via
// Miniflare so the crawler can hit it like any other HTTP origin, then
// each rendered route gets written out as static HTML by the crawler.
//
// Pair file: serve-static.mjs. Both expose the same surface:
//   start(...) -> { origin: string, stop: () => Promise<void> }

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

const DEFAULT_COMPATIBILITY_DATE = "2025-01-01";

export async function startSsrServer({ ssrEntry, assetsDir }) {
  const { Miniflare, Log, LogLevel } = await loadMiniflare();

  const entryPath = resolvePath(ssrEntry);
  const entryDir = dirname(entryPath);
  const wrangler = readWranglerConfig(entryDir);

  // Workers Assets routing: when no static file matches and a user worker is
  // present, the worker handles the request. That's exactly the SSR behavior
  // we want — assets short-circuit static files, the worker SSRs the rest.
  //
  // The `modulesRules` mirror what wrangler.json declares (TanStack Start's
  // CF preset emits `{"type":"ESModule","globs":["**/*.js","**/*.mjs"]}`),
  // so transitively-imported worker chunks under dist/server/assets/*.js are
  // parsed as ES modules instead of falling back to the CommonJS default.
  const mf = new Miniflare({
    modules: true,
    modulesRoot: entryDir,
    modulesRules: wrangler.modulesRules,
    scriptPath: entryPath,
    compatibilityDate: wrangler.compatibilityDate || DEFAULT_COMPATIBILITY_DATE,
    compatibilityFlags: wrangler.compatibilityFlags,
    assets: {
      directory: resolvePath(assetsDir),
      binding: wrangler.assetsBinding || "ASSETS",
      // Without this, miniflare's static-assets router never falls through
      // to our worker — every non-asset route comes back as a bare 404. The
      // option is an undocumented snake_case key on the miniflare API; it
      // mirrors the same flag wrangler sets when both `main` and `assets`
      // are configured. See workers-sdk#9397.
      routerConfig: { has_user_worker: true },
    },
    log: new Log(LogLevel.WARN, { prefix: "miniflare" }),
  });

  const url = await mf.ready;
  return {
    origin: new URL(url).origin,
    stop: () => mf.dispose(),
  };
}

async function loadMiniflare() {
  try {
    return await import("miniflare");
  } catch (err) {
    throw new Error(
      "Failed to load 'miniflare'. SSR builds require it to spin up the Worker " +
        "locally for prerendering. Reinstall the action's dependencies and ensure " +
        "Node 22+. Original error: " + (err?.message || err)
    );
  }
}

// Reads the subset of wrangler.json keys we care about. The file is emitted
// by the build (TanStack Start CF preset writes it into dist/server/), so
// keys are stable; missing keys fall back to safe defaults.
function readWranglerConfig(entryDir) {
  const path = resolvePath(entryDir, "wrangler.json");
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  return {
    compatibilityDate: cfg.compatibility_date,
    compatibilityFlags: Array.isArray(cfg.compatibility_flags) ? cfg.compatibility_flags : undefined,
    assetsBinding: cfg.assets?.binding,
    modulesRules: translateModuleRules(cfg.rules),
  };
}

// Wrangler uses `{ type, globs }`; Miniflare's API expects `{ type, include }`.
// Same semantics, different key names.
function translateModuleRules(rules) {
  if (!Array.isArray(rules)) return undefined;
  return rules
    .filter((r) => r && typeof r.type === "string" && Array.isArray(r.globs))
    .map((r) => ({ type: r.type, include: r.globs }));
}
