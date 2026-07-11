# x2zod

[![CI](https://github.com/gkze/x2zod/actions/workflows/ci.yml/badge.svg)](https://github.com/gkze/x2zod/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-black)](https://bun.sh/)
[![License](https://img.shields.io/github/license/gkze/x2zod)](https://github.com/gkze/x2zod/blob/main/LICENSE)

`x2zod` is an owned schema/IDL to Zod v4 source compiler.

The goal is to turn foreign schema languages, formats, and IDLs into deterministic TypeScript
modules that export readable Zod schemas and useful `z.infer` types. Generated source is the product
surface, so it should be stable, declaration-safe, and honest about the semantics it can preserve.

JSON Schema is the first input plugin. The longer-term shape is a compiler that can add other schema
and IDL plugins while keeping deterministic, readable Zod source as the stable output surface.

## Design

The current design is documented in:

- [docs/problem-space.md](docs/problem-space.md): landscape review, JSON Schema semantic risks, and
  the resolved V1 direction.
- [docs/design.md](docs/design.md): package boundaries, plugin contract, Zod emission model, public
  API, CLI shape, diagnostics, tests, and implementation order.
- [docs/design-notes.md](docs/design-notes.md): short notes about the scaffold, product shape, and
  TypeScript policy.
- [docs/publishing.md](docs/publishing.md): planned `@x2zod` registry package names and trusted
  publishing setup.

The V1 architecture is library-first:

- [`@x2zod/core`](packages/core) owns shared result and diagnostic types, input plugin contracts,
  orchestration, the Zod emission model, and final TypeScript source-file construction.
- [`@x2zod/input-json-schema`](packages/input-json-schema) is the first input plugin. It owns JSON
  Schema parsing, validation policy, dialect and reference semantics, option schemas, and JSON
  Schema-to-Zod lowering.
- [`@x2zod/config`](packages/config) owns typed project config, plugin registry loading, target
  resolution, and the `defineConfig` helper for library and CLI callers.
- [`@x2zod/code-quality-oxfmt`](packages/code-quality-oxfmt) and
  [`@x2zod/code-quality-oxlint`](packages/code-quality-oxlint) provide optional generated-source
  quality plugins.
- [`@x2zod/cli`](apps/cli) exposes the `x2zod` binary and should stay thin over the library API.
- Supporting packages such as [`@x2zod/build-inputs`](packages/build-inputs),
  [`@x2zod/eslint-plugins`](packages/eslint-plugins), and [`@x2zod/tsconfig`](packages/tsconfig)
  remain separate workspace packages.

Core should stay schema-language agnostic. Plugins validate and lower their own input languages;
core coordinates compilation and emits a finalized TypeScript compiler `SourceFile`.

## CLI

Declare input plugins and reusable targets in `x2zod.config.ts`:

```ts
import { defineConfig } from "@x2zod/config";
import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";

export default defineConfig({
  plugins: { input: { "json-schema": jsonSchemaInputPlugin } },
  targets: {
    user: {
      kind: "json-schema",
      input: { path: "schema.json" },
      output: { path: "src/generated/user.ts", typeName: "User" },
    },
  },
});
```

Generated source can optionally run through code quality plugins. Register the plugins once, then
select the ordered tools per output:

```ts
import { defineConfig } from "@x2zod/config";
import { oxfmtCodeQualityPlugin } from "@x2zod/code-quality-oxfmt";
import { oxlintCodeQualityPlugin } from "@x2zod/code-quality-oxlint";
import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";

export default defineConfig({
  plugins: {
    codeQuality: { oxfmt: oxfmtCodeQualityPlugin, oxlint: oxlintCodeQualityPlugin },
    input: { "json-schema": jsonSchemaInputPlugin },
  },
  targets: {
    user: {
      kind: "json-schema",
      input: { path: "schema.json" },
      output: {
        codeQuality: [
          {
            kind: "oxlint",
            // Optional: omit options to let oxlint find local config.
            // options: { config: { kind: "path", path: "./.oxlintrc.json" } },
          },
          {
            kind: "oxfmt",
            // Optional: omit options to let oxfmt find local config.
            // options: { config: { kind: "path", path: "./oxfmt.json" } },
            // options: { config: { kind: "inline", value: { semi: false } } },
          },
        ],
        path: "src/generated/user.ts",
        typeName: "User",
      },
    },
  },
});
```

Code quality plugins run in the order listed. Each plugin owns its own typed options. Both bundled
plugins can use local tool config discovery, an explicit config path, or an inline typed config
value.

Running `x2zod` with no arguments runs every configured target. `x2zod run` does the same
explicitly. `x2zod compile -g user` runs one named target, and compile flags are ephemeral overrides
over file defaults.

Anonymous one-shot compilation also uses the configured plugin registry:

```sh
x2zod compile -k json-schema -i schema.json -o src/generated/user.ts -n User
```

The JSON Schema plugin fails clearly on unsupported or unlowerable semantics instead of silently
degrading to `z.any()`. Runtime-only semantics may be preserved through generated helpers when they
cannot be represented directly by Zod constructors or TypeScript inference.

## Status

This repo has design docs, strict TypeScript on Bun tooling with Node.js APIs in source,
CI/publishing scaffolding, the first `@x2zod/core` compiler slice, the JSON Schema input plugin,
typed config loading, and a working CLI compile path. Packages remain private until the first
release path is ready.

## Commands

The repository pins Bun and the current Node.js LTS in `.bun-version` and `.node-version`. The Nix
development shell provisions those exact runtimes plus the native lint tools.
`bun --no-env-file install` installs the pre-commit, commit-message, and pre-push hooks
automatically; rerun `bun run hooks:install` to repair them.

```sh
bun --no-env-file install
bun --no-env-file run check
bun --no-env-file run format
bun --no-env-file run lint
```
