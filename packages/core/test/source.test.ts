import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import {
  buildZodSourceFile,
  ts,
  zodDeclaration,
  zodDeclarationNameHint,
  zodModule,
  zodPlan,
  zodSymbol,
} from "../src/index";
import type { ZodEmissionModule } from "../src/index";

const rootSymbol = zodSymbol("root");
const generatedFileName = "/__x2zod__/x2zod.generated.ts";
const corePackageRootDirectory = resolve(import.meta.dirname, "..");
const coreEntrypoint = "src/index.ts";
const sourcePrinterEntryPoint = join(import.meta.dirname, "source-print-helper.ts");
const coreTestTempDirectory = join(corePackageRootDirectory, "node_modules/.cache");
const coreTestTempPrefix = "x2zod-test-";
const bundledCoreFileName = "index.mjs";
const bundledSourcePrinterFileName = "source-print-helper.mjs";
const generatedRuntimeFileName = "generated-runtime.ts";
const maximumCount = 10;
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
type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;
type RuntimeUser = Record<string, unknown>;

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

const buildCoreBundle = (bundleFile: string): void => {
  buildNodeBundle({
    cwd: corePackageRootDirectory,
    entryPoint: coreEntrypoint,
    externals: nativePreviewExternals,
    outfile: bundleFile,
  });
};

const buildSourcePrinterBundle = (bundleFile: string): void => {
  buildNodeBundle({
    cwd: corePackageRootDirectory,
    entryPoint: sourcePrinterEntryPoint,
    externals: nativePreviewExternals,
    outfile: bundleFile,
  });
};

const printWithNativeEmitter = (printerBundleFile: string, coreBundleFile: string): string =>
  runNode({ args: [printerBundleFile, coreBundleFile], cwd: corePackageRootDirectory });

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const importGeneratedUserSchema = async (generatedFile: string): Promise<RuntimeZodSchema> => {
  const schema = await importGeneratedExport(generatedFile, "userSchema", isRuntimeZodSchema);
  return schema;
};

const validRuntimeUser = (): RuntimeUser => ({
  count: 1,
  pair: ["left", 2],
  payload: { value: "present" },
  slug: "abc",
  status: "open",
  tags: ["tag"],
});

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

    expect(declarations.map((declaration) => declaration.name.text)).toEqual([
      "addressSchema",
      "userSchema",
    ]);
    expect(zodCallName(rootDeclaration.initializer as ts.Expression)).toBe("object");
    expect(zodCallName(propertyInitializer(rootDeclaration, "name"))).toBe("string");
    expect(zodCallName(propertyInitializer(rootDeclaration, "tags"))).toBe("array");
    expect(zodCallName(propertyInitializer(rootDeclaration, "mode"))).toBe("union");
    expect(zodCallName(propertyInitializer(rootDeclaration, "status"))).toBe("enum");
    expect(zodCallName(propertyInitializer(rootDeclaration, "boundedTags"))).toBe("max");
    expect(zodCallName(propertyInitializer(rootDeclaration, "slug"))).toBe("regex");
    expect(zodCallName(propertyInitializer(rootDeclaration, "pair"))).toBe("tuple");
    expect(zodCallName(propertyInitializer(rootDeclaration, "payload"))).toBe("required");
    expect(zodCallName(propertyInitializer(rootDeclaration, "dash-key"))).toBe("literal");
    expect(zodCallName(propertyInitializer(rootDeclaration, "count"))).toBe("lte");
    expect(zodCallName(propertyInitializer(rootDeclaration, "extra"))).toBe("catchall");
    expect(zodCallName(propertyInitializer(rootDeclaration, "nested"))).toBe("strict");
    expect(zodCallName(propertyInitializer(rootDeclaration, "age"))).toBe("optional");
    expect(
      zodCallName(
        (propertyInitializer(rootDeclaration, "age") as unknown as CallExpressionLike).expression
          .expression,
      ),
    ).toBe("number");
  });
});

describe("buildZodSourceFile declaration ordering and exports", () => {
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
  test("returns source files printable by the aligned native TypeScript emitter", async () => {
    const directory = createTemporaryDirectory({
      prefix: coreTestTempPrefix,
      rootDirectory: coreTestTempDirectory,
    });
    const coreBundleFile = join(directory, bundledCoreFileName);
    const printerBundleFile = join(directory, bundledSourcePrinterFileName);
    const generatedFile = join(directory, generatedRuntimeFileName);

    try {
      buildCoreBundle(coreBundleFile);
      buildSourcePrinterBundle(printerBundleFile);
      const printedSource = printWithNativeEmitter(printerBundleFile, coreBundleFile);

      expect(printedSource).toContain("export const userSchema");
      expect(printedSource).toContain("export type User");
      expect(printedSource).toContain("z.enum");
      expect(printedSource).toContain("new RegExp");
      expect(printedSource).toContain("z.tuple");
      expect(printedSource).toContain(".int().gt(0).lte(10)");
      expect(printedSource).toContain(".required({ value: true })");
      expect(printedSource).toContain(".min(1).max(2)");

      await Bun.write(generatedFile, printedSource);
      const userSchema = await importGeneratedUserSchema(generatedFile);

      expect(userSchema.safeParse(validRuntimeUser()).success).toBe(true);
      expect(userSchema.safeParse({ ...validRuntimeUser(), count: 0 }).success).toBe(false);
      expect(userSchema.safeParse({ ...validRuntimeUser(), payload: {} }).success).toBe(false);
      expect(userSchema.safeParse({ ...validRuntimeUser(), slug: "ABC" }).success).toBe(false);
      expect(userSchema.safeParse({ ...validRuntimeUser(), tags: [] }).success).toBe(false);
      expect(userSchema.safeParse({ ...validRuntimeUser(), tags: ["a", "b", "c"] }).success).toBe(
        false,
      );
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

  test("uses TypeScript identifier rules for declaration names", () => {
    const configSymbol = zodSymbol("config");
    const module = zodModule(rootSymbol, [
      zodDeclaration(configSymbol, zodPlan.string(), [zodDeclarationNameHint("CaféConfig")]),
      zodDeclaration(rootSymbol, zodPlan.reference(configSymbol)),
    ]);

    expect(variableNames(sourceFileFor(module))).toEqual(["caféConfigSchema", "userSchema"]);
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
