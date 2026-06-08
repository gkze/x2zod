import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildZodSourceFile,
  parseZodEmissionModule,
  ts,
  zodCall,
  zodDeclaration,
  zodDeclarationNameHint,
  zodModule,
  zodPlan,
  zodSymbol,
} from "../src/index";
import type { DiagnosticCode, ZodEmissionModule, ZodEmissionModuleInput } from "../src/index";

const rootSymbol = zodSymbol("root");
const generatedFileName = "/__x2zod__/x2zod.generated.ts";
const coreEntrypoint = "src/index.ts";
const coreTestTempDirectory = join(process.cwd(), "node_modules/.cache");
const coreTestTempPrefix = "x2zod-test-";
const bundledCoreFileName = "index.mjs";
const textDecoder = new TextDecoder();
const nativePreviewExternals = [
  "@typescript/native-preview/ast",
  "@typescript/native-preview/ast/factory",
  "@typescript/native-preview/sync",
  "zod/v4",
] as const;
const defaultOutputOptions = { typeName: "User" } satisfies Parameters<
  typeof buildZodSourceFile
>[1];

type IdentifierLike = Readonly<{ text: string }>;
type ExpressionLike = ts.Expression & Partial<IdentifierLike>;
type PropertyAccessLike = ExpressionLike &
  Readonly<{ expression: ExpressionLike; name: IdentifierLike }>;
type CallExpressionLike = ExpressionLike &
  Readonly<{ arguments: readonly ExpressionLike[]; expression: PropertyAccessLike }>;
type PropertyAssignmentLike = Readonly<{ initializer: ExpressionLike; name: IdentifierLike }>;
type ObjectLiteralLike = ExpressionLike &
  Readonly<{ properties: readonly PropertyAssignmentLike[] }>;
type VariableDeclarationLike = Readonly<{ initializer: ExpressionLike; name: IdentifierLike }>;
type VariableStatementLike = ts.VariableStatement &
  Readonly<{
    declarationList: Readonly<{ declarations: readonly [VariableDeclarationLike] }>;
    modifiers?: readonly Readonly<{ kind: ts.SyntaxKind }>[] | undefined;
  }>;
type ImportDeclarationLike = Readonly<{ moduleSpecifier: IdentifierLike }>;

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

const expectInvalidModule = (module: ZodEmissionModuleInput, code: DiagnosticCode): void => {
  const result = parseZodEmissionModule(module);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected module parsing to fail.");
  expect(result.diagnostics[0].code).toBe(code);
};

const variableStatements = (sourceFile: ts.SourceFile): readonly VariableStatementLike[] =>
  sourceFile.statements
    .filter((statement) => statement.kind === ts.SyntaxKind.VariableStatement)
    .map((statement) => statement as unknown as VariableStatementLike);

const variableDeclaration = (statement: VariableStatementLike): VariableDeclarationLike =>
  statement.declarationList.declarations[0];

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

const zodCallName = (expression: ts.Expression): string =>
  (expression as unknown as CallExpressionLike).expression.name.text;

const firstCallArgument = (expression: ExpressionLike): ExpressionLike => {
  const [argument] = (expression as unknown as CallExpressionLike).arguments;
  if (argument === undefined) throw new Error("Missing call argument.");

  return argument;
};

const objectProperties = (
  declaration: VariableDeclarationLike,
): readonly PropertyAssignmentLike[] =>
  (firstCallArgument(declaration.initializer) as unknown as ObjectLiteralLike).properties;

const propertyInitializer = (declaration: VariableDeclarationLike, key: string): ExpressionLike => {
  const property = objectProperties(declaration).find((item) => item.name.text === key);
  if (property === undefined) throw new Error(`Missing property: ${key}`);
  return property.initializer;
};

const importPath = (sourceFile: ts.SourceFile): string =>
  (sourceFile.statements[0] as unknown as ImportDeclarationLike).moduleSpecifier.text;

