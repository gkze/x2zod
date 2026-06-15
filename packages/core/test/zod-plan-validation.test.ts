import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseZodEmissionModule, zodPlan, zodSymbol } from "../src/index";
import type { DiagnosticCode, ZodEmissionModuleInput, ZodExpressionInput } from "../src/index";

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
  void test("rejects missing roots, duplicate symbols, unresolved refs, invalid factory args, and cycles", () => {
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
    expectInvalidRoot(zodPlan.reference(zodSymbol("root")), "cyclic_reference");
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
  void test("rejects invalid enum and tuple factory arguments", () => {
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
    expectInvalidModule(
      {
        declarations: [
          {
            expression: {
              args: [{ elements: [], kind: "array" }],
              factory: "tuple",
              kind: "factory",
            },
            symbol: "root",
          },
        ],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
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
