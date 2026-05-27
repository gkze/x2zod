# x2zod Design

## Summary

`x2zod` is a modular schema/IDL to Zod v4 source compiler. The core is an orchestration and emission
layer, not a JSON Schema-specific validator. It calls an input plugin that owns its input kind end
to end: declaring whether and how source validation occurs, resolving that input language's
references, and lowering the input language's constructs into a Zod-oriented emission model. The
core then renders the lowered model into a finalized raw TypeScript compiler `SourceFile`.

Generated modules import only Zod. When JSON Schema semantics cannot be represented directly by Zod
constructors, `x2zod` emits deduplicated helper code into the generated module.

## Package Boundaries

The v1 implementation should use separate packages so the compiler architecture is visible from the
start:

- `@x2zod/core`: shared result and diagnostic types, input plugin contracts, an aligned `ts`
  namespace re-export, source-file construction and printing internals, and the Zod emission model.
- `@x2zod/json-schema`: JSON Schema input plugin plus its typed option schema. This package owns
  JSON Schema dialect selection, schema-document validation policy, ref resolution, and JSON
  Schema-to-Zod lowering. Validator and resolver bridge code is internal to this package.
- `@x2zod/cli`: CLI package, located at `apps/cli` and exposing the `x2zod` binary.

There should not be standalone validator packages in v1. The core plugin interface does not expose a
generic schema-language validation extension point, so validator selection is a JSON Schema plugin
implementation detail surfaced only through that plugin's typed options.

## Input Plugin Contract

Core should expose a schema-language-agnostic input plugin contract. Conceptually:

```ts
export type InputPlugin<TPreparedInput, TOptions> = {
  readonly kind: string;
  readonly optionsSchema: PluginOptionsSchema<TOptions>;
  readonly prepare: (
    document: InputDocument,
    options: TOptions,
  ) => Promise<Result<PreparedInput<TPreparedInput>>>;
  readonly lower: (
    input: PreparedInput<TPreparedInput>,
    options: TOptions,
  ) => Promise<Result<ZodEmissionModule>>;
};
```

The exact names can evolve, but the boundary should stay stable:

- the plugin owns its typed option schema and option semantics;
- the plugin decides whether validation happens, when it happens, and which validator or strategy is
  used;
- the plugin owns parsing the input document into its schema-language value;
- the plugin owns input-kind reference and dialect semantics;
- the plugin owns mapping input constructs into the shared Zod emission model;
- core treats plugin options as a generic `TOptions` and does not inspect input-specific option
  fields;
- core owns diagnostics plumbing, orchestration, TypeScript source construction, and final
  `ts.SourceFile` output.

For JSON Schema, `@x2zod/json-schema` is the first input plugin. Ajv and any future validator or
resolver adapters are internal tools used by that plugin, not global core behavior and not
separately published package boundaries.

## Dependency Strategy

`x2zod` should not reimplement mature JSON Schema infrastructure unless the source-generation policy
requires information that existing libraries cannot provide. The intended split is:

- use Ajv first for schema-document preflight against selected JSON Schema dialects;
- use an existing JSON parser/source-map library for JSON Pointer to source-span mapping;
- spike `@hyperjump/json-schema` before implementing custom dialect, vocabulary, annotation, or
  dynamic-reference handling;
- use a smaller resolver such as `@apidevtools/json-schema-ref-parser` only if the chosen scope is
  plain ref bundling/dereferencing and Hyperjump is more machinery than needed;
- keep `json-schema-to-zod`, `zod-from-json-schema`, and Zod's `z.fromJSONSchema()` as comparison
  oracles, not architecture dependencies.

Advanced JSON Schema support remains in scope, but should enter through direct Zod lowering,
dependency-backed preparation, or generated helpers with tests. The project should avoid building a
general JSON Schema validator under the name of Zod source generation.

## Input Documents

Core and the CLI use a document envelope rather than pre-parsing input files. The CLI reads the
selected file as text, records source identity, and passes that envelope to the selected plugin. The
plugin parses the document, preserves source locations when possible, and prepares the
schema-language-specific input value.

