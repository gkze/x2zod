import { ok, zodPlan } from "@x2zod/core";
import type {
  Diagnostic,
  Result,
  SourceLocationMap,
  ZodDeclaration,
  ZodEmissionModuleInput,
  ZodRuntimeProgram,
} from "@x2zod/core";

import { collectJsonSchemaAnnotations, applyJsonSchemaAnnotationProjection } from "./annotations";
import type { JsonSchemaAnnotationProjector } from "./annotations";
import { resultFromJsonSchemaDiagnostics } from "./diagnostics";
import { defaultJsonSchemaDialectPolicy } from "./dialect";
import type { JsonSchemaDialectPolicy } from "./dialect";
import { isJsonObject } from "./document";
import type { JsonSchemaValue, ParsedJsonSchemaDocument } from "./document";
import {
  jsonSchemaDocumentResource,
  normalizeUserExternalSchemaRegistry,
} from "./external-schema-registry";
import { collectKeywordDiagnostics } from "./keyword-diagnostics";
import { declareSchema } from "./lower";
import { loweringDiagnosticSink as diagnosticSink } from "./lower-diagnostics";
import type { LoweringContext } from "./lower-types";
import { jsonSchemaValidationKeywords } from "./metadata";
import type { ResolvedJsonSchemaInputPluginOptions } from "./options";
import {
  createJsonSchemaReferenceResolver,
  createJsonSchemaReferenceResolverFromGraph,
} from "./reference";
import type { JsonSchemaAddress } from "./reference";
import { resolveJsonSchemaResourcePolicies } from "./resource-policies";
import { stripReachableRuntimeDocument } from "./runtime-schema-projection";
import {
  createStandaloneRuntimeProgram,
  jsonSchemaRuntimeProjection,
} from "./standalone-validator";

const rootSymbol = "root";

const schemaWithoutValidationKeywords = (
  schema: JsonSchemaValue,
  policy: JsonSchemaDialectPolicy,
): JsonSchemaValue => {
  if (!isJsonObject(schema)) return schema;

  // Preserve opaque containers for explicit pointer targets; runtime atoms exclude unknown keys.
  if (policy.validation) return schema;
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => !jsonSchemaValidationKeywords.has(key)),
  );
};

const exactRuntimeRecoverableDiagnosticCodes = new Set(["unrepresentable_schema_combination"]);

const hasOnlyExactRuntimeRecoverableErrors = (diagnostics: readonly Diagnostic[]): boolean => {
  let hasError = false;
  for (const diagnostic of diagnostics)
    if (diagnostic.severity === "error") {
      hasError = true;
      if (!exactRuntimeRecoverableDiagnosticCodes.has(diagnostic.code)) return false;
    }
  return hasError;
};

const rootDialectPolicy = (context: LoweringContext): JsonSchemaDialectPolicy =>
  context.resourcePolicies.get(context.references.graph.root) ?? {
    ...defaultJsonSchemaDialectPolicy(context.options.dialect),
    formatAssertion: context.formatAssertionVocabulary,
    validation: context.validationVocabulary,
  };

const collectDocumentDiagnostics = (context: LoweringContext): void => {
  const rootPolicy = rootDialectPolicy(context);
  for (const locationId of context.references.graph.reachableLocations) {
    const location = context.references.graph.location(locationId);
    if (location !== undefined) {
      const policy = context.resourcePolicies.get(locationId) ?? rootPolicy;
      collectKeywordDiagnostics(location.schema, location.pointer, {
        ...diagnosticSink(context),
        dialect: policy.dialect,
        formatAssertionVocabulary: policy.formatAssertion,
        options: context.options,
        policyForPointer: () => policy,
        validationVocabulary: policy.validation,
      });
    }
  }
};

const createRuntimeRequest = (
  normalizedSchema: JsonSchemaValue,
  normalizedExternalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  context: LoweringContext,
): Readonly<{
  dialect: ResolvedJsonSchemaInputPluginOptions["dialect"];
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  resourcePolicies: LoweringContext["resourcePolicies"];
  references: LoweringContext["references"];
  schema: JsonSchemaValue;
}> => {
  const rootPolicy = rootDialectPolicy(context);
  const externalRootPolicy = defaultJsonSchemaDialectPolicy(context.options.dialect);
  const policyForExternal = (uri: string): JsonSchemaDialectPolicy => {
    const resource = jsonSchemaDocumentResource(context.references.graph.resources, uri);
    const location =
      resource === undefined ? undefined : context.references.graph.location(resource.location);
    return location === undefined
      ? externalRootPolicy
      : (context.resourcePolicies.get(location.id) ?? externalRootPolicy);
  };
  return {
    dialect: context.options.dialect,
    externalSchemas: Object.fromEntries(
      Object.entries(normalizedExternalSchemas).map(([uri, schema]) => [
        uri,
        stripReachableRuntimeDocument({
          context,
          fallbackPolicy: policyForExternal(uri),
          retrievalUri: uri,
          schema,
          stripSchema: (candidate, policy) => schemaWithoutValidationKeywords(candidate, policy),
        }),
      ]),
    ),
    resourcePolicies: context.resourcePolicies,
    references: context.references,
    schema: stripReachableRuntimeDocument({
      context,
      fallbackPolicy: rootPolicy,
      retrievalUri:
        context.references.graph.location(context.references.graph.root)?.retrievalUri ?? "",
      schema: normalizedSchema,
      stripSchema: (candidate, policy) => schemaWithoutValidationKeywords(candidate, policy),
    }),
  };
};

