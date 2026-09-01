import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, test } from "node:test";

import { z } from "zod/v4";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import {
  buildZodSourceFile,
  compileToZodSource,
  ok,
  zodDeclaration,
  zodHelper,
  zodModule,
  zodPlan,
  zodSymbol,
} from "../src/index";
import type {
  InputDocument,
  InputPlugin,
  PreparedInput,
  Result,
  ZodEmissionModule,
  ZodEmissionModuleInput,
  ZodEmissionTransformInput,
} from "../src/index";
import { variableDeclaration, variableStatements, zodCallName } from "./ast-helpers";

const corePackageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const coreEntrypoint = "src/index.ts";
const sourcePrinterEntryPoint = nodePath.join(import.meta.dirname, "source-print-helper.ts");
const coreTestTempDirectory = nodePath.join(corePackageRootDirectory, "node_modules/.cache");
const coreTestTempPrefix = "x2zod-emission-transform-test-";
const bundledCoreFileName = "index.mjs";
const bundledSourcePrinterFileName = "source-print-helper.mjs";
const generatedRuntimeFileName = "generated-runtime.ts";
const generatedTypeProbeFileName = "generated-type-probe.ts";
const typeScriptBinary = nodePath.resolve(corePackageRootDirectory, "../../node_modules/.bin/tsgo");
const rootSymbol = zodSymbol("root");
const defaultOutputOptions = { typeName: "User" } satisfies Parameters<
  typeof buildZodSourceFile
>[1];
const camelCasePropertyTransforms = [
  { kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } },
] as const satisfies readonly ZodEmissionTransformInput[];
const emptyOptionsSchema = z.object({});

type EmptyOptions = z.infer<typeof emptyOptionsSchema>;
type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodCodec = Readonly<{
  decode: (value: unknown) => object;
  encode: (value: unknown) => unknown;
  safeDecode: (value: unknown) => RuntimeParseResult;
  safeEncode: (value: unknown) => RuntimeParseResult;
}>;

const document: InputDocument = {
  source: { id: "emission-transform-test", kind: "inline" },
  text: "schema",
};

const transformedObjectPlugin = {
  kind: "emission-transform-test",
  optionsSchema: emptyOptionsSchema,
  prepare: async (input: InputDocument): Promise<Result<PreparedInput<string>>> => {
    const result = await Promise.resolve(ok({ value: input.text }));
    return result;
  },
  lower: async (): Promise<Result<ZodEmissionModuleInput>> => {
    const result = await Promise.resolve(
      ok({
        declarations: [
          { expression: zodPlan.object({ user_id: zodPlan.string() }), symbol: "root" },
        ],
        root: "root",
      }),
    );
    return result;
  },
} satisfies InputPlugin<string, EmptyOptions>;

const rootOnlyModule = (expression: Parameters<typeof zodDeclaration>[1]): ZodEmissionModule =>
  zodModule(rootSymbol, [zodDeclaration(rootSymbol, expression)]);

const generatedTypeProbeSource = [
  'import { z } from "zod/v4";',
  'import { userSchema } from "./generated-runtime.js";',
  'import type { User } from "./generated-runtime.js";',
  "",
  "type Equal<TLeft, TRight> =",
  "  (<T>() => T extends TLeft ? 1 : 2) extends",
  "  (<T>() => T extends TRight ? 1 : 2) ? true : false;",
  "type Assert<TValue extends true> = TValue;",
  "",
  "export type InputMatches = Assert<",
  "  Equal<",
  "    z.input<typeof userSchema>,",
  "    {",
  "      metadata_map: { [key: string]: { nested_value: string } };",
  "      user_id: string;",
  "      profile_data?: {",
  "        addresses_list: { postal_code: string }[];",
  "        display_name?: string | undefined;",
  "      } | undefined;",
  "      settings_data: { display_name: string };",
  "      [key: string]: unknown;",
  "    }",
  "  >",
  ">;",
  "export type OutputMatches = Assert<",
  "  Equal<",
  "    z.output<typeof userSchema>,",
  "    {",
  "      metadataMap: { [key: string]: { nestedValue: string } };",
  "      userId: string;",
  "      profileData?: {",
  "        addressesList: { postalCode: string }[];",
  "        displayName?: string | undefined;",
  "      } | undefined;",
  "      settingsData: { displayName: string };",
  "      [key: string]: unknown;",
  "    }",
  "  >",
  ">;",
  "export type UserMatches = Assert<Equal<User, z.output<typeof userSchema>>>;",
  "",
].join("\n");

const wireValue = {
  extra_wire_key: "unchanged",
  metadata_map: { dynamic_entry: { nested_value: "nested" } },
  profile_data: { addresses_list: [{ postal_code: "12345" }], display_name: undefined },
  settings_data: { display_name: "visible" },
  user_id: "user-1",
};
const decodedValue = {
  extra_wire_key: "unchanged",
  metadataMap: { dynamic_entry: { nestedValue: "nested" } },
  profileData: { addressesList: [{ postalCode: "12345" }], displayName: undefined },
  settingsData: { displayName: "visible" },
  userId: "user-1",
};

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

const printPropertyTransformSource = (printerBundleFile: string, coreBundleFile: string): string =>
  runNode({
    allowedStderr: isNativePreviewShutdownStderr,
    args: [printerBundleFile, coreBundleFile, "property-transform"],
    cwd: corePackageRootDirectory,
  });

