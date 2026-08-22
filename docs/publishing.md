# Publishing

The registry scope for this project is `@x2zod`.

Public npm packages:

- `@x2zod/build-inputs`
- `@x2zod/cli`
- `@x2zod/config`
- `@x2zod/core`
- `@x2zod/eslint-plugins`
- `@x2zod/input-json-schema`
- `@x2zod/output-oxfmt`
- `@x2zod/output-oxlint`
- `@x2zod/tsconfig`

Public JSR packages are packages with a checked-in `jsr.json` file. `@x2zod/build-inputs` and
`@x2zod/tsconfig` are npm-only: build-inputs is a fixture materialization utility, and tsconfig
exports shared TypeScript configuration JSON rather than JavaScript or TypeScript modules.

## Release Model

Changesets owns release planning and package version writes:

```sh
bun --no-env-file run changeset
bun --no-env-file run release:version
```

`release:version` runs `changeset version`, syncs JSR `name` and `version` metadata from each
package manifest, and refreshes the Bun lockfile.

Registry publishing is intentionally owned by `scripts/publish.ts`. The script reuses Changesets
package discovery, config loading, pre-release state, and skip policy, then publishes through
generic registry adapters:

```sh
bun --no-env-file run publish:packages -- --dry-run
bun --no-env-file run publish:packages
bun --no-env-file run publish:npm
bun --no-env-file run publish:jsr
```

The combined publish path runs all adapters and creates Changesets package tags only after every
selected package has either been published or confirmed already present in every configured
registry. This keeps retries idempotent when one registry succeeds and another fails.

## Registry Setup

Before the first real publish of a package:

1. Create or reserve the `@x2zod` scope on JSR.
2. Create or reserve the `@x2zod` organization or scope on npm.
3. Create each JSR package and link it to the GitHub repository for trusted publishing.
4. For a new npm package name, create a short-lived granular token with write access to the `@x2zod`
   scope and store it as the `publish` environment's `NPM_TOKEN` secret. The workflow maps this
   secret to `NODE_AUTH_TOKEN` for the initial publish that creates the package.
5. After the initial npm publish, configure npm Trusted Publisher for the package:
   - publisher: GitHub Actions
   - owner: `gkze`
   - repository: `x2zod`
   - workflow filename: `publish.yml`
   - environment: `publish`
   - allowed action: `npm publish`
6. Remove the temporary `NPM_TOKEN` secret after trusted publishing is verified.
7. Add a GitHub `publish` environment if maintainer approval should gate registry writes.

## Guardrails

- Manual workflow dispatch defaults to dry-run.
- The publisher materializes temporary package copies and rewrites `workspace:` dependency ranges
  before registry commands run.
- The npm adapter delegates uploads to `npm publish`.
- The JSR adapter delegates uploads to `jsr publish`.
- `changeset tag` runs only from the combined non-dry-run publish path, after both registry adapters
  succeed.