```ts
export type InputDocument = {
  readonly source: InputDocumentSource;
  readonly text: string;
  readonly mediaType?: string;
};

export type InputDocumentSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "uri"; readonly uri: string }
  | { readonly kind: "inline"; readonly id: string };

export type PreparedInput<TInput> = {
  readonly value: TInput;
  readonly locations?: SourceLocationMap;
};

export type SourceLocationMap = ReadonlyMap<JsonPointer, SourceSpan>;
```

This keeps core schema-language agnostic: it does not need to know whether JSON Schema input arrived
as JSON, YAML, an external URI, or inline test text. The JSON Schema plugin can choose a JSON/YAML
parser that preserves offsets, map parsed values back to JSON Pointer locations, and attach spans to
diagnostics returned during preflight, reference resolution, and lowering.

## Plugin Option Schemas

Plugin options are declared once as a Zod v4 object schema. The schema is the source of truth for
the option type, defaults, validation, and CLI help metadata:

```ts
export const jsonSchemaOptionsSchema = z.object({
  dialect: z
    .enum(["draft-2020-12", "draft-7"])
    .default("draft-2020-12")
    .describe("JSON Schema dialect."),
  validator: z.enum(["ajv", "none"]).default("ajv").describe("Schema document validator."),
  sourceProfile: z
    .enum(["none", "opencode"])
    .default("none")
    .describe("Source-specific JSON Schema compatibility profile."),
  allowRemoteRefs: z.boolean().default(false).describe("Allow remote reference fetching."),
});

export type JsonSchemaOptions = z.infer<typeof jsonSchemaOptionsSchema>;
```

Core introspects a supported Zod option-schema subset and maps it to Optique parsers:

- root `z.object(...)` fields become named flags;
- field names become kebab-case long flags, so `allowRemoteRefs` becomes `--allow-remote-refs`;
- `z.enum(...)` becomes an Optique `choice(...)`;
- `z.string()`, `z.number()`, `z.int()`, and `z.boolean()` become the corresponding Optique scalar
  parsers or flags;
- `z.array(supportedScalar)` becomes a repeatable option;
- `.optional()` and `.default(...)` drive optional/default behavior;
- `.describe(...)` and supported `.meta(...)` fields drive help text;
- refinements are allowed as final Zod validation, but do not need to become Optique-native checks.

The CLI path is:

```text
plugin Zod option schema
  -> core Zod-to-Optique adapter
  -> Optique token parsing, help, and shell completion
  -> Zod parse for defaults, refinements, transforms, and final TOptions
```

Unsupported option-schema shapes should fail plugin registration with clear diagnostics. Examples
include nested objects, broad unions, records, and transforms that change the option object shape in
ways the CLI adapter cannot model.

Plugins with no options should declare `z.object({})`; core should not need a separate "no options"
path.

The generated Optique compile parser should use the plugin kind as a discriminator and attach the
generated option parser as the branch:

```ts
const kind = option("-k", "--kind", choice(pluginKinds), {
  description: message`Input plugin kind.`,
});

const pluginOptions = conditional(kind, {
  "json-schema": zodObjectToOptique(jsonSchemaInputPlugin.optionsSchema),
});
```

For exact per-kind help, the CLI can add a small pre-help router: when argv contains `compile`,
`--help`, and a valid `--kind`, it builds a one-branch compile parser for that plugin and lets
Optique render help for only that branch. This preserves Optique's help formatting while avoiding
manual plugin-specific CLI wiring.

After option parsing, core treats options as opaque `TOptions`. It does not inspect fields such as
`validator`, `dialect`, `allowRemoteRefs`, or any future plugin-specific setting.

## Zod Expression Plan

Input plugins lower their input language into a thin Zod expression plan exposed by `@x2zod/core`.
This is not a semantic clone of Zod and not a second type system. It is a deterministic plan for the
Zod source expression core should emit, plus the module-level information needed to make that source
declaration-safe and readable.

