import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseZodEmissionModule, zodHelper, zodPlan, zodSymbol } from "../src/index";
import type { DiagnosticCode, ZodEmissionModuleInput, ZodExpressionInput } from "../src/index";

const decimalDivisor = 0.1;

const rootModule = (expression: ZodExpressionInput): ZodEmissionModuleInput => ({
  declarations: [{ expression, symbol: "root" }],
  root: "root",
});

const expectInvalidModule = (module: ZodEmissionModuleInput, code: DiagnosticCode): void => {
  const result = parseZodEmissionModule(module);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, code);
};

const expectInvalidRoot = (
  expression: ZodExpressionInput,
  code: DiagnosticCode = "invalid_zod_emission_module",
): void => {
  expectInvalidModule(rootModule(expression), code);
};

void describe("parseZodEmissionModule", () => {
  void test("validates independently exported expressions", () => {
    const result = parseZodEmissionModule({
      declarations: [
        {
          expression: zodPlan.string(),
          exportExpression: zodPlan.reference(zodSymbol("missing")),
          symbol: "root",
        },
      ],
      root: "root",
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "unresolved_reference");
  });

  void test("rejects missing roots, duplicate symbols, unresolved refs, and invalid factory args", () => {
    expectInvalidModule({ declarations: [], root: "root" }, "invalid_zod_emission_module");
    expectInvalidModule(
      {
        declarations: [
          { expression: zodPlan.string(), symbol: "root" },
          { expression: zodPlan.number(), symbol: "root" },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
    expectInvalidRoot(zodPlan.reference(zodSymbol("missing")), "unresolved_reference");
    expectInvalidRoot({ factory: "array", kind: "factory" });
  });

  void test("rejects non-terminating cycles and accepts data-descending recursion", () => {
    expectInvalidRoot(zodPlan.reference(zodSymbol("root")), "cyclic_reference");
    expectInvalidModule(
      {
        declarations: [
          { expression: zodPlan.reference(zodSymbol("peer")), symbol: "root" },
          { expression: zodPlan.reference(zodSymbol("root")), symbol: "peer" },
        ],
        root: "root",
      },
      "cyclic_reference",
    );
    assert.equal(
      parseZodEmissionModule(
        rootModule(zodPlan.object({ child: zodPlan.reference(zodSymbol("root")) })),
      ).ok,
      true,
    );
  });

  void test("accepts nonempty adapter-specific declaration name hint provenance", () => {
    const parsed = parseZodEmissionModule({
      declarations: [
        {
          expression: zodPlan.string(),
          nameHints: [
            { provenance: "protobuf/message", value: "Message" },
            { provenance: "graphql/type", value: "Type" },
            { value: "Default" },
          ],
          symbol: "root",
        },
      ],
      root: "root",
    });

    assert.equal(parsed.ok, true);
    assert.deepEqual(
      parsed.value.declarations[0]?.nameHints.map((hint) => hint.provenance),
      ["protobuf/message", "graphql/type", "explicit"],
    );
    expectInvalidModule(
      {
        declarations: [
          {
            expression: zodPlan.string(),
            nameHints: [{ provenance: "", value: "Root" }],
            symbol: "root",
          },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
  });
});

void describe("parseZodEmissionModule method validation", () => {
  void test("rejects unsupported and malformed method calls", () => {
    expectInvalidRoot({ calls: [{ method: "trim" }], factory: "string", kind: "factory" });
    expectInvalidRoot({
      calls: [{ args: [{ kind: "literal", value: true }], method: "optional" }],
      factory: "string",
      kind: "factory",
    });
    expectInvalidRoot({
      calls: [{ args: [{ kind: "literal", value: true }], method: "regex" }],
      factory: "string",
      kind: "factory",
    });
    expectInvalidRoot({
      args: [{ expression: zodPlan.string(), kind: "expression" }],
      calls: [{ args: [{ kind: "literal", value: "1" }], method: "min" }],
      factory: "array",
      kind: "factory",
    });
    expectInvalidRoot({
      calls: [
        {
          args: [{ kind: "helper", request: { divisor: 0, helper: "exactMultipleOf" } }],
          method: "refine",
        },
      ],
      factory: "number",
      kind: "factory",
    });
  });

  void test("accepts valid built-in refinements and rejects invalid receivers", () => {
    assert.equal(
      parseZodEmissionModule(
        rootModule(zodPlan.refine(zodPlan.number(), zodHelper.exactMultipleOf(decimalDivisor))),
      ).ok,
      true,
    );
    assert.equal(
      parseZodEmissionModule(
        rootModule(zodPlan.refine(zodPlan.string(), zodHelper.codePointLength(1, 2))),
      ).ok,
      true,
    );
    assert.equal(
      parseZodEmissionModule(
        rootModule(zodPlan.refine(zodPlan.array(zodPlan.unknown()), zodHelper.uniqueItems())),
      ).ok,
      true,
    );
    expectInvalidRoot(zodPlan.refine(zodPlan.string(), zodHelper.exactMultipleOf(decimalDivisor)));
    expectInvalidRoot(zodPlan.refine(zodPlan.number(), zodHelper.codePointLength(1, 2)));
    expectInvalidRoot(zodPlan.refine(zodPlan.string(), zodHelper.uniqueItems()));
  });

  void test("rejects invalid required keys and duplicate object keys", () => {
    expectInvalidRoot({
      args: [{ kind: "object", properties: [] }],
      calls: [{ args: [{ elements: [], kind: "array" }], method: "required" }],
      factory: "object",
      kind: "factory",
    });
    expectInvalidRoot({
      args: [
        {
          kind: "object",
          properties: [
            { expression: zodPlan.string(), key: "name" },
            { expression: zodPlan.number(), key: "name" },
          ],
        },
      ],
      factory: "object",
      kind: "factory",
    });
  });
});

void describe("parseZodEmissionModule receiver validation", () => {
  void test("accepts exclusive unions with at least two branches", () => {
    const result = parseZodEmissionModule(
      rootModule(zodPlan.xor([zodPlan.string(), zodPlan.number()])),
    );

    assert.equal(result.ok, true);
    expectInvalidRoot({
      args: [{ elements: [{ expression: zodPlan.string(), kind: "expression" }], kind: "array" }],
      factory: "xor",
      kind: "factory",
    });
  });

  void test("rejects invalid enum arguments and accepts empty tuples", () => {
    expectInvalidModule(
      {
        declarations: [
          {
            expression: {
              args: [{ elements: [], kind: "array" }],
              factory: "enum",
              kind: "factory",
            },
            symbol: "root",
          },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
    expectInvalidModule(
      {
        declarations: [
          {
            expression: {
              args: [{ elements: [{ kind: "literal", value: true }], kind: "array" }],
              factory: "enum",
              kind: "factory",
            },
            symbol: "root",
          },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
    assert.equal(parseZodEmissionModule(rootModule(zodPlan.tuple([]))).ok, true);
  });

  void test("accepts object-input wrappers and rejects invalid wrapped receivers", () => {
    const wrapped = zodPlan.preserveObjectInput(
      zodPlan.strict(zodPlan.object({ ["__proto__"]: zodPlan.string() })),
      ["__proto__"],
    );

    assert.equal(parseZodEmissionModule(rootModule(wrapped)).ok, true);
    expectInvalidRoot(zodPlan.preserveObjectInput(zodPlan.string(), ["__proto__"]));
    expectInvalidRoot(zodPlan.preserveObjectInput(zodPlan.object({}), ["__proto__"]));
    expectInvalidRoot(
      zodPlan.preserveObjectInput(zodPlan.optional(zodPlan.object({ value: zodPlan.string() })), [
        "value",
      ]),
    );
    expectInvalidRoot(
      zodPlan.preserveObjectInput(zodPlan.object({ ["__proto__"]: zodPlan.string() }), [
        "__proto__",
        "__proto__",
      ]),
    );
    expectInvalidRoot(zodPlan.strict(wrapped));
  });
});

void describe("parseZodEmissionModule method receiver validation", () => {
  void test("rejects invalid method receiver and required-key combinations", () => {
    expectInvalidRoot(zodPlan.regex(zodPlan.number(), "x"));
    expectInvalidRoot(zodPlan.gt(zodPlan.string(), 1));
    expectInvalidRoot(zodPlan.strict(zodPlan.string()));
    expectInvalidModule(
      {
        declarations: [
          { expression: zodPlan.optional(zodPlan.object({})), symbol: "object" },
          { expression: zodPlan.strict(zodPlan.reference(zodSymbol("object"))), symbol: "root" },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
    expectInvalidRoot(zodPlan.required(zodPlan.object({}), ["missing"]));
    expectInvalidModule(
      {
        declarations: [
          { expression: zodPlan.object({ present: zodPlan.string() }), symbol: "object" },
          {
            expression: zodPlan.required(zodPlan.reference(zodSymbol("object")), ["missing"]),
            symbol: "root",
          },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
  });
});

void describe("object and record key contracts", () => {
  void test("accepts the empty string as an object property name", () => {
    assert.equal(
      parseZodEmissionModule(rootModule(zodPlan.object({ "": zodPlan.string() }))).ok,
      true,
    );
  });

  void test("rejects record keys outside property-key output types", () => {
    for (const key of [
      zodPlan.boolean(),
      zodPlan.null(),
      zodPlan.unknown(),
      zodPlan.optional(zodPlan.string()),
      zodPlan.object({}),
      zodPlan.array(zodPlan.string()),
    ])
      expectInvalidRoot(zodPlan.record(key, zodPlan.string()));
    expectInvalidModule(
      {
        root: "root",
        declarations: [
          {
            symbol: "root",
            expression: zodPlan.record(zodPlan.reference(zodSymbol("key")), zodPlan.string()),
          },
          { symbol: "key", expression: zodPlan.boolean() },
        ],
      },
      "invalid_zod_emission_module",
    );
  });

  void test("accepts string, number, literal, composed and referenced record keys", () => {
    for (const key of [
      zodPlan.string(),
      zodPlan.number(),
      zodPlan.literal(1),
      zodPlan.enum(["a", "b"]),
      zodPlan.never(),
      zodPlan.union([zodPlan.string(), zodPlan.number()]),
      zodPlan.intersection(zodPlan.unknown(), zodPlan.string()),
    ])
      assert.equal(
        parseZodEmissionModule(rootModule(zodPlan.record(key, zodPlan.string()))).ok,
        true,
      );
    assert.equal(
      parseZodEmissionModule({
        root: "root",
        declarations: [
          {
            symbol: "root",
            expression: zodPlan.record(zodPlan.reference(zodSymbol("key")), zodPlan.string()),
          },
          { symbol: "key", expression: zodPlan.string() },
        ],
      }).ok,
      true,
    );
  });
});
