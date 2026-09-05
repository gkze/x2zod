import { remapPropertiesHelperName } from "./source-codecs";
import { zodHelperIdentifierNames } from "./source-helpers";
import { analyzeSourceExpression } from "./source-model";
import type { SourceEmissionModule } from "./source-model";
import { preservedObjectCodecHelperName } from "./source-preserved-object-codecs";
import { runtimePredicateHelperNames } from "./source-runtime";
import { createTypeScriptIdentifierAllocator } from "./typescript-identifiers";
import type { TypeScriptIdentifierAllocator } from "./typescript-identifiers";
import type { ZodHelperName } from "./zod-helpers";

type SourceIdentifierAllocation = Readonly<{
  allocator: TypeScriptIdentifierAllocator;
  helperNames: ReadonlySet<ZodHelperName>;
  needsRemapHelper: boolean;
  needsPreservedObjectCodec: boolean;
  runtimeGuardParseModes: ReadonlySet<boolean>;
}>;

export const createSourceIdentifierAllocator = (
  sourceModule: SourceEmissionModule,
): SourceIdentifierAllocation => {
  const helperNames = new Set<ZodHelperName>();
  const runtimeGuardParseModes = new Set<boolean>();
  let needsRemapHelper = false;
  let needsPreservedObjectCodec = false;
  for (const declaration of sourceModule.declarations) {
    const analysis = analyzeSourceExpression(declaration.expression);
    for (const helperName of analysis.helperNames) helperNames.add(helperName);
    for (const parseMode of analysis.runtimeGuardParseModes) runtimeGuardParseModes.add(parseMode);
    needsRemapHelper ||= analysis.usesPropertyMap;
    needsPreservedObjectCodec ||= analysis.usesPreservedObjectCodec;
  }

  return {
    allocator: createTypeScriptIdentifierAllocator([
      ...zodHelperIdentifierNames(helperNames),
      ...(needsPreservedObjectCodec ? [preservedObjectCodecHelperName] : []),
      ...(needsRemapHelper ? [remapPropertiesHelperName] : []),
      ...runtimePredicateHelperNames(runtimeGuardParseModes),
    ]),
    helperNames,
    needsRemapHelper,
    needsPreservedObjectCodec,
    runtimeGuardParseModes,
  };
};
