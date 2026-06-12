# Design Notes

## Initial Shape

The repo starts as a zeroed monorepo skeleton matching `mcpsync`'s supporting tooling:

- Bun workspaces
- strict TypeScript 7 / `tsgo`
- shared `tsconfig` workspace package
- Oxfmt / Oxlint
- Turborepo task wiring
- Nix flake and bun2nix support

## Product Shape

`x2zod` is a schema/IDL to Zod source compiler. Input languages should be modeled as input plugins
that own their validation policy, options, references, dialect semantics, and lowering into a shared
Zod source emission model.

JSON Schema is the first input plugin because it was the immediate `mcpsync` plugin-schema need. The
JSON Schema plugin should preserve supported JSON Schema semantics, including runtime-only semantics
through generated helpers where needed. Unsupported or unlowerable semantics should fail explicitly
rather than degrade to `z.any()`.

The output surface matters: generated Zod should be deterministic, readable, declaration-safe, and
useful with `z.infer`. Core should stay schema-language agnostic: input plugins own validation and
mapping; core owns orchestration and TypeScript source construction.

## TypeScript Policy

Shared compiler options live in `packages/tsconfig/base.json`. Package-local `tsconfig.json` files
extend `@x2zod/tsconfig/base.json` through the installed workspace package instead of path-relative
root inheritance.
