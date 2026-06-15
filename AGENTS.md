# Agent Guide for `x2zod`

This is a new standalone TypeScript project scaffolded from the `mcpsync` repo structure.

## Project Direction

- Build an owned schema/IDL to Zod source compiler.
- Treat JSON Schema as the first input plugin, not the permanent product boundary.
- Treat generated source as a product surface: deterministic, readable, and declaration-safe.
- Keep the implementation library-first. The CLI should stay thin over core and plugin APIs.
- Follow `docs/design.md` for package boundaries, public API shape, diagnostics, tests, and
  implementation order.
- Use `docs/problem-space.md` as the semantic policy reference for JSON Schema tradeoffs.
- Keep input-specific validation, option schemas, reference handling, dialect semantics, and
  lowering behind input plugin packages.
- Preserve supported input-language semantics, including runtime-only semantics through generated
  helpers where needed.
- Fail loudly on unsupported or unlowerable semantics instead of degrading to `z.any()`.
- Prefer clean Zod source and useful `z.infer` output over pretending to support semantics that do
  not map cleanly.
- Keep core schema-language agnostic: plugins own validation and mapping; core owns orchestration
  and TypeScript source construction.
- V1 package boundaries are `@x2zod/core`, `@x2zod/json-schema`, and `@x2zod/cli`. Do not add
  standalone validator packages unless the design docs are intentionally changed.
- `@x2zod/core` should expose shared results, diagnostics, input plugin contracts, the Zod emission
  model, TypeScript source construction, and the aligned `ts` namespace.
- `@x2zod/json-schema` should own JSON Schema parsing, dialect selection, schema validation policy,
  reference handling, source profiles, option schemas, and lowering.
- Generated modules should import only Zod by default. Emit deduplicated helpers in generated source
  when supported runtime semantics need code beyond Zod constructors.
- The public compile result should return a finalized TypeScript compiler `SourceFile`; source text
  printing is a caller concern using the aligned `ts` API.

## Code Style

- Use Bun for package management, script execution, and tests. Use TypeScript 7 via
  `@typescript/native-preview` / `tsgo`.
- Keep TypeScript config strict. Shared compiler policy lives in `packages/tsconfig/base.json`;
  package-local `tsconfig.json` files should extend `@x2zod/tsconfig/base.json` and declare the
  `@x2zod/tsconfig` workspace package.
- Prefer exported const arrow functions over `function` declarations.
- Prefer compact expression returns where readable.
- Keep callback-shaped interfaces as readonly function properties.
- Authored TypeScript should use Node.js standard-library APIs and Node globals/types only. Do not
  reference Bun globals in source or tests, and do not install `@types/bun`.
- Use extensionless relative imports and exports for TypeScript and JavaScript modules. Do not write
  `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, or `.cjs` in source import/export
  specifiers; Oxlint enforces this.
- Do not add Biome back unless explicitly requested.
- Prefer small typed IRs and builder APIs over ad hoc string concatenation for generated TypeScript.
- Keep plugin option schemas in Zod. Option schemas should drive type inference, defaults, final
  validation, and CLI help metadata.
- Unsupported option-schema shapes should fail plugin registration with clear diagnostics.

## Testing Direction

- Use existing JSON Schema validators for schema-document validity, dialect handling, and vocabulary
  enforcement instead of trying to replace them in core.
- Test this project around mapping validated input into Zod expression plans and deterministic,
  declaration-safe TypeScript source.
- Include runtime smoke tests for generated modules where semantics need helper code.
- Keep fixture coverage focused on diagnostics, references, composition, object strictness,
  generated helper behavior, declaration naming, and the OpenCode schema acceptance corpus.

## Validation

Run:

```sh
bun install
bun run check
```

`bun run check` runs formatting, strict TypeScript typechecking, linting, and Bun tests.

## Git

- Never use `--no-verify` for commits or pushes. If hooks fail, fix the hook issue, change the
  commit split so hooks can run correctly, or stop and report the blocker.
