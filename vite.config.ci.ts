import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Relative asset URLs work on WordPress subdirectory installs and static file hosts.
  base: "./",
  // Cloudflare plugin outputs dist/server/index.js; prerender needs server.js
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
    prerender: {
      enabled: true,
      autoStaticPathsDiscovery: true,
      crawlLinks: true,
    },
  },
});
