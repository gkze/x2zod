# Publishing

The registry scope for this project is `@x2zod`.

Planned public packages:

- `@x2zod/core`
- `@x2zod/json-schema`
- `@x2zod/cli`

The publish workflow is already structured for tokenless publishing. It runs repository preflight
checks first, then publishes npm and JSR in parallel jobs.

## Registry Setup

Before the first real publish:

1. Create the GitHub repository and set the local `origin` remote.
2. Create or reserve the `@x2zod` scope on JSR.
3. Create or reserve the `@x2zod` organization or scope on npm.
4. Create each package in both registries.
5. Link each JSR package to the GitHub repository.
6. Configure npm Trusted Publisher for each npm package:
   - publisher: GitHub Actions
   - owner: `gkze`
   - repository: `x2zod`
   - workflow filename: `publish.yml`
   - environment: `publish`
   - allowed action: `npm publish`
7. Add a GitHub `publish` environment if maintainer approval should gate registry writes.
8. Remove `private: true` from packages only after the release/versioning path rewrites any
   `workspace:*` dependency ranges to registry versions.

## Current Guardrails

`scripts/publish-packages.ts` only considers non-private workspace packages publishable and rejects
publishable package names outside the `@x2zod` scope. This keeps accidental unscoped publishes out
of the release path.
