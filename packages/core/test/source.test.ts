import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, test } from "node:test";

import { importGeneratedExport, isRecord } from "../../../test/native-source-harness";
import {
  buildZodSourceFile,
  ts,
  zodDeclaration,
  zodDeclarationNameHint,
  zodHelper,
  zodModule,
  zodPlan,
  zodSymbol,
} from "../src/index";
import type { ZodEmissionModule } from "../src/index";
import {
  importPath,
  propertyInitializer,
  variableDeclaration,
  variableStatements,
  zodCallName,
  zodCallReceiverExpression,
} from "./ast-helpers";
import {
  createGeneratedSourceHarness,
  emitGeneratedDeclarations,
} from "./generated-source-harness";

const rootSymbol = zodSymbol("root");
const generatedFileName = "/__x2zod__/x2zod.generated.ts";
const sourcePrinterEntryPoint = nodePath.join(import.meta.dirname, "source-print-helper.ts");
const maximumCount = 10;
const firstDivisor = 0.1;
const secondDivisor = 0.2;
const defaultOutputOptions = { typeName: "User" } satisfies Parameters<
  typeof buildZodSourceFile
>[1];

type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;
type RuntimeUser = Readonly<{
  __proto__: string;
  count: number;
  insensitive: string;
  maybe?: string | undefined;
  pair: readonly [string, number];
  payload: Readonly<{ value: string }>;
  slug: string;
  status: "open";
  tags: readonly [string];
}>;

const sourceFileFor = (
  module: ZodEmissionModule,
  output: Parameters<typeof buildZodSourceFile>[1] = defaultOutputOptions,
): ts.SourceFile => {
  const result = buildZodSourceFile(module, output);
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.value.sourceFile;
};

const rootOnlyModule = (expression: Parameters<typeof zodDeclaration>[1]): ZodEmissionModule =>
  zodModule(rootSymbol, [zodDeclaration(rootSymbol, expression)]);

const variableNames = (sourceFile: ts.SourceFile): readonly string[] =>
  variableStatements(sourceFile).map((statement) => variableDeclaration(statement).name.text);

const exportedVariableNames = (sourceFile: ts.SourceFile): readonly string[] =>
  variableStatements(sourceFile)
    .filter(
      (statement) =>
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false,
    )
    .map((statement) => variableDeclaration(statement).name.text);

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const importGeneratedUserSchema = async (generatedFile: string): Promise<RuntimeZodSchema> => {
  const schema = await importGeneratedExport(generatedFile, "userSchema", isRuntimeZodSchema);
  return schema;
};

const validRuntimeUser = (): RuntimeUser => {
  const value = {
    count: 1,
    insensitive: "ABC",
    pair: ["left", 2],
    payload: { value: "present" },
    slug: "abc",
    status: "open",
    tags: ["tag"],
  } as Record<string, unknown>;
  Object.defineProperty(value, "__proto__", {
    configurable: true,
    enumerable: true,
    value: "own-proto-key",
  });
  return value as RuntimeUser;
};

