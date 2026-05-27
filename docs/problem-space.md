# Problem Space Brief

Research date: 2026-05-10

## Purpose

`x2zod` is an owned schema/IDL to Zod source compiler. JSON Schema is the first input plugin, but
the product should not be limited to JSON Schema forever. The stable output surface is deterministic
TypeScript source containing Zod schemas that are readable, declaration-safe, and useful with
`z.infer`.

The core problem is not "can a JSON Schema validate JSON?" Mature tools already do that. The core
problem is:

> Given an input schema language with its own semantics, generate the strongest honest Zod source
> that balances runtime validation behavior with useful TypeScript inference.

This brief maps the problem space before committing to package boundaries or implementation design.

## Current Project Direction

Local project notes already establish these constraints:

- Treat JSON Schema as the first input plugin, not the permanent product boundary.
- Treat generated Zod source as the product surface.
- Keep core schema-language agnostic: plugins own validation policy, dialect/reference semantics,
  and lowering into the shared Zod emission model.
- Preserve supported input-language semantics, including runtime-only semantics where needed,
  through generated helpers.
- Fail loudly on unlowerable semantics instead of silently degrading to `z.any()`.

That direction is still sound after the landscape review.

## Landscape

### JSON Schema validators

Validators such as [Ajv](https://github.com/ajv-validator/ajv) are optimized for standards-compliant
validation. Ajv supports multiple JSON Schema drafts, including 2020-12, and generates optimized
validation functions. It is the right comparison point for full validator behavior, not for Zod
source generation.

The [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) is the
practical conformance reference. Its README is explicit that the tests verify specified behavior and
are not a style guide. This matters for `x2zod`: we can use the suite to understand semantics and
regression-test selected keywords, but passing the entire suite is equivalent to choosing to become
a validator compiler.

### JSON Schema-first type systems

[TypeBox](https://github.com/sinclairzx81/typebox) takes the inverse approach from Zod: it creates
in-memory JSON Schema objects that infer as TypeScript types, and those schemas can be passed to
JSON Schema validators. This is a strong proof that JSON Schema can be the schema object model for
TypeScript workflows, but it is not the desired output surface for this repo. `x2zod` exists because
the desired authored or generated artifact is Zod source.

### Existing JSON Schema to Zod source generators

[json-schema-to-zod](https://github.com/StefanTerdell/json-schema-to-zod) is the closest existing
source generator. It converts JSON Schema draft 4+ objects or files into JavaScript or TypeScript
code and now targets Zod v4 by default. It also exposes several warning signs for this project:

- The README says the project will no longer be actively maintained as of March 2026.
- `$ref` resolution and formatting are delegated to separate tools.
- `oneOf` and similar factored schemas are only partially supported.
- The README warns that JSON Schema and Zod do not overlap completely, so details can be lost in
  translation.

This makes it valuable as prior art and a test oracle for simple cases, but not as a foundation for
an owned compiler.

### Runtime JSON Schema to Zod converters

[zod-from-json-schema](https://github.com/glideapps/zod-from-json-schema) and
[@n8n/json-schema-to-zod](https://www.npmjs.com/package/%40n8n%2Fjson-schema-to-zod) convert JSON
Schema into runtime Zod schema objects. They are useful evidence for mapping choices, but their
product shape differs from `x2zod`: they do not emit stable source as the primary artifact.

`zod-from-json-schema` is especially instructive because it claims broad Draft 2020-12 coverage for
many core features while still listing important unsupported areas: `$ref`, `$defs`, remote
references, `$dynamicRef`, `patternProperties`, `dependentSchemas`, `dependentRequired`,
`propertyNames`, `unevaluatedProperties`, `unevaluatedItems`, `if`/`then`/`else`, custom
vocabularies, and annotation collection.

That unsupported list is a useful early warning. These are exactly the places where JSON Schema
semantics stop looking like simple type construction and start requiring evaluation state, reference
graphs, dialect handling, or runtime-only logic.

### Zod native JSON Schema conversion

Zod v4 has native JSON Schema conversion. The official
[Zod JSON Schema docs](https://zod.dev/json-schema?id=configuration) say `z.fromJSONSchema()` is
experimental and converts JSON Schema into a runtime Zod schema. `z.toJSONSchema()` is stable enough
to study as a semantic map in the other direction, especially because the docs make Zod's own
boundaries visible: some Zod constructs are unrepresentable in JSON Schema, object strictness has
specific `additionalProperties` implications, metadata uses registries, and cycles/reused schemas
need policy.

[Zod Core](https://zod.dev/packages/core) is relevant if we later need to inspect or transform Zod
schemas. It documents a JSON-serializable internal definition model and virtual input/output type
properties. For `x2zod`, though, the first output should be ordinary Zod source, not direct
construction of internal Zod Core nodes.

### Academic and standards context

Modern JSON Schema is meaningfully more complex than older drafts. The paper
[Validation of Modern JSON Schema: Formalization and Complexity](https://arxiv.org/abs/2307.10034)
identifies dynamic references and annotation-dependent validation as features that change the
evaluation model, and proves PSPACE-completeness for the modern validation problem. `x2zod` should
not accidentally adopt that burden under the name of source generation.

## JSON Schema Semantic Map

JSON Schema Draft 2020-12 is not just a structural type notation. It is a schema language with
dialects, vocabularies, references, assertions, annotations, applicators, and output formats.

### Dialects and vocabularies

JSON Schema 2020-12 is split across Core and Validation specifications. The default dialect
meta-schema combines vocabularies, and some vocabularies are optional. The validation spec
distinguishes structural assertions from metadata and semantic-content annotations.

Implication for `x2zod`:

- The input plugin must know which dialect it is interpreting.
- Unknown keywords cannot be treated uniformly. Some are harmless annotations; some may introduce
  subschemas; some may change reference or evaluation behavior.
- Input plugins should include dialect policy, not just a JSON object parser.
- Required vocabularies must be honored. Unknown required vocabularies are unsupported dialect
  failures, while unknown optional vocabularies are ignored only when unknown-key policy also allows
  their keywords.

### Boolean schemas

JSON Schema allows schemas to be boolean values:

- `true` accepts any instance.
- `false` accepts no instance.

These map cleanly to `z.unknown()` and `z.never()` if we are targeting parse behavior rather than
object key preservation.

### Primitive assertions

The validation vocabulary defines primitive instance types: `null`, `boolean`, `object`, `array`,
`number`, and `string`, plus `integer` as a validation type. Numeric values in JSON Schema are
arbitrary precision from the spec's point of view, while JavaScript numbers are not.

Implication:

- Primitive `type` usually maps cleanly to Zod constructors.
- `integer` maps to `z.int()` or `z.number().int()`, but this is JavaScript number semantics.
- Very large JSON numbers are an interop boundary, not a type-shape problem.

### Independent keyword evaluation

JSON Schema keywords generally evaluate independently at the same instance location. A schema like
`{ "type": "string", "minLength": 3 }` is not a chained type expression in the abstract; it is a set
of constraints that all apply when relevant.

Implication:

- Zod emission should normalize keyword sets into an ordered expression, but the compiler should
  reason from JSON Schema semantics first.
- Constraints without explicit `type` need policy. For example, `minLength` alone only constrains
  strings in JSON Schema, but `z.string().min(...)` rejects non-strings. Type inference and
  validation behavior diverge here.

### Applicators

Applicators apply subschemas. Important groups:

- In-place logic: `allOf`, `anyOf`, `oneOf`, `not`.
- Conditional logic: `if`, `then`, `else`.
- Object and array applicators: `properties`, `patternProperties`, `additionalProperties`,
  `propertyNames`, `items`, `prefixItems`, `contains`.
- References: `$ref`, `$dynamicRef`, `$defs`, `$id`, `$anchor`, `$dynamicAnchor`.

Implication:

- Some applicators lower cleanly to Zod unions, intersections, objects, arrays, records, and tuples.
- Some require validation-time branching that does not produce useful static types.
- Some require graph resolution before emission.
- `$dynamicRef` is not an ordinary reference. V1 supports it through the JSON Schema plugin's
  resource graph, dynamic-anchor tracking, and helper-backed dynamic resolution where static refs
  are not enough.

### Annotation-dependent validation

The `unevaluatedItems` and `unevaluatedProperties` vocabulary depends on annotation results from
other keywords. The spec says only successfully evaluated locations count, and these keywords must
be evaluated after the keywords whose annotations they depend on.

Implication:

- These keywords are validator-evaluation features, not simple source-emission features.
- The JSON Schema plugin needs dedicated runtime evaluation bookkeeping if it supports them; the v1
  design chooses to support `unevaluatedProperties` and `unevaluatedItems` this way.

### Format

`format` is split between format annotation and format assertion. The validation spec says format
assertion support must be configurable and disabled by default for annotation behavior. Full format
assertion support is optional unless the format-assertion vocabulary is required.

Implication:

- `format` must be a policy choice, not an unconditional Zod check.
- Known safe mappings such as `email`, `uuid`, `uri`, `date-time`, `date`, `duration`, `ipv4`, and
  `ipv6` can emit Zod helpers in an assertion mode.
- Default balanced mode should likely preserve format as metadata unless a caller asks for assertion
  behavior.

### Metadata and comments

Metadata keywords include `title`, `description`, `default`, `deprecated`, `readOnly`, `writeOnly`,
and `examples`. `$comment` is specifically not for executable behavior.

Implication:

- Metadata can become `.meta(...)` or JSDoc, depending on output policy.
- `default` is subtle: JSON Schema default is annotation, while Zod `.default()` changes parse
  output. Default should not become `.default()` without an explicit semantic policy.

## Zod Target Model

Zod source has three different roles:

1. Runtime parser and validator.
2. Static type source via `z.infer`.
3. Human-readable generated code.

Those roles usually align, but not always.

### What maps cleanly

The cleanest cases produce both useful runtime validation and honest inference:

- Primitive types.
- Object properties and `required`.
- String-only `enum` as `z.enum(...)`.
- Mixed `enum` or `const` as `z.literal(...)` unions.
- Arrays with homogeneous `items`.
- Tuples with `prefixItems`.
- Simple `anyOf` as `z.union(...)`.
- Object `additionalProperties: false` as `z.strictObject(...)`.
- Object `additionalProperties` with a schema as `.catchall(...)`.

### Runtime-only checks that remain honest

Some constraints do not improve TypeScript inference but still preserve runtime behavior:

- `minLength`, `maxLength`, `pattern`.
- `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`.
- `minItems`, `maxItems`.
- `minProperties`, `maxProperties`.
- `uniqueItems`.
- Known string formats when assertion mode is enabled.

These are acceptable because `z.infer` remains a sound broad type while runtime validation is
stricter.

### Places inference and runtime diverge

These need explicit policy:

- Constraint-only schemas such as `{ "minLength": 3 }`.
- `oneOf` where branches overlap.
- `allOf` where intersections are not statically mergeable.
- `not`, which is often runtime-only and rarely produces a useful TypeScript type.
- `if`/`then`/`else`, which may describe value-level constraints that TypeScript cannot represent
  well.
- `default`, because JSON Schema annotation is not Zod parse-default semantics.
- Object extra-key behavior, because Zod has strip, strict, and loose modes, while JSON Schema
  absent `additionalProperties` means allowed.

### Source output constraints

Generated source should be:

- Deterministic across runs.
- Readable enough to review.
- Stable under formatting.
- Declaration-safe under `isolatedDeclarations`.
- Explicit about unsupported keywords.
- Capable of generating named reusable declarations for refs and recursive shapes.
- Compatible with Zod v4 first. Zod v3 can be a later target if needed.

## Balanced Policy

The balanced policy should be:

> Emit the strongest Zod source that preserves honest `z.infer` output, and add runtime checks only
> when they do not misrepresent the inferred type.

This implies four lowering classes:

1. Direct emit: the JSON Schema construct maps cleanly to a Zod constructor.
2. Emit with checks: the base type maps cleanly and validation checks refine at runtime without
   changing static shape.
3. Normalize/evaluate first: the construct can be supported after dereferencing, merging,
   simplifying, branch-counting, or building runtime evaluation bookkeeping.
4. Metadata-only: the construct is an annotation and should not change parse behavior unless the
   input plugin exposes an explicit opt-in option.
5. Unsupported: the construct cannot be lowered honestly yet and must produce a diagnostic.

## Resolved V1 Direction

The design discussion after this landscape pass resolved the initial open questions as follows:

- Core is schema-language agnostic. It accepts an input plugin, generic plugin options, and
  core-owned output options, then renders the plugin's lowered Zod emission model into a TypeScript
  `SourceFile`.
- The JSON Schema plugin owns JSON Schema validation policy, dialect selection, ref resolution,
  unknown-key handling, and JSON Schema-to-Zod lowering.
- Plugin option schemas are plugin-owned Zod object schemas. Core derives Optique CLI flags/help
  from the supported Zod option subset, then treats parsed options as a generic type.
- Plugins lower input constructs into a shared Zod expression plan. Core owns plan validation,
  declaration naming, helper deduplication, imports, and TypeScript source construction.
- Helpers use a hybrid ABI: core ships built-in helpers for v1 JSON Schema semantics, while
  plugin-provided helper source is allowed later through a typed, deterministic helper request.
- Diagnostics always include JSON Pointer locations and may also include source spans when the input
  loader or plugin can preserve file, line, and column metadata.
- Input loading uses a generic document envelope. The CLI reads file text and source identity, while
  the selected plugin owns parsing into its input-language value and producing any location map.
- The CLI uses explicit flags:
  `x2zod compile --kind json-schema --input <input> --output <output> --name <TypeName>`.
- V1 targets Draft 2020-12 and Draft 7 in the JSON Schema plugin, starting with Ajv-backed
  schema-document preflight.
- Draft 2020-12 dynamic references and vocabularies stay in scope, but implementation should be
  dependency-backed where possible. Spike `@hyperjump/json-schema` before building custom dialect,
  vocabulary, annotation, or dynamic-reference machinery.
- Existing validators handle schema-document validity and dialect/vocabulary enforcement. `x2zod`
  tests focus on validated-schema to Zod expression-plan mapping and deterministic TypeScript source
  emission, with representative runtime smoke tests.
- URI refs are supported through the selected reference strategy. Remote fetching requires explicit
  opt-in; external schemas can be provided through a registry.
- Generated output imports only Zod by default, with generated helpers deduplicated at module scope.
- Generated output exports the root schema/type by default; exporting all named ref declarations is
  configurable and opt-in.
- Generated declaration names use a hybrid readable-plus-stable policy: the root name is explicit,
  ref names are selected from plugin-provided hints, and collisions use stable suffixes rather than
  traversal-order suffixes.
- Absent or `true` `additionalProperties` emits loose object behavior; `additionalProperties: false`
  emits strict object behavior.
- `format` and `default` are metadata-only by default.
- Unknown non-ref keywords fail unless the selected source profile marks them as inert producer
  metadata. The default profile is strict; the first named profile is `opencode`.
- Refs emit named schema declarations and use those declarations at reference sites; plugins supply
  ordered name hints, while core owns final TypeScript identifier selection.
- `patternProperties`, exact `oneOf`, `anyOf`, `allOf`, `not`, conditionals, and `unevaluated*` are
  supported through direct Zod constructs where possible and generated runtime helpers where needed.
- The acceptance corpus is OpenCode plus targeted synthetic fixtures.

## First Real-World Corpus

The first real target remains the OpenCode config schema:

- Source: <https://opencode.ai/config.json>
- Fetched on 2026-05-10 for this brief.
- Size: about 96 KB serialized JSON.
- Top-level properties: 34.
- High-frequency schema keywords: `type`, `ref`, `enum`, `additionalProperties`, `propertyNames`,
  `anyOf`, `description`, `properties`, numeric bounds, `items`, `$ref`, `required`, `pattern`,
  `prefixItems`, `const`.
- MCP subtree includes tagged local/remote object variants under `additionalProperties.anyOf`.

Important observation: the schema includes both standard `$ref` and a nonstandard `ref` field. The
JSON Schema plugin needs a policy for nonstandard metadata emitted by upstream tools. Treating every
unknown key as fatal would reject this useful corpus; treating every unknown key as inert would hide
mistakes. The selected policy is source profiles:

- default to the strict `none` profile;
- ship an explicit `opencode` profile that treats nonstandard `ref` as inert producer metadata;
- reject unknown keys that appear to contain subschemas or alter evaluation unless the active
  profile has an exact documented compatibility rule;
- report all ignored profile keys in diagnostics.

## Product Boundary

`x2zod` should not compete directly with Ajv. Ajv validates JSON Schema. `x2zod` generates Zod
source.

`x2zod` should also not simply wrap `z.fromJSONSchema()`. That path creates a runtime Zod schema, is
experimental, and does not produce the deterministic source artifact this repo is built around.

The useful product boundary is:

```text
input schema/IDL
  -> input document envelope
  -> input plugin parsing, validation/preflight, and preparation
  -> input plugin reference/dialect handling
  -> input plugin lowering into the Zod emission model
  -> core TypeScript source construction
  -> finalized TypeScript SourceFile
```

The active design lives in `docs/design.md`.
