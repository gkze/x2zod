# x2zod

[![CI](https://github.com/gkze/x2zod/actions/workflows/ci.yml/badge.svg)](https://github.com/gkze/x2zod/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-black)](https://bun.sh/)
[![License](https://img.shields.io/github/license/gkze/x2zod)](https://github.com/gkze/x2zod/blob/main/LICENSE)

`x2zod` is an owned schema/IDL to Zod v4 source compiler.

The goal is to turn foreign schema languages, formats, and IDLs into deterministic TypeScript
modules that export readable Zod schemas and useful `z.infer` types. Generated source is the product
surface, so it should be stable, declaration-safe, and honest about the semantics it can preserve.

JSON Schema is the first planned input plugin. The longer-term shape is a compiler that can add
other schema and IDL plugins while keeping deterministic, readable Zod source as the stable output
surface.

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
- [`@x2zod/json-schema`](packages/json-schema) will be the first input plugin. It owns JSON Schema
  parsing, validation policy, dialect and reference semantics, option schemas, and JSON
  Schema-to-Zod lowering.
- [`@x2zod/cli`](apps/cli) exposes the `x2zod` binary and should stay thin over the library API.

Core should stay schema-language agnostic. Plugins validate and lower their own input languages;
core coordinates compilation and emits a finalized TypeScript compiler `SourceFile`.

## Planned CLI

The first real command will compile an input document through a selected plugin:

```sh
x2zod compile --kind json-schema --input <input> --output <output> --name <TypeName>
```

The JSON Schema plugin should fail clearly on unsupported or unlowerable semantics instead of
silently degrading to `z.any()`. Runtime-only semantics may be preserved through generated helpers
when they cannot be represented directly by Zod constructors or TypeScript inference.

## Status

This repo has design docs, strict TypeScript/Bun tooling, CI/publishing scaffolding, and the first
`@x2zod/core` compiler slice: shared results and diagnostics, input plugin contracts, a minimal Zod
emission model, TypeScript source-file construction, and compile orchestration. The JSON Schema
plugin and CLI command are not implemented yet, and packages remain private until the first release
path is ready.

## Commands

```sh
bun install
bun run check
bun run format
bun run lint
```