void describe("buildZodSourceFile", () => {
  void test("emits primitive root declarations", () => {
    const sourceFile = sourceFileFor(rootOnlyModule(zodPlan.string()));
    const [schemaStatement] = variableStatements(sourceFile);
    if (schemaStatement === undefined) throw new Error("Missing schema statement.");

    const schemaDeclaration = variableDeclaration(schemaStatement);

    assert.equal(sourceFile.fileName, generatedFileName);
    assert.equal(sourceFile.text, "");
    assert.deepEqual(
      sourceFile.statements.map((statement) => statement.kind),
      [
        ts.SyntaxKind.ImportDeclaration,
        ts.SyntaxKind.VariableStatement,
        ts.SyntaxKind.TypeAliasDeclaration,
      ],
    );
    assert.equal(importPath(sourceFile), "zod/v4");
    assert.deepEqual(variableNames(sourceFile), ["userSchema"]);
    assert.deepEqual(exportedVariableNames(sourceFile), ["userSchema"]);
    assert.equal(zodCallName(schemaDeclaration.initializer), "string");
  });

  void test("emits objects, arrays, literals, unions, chained calls, and references", () => {
    const addressSymbol = zodSymbol("address");
    const module = zodModule(rootSymbol, [
      zodDeclaration(addressSymbol, zodPlan.object({ street: zodPlan.string() }), [
        zodDeclarationNameHint("Address"),
      ]),
      zodDeclaration(
        rootSymbol,
        zodPlan.object({
          name: zodPlan.string(),
          age: zodPlan.optional(zodPlan.number()),
          tags: zodPlan.array(zodPlan.string()),
          mode: zodPlan.union([zodPlan.literal("build"), zodPlan.literal("watch")]),
          exclusiveMode: zodPlan.optional(
            zodPlan.xor([zodPlan.literal("build"), zodPlan.literal("watch")]),
          ),
          status: zodPlan.enum(["open", "closed"]),
          boundedTags: zodPlan.max(zodPlan.min(zodPlan.array(zodPlan.string()), 1), maximumCount),
          slug: zodPlan.regex(zodPlan.string(), "^[a-z]+$"),
          pair: zodPlan.tuple([zodPlan.string(), zodPlan.number()]),
          payload: zodPlan.required(
            zodPlan.object({ maybe: zodPlan.optional(zodPlan.string()), value: zodPlan.unknown() }),
            ["value"],
          ),
          active: zodPlan.nullable(zodPlan.boolean()),
          count: zodPlan.lte(zodPlan.gt(zodPlan.integer(), 0), maximumCount),
          extra: zodPlan.catchall(zodPlan.passthrough(zodPlan.object({})), zodPlan.unknown()),
          "dash-key": zodPlan.literal(null),
          nested: zodPlan.strict(zodPlan.reference(addressSymbol)),
        }),
      ),
    ]);
    const declarations = variableStatements(sourceFileFor(module)).map((statement) =>
      variableDeclaration(statement),
    );
    const rootDeclaration = declarations.find(
      (declaration) => declaration.name.text === "userSchema",
    );
    if (rootDeclaration === undefined) throw new Error("Missing root declaration.");

    assert.deepEqual(
      declarations.map((declaration) => declaration.name.text),
      ["addressSchema", "userSchema"],
    );
    assert.equal(zodCallName(rootDeclaration.initializer), "object");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "name")), "string");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "tags")), "array");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "mode")), "union");
    assert.equal(
      zodCallName(zodCallReceiverExpression(propertyInitializer(rootDeclaration, "exclusiveMode"))),
      "xor",
    );
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "status")), "enum");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "boundedTags")), "max");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "slug")), "regex");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "pair")), "tuple");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "payload")), "required");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "dash-key")), "literal");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "count")), "lte");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "extra")), "catchall");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "nested")), "strict");
    assert.equal(zodCallName(propertyInitializer(rootDeclaration, "age")), "optional");
    assert.equal(
      zodCallName(zodCallReceiverExpression(propertyInitializer(rootDeclaration, "age"))),
      "number",
    );
  });
});

void describe("buildZodSourceFile built-in helpers", () => {
  void test("emits each requested helper once in catalog order", () => {
    const sourceFile = sourceFileFor(
      rootOnlyModule(
        zodPlan.object({
          first: zodPlan.refine(zodPlan.number(), zodHelper.exactMultipleOf(firstDivisor)),
          firstPreserved: zodPlan.preserveObjectInput(
            zodPlan.strict(zodPlan.object({ ["__proto__"]: zodPlan.string() })),
            ["__proto__"],
          ),
          second: zodPlan.refine(zodPlan.number(), zodHelper.exactMultipleOf(secondDivisor)),
          firstUnique: zodPlan.refine(zodPlan.array(zodPlan.unknown()), zodHelper.uniqueItems()),
          secondUnique: zodPlan.refine(zodPlan.array(zodPlan.string()), zodHelper.uniqueItems()),
          secondPreserved: zodPlan.preserveObjectInput(
            zodPlan.strict(zodPlan.object({ ["__proto__"]: zodPlan.string() })),
            ["__proto__"],
          ),
          text: zodPlan.refine(zodPlan.string(), zodHelper.codePointLength(1, 2)),
        }),
      ),
    );

    assert.deepEqual(variableNames(sourceFile), [
      "x2zodCodePointLength",
      "x2zodDecimalParts",
      "x2zodExactMultipleOf",
      "x2zodJsonEqual",
      "x2zodUniqueItems",
      "x2zodPreserveObjectInput",
      "userSchema",
    ]);
  });

  void test("rejects invalid helper requests built through the typed API", () => {
    const invalidExpressions = [
      zodPlan.refine(zodPlan.number(), zodHelper.exactMultipleOf(0)),
      zodPlan.refine(zodPlan.string(), zodHelper.codePointLength(null, null)),
      zodPlan.refine(zodPlan.string(), zodHelper.codePointLength(2, 1)),
    ];

    for (const expression of invalidExpressions) {
      const result = buildZodSourceFile(rootOnlyModule(expression), defaultOutputOptions);
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
    }
  });
});

