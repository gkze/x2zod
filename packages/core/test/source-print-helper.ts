import { pathToFileURL } from "node:url";

import {
  diagnosticText,
  requiredArgument,
  writeNativeSourceFile,
} from "../../../test/native-print-helper";
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

const coreBundleFile = requiredArgument(coreBundlePathArgumentIndex, "core bundle");
const core = (await import(pathToFileURL(coreBundleFile).href)) as CoreModule;
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
