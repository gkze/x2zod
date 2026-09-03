# Full JSON Schema Support Contract

This document is the finite support contract for `@x2zod/input-json-schema`. It defines what a
release may claim, what requires an explicit profile, and what must produce a diagnostic. "Full"
means full support for a named capability in this contract; it does not mean that arbitrary
third-party schema behavior can be inferred automatically.

The contract is deliberately separate from the implementation status. The
[canonical baseline](../packages/input-json-schema/test/fixtures/json-schema-test-suite/official-suite-baseline.json)
is the current source-backed status. Gate 1 attainment is derived from that validated baseline, not
stored in the capability registry: every required case must pass and the compiler, runtime, and
reference-oracle gap counts must all be zero. The additional profile, interaction, representation,
resource, and release-integrity gates remain separate claims.

The [machine-readable gate and profile registry](json-schema-capabilities.json) defines the
dashboard rows and marks Gate 1 as baseline-derived; it does not duplicate Gate 1's current state.

## Product boundary

The core compiler remains schema-language agnostic. The JSON Schema input plugin owns dialect
selection, vocabulary and schema-document validation, parsing, resource resolution, profiles, and
lowering. Core owns orchestration, diagnostics plumbing, the Zod emission model, helper
deduplication, declaration naming, and TypeScript source construction.

The generated artifact remains deterministic TypeScript source whose runtime surface is Zod. A
source-visible, module-local generated predicate compiled at build time from an existing validator
backend is allowed when Zod constructors cannot preserve a supported semantic. Opaque validator
wrappers, runtime schema loading or code generation, network fetches, and dependencies on ambient
validator state are not allowed.

Each capability has one of these states:

- **Required**: enabled by the advertised default and release-blocking.
- **Profiled**: enabled only by a named, documented option with its own evidence.
- **Recognized**: accepted and retained as inert information, without an assertion claim.
- **Unsupported**: rejected with a structured diagnostic; it must not degrade to `z.any()`.

An implementation may not use a broader state such as "best effort" for a published support claim.
Every required or profiled capability must identify its input domain, output behavior, references,
resource policy, and evidence fixtures.

## Support matrix

The [machine-readable registry](json-schema-capabilities.json) is the canonical capability and
claim-boundary matrix. It owns static states where applicable and the Gate 1 derivation rule. The
sections below define those capabilities; status surfaces must derive their rows from the registry
and validated evidence.

## Input domain and validation semantics

The required stock-dialect claim covers acyclic JSON values represented by ordinary JavaScript
values after normal JSON parsing. It excludes `undefined`, symbols, functions, non-finite numbers,
sparse arrays, class instances, cyclic graphs, and other JavaScript-only values.

For every supported schema and instance in that domain, generated `safeParse` acceptance must equal
the selected dialect's validation result. Successful parsing must return a deeply equal value. It
may clone containers, but it must not coerce, strip, insert defaults, or otherwise mutate values
under the conformance profile.

Schema-document validity, dialect selection, resource identification, vocabulary declarations,
reference semantics, and keyword applicability are part of this contract. They are not optional
preprocessing conveniences. A compiler or generated-runtime crash, timeout, nondeterministic result,
or harness failure is an infrastructure failure, not a semantic gap.

## Stock validation dialects

The required stock matrix is:

1. Draft 7, including its stock Core, Applicator, Validation, and metadata behavior.
2. Draft 2019-09, including its stock vocabularies and recursive-reference behavior.
3. Draft 2020-12, including its stock vocabularies, dynamic references, and unevaluated behavior.

"Full" for a stock dialect means all standard keywords and interactions in its advertised stock
vocabularies, including boolean schemas, independent keyword applicability, composition,
conditionals, `$ref` siblings, anchors, recursive and dynamic references, `patternProperties`,
`contains`, `unevaluatedItems`, `unevaluatedProperties`, and format assertion when the dialect
requires it. A keyword that cannot be lowered exactly is an unsupported schema, not an omitted
constraint.