const emitGeneratedDeclarations = (generatedFile: string, outputDirectory: string): void => {
  const result = spawnSync(
    typeScriptBinary,
    [
      "--declaration",
      "--emitDeclarationOnly",
      "--ignoreConfig",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--outDir",
      outputDirectory,
      "--skipLibCheck",
      "--strict",
      "--target",
      "es2022",
      generatedFile,
    ],
    { cwd: corePackageRootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
};

const isRuntimeZodCodec = (value: unknown): value is RuntimeZodCodec =>
  isRecord(value) &&
  typeof value["decode"] === "function" &&
  typeof value["encode"] === "function" &&
  typeof value["safeDecode"] === "function" &&
  typeof value["safeEncode"] === "function";

const importGeneratedUserSchema = async (generatedFile: string): Promise<RuntimeZodCodec> => {
  const schema = await importGeneratedExport(generatedFile, "userSchema", isRuntimeZodCodec);
  return schema;
};

void describe("compileToZodSource emission transforms", () => {
  void test("emits a bidirectional codec for mapped property keys", async () => {
    const result = await compileToZodSource({
      document,
      output: defaultOutputOptions,
      plugin: transformedObjectPlugin,
      pluginOptions: {},
      transforms: camelCasePropertyTransforms,
    });
    if (!result.ok)
      throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));

    const userSchema = variableStatements(result.value.sourceFile)
      .map((statement) => variableDeclaration(statement))
      .find((declaration) => declaration.name.text === "userSchema");
    if (userSchema === undefined) throw new Error("Missing user schema declaration.");

    assert.equal(zodCallName(userSchema.initializer), "codec");
  });
});

void describe("buildZodSourceFile emission transform diagnostics", () => {
  void test("rejects declared property-key collisions", () => {
    const result = buildZodSourceFile(
      rootOnlyModule(zodPlan.object({ user_id: zodPlan.string(), userId: zodPlan.string() })),
      defaultOutputOptions,
      camelCasePropertyTransforms,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "emission_transform_key_collision");
  });

  void test("rejects invalid emission transform descriptors", () => {
    const invalidTransforms = structuredClone(camelCasePropertyTransforms);
    assert.equal(Reflect.set(invalidTransforms[0].options.keys, "decodedCase", "PascalCase"), true);
    const result = buildZodSourceFile(
      rootOnlyModule(zodPlan.object({ user_id: zodPlan.string() })),
      defaultOutputOptions,
      invalidTransforms,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_emission_transforms");
  });

  void test("rejects transformed union compositions that cannot encode unambiguously", () => {
    const result = buildZodSourceFile(
      rootOnlyModule(
        zodPlan.union([
          zodPlan.object({ user_id: zodPlan.string() }),
          zodPlan.object({ team_id: zodPlan.string() }),
        ]),
      ),
      defaultOutputOptions,
      camelCasePropertyTransforms,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "unsupported_emission_transform");
  });

  void test("rejects unique-item refinements after transformed array elements", () => {
    const result = buildZodSourceFile(
      rootOnlyModule(
        zodPlan.refine(
          zodPlan.array(zodPlan.object({ snake_key: zodPlan.number() })),
          zodHelper.uniqueItems(),
        ),
      ),
      defaultOutputOptions,
      camelCasePropertyTransforms,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "unsupported_emission_transform");
  });

  void test("rejects object-input preservation across property-key transforms", () => {
    const result = buildZodSourceFile(
      rootOnlyModule(
        zodPlan.preserveObjectInput(
          zodPlan.strict(
            zodPlan.object({ ["__proto__"]: zodPlan.string(), snake_key: zodPlan.string() }),
          ),
          ["__proto__"],
        ),
      ),
      defaultOutputOptions,
      camelCasePropertyTransforms,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "unsupported_emission_transform");
  });
});

void describe("generated property-key codecs", () => {
  void test("decode, encode, and emit distinct input and output declarations", async () => {
    const directory = createTemporaryDirectory({
      prefix: coreTestTempPrefix,
      rootDirectory: coreTestTempDirectory,
    });
    const coreBundleFile = nodePath.join(directory, bundledCoreFileName);
    const printerBundleFile = nodePath.join(directory, bundledSourcePrinterFileName);
    const generatedFile = nodePath.join(directory, generatedRuntimeFileName);

    try {
      buildCoreBundle(coreBundleFile);
      buildSourcePrinterBundle(printerBundleFile);
      const printedSource = printPropertyTransformSource(printerBundleFile, coreBundleFile);
      const typeProbeFile = nodePath.join(directory, generatedTypeProbeFileName);
      await writeFile(generatedFile, printedSource);
      await writeFile(typeProbeFile, generatedTypeProbeSource);
      emitGeneratedDeclarations(typeProbeFile, nodePath.join(directory, "declarations"));
      const userSchema = await importGeneratedUserSchema(generatedFile);

      assert.ok(printedSource.includes("z.codec"));
      assert.ok(printedSource.includes("user_id"));
      assert.ok(printedSource.includes("userId"));
      assert.deepEqual(userSchema.decode(wireValue), decodedValue);
      assert.deepEqual(userSchema.encode(decodedValue), wireValue);
      const requiredWireValue = {
        metadata_map: {},
        settings_data: { display_name: "visible" },
        user_id: "user-1",
      };
      assert.deepEqual(userSchema.decode(requiredWireValue), {
        metadataMap: {},
        settingsData: { displayName: "visible" },
        userId: "user-1",
      });
      assert.equal(Object.hasOwn(userSchema.decode(requiredWireValue), "profileData"), false);
      assert.equal(
        Object.hasOwn(
          userSchema.decode({ ...requiredWireValue, profile_data: undefined }),
          "profileData",
        ),
        true,
      );
      assert.equal(
        userSchema.safeDecode({ ...requiredWireValue, settings_data: {} }).success,
        false,
      );
      assert.equal(
        userSchema.safeDecode({ userId: "collision", user_id: "user-1" }).success,
        false,
      );
      assert.equal(
        userSchema.safeEncode({ userId: "user-1", user_id: "collision" }).success,
        false,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
