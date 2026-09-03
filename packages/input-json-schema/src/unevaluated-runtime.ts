import standaloneCode from "ajv/dist/standalone/index.js";

import { createDiagnostic, err, ok, zodRuntimeProgram } from "@x2zod/core";
import type { Result, ZodRuntimeProgram } from "@x2zod/core";

import { installExactMultipleOf } from "./ajv-exact-multiple-of";
import { createJsonSchemaAjv } from "./ajv-factory";
import type { JsonSchemaAjv } from "./ajv-factory";
import {
  ajvStandaloneOptions,
  jsonSchemaRuntimeProgramId,
  normalizeAjvStandaloneSource,
} from "./ajv-standalone-compiler";
import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaDocumentResource } from "./external-schema-registry";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./options";
import { jsonSchemaAtPointer } from "./pointer";
import type { JsonSchemaLocationId, JsonSchemaResourceLocation } from "./resource-graph";
import { isDraft7ReferenceSchema } from "./schema-applicability";
import type { StandaloneRuntimeRequest } from "./standalone-reachability";
import { standaloneRuntimePreamble } from "./standalone-runtime-preamble";
import { parseGeneratedTypeScriptExpression } from "./typescript-expression-parser";
import { buildRuntimeDescriptors } from "./unevaluated-runtime-descriptors";
import type { RuntimeDescriptorGraph } from "./unevaluated-runtime-descriptors";
import {
  createRuntimeDescriptorEvaluator,
  runtimeEvaluatorSource,
} from "./unevaluated-runtime-evaluator";
import type { RuntimeNodeValidator } from "./unevaluated-runtime-evaluator";

type ResourceGraphRuntimeRequest = StandaloneRuntimeRequest &
  Readonly<{ reachableLocations: ReadonlySet<JsonSchemaLocationId> }>;
type ValidatorGroup = Readonly<{
  ajv: JsonSchemaAjv;
  dialect: JsonSchemaDialect;
  exports: Record<string, string>;
  validators: string[];
}>;
type RuntimeValidatorTarget = Readonly<{ group: ValidatorGroup; uri: string }>;
type PreparedNodeValidators = Readonly<{
  groups: readonly ValidatorGroup[];
  nodeValidators: readonly string[];
  targets: ReadonlyMap<string, RuntimeValidatorTarget>;
}>;
type RuntimeLocationDialect = (location: JsonSchemaResourceLocation) => JsonSchemaDialect;

const dialects = ["draft-7", "draft-2019-09", "draft-2020-12"] as const;

const ajvForDialect = (dialect: JsonSchemaDialect): JsonSchemaAjv => {
  const ajv = createJsonSchemaAjv(dialect, ajvStandaloneOptions);
  installExactMultipleOf(ajv);
  return ajv;
};

const annotationApplicatorKeywords: ReadonlySet<string> = new Set([
  "$defs",
  "$id",
  "$schema",
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "then",
  jsonSchemaKeywords.anchor,
  jsonSchemaKeywords.dynamicAnchor,
  jsonSchemaKeywords.dynamicRef,
  jsonSchemaKeywords.recursiveAnchor,
  jsonSchemaKeywords.recursiveRef,
  jsonSchemaKeywords.ref,
  jsonSchemaKeywords.unevaluatedItems,
  jsonSchemaKeywords.unevaluatedProperties,
]);

const ownValidationSchema = (
  schema: JsonSchemaValue,
  dialect: JsonSchemaDialect,
): JsonSchemaValue => {
  if (!isJsonObject(schema)) return schema;
  if (isDraft7ReferenceSchema(schema, dialect)) return true;
  return Object.fromEntries(
    Object.entries(schema).flatMap(([keyword, value]) => {
      if (dialect === "draft-7" && keyword === jsonSchemaKeywords.dependencies) {
        if (!isJsonObject(value)) return [];
        const requiredDependencies = Object.fromEntries(
          Object.entries(value).filter(([, dependency]) => Array.isArray(dependency)),
        );
        return Object.keys(requiredDependencies).length === 0
          ? []
          : [[keyword, requiredDependencies]];
      }
      return annotationApplicatorKeywords.has(keyword) ? [] : [[keyword, value]];
    }),
  );
};

const dialectForLocation = (
  request: ResourceGraphRuntimeRequest,
  location: JsonSchemaResourceLocation,
): JsonSchemaDialect => request.resourcePolicies?.get(location.id)?.dialect ?? request.dialect;

const runtimeSchemaProjection = (
  request: ResourceGraphRuntimeRequest,
): ((location: JsonSchemaResourceLocation) => JsonSchemaValue) => {
  const rootLocation = request.references.graph.location(request.references.graph.root);
  const documents = new Map<string, JsonSchemaValue>();
  if (rootLocation !== undefined) documents.set(rootLocation.retrievalUri, request.schema);
  for (const [uri, schema] of Object.entries(request.externalSchemas)) {
    const resource = jsonSchemaDocumentResource(request.references.graph.resources, uri);
    if (resource !== undefined) documents.set(resource.retrievalUri, schema);
  }
  return (location): JsonSchemaValue => {
    const document = documents.get(location.retrievalUri);
    return document === undefined
      ? location.schema
      : (jsonSchemaAtPointer(document, location.pointer) ?? location.schema);
  };
};