Plugins should not emit TypeScript AST directly for normal schema constructs, and they should not
return runtime Zod schema objects for core to decompile. The plugin owns semantic mapping from its
input language to Zod calls. Core owns plan validation, naming, helper deduplication, import policy,
and TypeScript source construction.

The expression plan is intentionally close to Zod syntax:

```ts
export type ZodExpression =
  | {
      readonly kind: "factory";
      readonly factory: ZodFactoryName;
      readonly args: readonly ZodArgument[];
      readonly calls: readonly ZodMethodCall[];
      readonly annotations: readonly ZodAnnotation[];
    }
  | { readonly kind: "reference"; readonly symbol: ZodSymbol }
  | { readonly kind: "lazyReference"; readonly symbol: ZodSymbol }
  | {
      readonly kind: "helperCall";
      readonly helper: ZodHelperRequest;
      readonly args: readonly ZodArgument[];
      readonly calls: readonly ZodMethodCall[];
      readonly annotations: readonly ZodAnnotation[];
    };

export type ZodMethodCall = { readonly method: string; readonly args: readonly ZodArgument[] };
```

For example, the JSON Schema plugin maps `{ "type": "string", "minLength": 3 }` to a planned
`z.string().min(3)` call chain. Core does not know what `minLength` means; it only knows how to emit
the requested Zod expression.

Plugins should use builder APIs over raw tagged objects so lowering reads as a binding layer:

```ts
const schema = ctx.z
  .object({ mode: ctx.z.enum(["build", "watch"]), path: ctx.z.string() })
  .loose()
  .annotate({ description: "Tool configuration." });
```

Internally, that builder records factories, arguments, chained method calls, references, helper
calls, and annotations. We should avoid bespoke semantic nodes such as `StringMinLengthCheck` or
`ObjectAdditionalPropertiesPolicy` unless the emitter truly needs information that cannot be
represented as planned Zod calls.

The module-level plan is separate from expression planning:

```ts
export type ZodEmissionModule = {
  readonly root: ZodSymbol;
  readonly declarations: readonly ZodDeclaration[];
  readonly helpers: readonly ZodHelperRequest[];
};
```

This lets core produce deterministic modules with stable declaration names, self-contained helper
code, recursive refs, and `export type T = z.infer<typeof schema>` without pushing those policies
into each plugin.

Declarations should carry ordered name hints rather than final TypeScript identifiers. Plugins know
where a useful source-language name came from; core knows how to make that name legal, unique, and
consistent in a TypeScript module:

```ts
export type ZodDeclaration = {
  readonly symbol: ZodSymbol;
  readonly expression: ZodExpression;
  readonly nameHints: readonly ZodDeclarationNameHint[];
};

export type ZodDeclarationNameHint = {
  readonly value: string;
  readonly provenance: "title" | "definitionKey" | "anchor" | "uriSegment" | "pointer" | "explicit";
};
```

The escape hatch is helper-backed runtime semantics, not arbitrary plugin-owned source. Advanced
JSON Schema constructs such as exact `oneOf`, `not`, `if` / `then` / `else`, `patternProperties`,
deep `const`/`enum`, and `unevaluated*` should lower into ordinary planned Zod expressions plus
helper requests. If a plugin needs raw TypeScript for a helper body, that raw source belongs in a
typed helper request and must declare its dependencies and inferred structural boundary.

## Helper ABI

Helpers use a hybrid model. Core provides a built-in helper catalog for v1 JSON Schema semantics,
and helper requests may optionally carry plugin-provided source when a future plugin needs behavior
outside the catalog.

Built-in helpers are the default path. A helper request names the helper, supplies serializable
configuration, and points at the IR expressions or generated declarations the helper needs:

```ts
export type ZodHelperRequest = {
  readonly helper: ZodHelperId;
  readonly key: string;
  readonly args: readonly ZodHelperArgument[];
};
```

