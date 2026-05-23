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

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `parkstatic-secret` | yes | — | Parkstatic instance secret token |
| `node-version` | no | `22` | Node.js version for the build |
| `pnpm-version` | no | `10` | pnpm version for the build |

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE).

You may use this action only by referencing official releases in GitHub Actions
workflows. Copying, forking, or reusing this source code requires written
permission from ParkStatic.