const outputText = (output: Uint8Array): string => textDecoder.decode(output);

const buildCoreBundle = (bundleFile: string): void => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      coreEntrypoint,
      "--outfile",
      bundleFile,
      "--target",
      "node",
      "--format",
      "esm",
      ...nativePreviewExternals.flatMap((external) => ["--external", external]),
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(outputText(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
};

const nativePrinterScript = (bundleFile: string): string =>
  [
    'import { API, Emitter } from "@typescript/native-preview/sync";',
    `const core = await import(${JSON.stringify(pathToFileURL(bundleFile).href)});`,
    'const root = core.zodSymbol("root");',
    "const module = core.zodModule(root, [",
    "  core.zodDeclaration(root, core.zodPlan.object({ name: core.zodPlan.string() })),",
    "]);",
    'const result = core.buildZodSourceFile(module, { typeName: "User" });',
    "if (!result.ok)",
    "  throw new Error(",
    String.raw`    result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),`,
    "  );",
    "const api = new API({ cwd: process.cwd() });",
    "const emitter = new Emitter(api.client);",
    "try {",
    "  console.log(emitter.printNode(result.value.sourceFile));",
    "} finally {",
    "  api.close();",
    "}",
  ].join("\n");

const printWithNativeEmitter = (bundleFile: string): string => {
  const result = Bun.spawnSync({
    cmd: ["node", "--no-warnings", "--eval", nativePrinterScript(bundleFile)],
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(outputText(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
  return outputText(result.stdout);
};

describe("buildZodSourceFile", () => {
  test("emits primitive root declarations", () => {
    const sourceFile = sourceFileFor(rootOnlyModule(zodPlan.string()));
    const [schemaStatement] = variableStatements(sourceFile);
    if (schemaStatement === undefined) throw new Error("Missing schema statement.");

    const schemaDeclaration = variableDeclaration(schemaStatement);

    expect(sourceFile.fileName).toBe(generatedFileName);
    expect(sourceFile.text).toBe("");
    expect(sourceFile.statements.map((statement) => statement.kind)).toEqual([
      ts.SyntaxKind.ImportDeclaration,
      ts.SyntaxKind.VariableStatement,
      ts.SyntaxKind.TypeAliasDeclaration,
    ]);
    expect(importPath(sourceFile)).toBe("zod/v4");
    expect(variableNames(sourceFile)).toEqual(["userSchema"]);
    expect(exportedVariableNames(sourceFile)).toEqual(["userSchema"]);
    expect(zodCallName(schemaDeclaration.initializer as ts.Expression)).toBe("string");
  });

  test("emits objects, arrays, literals, unions, chained calls, and references", () => {
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
          active: zodPlan.nullable(zodPlan.boolean()),
          "dash-key": zodPlan.literal(null),
          nested: zodPlan.reference(addressSymbol),
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

    expect(declarations.map((declaration) => declaration.name.text)).toEqual([
      "addressSchema",
      "userSchema",
    ]);
    expect(zodCallName(rootDeclaration.initializer as ts.Expression)).toBe("object");
    expect(zodCallName(propertyInitializer(rootDeclaration, "name"))).toBe("string");
    expect(zodCallName(propertyInitializer(rootDeclaration, "tags"))).toBe("array");
    expect(zodCallName(propertyInitializer(rootDeclaration, "mode"))).toBe("union");
    expect(zodCallName(propertyInitializer(rootDeclaration, "dash-key"))).toBe("literal");
    expect(propertyInitializer(rootDeclaration, "nested").text).toBe("addressSchema");
    expect(zodCallName(propertyInitializer(rootDeclaration, "age"))).toBe("optional");
    expect(
      zodCallName(
        (propertyInitializer(rootDeclaration, "age") as unknown as CallExpressionLike).expression
          .expression,
      ),
    ).toBe("number");
  });

  test("orders declarations before their reference sites", () => {
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

    expect(variableNames(sourceFile)).toEqual(["leafSchema", "middleSchema", "userSchema"]);
  });

  test("exports named declarations only when requested", () => {
    const addressSymbol = zodSymbol("address");
    const module = zodModule(rootSymbol, [
      zodDeclaration(addressSymbol, zodPlan.string(), [zodDeclarationNameHint("Address")]),
      zodDeclaration(rootSymbol, zodPlan.reference(addressSymbol)),
    ]);

    expect(exportedVariableNames(sourceFileFor(module))).toEqual(["userSchema"]);
    expect(
      exportedVariableNames(
        sourceFileFor(module, { declarationExportMode: "all", typeName: "User" }),
      ),
    ).toEqual(["addressSchema", "userSchema"]);
  });

  test("returns diagnostics for invalid modules before emitting source", () => {
    const result = buildZodSourceFile(zodModule(zodSymbol("missing"), []), { typeName: "User" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected source emission to fail.");
    expect(result.diagnostics[0].code).toBe("invalid_zod_emission_module");
  });
});

describe("buildZodSourceFile native printing", () => {
  test("returns source files printable by the aligned native TypeScript emitter", () => {
    mkdirSync(coreTestTempDirectory, { recursive: true });
    const directory = mkdtempSync(join(coreTestTempDirectory, coreTestTempPrefix));
    const bundleFile = join(directory, bundledCoreFileName);

    try {
      buildCoreBundle(bundleFile);
      const printedSource = printWithNativeEmitter(bundleFile);

      expect(printedSource).toContain("export const userSchema");
      expect(printedSource).toContain("export type User");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("buildZodSourceFile declaration naming", () => {
  test("preserves readable camel casing from declaration hints", () => {
    const configSymbol = zodSymbol("config");
    const module = zodModule(rootSymbol, [
      zodDeclaration(configSymbol, zodPlan.string(), [zodDeclarationNameHint("UserConfig")]),
      zodDeclaration(rootSymbol, zodPlan.reference(configSymbol)),
    ]);

    expect(variableNames(sourceFileFor(module))).toEqual(["userConfigSchema", "userSchema"]);
  });

  test("deduplicates declaration names from stable symbol identity", () => {
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

    expect(variableNames(sourceFileFor(module))).toEqual([
      "userSchemaForFirst",
      "userSchemaForSecond",
      "userSchema",
    ]);
    expect(variableNames(sourceFileFor(module))).toEqual(
      variableNames(sourceFileFor(reorderedModule)),
    );
  });

  test("keeps encoded fallback declaration names unique", () => {
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

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(fallbackName);
    expect(names).toContain([fallbackName, betaSchemaEncodedSuffix].join("X"));
  });
});

describe("parseZodEmissionModule", () => {
  test(
    "rejects missing roots, duplicate symbols, unresolved refs, invalid factory args, and " +
      "cycles",
    () => {
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
      expectInvalidModule(
        {
          declarations: [{ expression: zodPlan.reference(zodSymbol("missing")), symbol: "root" }],
          root: "root",
        },
        "unresolved_reference",
      );
      expectInvalidModule(
        {
          declarations: [{ expression: { factory: "array", kind: "factory" }, symbol: "root" }],
          root: "root",
        },
        "invalid_zod_emission_module",
      );
      expectInvalidModule(
        {
          declarations: [{ expression: zodPlan.reference(zodSymbol("root")), symbol: "root" }],
          root: "root",
        },
        "cyclic_reference",
      );
    },
  );

  test("rejects unsupported method calls, invalid method args, and duplicate object keys", () => {
    expectInvalidModule(
      {
        declarations: [{ expression: zodCall(zodPlan.string(), "min"), symbol: "root" }],
        root: "root",
      },
      "invalid_zod_emission_module",
    );
    expectInvalidModule(
      {
        declarations: [
          {
            expression: zodCall(zodPlan.string(), "optional", [{ kind: "literal", value: true }]),
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