`helper` selects a known implementation such as deep equality, deep unique array items, exact
`oneOf` branch counting, `not`, conditionals, property-name validation, pattern-property validation,
or `unevaluated*` bookkeeping. `key` is a deterministic dedupe key derived from the helper id and
configuration. `args` must be IR-safe references, literals, or declarations; helper requests should
not smuggle arbitrary TypeScript through argument strings.

Plugin-provided helpers use the same request shape but add a typed source payload:

```ts
export type ZodHelperSource = {
  readonly exportName: string;
  readonly source: string;
  readonly dependencies: readonly ZodHelperDependency[];
  readonly inferredBoundary: ZodInferredBoundary;
};
```

Core is still responsible for deduplication, name collision handling, declaration-safe placement,
and formatting. Plugin-provided helper source must be module-local, deterministic, and explicit
about dependencies. It cannot import arbitrary packages in v1; generated modules remain
self-contained apart from Zod.

The v1 implementation should start with the built-in helper catalog only. The typed source payload
is part of the design so the ABI does not need to be redesigned later, but it should be exercised
only when a second plugin or a concrete JSON Schema case proves it is needed.

## Public API

The primary library entrypoint should live in core and compile through an input plugin:

```ts
export const compileToZodSource = async <TPreparedInput, TPluginOptions>(
  request: CompileToZodSourceRequest<TPreparedInput, TPluginOptions>,
): Promise<CompileToZodSourceResult> => {
  // ...
};
```

Conceptually, the request separates core-owned output options from plugin-owned options:

```ts
export type CompileToZodSourceRequest<TPreparedInput, TPluginOptions> = {
  readonly document: InputDocument;
  readonly plugin: InputPlugin<TPreparedInput, TPluginOptions>;
  readonly pluginOptions: TPluginOptions;
  readonly output: ZodSourceOutputOptions;
};

export type ZodSourceOutputOptions = {
  readonly typeName: string;
  readonly zodImportPath?: string;
  readonly declarationExportMode?: "root" | "all";
  readonly declarationNameOverrides?: Readonly<Record<string, string>>;
};
```

The successful result contains a finalized raw TypeScript compiler source file:

```ts
export type CompileToZodSourceResult = Result<{ readonly sourceFile: ts.SourceFile }>;
```

`@x2zod/core` should re-export the exact `ts` namespace used internally, aligned with the TypeScript
7 / `@typescript/native-preview` toolchain used by `tsgo`. Callers that want source text can print
the returned `ts.SourceFile` with that aligned compiler API. The public compile result should not
expose a wrapper object from another AST library and should not include source text as the primary
artifact.

The JSON Schema package should export a JSON Schema input plugin and its typed options. Callers use
that plugin with the generic core compile API:

```ts
await compileToZodSource({
  document: {
    source: { kind: "file", path: "opencode.schema.json" },
    text: schemaText,
    mediaType: "application/schema+json",
  },
  plugin: jsonSchemaInputPlugin,
  pluginOptions: jsonSchemaOptions,
  output: { typeName: "UserConfig", declarationExportMode: "root" },
});
```

The prepared JSON Schema value type is `unknown`. JSON Schema parsing and validation behavior are
configured through `jsonSchemaOptions`, not through core.

## CLI

The first CLI surface is a direct compile command with explicit flags only:

```sh
x2zod compile --kind json-schema --input <input> --output <output> --name <TypeName>
```

The CLI should:

- read input files as text and pass an `InputDocument` envelope to the selected plugin;
- require `-k` / `--kind`, selecting the input plugin;
- require `-i` / `--input`, selecting the input schema file;
- require `-o` / `--output`, selecting the generated TypeScript file;
- require `-n` / `--name`, interpreted as the generated root TypeScript type name;
- expose JSON Schema plugin options such as `--dialect draft-2020-12|draft-07`;
- expose JSON Schema plugin validation options such as `--validator ajv|none`, defaulting to `ajv`;
- expose source compatibility profiles such as `--source-profile opencode`;
- support a configurable Zod import path, defaulting to `zod/v4`;
- support `--export-declarations root|all`, defaulting to `root`;
- support explicit registry entries for external URI refs;
- require an explicit opt-in flag before fetching remote URI refs;
- print and format generated TypeScript before writing it.