void describe("buildZodSourceFile declaration ordering and exports", () => {
  void test("keeps internal references separate from independently exported expressions", () => {
    const child = zodSymbol("child");
    const module = zodModule(rootSymbol, [
      { ...zodDeclaration(child, zodPlan.string()), exportExpression: zodPlan.literal("public") },
      zodDeclaration(rootSymbol, zodPlan.object({ child: zodPlan.reference(child) })),
    ]);
    const rootOnly = sourceFileFor(module);
    assert.deepEqual(variableNames(rootOnly), ["childSchema", "userSchema"]);
    const all = sourceFileFor(module, {
      declarationExportMode: "all",
      declarationNameOverrides: { child: "Configured" },
      typeName: "User",
    });
    assert.deepEqual(exportedVariableNames(all), ["configuredSchema", "userSchema"]);
    const declarations = new Map(
      variableStatements(all).map((statement) => {
        const declaration = variableDeclaration(statement);
        return [declaration.name.text, declaration] as const;
      }),
    );
    const root = declarations.get("userSchema");
    const internal = declarations.get("configuredSchemaInternal");
    const exported = declarations.get("configuredSchema");
    assert.ok(root);
    assert.ok(internal);
    assert.ok(exported);
    assert.equal(propertyInitializer(root, "child")["text"], "configuredSchemaInternal");
    assert.equal(zodCallName(internal.initializer), "string");
    assert.equal(zodCallName(exported.initializer), "literal");
  });

  void test("orders declarations before their reference sites", () => {
    const middleSymbol = zodSymbol("middle");
    const leafSymbol = zodSymbol("leaf");
    const sourceFile = sourceFileFor(
      zodModule(rootSymbol, [
        zodDeclaration(rootSymbol, zodPlan.object({ middle: zodPlan.reference(middleSymbol) })),
        zodDeclaration(middleSymbol, zodPlan.object({ leaf: zodPlan.reference(leafSymbol) }), [
          zodDeclarationNameHint("Middle"),
        ]),
        zodDeclaration(leafSymbol, zodPlan.string(), [zodDeclarationNameHint("Leaf")]),
      ]),
    );

    assert.deepEqual(variableNames(sourceFile), ["leafSchema", "middleSchema", "userSchema"]);
  });

  void test("emits lazy references only within cyclic declaration components", () => {
    const nodeSymbol = zodSymbol("node");
    const sourceFile = sourceFileFor(
      zodModule(rootSymbol, [
        zodDeclaration(
          nodeSymbol,
          zodPlan.object({ next: zodPlan.optional(zodPlan.reference(nodeSymbol)) }),
        ),
        zodDeclaration(rootSymbol, zodPlan.reference(nodeSymbol)),
      ]),
    );
    const declarations = variableStatements(sourceFile).map((statement) =>
      variableDeclaration(statement),
    );
    const nodeDeclaration = declarations.find(
      (declaration) => declaration.name.text === "nodeSchema",
    );
    const rootDeclaration = declarations.find(
      (declaration) => declaration.name.text === "userSchema",
    );
    if (nodeDeclaration === undefined || rootDeclaration === undefined)
      throw new Error("Missing cyclic source declarations.");

    const next = propertyInitializer(nodeDeclaration, "next");
    assert.equal(zodCallName(next), "optional");
    assert.equal(zodCallName(zodCallReceiverExpression(next)), "lazy");
    assert.notEqual(rootDeclaration.initializer["kind"], ts.SyntaxKind.CallExpression);
  });

  void test("exports named declarations only when requested", () => {
    const addressSymbol = zodSymbol("address");
    const module = zodModule(rootSymbol, [
      zodDeclaration(addressSymbol, zodPlan.string(), [zodDeclarationNameHint("Address")]),
      zodDeclaration(rootSymbol, zodPlan.reference(addressSymbol)),
    ]);

    assert.deepEqual(exportedVariableNames(sourceFileFor(module)), ["userSchema"]);
    assert.deepEqual(
      exportedVariableNames(
        sourceFileFor(module, { declarationExportMode: "all", typeName: "User" }),
      ),
      ["addressSchema", "userSchema"],
    );
  });

  void test("returns diagnostics for invalid modules before emitting source", () => {
    const result = buildZodSourceFile(zodModule(zodSymbol("missing"), []), { typeName: "User" });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
  });
});