The plugin selects a dialect from `$schema` when present. A caller-supplied dialect that conflicts
with `$schema` fails. If `$schema` is absent, an explicit caller override selects the dialect;
otherwise the plugin defaults to Draft 2020-12. Required unknown vocabularies fail. Optional unknown
vocabularies do not authorize their keywords: those keywords still follow the active unknown-keyword
and source-profile policy. The finite custom-dialect subset and its fail-loud
foundational-vocabulary rules are defined by the
[conformance contract](json-schema-conformance.md#dialects-and-vocabularies).

The official suite is the release gate for this stock matrix. It is necessary, but synthetic
fixtures are also required for interactions the suite does not fully exercise, especially
annotation-dependent evaluation, hostile names, source injection, resource graphs, and generated
helper boundaries.

## Standardized output and annotations

Validation and evaluator output are separate surfaces:

- The required validation surface is the generated Zod module and its acceptance/output behavior.
- Standardized JSON Schema output modes (flag, basic, detailed, and verbose, when implemented) must
  expose explicit result APIs with documented schemas, instance locations, schema locations, errors,
  and annotations. `safeParse` alone is not evidence for standardized output conformance.
- Static annotations such as `title`, `description`, `default`, `examples`, `deprecated`,
  `readOnly`, `writeOnly`, and `$comment` are retained in an annotation IR when that capability is
  claimed. `$comment` is never executable behavior.
- Instance-dependent annotations must be collected by an evaluator/result surface. They must not be
  fabricated from the generated Zod parse result.

JSON Schema `default` is an annotation. It must not become Zod `.default()` unless an explicitly
named output/transform profile changes the parse contract and documents that change. Annotation
emission must be deterministic and must not alter validation acceptance. A profile that claims
standard output or annotation behavior must have fixtures for nested schemas, references,
composition, failing instances, and annotation ordering/merging rules.

## Format profiles

The default format profile is annotation-only. `format` is recognized but validation-inert, and an
unknown format name is not treated as a host-language validator. A schema that requires the stock
format-assertion vocabulary must either use a profile that implements the named format or fail
compilation with a structured unsupported-format diagnostic.

Every assertion profile has a finite registry of format names and specifies, for each name:

- the accepted input domain and exact assertion semantics;
- normalization, Unicode, boundary, and error behavior;
- whether the implementation is generated and self-contained; and
- the conformance fixtures and dialects against which it is checked.

Profiles must distinguish annotation from assertion and must not silently enable assertion because
an installed host library happens to recognize a format. A format profile may be expanded only by
adding its name, semantics, tests, and deterministic dependency evidence. Required unsupported
formats remain compilation failures.

## Content vocabulary

`contentEncoding`, `contentMediaType`, and `contentSchema` are recognized according to the selected
dialect's content vocabulary. The default behavior is annotation-only: no base64 decode, character
set conversion, media-type parser, or nested content validation is implied.

A named content profile may add a finite codec/media-type registry and an explicit content-schema
assertion policy. It must document whether the generated Zod input is encoded or decoded, what
`z.input`, `z.output`, and `z.infer` mean, and whether invalid content fails during parsing. A
content schema is lowered only when its own dialect, references, and profile are supported. Unknown
encodings, media types, or codecs fail in assertion mode. A URI, MIME string, or producer hint never
supplies executable semantics by itself.

Content-profile evidence includes valid and invalid encoded values, malformed encodings, media-type
parameters, nested `contentSchema`, reference graphs, and round-trip/output identity tests. Content
annotation support must also be tested where no decoder is enabled.

## Lossless numbers and JSON text

The required stock claim uses ordinary JavaScript JSON values and JavaScript `number` arithmetic. It
therefore does not claim arbitrary-precision JSON numbers, exact decimal arithmetic, or exact
preservation of numeric lexemes.

A future lossless JSON-text profile may claim mathematical JSON Schema number behavior only if it
defines all of the following:

- a JSON-text parser and source envelope that preserve numeric values beyond IEEE 754;
- the runtime numeric representation exposed by generated `z.input`, `z.output`, and `z.infer`;
- semantics for integers, decimals, exponents, negative zero, overflow, underflow, and `multipleOf`;
- duplicate-member, invalid-UTF-8, BOM, and other parser policies; and
- deterministic generated helpers and a differential corpus covering boundary values.

The profile must not imply that an already-parsed JavaScript object can recover a lost number.
Lossless support is a representation and runtime contract, not merely a more precise numeric keyword
lowerer. Without that profile, out-of-domain lossless cases fail or remain unclaimed.

## Remote resource policy

Resource resolution is compile-time behavior owned by the JSON Schema plugin. The default policy
uses local resources and an explicit URI-to-document registry; the generated module never fetches
the network at runtime. The pinned official harness follows this policy by loading its checked-in
remote fixtures and passing them to the dialect-matched validator and compiler.

An opt-in remote profile may fetch resources while compiling only when it defines an allowlist,
transport policy, redirect behavior, size/deadline limits, cache/snapshot identity, and failure
diagnostics. A release claim must be reproducible from the captured resource bytes and their
digests. Credentials, ambient process state, and unpinned network responses must not affect output.

Remote support evidence includes local registry resolution, nested and recursive resources, base-URI
changes, anchors and dynamic anchors, missing resources, cycles, deterministic repeated builds, and
an explicit proof that generated modules perform no network access. An unavailable remote resource
is an error; silently treating its reference as an unconstrained schema is forbidden.

## Hyper-Schema

JSON Hyper-Schema link descriptions, link relations, URI templates, HTTP methods, submission
behavior, and network interaction are outside this plugin's stock validation/output contract. They
must not be inferred from `$id`, `links`, `rel`, or arbitrary producer metadata.

Hyper-Schema support requires a separately named plugin or product surface with its own input
contract, link/evaluator output model, security policy, and fixtures. A schema that requires
Hyper-Schema semantics is unsupported by this plugin unless that explicit surface is selected.

## Historical and future drafts

Draft 4 and Draft 6, and other historical drafts not listed in the stock matrix, are unsupported.
Their keyword and reference behavior must not be approximated by translating them to Draft 7 or
2020-12. Supporting one requires a named dialect implementation, its meta-schema and vocabulary
policy, and a dialect-specific conformance inventory.

Future JSON Schema drafts are unsupported until explicitly registered. An unknown `$schema` URI does
not select the nearest known dialect. A future-draft release must publish its supported vocabulary
matrix, conflict policy, reference/resource behavior, and pinned evidence before it can be
advertised.

OpenAPI Schema Objects, JTD, and other JSON-Schema-adjacent languages are not dialect aliases. They
require an explicit source profile or a separate input plugin with its own semantics.

## Custom vocabularies

An arbitrary vocabulary URI, meta-schema, or keyword name supplies no implementation. Required
unknown vocabularies fail. Optional unknown vocabularies may be ignored only under the normal
unknown-keyword policy; optional status is not permission to accept unknown assertion or applicator
behavior.

A registered custom vocabulary must provide a finite contract containing its URI and dialect scope,
meta-schema/validation policy, keyword classification, applicability and evaluation rules,
reference/resource behavior, lowering or generated-helper implementation, output/annotation
behavior, option/profile name, and targeted tests. The registration must state whether each keyword
is required, profiled, recognized, or unsupported.

The registration owner is responsible for semantics. Core treats the registration as a plugin
capability and does not inspect or guess its keyword meanings. A custom vocabulary can be
annotation-only, but that must be explicit and cannot be promoted to validation equivalence later
without assertion evidence.

## Completion gates

The following gates are cumulative. A release may claim only the gates whose evidence is checked in
and reproducible.

### Gate 0: finite registry

The implementation publishes a machine-readable capability matrix naming each dialect, stock
vocabulary, output mode, format profile, content profile, number/input profile, resource policy, and
custom-vocabulary registration. Every unlisted capability has a deterministic diagnostic.

Evidence: plugin option schemas, diagnostics tests, generated source snapshots, and documentation
that agree on the same names and defaults. Core tests must not contain JSON Schema-specific policy.

### Gate 1: stock dialect semantics

Draft 7, Draft 2019-09, and Draft 2020-12 pass the complete required official-suite inventory with
zero compiler gaps, runtime gaps, reference-oracle discrepancies, crashes, timeouts, or declaration
failures. The generated parse result is deeply equal to every accepted fixture. Dialect and
vocabulary failures are structured and source-located.

Evidence: the pinned suite archive and inventory, the official-suite harness, canonical baseline,
diagnostic sets, generated runtime batches, and declaration-only TypeScript emit.

### Gate 2: differential and interaction coverage

For every stock keyword and every documented cross-keyword interaction, targeted fixtures compare
generated Zod behavior with a dialect-matched reference validator. Reference-validator discrepancies
are reported separately and never used to waive an official-suite failure.

Evidence: synthetic semantics fixtures, differential results, recursive/resource graphs, hostile
identifier/source-injection fixtures, deterministic output checks, and bounded subprocess tests.

### Gate 3: standardized output and annotations

Each claimed standardized output mode and annotation profile passes its result-schema, location,
ordering, reference, composition, success, and failure fixtures. Static annotations are preserved
without changing parse behavior; instance annotations come from the declared evaluator surface.

Evidence: versioned output schemas, serialized result fixtures, annotation IR/source snapshots, and
tests proving that `default`, metadata, and annotations do not silently mutate Zod parsing.

### Gate 4: profiled formats and content

Every named format assertion and content codec/media type has complete positive/negative fixtures,
unsupported-value diagnostics, deterministic helper/source output, and documented `z.input`/
`z.output` behavior. Annotation-only defaults remain inert.

Evidence: profile registries, profile option-schema tests, differential fixtures where an oracle
exists, and generated-runtime/declaration tests for each profile.

### Gate 5: lossless representation

The lossless profile passes its parser, numeric representation, duplicate-member, Unicode, and
boundary policies. Exact numeric constraints and output types are tested from JSON text; ordinary
JavaScript input is not presented as lossless evidence.

Evidence: pinned JSON-text corpus, parser/source-map tests, arbitrary-precision differential tests,
generated helper tests, and declaration output for the lossless runtime model.

### Gate 6: resources and release integrity

Local and explicitly permitted remote resources resolve reproducibly, including recursive and
dynamic-reference graphs. Generated modules are self-contained apart from Zod and cannot perform
network I/O. Repeated runs, registry order changes, and clean temporary-directory imports produce
identical source and equivalent behavior.

Evidence: resource snapshots and digests, allowlist/limit tests, network-denial tests, source
hashes, declaration emit, and the acceptance corpora described by the project design.

## Current source-backed baseline

Do not duplicate mutable counts, commits, or hashes in this contract. Use the
[generated support summary](json-schema-conformance.md),
[canonical result](../packages/input-json-schema/test/fixtures/json-schema-test-suite/official-suite-baseline.json),
[case inventory](../packages/input-json-schema/test/fixtures/json-schema-test-suite/official-suite-inventory.json),
and [capability registry](json-schema-capabilities.json). Those sources distinguish current evidence
from the broader capability contract above. Status consumers validate the baseline before deriving
Gate 1; invalid or missing evidence is unavailable, and evidence that misses any attainment
condition is not satisfied.

## Evidence procedure

The official harness is the implementation of the stock evidence procedure. It loads the pinned
inventory and checked-in remote resources, asserts case identities and hashes, runs the
dialect-matched Ajv sanity oracle, compiles groups in batches, imports generated modules, compares
every case with the authoritative suite result, checks deep output equality, and runs declaration-
only emit. The harness rejects omitted or reordered results and treats crashes and timeouts as
failures.

The harness and baseline code are checked in at:

- `packages/input-json-schema/test/official-suite/conformance-runner.ts`;
- `packages/input-json-schema/test/official-suite/conformance-support.ts`;
- `packages/input-json-schema/test/official-suite/conformance.test.ts`;
- `packages/input-json-schema/test/fixtures/json-schema-test-suite/official-suite-inventory.json`;
  and
- `packages/input-json-schema/test/fixtures/json-schema-test-suite/official-suite-baseline.json`.

The reproducible baseline command is:

```sh
bun --no-env-file run test:conformance:update
```

Baseline changes are reviewable evidence, not an approval mechanism: an unlisted failure is a
regression, a changed listed identity or diagnostic fails comparison, and a newly passing listed gap
must be removed intentionally. The completion gates require the baseline to contain no compiler,
runtime, or reference-oracle gaps for the required stock matrix before that matrix can be advertised
as full support.