The generated root schema const name is derived from the required type name. For example,
`--name UserConfig` emits `userConfigSchema` and
`export type UserConfig = z.infer<typeof userConfigSchema>`.

## Declaration Naming

Generated declaration names use a hybrid readable-plus-stable policy.

The root declaration is explicit: callers must supply `typeName`, and core derives the root schema
const name from it. Non-root declaration names are chosen by core from plugin-provided ordered name
hints. The JSON Schema plugin should supply hints from, in order of expected readability:

- explicit caller overrides;
- schema `title`;
- `$defs` / `definitions` keys;
- `$anchor` and `$dynamicAnchor`;
- URI path segments;
- a stable pointer-derived fallback.

Core then sanitizes the selected candidate into a legal TypeScript identifier, applies schema/type
suffix policy, and resolves collisions deterministically. Collision suffixes should be derived from
the declaration's stable symbol identity rather than from traversal order so unrelated schema
movement does not rename existing declarations.

The optional `declarationNameOverrides` API is keyed by `ZodSymbol` identity and takes precedence
over plugin hints. The CLI does not need a first-pass flag for this until there is a config-file
surface, but the core model should leave room for users who need stable public names in generated
modules.

## JSON Schema Validation

Schema-document validation is a JSON Schema input-plugin concern, not a core compiler concern. The
JSON Schema plugin can use an internal functional adapter:

```ts
export type SchemaPreflightValidator = (
  input: SchemaPreflightValidatorInput,
) => Promise<SchemaPreflightValidatorResult>;
```

The adapter validates the schema document against the selected JSON Schema dialect when the plugin's
typed options request that validation mode, then returns normalized diagnostics to the JSON Schema
plugin. It does not validate data instances and is not an oracle interface.

V1 starts with an internal Ajv adapter inside `@x2zod/json-schema`. The JSON Schema plugin's default
options use Ajv for schema-document validation, with `none` available for trusted inputs or tests
that intentionally bypass preflight. `ata-validator` is not a V1 default; it can be revisited later
as a performance or AOT-validation spike if it proves useful for this plugin boundary.

Preflight validator diagnostics should normalize to `x2zod` diagnostics using JSON Pointer locations
before the plugin returns failures to core.

## Source Profiles

Unknown-keyword compatibility is owned by the JSON Schema plugin through explicit source profiles.
The default profile is `none`, which rejects unknown non-vocabulary keywords. Named profiles
describe real producer quirks without weakening global strictness.

For v1, the first named profile is `opencode`. It exists because the OpenCode config schema includes
both standard `$ref` and a nonstandard `ref` field. Under the `opencode` profile, `ref` is treated
as inert producer metadata, never as a reference alias and never as validation behavior.

A source profile may:

- allow exact known inert annotation keywords;
- restrict allowances by schema location when a keyword is only safe in specific positions;
- attach ignored-key diagnostics so generated output is auditable.

A source profile may not:

- override standard JSON Schema keywords or vocabularies;
- turn an unknown keyword into active validation behavior without an implemented lowering path;
- suppress unknown keywords that look like subschemas or evaluation-changing constructs unless the
  profile has an exact, documented compatibility rule for that keyword and location.

If a source-specific construct needs runtime behavior, the JSON Schema plugin must model and lower
that behavior explicitly. Otherwise compilation fails with an unknown or unsupported keyword
diagnostic.

## Dialects And References

V1 supports JSON Schema Draft 2020-12 and Draft 7.

Dialect selection uses the schema's `$schema` when present. If the caller also supplies a dialect
option and it conflicts with `$schema`, compilation fails with a diagnostic. If `$schema` is absent,
the caller or CLI default selects the dialect.

For Draft 2020-12, the JSON Schema plugin must process `$vocabulary` declarations. Required unknown
vocabularies fail with an unsupported-vocabulary diagnostic. Optional unknown vocabularies may be
ignored, but their keywords still pass through the normal unknown-keyword policy: unknown active
keywords fail unless the selected source profile explicitly treats them as inert metadata.