const prepareNodeValidators = (
  locations: readonly JsonSchemaResourceLocation[],
  dialectForNode: RuntimeLocationDialect,
): PreparedNodeValidators => {
  const groups = new Map<JsonSchemaDialect, ValidatorGroup>();
  const validatorsBySchema = new Map<string, string>();
  const targets = new Map<string, RuntimeValidatorTarget>();
  const nodeValidators: string[] = [];
  for (const location of locations) {
    const dialect = dialectForNode(location);
    const validationSchema = ownValidationSchema(location.schema, dialect);
    const schemaKey = `${dialect}:${JSON.stringify(validationSchema)}`;
    let validator = validatorsBySchema.get(schemaKey);
    if (validator === undefined) {
      validator = `x2zodValidate${validatorsBySchema.size.toString()}`;
      const wrapperUri = `https://x2zod.invalid/runtime/resource/${validatorsBySchema.size.toString()}`;
      const group =
        groups.get(dialect) ??
        ({
          ajv: ajvForDialect(dialect),
          dialect,
          exports: {},
          validators: [],
        } satisfies ValidatorGroup);
      groups.set(dialect, group);
      validatorsBySchema.set(schemaKey, validator);
      group.validators.push(validator);
      group.ajv.addSchema(validationSchema, wrapperUri);
      group.exports[validator] = wrapperUri;
      targets.set(validator, { group, uri: wrapperUri });
    }
    nodeValidators.push(validator);
  }

  const activeGroups: readonly ValidatorGroup[] = dialects.flatMap((dialect) => {
    const group = groups.get(dialect);
    return group === undefined ? [] : [group];
  });
  return { groups: activeGroups, nodeValidators, targets };
};

const runtimeNodeValidators = (prepared: PreparedNodeValidators): readonly RuntimeNodeValidator[] =>
  prepared.nodeValidators.map((name) => {
    const target = prepared.targets.get(name);
    if (target === undefined) throw new Error("Missing JSON Schema runtime validator target.");
    const validate = target.group.ajv.getSchema(target.uri);
    if (validate === undefined) throw new Error("Missing compiled JSON Schema runtime validator.");
    return (value: unknown): boolean => validate(value) === true;
  });

const compileNodeValidatorSources = (
  prepared: PreparedNodeValidators,
): Result<Readonly<{ sources: readonly string[]; validators: readonly string[] }>> => {
  const grouped = prepared.groups.length > 1;
  const groupNames = new Map<JsonSchemaDialect, string>();
  const sources: string[] = [];
  for (const [index, group] of prepared.groups.entries()) {
    const normalized = normalizeAjvStandaloneSource(standaloneCode(group.ajv, group.exports));
    if (!normalized.ok) return normalized;
    if (grouped) {
      const groupName = `x2zodValidatorGroup${index.toString()}`;
      groupNames.set(group.dialect, groupName);
      sources.push(
        [
          `const ${groupName} = (() => {`,
          normalized.value,
          `return { ${group.validators.join(", ")} };`,
          "})();",
        ].join("\n"),
      );
    } else sources.push(normalized.value);
  }
  return ok({
    sources,
    validators: prepared.nodeValidators.map((validator) => {
      const target = prepared.targets.get(validator);
      if (target === undefined) throw new Error("Missing JSON Schema runtime validator target.");
      const groupName = groupNames.get(target.group.dialect);
      return groupName === undefined ? validator : `${groupName}.${validator}`;
    }),
  });
};

const runtimeCompilationFailure = <TValue>(error: unknown): Result<TValue> =>
  err(
    createDiagnostic({
      code: "invalid_schema_document",
      message: `JSON Schema resource graph runtime compilation failed: ${
        error instanceof Error ? error.message : "Unknown validation compiler failure."
      }`,
    }),
  );

export const createRuntimeDescriptorValidator = (
  graph: RuntimeDescriptorGraph,
  dialectForNode: RuntimeLocationDialect,
): Result<RuntimeNodeValidator> => {
  try {
    const prepared = prepareNodeValidators(graph.locations, dialectForNode);
    return ok(createRuntimeDescriptorEvaluator(graph, runtimeNodeValidators(prepared)));
  } catch (error) {
    return runtimeCompilationFailure(error);
  }
};

const runtimeExpressionSource = (request: ResourceGraphRuntimeRequest): Result<string> => {
  const { descriptors, locations, resources, root } = buildRuntimeDescriptors({
    dialect: request.dialect,
    dialectForLocation: (location) => dialectForLocation(request, location),
    reachableLocations: request.reachableLocations,
    references: request.references,
    schemaForLocation: runtimeSchemaProjection(request),
  });
  const compiled = compileNodeValidatorSources(
    prepareNodeValidators(locations, (location) => dialectForLocation(request, location)),
  );
  if (!compiled.ok) return compiled;
  return ok(
    [
      "(() => {",
      standaloneRuntimePreamble,
      ...compiled.value.sources,
      runtimeEvaluatorSource,
      `const x2zodNodes = ${JSON.stringify(descriptors)};`,
      `const x2zodResources = ${JSON.stringify(resources)};`,
      `const x2zodValidators = [${compiled.value.validators.join(", ")}];`,
      `const x2zodMachine = { nodes: x2zodNodes, patterns: new Map(), resources: x2zodResources, root: ${root.toString()}, validators: x2zodValidators };`,
      "return (value: unknown): boolean => x2zodEvaluate(x2zodMachine, value);",
      "})()",
    ].join("\n"),
  );
};

export const createResourceGraphRuntimeProgram = async (
  request: ResourceGraphRuntimeRequest,
): Promise<Result<ZodRuntimeProgram>> => {
  try {
    const source = runtimeExpressionSource(request);
    if (!source.ok) return source;
    return ok(
      zodRuntimeProgram(
        jsonSchemaRuntimeProgramId,
        await parseGeneratedTypeScriptExpression(source.value),
      ),
    );
  } catch (error) {
    return runtimeCompilationFailure(error);
  }
};
