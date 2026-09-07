import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createExportDeclaration,
  createExportSpecifier,
  createIdentifier,
  createNamedExports,
  updateSourceFile,
} from "@typescript/native-preview/unstable/ast/factory";

import { printNativeSourceFile } from "../../../test/native-print-helper";
import { formatWithOxfmt } from "../../build-inputs/src/oxfmt";
import { buildZodSourceFile } from "../src/source";
import { createRemapPropertiesHelper } from "../src/source-codecs";
import { createPreservedObjectCodecHelper, createZodHelperStatements } from "../src/source-helpers";
import { createRuntimePredicateHelperStatements } from "../src/source-runtime";
import { createSharedImport, helperStatementNames } from "../src/source-shared";
import { zodHelperNames } from "../src/zod-helpers";
import { parseZodEmissionModule, zodPlan } from "../src/zod-plan";

const outputPath = path.resolve(process.cwd(), "packages/runtime/src/generated/helpers.ts");
const generate = (): string => {
  const module = parseZodEmissionModule({
    declarations: [{ expression: zodPlan.string(), symbol: "root" }],
    root: "root",
  });
  if (!module.ok) throw new Error("Could not create runtime helper module.");
  const base = buildZodSourceFile(module.value, { typeName: "Runtime" });
  if (!base.ok) throw new Error("Could not create runtime helper source file.");
  const helpers = [
    ...createZodHelperStatements(new Set(zodHelperNames)),
    createPreservedObjectCodecHelper(),
    ...createRuntimePredicateHelperStatements(new Set([false, true])),
    createRemapPropertiesHelper(),
  ];
  const source = updateSourceFile(
    base.value.sourceFile,
    [
      createSharedImport("zod/v4", [{ imported: "z", local: "z" }]),
      ...helpers,
      createExportDeclaration(
        undefined,
        false,
        createNamedExports(
          helperStatementNames(helpers).map((name) =>
            createExportSpecifier(false, undefined, createIdentifier(name)),
          ),
        ),
      ),
    ],
    base.value.sourceFile.endOfFileToken,
  );
  return formatWithOxfmt(
    `// Generated from the core helper AST builders. Run the runtime package gen script.\n${printNativeSourceFile(source)}`,
    outputPath,
  );
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Expected only --check.");
  const content = generate();
  if (args.includes("--check")) {
    if ((await readFile(outputPath, "utf8")) !== content)
      throw new Error("Runtime helpers are stale. Run bun run --cwd packages/runtime gen.");
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
};

await main();
