# Parkstatic Build and Deploy

GitHub Action to build and deploy your project to [Parkstatic](https://parkstatic.com).

## Prerequisites

- A [Parkstatic](https://parkstatic.com) instance
- Your Parkstatic secret stored as a repository secret named `PARKSTATIC_SECRET`

## Usage

Add a workflow file to your repository (for example `.github/workflows/deploy.yml`):

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: ParkStatic/parkstatic@v1
        with:
          parkstatic-secret: ${{ secrets.PARKSTATIC_SECRET }}
```

Pin to a specific release tag (for example `v1.0.0`) for reproducible builds.

## How it works

1. Detects the package manager from your lockfile.
2. Installs your project's dependencies.
3. Runs your project's own `build` script — no overlay configs, no framework lock-in.
4. **Prerenders** the result by serving the build output locally and crawling it with headless Chromium. Every reachable route is written as a static `<path>/index.html`, giving SEO-friendly HTML for any router, framework, or Lovable variant.
5. Zips and uploads to your Parkstatic instance.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `parkstatic-secret` | yes | — | Parkstatic instance secret token |
| `node-version` | no | `22` | Node.js version for the build |
| `pnpm-version` | no | `10` | pnpm version for the build |
| `build-command` | no | — | Override the build command (skips auto-detection) |
| `output-dir` | no | — | Override the static output directory (skips auto-detection) |
| `prerender` | no | `true` | Prerender the SPA to static HTML via headless Chromium |
| `prerender-routes` | no | — | Newline-separated extra seed paths the crawler should visit |
| `prerender-exclude` | no | — | Newline-separated glob patterns of paths to skip (e.g. `/admin/**`) |
| `prerender-max-pages` | no | `500` | Safety cap on total prerendered pages |
| `prerender-concurrency` | no | `4` | Number of parallel page workers |
| `debug` | no | `false` | Verbose shell and HTTP logging |

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE).

You may use this action only by referencing official releases in GitHub Actions
workflows. Copying, forking, or reusing this source code requires written
permission from ParkStatic.
