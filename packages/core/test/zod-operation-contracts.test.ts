import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  parseZodEmissionModule,
  zodArrayArgument,
  zodCall,
  zodExpressionArgument,
  zodFactory,
  zodFactoryMetadata,
  zodFactoryNames,
  zodHelper,
  zodHelperArgument,
  zodLiteralArgument,
  zodMethodNames,
  zodMethodSpecs,
  zodNoArgumentFactoryNames,
  zodNoArgumentMethodNames,
  zodObjectShapeArgument,
  zodPlan,
} from "../src/index";
import type { ZodExpression } from "../src/index";

const valid = (expression: ZodExpression): boolean =>
  parseZodEmissionModule({ declarations: [{ expression, symbol: "root" }], root: "root" }).ok;

const stringArgument = zodExpressionArgument(zodPlan.string());
const numberArgument = zodExpressionArgument(zodPlan.number());

void describe("Zod operation argument contracts", () => {
  void test("accepts typed arguments for every argument descriptor", () => {
    const expressions = [
      zodFactory("string"),
      zodFactory("array", [stringArgument]),
      zodFactory("object", [zodObjectShapeArgument({ key: zodPlan.string() })]),
      zodFactory("literal", [zodLiteralArgument(true)]),
      zodFactory("record", [stringArgument, numberArgument]),
      zodFactory("enum", [zodArrayArgument([zodLiteralArgument("one")])]),
      zodFactory("tuple", [zodArrayArgument([stringArgument, numberArgument])]),
      zodCall(zodPlan.number(), "gte", [zodLiteralArgument(1)]),
      zodCall(zodPlan.string(), "describe", [zodLiteralArgument("description")]),
      zodCall(zodPlan.number(), "refine", [zodHelperArgument(zodHelper.exactMultipleOf(2))]),
      zodCall(zodPlan.string(), "regex", [zodLiteralArgument("a")]),
      zodCall(zodPlan.string(), "regex", [zodLiteralArgument("a"), zodLiteralArgument("i")]),
    ];
    for (const expression of expressions) assert.equal(valid(expression), true);
  });

  void test("keeps builder signatures restrictive", () => {
    type Accepts<TCandidate, TAllowed> = TCandidate extends TAllowed ? true : false;
    interface Literal<TValue> {
      readonly kind: "literal";
      readonly value: TValue;
    }
    const accepted = [
      false satisfies Accepts<["array"], Parameters<typeof zodFactory<"array">>>,
      false satisfies Accepts<
        ["string", [typeof stringArgument]],
        Parameters<typeof zodFactory<"string">>
      >,
      false satisfies Accepts<
        ["object", [typeof stringArgument]],
        Parameters<typeof zodFactory<"object">>
      >,
      false satisfies Accepts<
        ["record", [typeof stringArgument]],
        Parameters<typeof zodFactory<"record">>
      >,
      false satisfies Accepts<
        ["enum", [{ kind: "array"; elements: [Literal<1>] }]],
        Parameters<typeof zodFactory<"enum">>
      >,
      false satisfies Accepts<
        ["tuple", [{ kind: "array"; elements: [Literal<"one">] }]],
        Parameters<typeof zodFactory<"tuple">>
      >,
      false satisfies Accepts<
        [ZodExpression, "gte", [Literal<"1">]],
        Parameters<typeof zodCall<"gte">>
      >,
      false satisfies Accepts<
        [ZodExpression, "describe", [Literal<1>]],
        Parameters<typeof zodCall<"describe">>
      >,
      false satisfies Accepts<
        [ZodExpression, "refine", [typeof numberArgument]],
        Parameters<typeof zodCall<"refine">>
      >,
      false satisfies Accepts<
        [ZodExpression, "regex", [Literal<"a">, Literal<"i">, Literal<"extra">]],
        Parameters<typeof zodCall<"regex">>
      >,
      false satisfies Accepts<
        [ZodExpression, "optional", [typeof stringArgument]],
        Parameters<typeof zodCall<"optional">>
      >,
    ];
    assert.equal(
      accepted.every((value) => !value),
      true,
    );
  });

  void test("preserves exported no-argument name tuples and usable builders", () => {
    const factories: readonly ["boolean", "never", "null", "number", "string", "unknown"] =
      zodNoArgumentFactoryNames;
    const methods: readonly ["int", "nullable", "optional", "passthrough", "strict"] =
      zodNoArgumentMethodNames;
    assert.deepEqual(factories, ["boolean", "never", "null", "number", "string", "unknown"]);
    assert.deepEqual(methods, ["int", "nullable", "optional", "passthrough", "strict"]);
    for (const factory of factories) assert.equal(valid(zodFactory(factory)), true);
    for (const method of methods) {
      const receiver = method === "int" ? zodPlan.number() : zodPlan.object({});
      assert.equal(valid(zodCall(receiver, method)), true);
    }
  });

  void test("keeps ordered public name lists complete and consistent with their specifications", () => {
    assert.deepEqual(zodFactoryNames, Object.keys(zodFactoryMetadata));
    assert.deepEqual(zodMethodNames, Object.keys(zodMethodSpecs));
    assert.deepEqual(
      zodNoArgumentFactoryNames,
      zodFactoryNames.filter((name) => zodFactoryMetadata[name].args.kind === "none"),
    );
    assert.deepEqual(
      zodNoArgumentMethodNames,
      zodMethodNames.filter((name) => zodMethodSpecs[name].args.kind === "none"),
    );
  });
});
