import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod/v4";

import { buildInputsDeclarationSchema } from "./build-inputs";
import { formatWithOxfmt } from "./oxfmt";

const buildInputsSchemaDialect = "http://json-schema.org/draft-07/schema#";
const buildInputsSchemaId = "https://x2zod.dev/schemas/build-inputs.schema.json";
const packageRoot = path.resolve(import.meta.dirname, "..");
const buildInputsSchemaPath = path.join(packageRoot, "schema", "build-inputs.schema.json");

const generateBuildInputsSchemaArgsSchema = z
  .array(z.literal("--check"))
  .transform((args) => ({ check: args.includes("--check") }));

const createBuildInputsJsonSchema = () => {
  const generatedSchema = z.toJSONSchema(buildInputsDeclarationSchema, {
    io: "input",
    reused: "inline",
    target: "draft-07",
  });
  const { $schema, ...generatedSchemaBody } = generatedSchema;

  return {
    $schema: $schema ?? buildInputsSchemaDialect,
    $id: buildInputsSchemaId,
    title: "Build Inputs",
    description:
      "Declaration file for external source artifacts materialized by @x2zod/build-inputs.",
    ...generatedSchemaBody,
  };
};

const renderBuildInputsJsonSchema = (): string =>
  formatWithOxfmt(
    `${JSON.stringify(createBuildInputsJsonSchema(), null, 2)}\n`,
    buildInputsSchemaPath,
  );

const parseGenerateBuildInputsSchemaArgs = (args: readonly string[]) => {
  const parsed = generateBuildInputsSchemaArgsSchema.safeParse(args);

  if (parsed.success) return parsed.data;

  const unknownArg = args.find((arg) => arg !== "--check") ?? "";

  throw new Error(`Unknown generate-build-inputs-schema argument: ${unknownArg}`);
};

const readTextFileIfPresent = async (filePath: string): Promise<string | undefined> => {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const main = async (): Promise<void> => {
  const args = parseGenerateBuildInputsSchemaArgs(process.argv.slice(2));
  const content = renderBuildInputsJsonSchema();

  if (args.check) {
    if ((await readTextFileIfPresent(buildInputsSchemaPath)) !== content)
      throw new Error(
        `Build inputs JSON Schema is stale at ${buildInputsSchemaPath}. Run bun run --cwd packages/build-inputs gen:schema.`,
      );
    return;
  }

  await mkdir(path.dirname(buildInputsSchemaPath), { recursive: true });
  await writeFile(buildInputsSchemaPath, content);
};

await main();
