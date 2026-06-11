import { describe, expect, test } from "bun:test";

import { z } from "zod/v4";

import { compileToZodSource, createDiagnostic, err, ok, zodFactory } from "../src/index";
import type {
  CompileToZodSourceResult,
  InputDocument,
  InputPlugin,
  PreparedInput,
  ts,
  ZodEmissionModuleInput,
  ZodFactoryName,
} from "../src/index";
import { firstVariableDeclaration, importPath, zodCallName } from "./ast-helpers";

const emptyOptionsSchema = z.object({});
type EmptyOptions = z.infer<typeof emptyOptionsSchema>;
type SourceValue = Readonly<{ sourceFile: ts.SourceFile }>;
type FactoryOptionInput = Readonly<{ factory?: "number" | "string" | undefined }>;
type FactoryOptions = Readonly<{ factory: "number" | "string" }>;
type FactoryPlugin = InputPlugin<string, FactoryOptions, FactoryOptionInput>;
type FactoryPreparedInputResult = Awaited<ReturnType<FactoryPlugin["prepare"]>>;
type FactoryEmissionModuleResult = Awaited<ReturnType<FactoryPlugin["lower"]>>;

const document = {
  source: { id: "inline-test", kind: "inline" },
  text: "{}",
} satisfies InputDocument;
const generatedFileName = "/__x2zod__/x2zod.generated.ts";

const emissionModuleForFactory = (factory: ZodFactoryName): ZodEmissionModuleInput => ({
  declarations: [{ expression: zodFactory(factory), symbol: "root" }],
  root: "root",
});

const unwrap = (result: CompileToZodSourceResult): SourceValue => {
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));

  return result.value;
};

const stringPlugin = {
  kind: "test",
  optionsSchema: emptyOptionsSchema,
  prepare: async (): Promise<ResultPreparedInput> => {
    const result = await Promise.resolve(ok({ value: "prepared" }));
    return result;
  },
  lower: async (): Promise<ResultEmissionModule> => {
    const result = await Promise.resolve(ok(emissionModuleForFactory("string")));
    return result;
  },
} satisfies InputPlugin<string, EmptyOptions>;

type ResultPreparedInput = Awaited<ReturnType<InputPlugin<string, EmptyOptions>["prepare"]>>;
type ResultEmissionModule = Awaited<ReturnType<InputPlugin<string, EmptyOptions>["lower"]>>;

const defaultedOptionsPlugin = (receivedOptions: FactoryOptions[]): FactoryPlugin => ({
  kind: "defaulted-options",
  optionsSchema: z
    .strictObject({ factory: z.enum(["number", "string"]).default("number") })
    .readonly(),
  prepare: async (
    _document: InputDocument,
    options: FactoryOptions,
  ): Promise<FactoryPreparedInputResult> => {
    await Promise.resolve();
    receivedOptions.push(options);
    return ok({ value: "prepared" });
  },
  lower: async (
    _input: PreparedInput<string>,
    options: FactoryOptions,
  ): Promise<FactoryEmissionModuleResult> => {
    await Promise.resolve();
    receivedOptions.push(options);
    return ok(emissionModuleForFactory(options.factory));
  },
});

describe("compileToZodSource", () => {
  test("orchestrates a plugin and returns a finalized source file", async () => {
    const result = await compileToZodSource({
      document,
      output: { typeName: "User" },
      plugin: stringPlugin,
      pluginOptions: {},
    });
    const { sourceFile } = unwrap(result);
    const expectedStatementCount = 3;

    expect(sourceFile.fileName).toBe(generatedFileName);
    expect(sourceFile.text).toBe("");
    expect(sourceFile.statements.length).toBe(expectedStatementCount);
    expect(importPath(sourceFile)).toBe("zod/v4");
    expect(firstVariableDeclaration(sourceFile).name.text).toBe("userSchema");
    expect(zodCallName(firstVariableDeclaration(sourceFile).initializer)).toBe("string");
  });

  test("uses the configured Zod import path", async () => {
    const result = await compileToZodSource({
      document,
      output: { typeName: "User", zodImportPath: "zod" },
      plugin: stringPlugin,
      pluginOptions: {},
    });

    expect(importPath(unwrap(result).sourceFile)).toBe("zod");
  });

  test("validates plugin options and passes parsed defaults to plugin steps", async () => {
    const receivedOptions: FactoryOptions[] = [];

    const result = await compileToZodSource({
      document,
      output: { typeName: "Metric" },
      plugin: defaultedOptionsPlugin(receivedOptions),
      pluginOptions: {},
    });

    const { sourceFile } = unwrap(result);
    expect(firstVariableDeclaration(sourceFile).name.text).toBe("metricSchema");
    expect(zodCallName(firstVariableDeclaration(sourceFile).initializer)).toBe("number");
    expect(receivedOptions).toEqual([{ factory: "number" }, { factory: "number" }]);
  });

  test("returns plugin prepare diagnostics without lowering", async () => {
    const diagnostic = createDiagnostic({
      code: "invalid_schema_document",
      message: "Input was not usable.",
    });
    const plugin = {
      kind: "prepare-failure",
      optionsSchema: emptyOptionsSchema,
      prepare: async (): Promise<ResultPreparedInput> => {
        const result = await Promise.resolve(err(diagnostic));
        return result;
      },
      lower: async (_input: PreparedInput<string>): Promise<ResultEmissionModule> => {
        const result = await Promise.resolve(ok(emissionModuleForFactory("never")));
        return result;
      },
    } satisfies InputPlugin<string, EmptyOptions>;

    const result = await compileToZodSource({
      document,
      output: { typeName: "User" },
      plugin,
      pluginOptions: {},
    });

    expect(result).toEqual({ diagnostics: [diagnostic], ok: false });
  });

  test("rejects invalid output type names", async () => {
    const result = await compileToZodSource({
      document,
      output: { typeName: "not valid" },
      plugin: stringPlugin,
      pluginOptions: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid output type name to fail.");
    expect(result.diagnostics[0].code).toBe("invalid_output_type_name");
  });
});