void describe("buildZodSourceFile native printing", () => {
  void test("returns source files printable by the aligned native TypeScript emitter", async () => {
    const harness = createGeneratedSourceHarness({
      prefix: "x2zod-test-",
      printerEntryPoint: sourcePrinterEntryPoint,
    });

    try {
      const printedSource = harness.print();

      assert.ok(printedSource.includes("export const userSchema"));
      assert.ok(printedSource.includes("export type User"));
      assert.ok(printedSource.includes("z.enum"));
      assert.ok(printedSource.includes("new RegExp"));
      assert.ok(printedSource.includes('new RegExp("^[a-z]+$")'));
      assert.ok(printedSource.includes('new RegExp("^abc$", "i")'));
      assert.ok(printedSource.includes("z.tuple"));
      assert.ok(printedSource.includes(".int().gt(0).lte(10)"));
      assert.ok(printedSource.includes('["__proto__"]: z.string()'));
      assert.ok(printedSource.includes("x2zodPreserveObjectInput"));
      assert.ok(printedSource.includes(".required({ value: true })"));
      assert.ok(printedSource.includes(".min(1).max(2)"));

      writeFileSync(harness.generatedFile, printedSource);
      const userSchema = await importGeneratedUserSchema(harness.generatedFile);

      assert.equal(userSchema.safeParse(validRuntimeUser()).success, true);
      assert.equal(userSchema.safeParse({ ...validRuntimeUser(), maybe: "present" }).success, true);
      assert.equal(
        userSchema.safeParse({
          count: 1,
          pair: ["left", 2],
          payload: { value: "present" },
          slug: "abc",
          status: "open",
          tags: ["tag"],
        }).success,
        false,
      );
      assert.equal(userSchema.safeParse({ ...validRuntimeUser(), count: 0 }).success, false);
      assert.equal(userSchema.safeParse({ ...validRuntimeUser(), payload: {} }).success, false);
      assert.equal(userSchema.safeParse({ ...validRuntimeUser(), slug: "ABC" }).success, false);
      assert.equal(userSchema.safeParse({ ...validRuntimeUser(), tags: [] }).success, false);
      assert.equal(
        userSchema.safeParse({ ...validRuntimeUser(), tags: ["a", "b", "c"] }).success,
        false,
      );

      for (const typeName of ["z", "x2zodPreserveObjectInput"]) {
        const sourceFile = nodePath.join(harness.directory, `generated-${typeName}.ts`);
        writeFileSync(sourceFile, harness.print(["default", typeName]));
        emitGeneratedDeclarations(
          sourceFile,
          nodePath.join(harness.directory, `declarations-${typeName}`),
        );
      }
    } finally {
      harness.dispose();
    }
  });
});