`format` remains metadata-only by default only when the active dialect does not require the
format-assertion vocabulary. If a schema declares required format assertions, the JSON Schema plugin
must emit assertion checks for supported formats and fail on required unsupported formats instead of
silently preserving them as metadata.

References:

- local and external URI refs are supported;
- Draft 2020-12 `$dynamicAnchor` and `$dynamicRef` are supported;
- resolved refs emit into the same generated module for v1;
- external refs resolve from an explicit schema registry map or from remote fetching when remote
  fetching is explicitly enabled;
- the JSON Schema plugin builds a resource graph with dynamic-anchor tracking before lowering;
- `$dynamicRef` lowers through the reference model or helper-backed runtime resolution when dynamic
  scope cannot be represented as a plain static ref;
- named schema declarations are generated for refs and referenced at use sites;
- ref declarations provide ordered name hints to core; core applies the declaration naming policy.

## Generated Source

Generated modules should:

- import only Zod;
- default to importing from `zod/v4`, with the import path configurable;
- always export a root schema const and root `z.infer` type;
- emit named schema declarations for refs;
- keep named ref declarations internal by default;
- export all named declarations only when `declarationExportMode` is `"all"`;
- emit module-level deduplicated helpers for advanced runtime semantics;
- preserve JSON Schema metadata with Zod metadata and readable comments where useful;
- format output through the TypeScript printer and Oxfmt in CLI/repo workflows.

Generated modules should not import an `@x2zod/runtime` helper package in v1. Advanced helpers
should be emitted into the generated module so the output stays self-contained apart from Zod.
Built-in helper implementations are preferred; plugin-provided helper sources are allowed only
through the typed helper ABI.

## JSON Schema Semantics

The compiler should preserve JSON Schema semantics for supported constructs. When exact semantics
require runtime checks that TypeScript cannot represent, generated `z.infer` types should remain the
best honest structural type and helper/refinement code should enforce runtime-only behavior.

Locked v1 behavior:

- Boolean schemas are supported anywhere.
- Absent or `true` `additionalProperties` emits loose object behavior.
- `additionalProperties: false` emits strict object behavior.
- `format` is metadata-only by default.
- `default` is metadata-only by default.
- required format-assertion vocabulary overrides the default `format` metadata policy.
- Unknown non-ref keywords are rejected unless the selected source profile marks them as inert
  compatibility metadata.
- Profile-allowed unknown keywords are preserved as inert metadata and reported in diagnostics.
- Unknown required vocabularies fail.
- `$dynamicAnchor` and `$dynamicRef` are supported for Draft 2020-12.
- `patternProperties` is supported with runtime checks where needed.
- `oneOf` preserves exact one-branch semantics, using generated counting/refinement helpers when
  necessary.
- `anyOf` uses clean Zod unions where possible and runtime logic where needed.
- `allOf` uses object merging, intersections, or refinements as appropriate.
- `not` is supported with runtime refinement.
- `if` / `then` / `else` are supported with runtime refinement.
- `unevaluatedProperties` and `unevaluatedItems` are supported with runtime evaluation bookkeeping.

Unsupported or unlowerable semantics should fail with diagnostics instead of silently degrading to
`z.any()`.

## Diagnostics

Diagnostics should be structured and use JSON Pointer as the required schema location format. The
library should return result objects instead of throwing for expected compile failures.

Diagnostics may also carry an optional source span when the input loader or plugin can preserve one:

```ts
export type DiagnosticLocation = {
  readonly pointer: JsonPointer;
  readonly sourceSpan?: SourceSpan;
};

export type SourceSpan = {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end?: SourcePosition;
};

export type SourcePosition = { readonly line: number; readonly column: number };
```

JSON Pointer remains the library contract because it is stable across JSON, YAML, remote schemas,
and generated intermediate graphs. Source spans are additive CLI/user-experience metadata: the CLI
should render file, line, and column when present, but library consumers can always rely on the
pointer.