const guardRuntimeDeclarations = async (
  context: LoweringContext,
  runtimeRequest: ReturnType<typeof createRuntimeRequest>,
  requireRuntime: boolean,
): Promise<Result<ZodEmissionModuleInput>> => {
  const declarations: ZodDeclaration[] = [];
  const runtimePrograms: ZodRuntimeProgram[] = [];
  const diagnostics = context.diagnostics.filter((diagnostic) => diagnostic.severity !== "error");
  for (const [address, declaration] of context.declarations) {
    const location = context.declarationLocations.get(address);
    if (location === undefined) throw new Error("Missing JSON Schema declaration location.");
    const declarationRequest = {
      ...runtimeRequest,
      references: createJsonSchemaReferenceResolverFromGraph(context.references.graph, location),
    };
    const projection = jsonSchemaRuntimeProjection(declarationRequest);
    const isRoot = declaration.symbol === rootSymbol;
    if (projection === "none" && !requireRuntime) declarations.push(declaration);
    else {
      // Serialize compiler/native-parser state instead of spawning one process per declaration.
      const compiled = await createStandaloneRuntimeProgram(declarationRequest);
      if (!compiled.ok) return compiled;
      const program = {
        ...compiled.value,
        id: isRoot ? compiled.value.id : `${compiled.value.id}:${declaration.symbol}`,
      };
      runtimePrograms.push(program);
      diagnostics.push(...(compiled.diagnostics ?? []));
      const guarded = zodPlan.runtimeGuard(
        zodPlan.reference(declaration.symbol),
        program.id,
        "encoded-input",
      );
      declarations.push({
        ...declaration,
        exportExpression: applyJsonSchemaAnnotationProjection(
          guarded,
          context.annotationProjections.get(location),
        ),
      });
    }
  }
  return ok({ declarations, root: rootSymbol, runtimePrograms }, diagnostics);
};

export const lowerJsonSchemaDocument = async (
  document: ParsedJsonSchemaDocument,
  options: ResolvedJsonSchemaInputPluginOptions,
  request: Readonly<{
    applicatorVocabulary?: boolean | undefined;
    formatAssertionVocabulary?: boolean | undefined;
    locations?: SourceLocationMap | undefined;
    unevaluatedVocabulary?: boolean | undefined;
    validationVocabulary?: boolean | undefined;
    projectAnnotations?: JsonSchemaAnnotationProjector | undefined;
  }> = {},
): Promise<Result<ZodEmissionModuleInput>> => {
  const {
    applicatorVocabulary = true,
    formatAssertionVocabulary = false,
    locations,
    unevaluatedVocabulary = true,
    validationVocabulary = true,
  } = request;
  const normalizedRegistry = normalizeUserExternalSchemaRegistry(options.externalSchemas);
  if (!normalizedRegistry.ok) return normalizedRegistry;
  const normalizedOptions = { ...options, externalSchemas: normalizedRegistry.value };
  const references = createJsonSchemaReferenceResolver(document, normalizedOptions);
  if (!references.ok) return references;
  const rootPolicy: JsonSchemaDialectPolicy = {
    applicator: applicatorVocabulary,
    dialect: normalizedOptions.dialect,
    formatAssertion: formatAssertionVocabulary,
    unevaluated: unevaluatedVocabulary,
    validation: validationVocabulary,
  };
  const resolvedResourcePolicies = resolveJsonSchemaResourcePolicies({
    dialect: normalizedOptions.dialect,
    externalSchemas: normalizedOptions.externalSchemas,
    graph: references.value.graph,
    locations,
    rootPolicy,
  });
  if (!resolvedResourcePolicies.ok) return resolvedResourcePolicies;
  const context: LoweringContext = {
    annotations: new Map(),
    annotationProjections: new Map(),
    projectAnnotations: request.projectAnnotations,
    declarationLocations: new Map(),
    declarations: new Map(),
    diagnostics: [],
    formatAssertionVocabulary,
    options: normalizedOptions,
    resourcePolicies: resolvedResourcePolicies.value,
    validationVocabulary,
    references: references.value,
    visiting: new Set<JsonSchemaAddress>(),
    sameValueReferences: new Set<JsonSchemaAddress>(),
    ...(locations === undefined ? {} : { locations }),
  };
  collectDocumentDiagnostics(context);
  if (context.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    return resultFromJsonSchemaDiagnostics(
      { declarations: [], root: rootSymbol },
      context.diagnostics,
    );

  for (const id of context.references.graph.reachableLocations) {
    const location = context.references.graph.location(id);
    if (location !== undefined) context.annotations.set(id, collectJsonSchemaAnnotations(location));
  }
  const runtimeRequest = createRuntimeRequest(
    document.schema,
    normalizedOptions.externalSchemas,
    context,
  );
  declareSchema(context.references.root, {
    ...context,
    allowSameValueCycles: jsonSchemaRuntimeProjection(runtimeRequest) === "structural",
  });
  const structuralModule = resultFromJsonSchemaDiagnostics(
    { declarations: [...context.declarations.values()], root: rootSymbol },
    context.diagnostics,
  );
  if (!structuralModule.ok && !hasOnlyExactRuntimeRecoverableErrors(context.diagnostics))
    return structuralModule;
  const guarded = await guardRuntimeDeclarations(context, runtimeRequest, !structuralModule.ok);
  return guarded;
};
