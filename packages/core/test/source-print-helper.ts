import { pathToFileURL } from "node:url";

import {
  diagnosticText,
  requiredArgument,
  writeNativeSourceFile,
} from "../../../test/native-print-helper";
import { isRecord } from "../../../test/structural";
import type { UnknownRecord } from "../../../test/structural";
import type {
  buildZodSourceFile,
  zodDeclaration,
  zodModule,
  zodPlan,
  zodSymbol,
} from "../src/index";

type CoreModule = Readonly<{
  buildZodSourceFile: typeof buildZodSourceFile;
  zodDeclaration: typeof zodDeclaration;
  zodModule: typeof zodModule;
  zodPlan: typeof zodPlan;
  zodSymbol: typeof zodSymbol;
}>;

const coreBundlePathArgumentIndex = 2;
const maximumCount = 10;
const coreModuleFunctionKeys = [
  "buildZodSourceFile",
  "zodDeclaration",
  "zodModule",
  "zodSymbol",
] as const satisfies readonly (keyof CoreModule)[];
const zodPlanFunctionKeys = [
  "array",
  "enum",
  "gt",
  "integer",
  "lte",
  "max",
  "min",
  "number",
  "object",
  "regex",
  "required",
  "string",
  "tuple",
  "unknown",
] as const satisfies readonly (keyof CoreModule["zodPlan"])[];

const hasFunctions = (value: UnknownRecord, keys: readonly string[]): boolean =>
  keys.every((key) => typeof value[key] === "function");

const isCoreModule = (value: unknown): value is CoreModule => {
  if (!isRecord(value) || !hasFunctions(value, coreModuleFunctionKeys)) return false;

  const plan = value["zodPlan"];
  return isRecord(plan) && hasFunctions(plan, zodPlanFunctionKeys);
};

const importCoreModule = async (file: string): Promise<CoreModule> => {
  const module: unknown = await import(pathToFileURL(file).href);
  if (!isCoreModule(module)) throw new Error("Core bundle did not expose the expected API.");

  return module;
};

const coreBundleFile = requiredArgument(coreBundlePathArgumentIndex, "core bundle");
const core = await importCoreModule(coreBundleFile);
const root = core.zodSymbol("root");
const module = core.zodModule(root, [
  core.zodDeclaration(
    root,
    core.zodPlan.object({
      count: core.zodPlan.lte(core.zodPlan.gt(core.zodPlan.integer(), 0), maximumCount),
      pair: core.zodPlan.tuple([core.zodPlan.string(), core.zodPlan.number()]),
      payload: core.zodPlan.required(core.zodPlan.object({ value: core.zodPlan.unknown() }), [
        "value",
      ]),
      slug: core.zodPlan.regex(core.zodPlan.string(), "^[a-z]+$"),
      status: core.zodPlan.enum(["open", "closed"]),
      tags: core.zodPlan.max(core.zodPlan.min(core.zodPlan.array(core.zodPlan.string()), 1), 2),
    }),
  ),
]);
const result = core.buildZodSourceFile(module, { typeName: "User" });

if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

writeNativeSourceFile(result.value.sourceFile);
