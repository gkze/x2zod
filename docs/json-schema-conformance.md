# JSON Schema Conformance Contract

This document defines the JSON Schema compatibility target for `@x2zod/input-json-schema`. It is a
target contract, not a statement that the current implementation already conforms. Current support
is measured across the complete pinned required-suite inventory by a checked-in conformance
baseline.

<!-- BEGIN OFFICIAL SUITE SUPPORT SUMMARY -->

At suite commit `b01af8c8d50244a2eb4dd3e01073e24823aa8691`, 1,488 of 3,485 required cases currently
conform. The baseline records 1,974 cases in 602 schema groups that do not compile and 23 case-level
runtime gaps. These case counts measure this corpus, not a percentage of JSON Schema semantics: test
cases and language features are not equally weighted.

The baseline also records 63 discrepancies between the suite's authoritative expected results and
the reference-validator sanity check. Those discrepancies are tracked separately from `x2zod`
support gaps and do not replace the suite's expected results.

<!-- END OFFICIAL SUITE SUPPORT SUMMARY -->

## Compatibility Claim

The plugin targets validation equivalence for the stock vocabularies of:

- JSON Schema Draft 7;
- JSON Schema Draft 2019-09; and
- JSON Schema Draft 2020-12.

For a schema and instance in the supported input domain, the generated Zod schema's public parse
result must accept exactly when that dialect accepts. A successful parse must return a value deeply
equal to the input. Conformance runs disable core emission transforms and plugin features that would
intentionally decode values.

Validation equivalence therefore prohibits schema-driven coercion, default insertion, property
stripping, or other mutation. It does not require the parsed value to preserve JavaScript object
identity because Zod may clone containers while parsing.

The supported input domain is acyclic JSON data represented by ordinary JavaScript values after
normal JSON parsing. The contract does not include JavaScript-only values such as `undefined`,
symbols, functions, non-finite numbers, sparse arrays, class instances, or cyclic object graphs.

## Dialects And Vocabularies

Dialect selection, schema-document validity, resource identification, and vocabulary declarations
are part of conformance rather than preprocessing conveniences.

- A required unknown vocabulary fails compilation with a structured diagnostic.
- An optional unknown vocabulary does not grant permission to silently accept its keywords. Those
  keywords still follow the plugin's strict unknown-keyword and source-profile policy.
- Custom vocabulary behavior is supported only when that vocabulary has an explicit implementation.
  `x2zod` does not infer semantics from an arbitrary vocabulary URI or meta-schema.
- Draft-specific `$ref` sibling behavior, anchors, recursive references, dynamic references,
  embedded resources, and base-URI changes must follow the selected dialect.
- External resources come from an explicit registry during conformance tests. The generated schema
  must not fetch the network at runtime.

`format` follows the selected dialect and vocabulary configuration. Annotation-only format handling
must not affect acceptance. Assertion mode is reported separately and must fail compilation when a
required format implementation is unavailable.

## Generated Zod Boundary

Generated source remains a Zod module and imports only Zod by default. Readable structural Zod is
preferred when it preserves both runtime semantics and useful inference. Semantics that Zod cannot
express exactly may use deterministic module-local helpers.

An exact wire validator may guard the encoded input before structural parsing or intentional core
transforms. The structural layer must not reject a value accepted by the exact validator, and it
must not change the value during conformance runs. Generated validation code must be deterministic,
self-contained apart from Zod, declaration-safe, and free of runtime schema loading or code
generation.

The first backend proof uses Ajv standalone generation. That proof is not a permanent dependency
decision until it demonstrates all three dialects, deterministic output, known and bundled runtime
dependencies, recursive resources, and compatibility with the typed helper/source-emission model.

The checked-in spike demonstrates deterministic bundled validators for recursive Draft 7, Draft
2019-09, and Draft 2020-12 schemas with deep `uniqueItems` and Unicode-aware length checks. Ajv's
raw standalone output still references its `equal` and `ucs2length` runtime modules. The spike
rewrites those known CommonJS edges for bundling, bundles them, and executes the result with plain
Node from a temporary directory outside the workspace dependency tree. Production adoption still
requires a library-grade bundling strategy, structured issue mapping, external-resource coverage,
and integration with core's typed helper and inferred-boundary model.

## Annotations And Evaluation Output

Static annotations such as `title`, `description`, `default`, `examples`, `deprecated`, `readOnly`,
and `writeOnly` are recognized according to their dialect and retained in annotation IR once that IR
is implemented. JSON Schema `default` never becomes Zod `.default()` as part of conformance.

Zod `safeParse` does not expose the standardized JSON Schema output formats or every
instance-dependent annotation result. Those observable evaluator outputs require a companion
generated evaluator/result API and are not included in the validation-equivalence claim. Adding that
API must not change the validation contract above.

Content keywords remain annotations unless an explicit future capability adds decoding or content
validation. JSON Hyper-Schema link and HTTP relation behavior belongs in a separate plugin or
product surface.

## Numeric Boundary

JSON Schema's mathematical number model is not bounded to IEEE 754, while the current document and
runtime APIs use JavaScript `number`. Required tests whose schema and instance values survive normal
JSON parsing are in scope. Arbitrary-precision and overflow cases are reported as a separate
capability and require a future lossless JSON-text input and runtime model before they can be
claimed as supported.

## Conformance Evidence

The official JSON Schema Test Suite is pinned to an immutable source archive through
`@x2zod/build-inputs`. Tests do not fetch the suite or its remote resources from the network.

For every required Draft 7, Draft 2019-09, and Draft 2020-12 schema group, the harness:

1. selects the exact dialect and provides the suite's remote resources at their prescribed retrieval
   URIs;
2. attempts compilation and records any unsupported or unlowerable schema as a canonical group-level
   compiler gap; and
3. compares a dialect-matched reference validator with the suite's authoritative expected results as
   an independent harness sanity check.

For each schema group that compiles successfully, the harness also:

1. emits and imports the generated Zod module;
2. compares Zod acceptance with the suite's authoritative expected result for every case;
3. asserts deep output equality for every accepted instance; and
4. completes declaration-only TypeScript emit.

Every failure is attributed to its applicable schema-group or case identity: dialect, suite file,
group description, and, for case-level failures, case description, together with its phase and
diagnostic.

The checked-in conformance baseline is monotonic:

- an unlisted failure is a regression and fails CI;
- a listed failure whose observed identity or diagnostic changes fails CI;
- a listed failure that starts passing must be removed from the baseline; and
- a compiler or generated-runtime crash, timeout, nondeterministic result, or harness failure may
  not be hidden as a semantic gap.

Compiler gaps are stored once per schema group and reference deduplicated, canonical diagnostic
sets. Runtime gaps are stored per case; reference-validator compile exceptions are stored per group,
and its runtime discrepancies are stored per case. Counts and hashes of the full, passing, and gap
case inventories make selection drift visible. A failing comparison reports the suite group and case
descriptions and bounds its output. Baseline regeneration is an explicit review action:

```sh
bun --no-env-file run test:conformance:update
```

The completed release gate has zero gaps for the required suite in all three advertised dialects.
Optional suites are reported separately by capability, including format assertion, cross-draft
references, Unicode regular expressions, and arbitrary-precision numbers.

The official suite is necessary but not sufficient. Release evidence also includes deterministic
source across repeated runs and registry order, declaration emit, parse-output identity, the pinned
real-world acceptance corpus, hostile-name and source-injection fixtures, bounded reference-graph
work, and subprocess deadlines for adversarial regular expressions and recursive resources.