Diagnostic classes should include:

- invalid schema document;
- unsupported dialect;
- unsupported vocabulary;
- dialect conflict;
- unresolved reference;
- unknown keyword;
- unsupported keyword;
- ambiguous schema;
- unrepresentable schema combination;
- emitter failure.

## Documentation

The current scaffold includes this design document, the problem-space brief, and short design notes.
A follow-up documentation pass can add:

- `CONTEXT.md` with glossary terms such as input plugin, schema preflight, lowering, emission model,
  generated helper, schema registry, dialect, and finalized source file;
- one ADR for the initial architecture decision.

## Test Plan

`x2zod` should lean on existing JSON Schema validators for schema-document validity, dialect
handling, and vocabulary enforcement. The project's own conformance target is mapping a validated
JSON Schema document into the correct Zod expression plan and emitting deterministic,
declaration-safe TypeScript source. Generated Zod runtime tests should be representative regression
tests, not an attempt to supersede Ajv or pass the full JSON Schema Test Suite as a validator.

Validator adapter tests:

- valid and invalid schema documents;
- Draft 2020-12 and Draft 7;
- `$vocabulary`, required unknown vocabularies, and optional unknown vocabularies;
- `$schema` and explicit dialect conflict;
- normalized JSON Pointer diagnostics;
- Ajv preflight diagnostics normalized to `x2zod` diagnostics;
- an explicit dependency spike for ref, dialect, vocabulary, and annotation behavior before custom
  implementations are added.

Mapper / expression-plan tests:

- strict unknown-keyword failures;
- `opencode` source-profile handling for inert `ref` metadata;
- primitives and boolean schemas;
- enums and consts;
- objects, required properties, loose objects, strict objects, and catchalls;
- metadata preservation;
- local refs and external URI refs;
- dynamic anchors and dynamic refs;
- `patternProperties`;
- `oneOf`, `anyOf`, `allOf`, `not`;
- conditionals;
- `unevaluatedProperties` and `unevaluatedItems`.

Emitter tests:

- deterministic TypeScript AST/source output from representative Zod expression plans;
- declaration-safe schema const and `z.infer` type exports;
- default root-only export mode;
- opt-in all named declaration export mode;
- hybrid declaration naming from readable hints, stable fallbacks, and deterministic collision
  suffixes;
- helper deduplication and stable helper naming;
- configurable Zod import path;
- Oxfmt-compatible output.

Runtime smoke tests:

- write generated source to temp modules;
- import with Bun;
- validate behavior through Zod `safeParse`;
- verify representative runtime-only helper semantics where TypeScript inference cannot encode
  constraints;
- compare generated Zod behavior with Ajv on small targeted fixtures for tricky semantics, without
  treating full JSON Schema Test Suite pass/fail as the product gate.

Acceptance corpus:

- compile the OpenCode schema;
- targeted synthetic fixtures for refs, composition, metadata, additional properties, pattern
  properties, conditionals, and unevaluated keywords;
- smoke-level performance check that OpenCode compiles in reasonable time.

## Implementation Order

1. Define core result, diagnostic, input plugin, Zod expression plan, builder APIs, TypeScript API,
   and source construction types.
2. Implement the JSON Schema input plugin skeleton with option parsing, document parsing, JSON
   Pointer source-span mapping, Ajv preflight, and a lowering entrypoint.
3. Spike the ref/dialect/vocabulary strategy with `@hyperjump/json-schema` and a smaller ref-parser
   fallback before committing to custom graph handling.
4. Implement the selected reference, dialect, vocabulary, and naming strategy.
5. Implement direct Zod expression planning for primitives, objects, enums, arrays, tuples,
   metadata, and refs.
6. Add generated helper registry and advanced semantic support.
7. Build the CLI compile command and formatter/write path.
8. Add golden, runtime, adapter, and acceptance tests.
9. Add `CONTEXT.md` and an ADR once the core contract is concrete enough to avoid documenting churn.