void describe("buildZodSourceFile declaration naming", () => {
  void test("preserves readable camel casing from declaration hints", () => {
    const configSymbol = zodSymbol("config");
    const module = zodModule(rootSymbol, [
      zodDeclaration(configSymbol, zodPlan.string(), [zodDeclarationNameHint("UserConfig")]),
      zodDeclaration(rootSymbol, zodPlan.reference(configSymbol)),
    ]);

    assert.deepEqual(variableNames(sourceFileFor(module)), ["userConfigSchema", "userSchema"]);
  });

  void test("uses TypeScript identifier rules for declaration names", () => {
    const configSymbol = zodSymbol("config");
    const module = zodModule(rootSymbol, [
      zodDeclaration(configSymbol, zodPlan.string(), [zodDeclarationNameHint("CaféConfig")]),
      zodDeclaration(rootSymbol, zodPlan.reference(configSymbol)),
    ]);

    assert.deepEqual(variableNames(sourceFileFor(module)), ["caféConfigSchema", "userSchema"]);
  });

  void test("uses declaration hint values and order independently of adapter provenance", () => {
    const configSymbol = zodSymbol("config");
    const moduleFor = (provenance: readonly [string, string]): ZodEmissionModule =>
      zodModule(rootSymbol, [
        zodDeclaration(configSymbol, zodPlan.string(), [
          zodDeclarationNameHint("Protocol Message", provenance[0]),
          zodDeclarationNameHint("Graph Type", provenance[1]),
        ]),
        zodDeclaration(rootSymbol, zodPlan.reference(configSymbol)),
      ]);

    const protobufFirst = variableNames(
      sourceFileFor(moduleFor(["protobuf/message", "graphql/type"])),
    );
    const graphqlFirst = variableNames(
      sourceFileFor(moduleFor(["graphql/type", "protobuf/message"])),
    );

    assert.deepEqual(protobufFirst, ["protocolMessageSchema", "userSchema"]);
    assert.deepEqual(graphqlFirst, protobufFirst);
  });

  void test("deduplicates declaration names from stable symbol identity", () => {
    const firstSymbol = zodSymbol("first");
    const secondSymbol = zodSymbol("second");
    const module = zodModule(rootSymbol, [
      zodDeclaration(firstSymbol, zodPlan.string(), [zodDeclarationNameHint("User")]),
      zodDeclaration(secondSymbol, zodPlan.number(), [zodDeclarationNameHint("User")]),
      zodDeclaration(rootSymbol, zodPlan.object({ first: zodPlan.reference(firstSymbol) })),
    ]);
    const reorderedModule = zodModule(rootSymbol, [
      zodDeclaration(secondSymbol, zodPlan.number(), [zodDeclarationNameHint("User")]),
      zodDeclaration(rootSymbol, zodPlan.object({ first: zodPlan.reference(firstSymbol) })),
      zodDeclaration(firstSymbol, zodPlan.string(), [zodDeclarationNameHint("User")]),
    ]);

    assert.deepEqual(variableNames(sourceFileFor(module)), [
      "userSchemaForFirst",
      "userSchemaForSecond",
      "userSchema",
    ]);
    assert.deepEqual(
      variableNames(sourceFileFor(module)),
      variableNames(sourceFileFor(reorderedModule)),
    );
  });

  void test("keeps encoded fallback declaration names unique", () => {
    const betaSchemaEncodedSuffix = ["2q2t382p", "2b2r2w2t312p"].join("");
    const fallbackName = ["alphaSchemaForBetaSchemaX", betaSchemaEncodedSuffix].join("");
    const forcedFallbackSymbol = zodSymbol(["-betaSchemaX", betaSchemaEncodedSuffix].join(""));
    const preferredCollisionSymbol = zodSymbol("alpha");
    const fallbackSymbol = zodSymbol("betaSchema");
    const module = zodModule(rootSymbol, [
      zodDeclaration(forcedFallbackSymbol, zodPlan.string(), [zodDeclarationNameHint("Alpha")]),
      zodDeclaration(preferredCollisionSymbol, zodPlan.number(), [
        zodDeclarationNameHint("AlphaSchemaForBeta"),
      ]),
      zodDeclaration(fallbackSymbol, zodPlan.boolean(), [zodDeclarationNameHint("Alpha")]),
      zodDeclaration(rootSymbol, zodPlan.reference(fallbackSymbol)),
    ]);
    const names = variableNames(sourceFileFor(module));

    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes(fallbackName));
    assert.ok(names.includes([fallbackName, betaSchemaEncodedSuffix].join("X")));
  });
});
