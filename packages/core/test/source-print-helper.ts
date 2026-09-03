import { pathToFileURL } from "node:url";

import { diagnosticText, requiredArgument } from "../../../test/native-print-helper";
import { isRecord } from "../../../test/structural";
import type { UnknownRecord } from "../../../test/structural";
import type {
  buildZodSourceFile,
  printSourceFileSync,
  zodDeclaration,
  zodModule,
  zodPlan,
  zodSymbol,
} from "../src/index";

type CoreModule = Readonly<{
  buildZodSourceFile: typeof buildZodSourceFile;
  printSourceFileSync: typeof printSourceFileSync;
  zodDeclaration: typeof zodDeclaration;
  zodModule: typeof zodModule;
  zodPlan: typeof zodPlan;
  zodSymbol: typeof zodSymbol;
}>;

const coreBundlePathArgumentIndex = 2;
const sourceModeArgumentIndex = 3;
const typeNameArgumentIndex = 4;
const maximumCount = 10;
const coreModuleFunctionKeys = [
  "buildZodSourceFile",
  "printSourceFileSync",
  "zodDeclaration",
  "zodModule",
  "zodSymbol",
] as const satisfies readonly (keyof CoreModule)[];
const zodPlanFunctionKeys = [
  "array",
  "catchall",
  "enum",
  "gt",
  "integer",
  "lte",
  "max",
  "min",
  "number",
  "object",
  "optional",
  "passthrough",
  "preserveObjectInput",
  "reference",
  "regex",
  "required",
  "string",
  "strict",
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
const sourceMode = process.argv[sourceModeArgumentIndex];
const typeName = process.argv[typeNameArgumentIndex] ?? "User";
const propertyTransformMode = sourceMode === "property-transform";
const preservedPropertyTransformMode = sourceMode === "preserved-property-transform";
const recursivePropertyTransformMode = sourceMode === "recursive-property-transform";
const address = core.zodSymbol("address");
let module = core.zodModule(root, [
  core.zodDeclaration(
    root,
    core.zodPlan.preserveObjectInput(
      core.zodPlan.strict(
        core.zodPlan.object({
          ["__proto__"]: core.zodPlan.string(),
          count: core.zodPlan.lte(core.zodPlan.gt(core.zodPlan.integer(), 0), maximumCount),
          maybe: core.zodPlan.optional(core.zodPlan.string()),
          pair: core.zodPlan.tuple([core.zodPlan.string(), core.zodPlan.number()]),
          payload: core.zodPlan.required(core.zodPlan.object({ value: core.zodPlan.unknown() }), [
            "value",
          ]),
          insensitive: core.zodPlan.regex(core.zodPlan.string(), "^abc$", { ignoreCase: true }),
          slug: core.zodPlan.regex(core.zodPlan.string(), "^[a-z]+$"),
          status: core.zodPlan.enum(["open", "closed"]),
          tags: core.zodPlan.max(core.zodPlan.min(core.zodPlan.array(core.zodPlan.string()), 1), 2),
        }),
      ),
      ["__proto__"],
    ),
  ),
]);
if (propertyTransformMode)
  module = core.zodModule(root, [
    core.zodDeclaration(address, core.zodPlan.object({ postal_code: core.zodPlan.string() })),
    core.zodDeclaration(
      root,
      core.zodPlan.passthrough(
        core.zodPlan.object({
          metadata_map: core.zodPlan.catchall(
            core.zodPlan.object({}),
            core.zodPlan.object({ nested_value: core.zodPlan.string() }),
          ),
          profile_data: core.zodPlan.optional(
            core.zodPlan.object({
              addresses_list: core.zodPlan.array(core.zodPlan.reference(address)),
              display_name: core.zodPlan.optional(core.zodPlan.string()),
            }),
          ),
          settings_data: core.zodPlan.required(
            core.zodPlan.object({ display_name: core.zodPlan.optional(core.zodPlan.string()) }),
            ["display_name"],
          ),
          user_id: core.zodPlan.string(),
        }),
      ),
    ),
  ]);
if (preservedPropertyTransformMode)
  module = core.zodModule(root, [
    core.zodDeclaration(
      root,
      core.zodPlan.preserveObjectInput(
        core.zodPlan.passthrough(core.zodPlan.object({ snake_key: core.zodPlan.string() })),
        [],
      ),
    ),
  ]);
if (recursivePropertyTransformMode)
  module = core.zodModule(root, [
    core.zodDeclaration(
      root,
      core.zodPlan.object({
        next: core.zodPlan.optional(core.zodPlan.reference(root)),
        snake_key: core.zodPlan.string(),
      }),
    ),
  ]);
const result = core.buildZodSourceFile(
  module,
  { typeName },
  propertyTransformMode || preservedPropertyTransformMode || recursivePropertyTransformMode
    ? [{ kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } }]
    : [],
);

if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

process.stdout.write(core.printSourceFileSync(result.value.sourceFile, { cwd: process.cwd() }));
