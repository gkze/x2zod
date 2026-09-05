import standaloneCode from "ajv/dist/standalone/index.js";

import { createDiagnostic, err, ok, zodRuntimeProgram } from "@x2zod/core";
import type { Result, ZodRuntimeProgram } from "@x2zod/core";

import {
  installExactDynamicReference,
  instrumentExactDynamicReferences,
} from "./ajv-dynamic-reference";
import { installExactMultipleOf } from "./ajv-exact-multiple-of";
import { createJsonSchemaAjv } from "./ajv-factory";
import type { JsonSchemaAjv } from "./ajv-factory";
import { installExactRecursiveReference } from "./ajv-recursive-reference";
import {
  ajvStandaloneOptions,
  jsonSchemaRuntimeProgramId,
  normalizeAjvStandaloneSource,
} from "./ajv-standalone-compiler";
import { jsonSchemaDocumentResource } from "./external-schema-registry";
import { jsonSchemaDialectMetaSchemaAliases, jsonSchemaDialectMetaSchemas } from "./meta-schemas";
import type { JsonSchemaDialect, JsonSchemaInputPluginOptions } from "./options";
import { normalizeEmbeddedResources } from "./resource-normalization";
import {
  jsonSchemaRuntimeProjection,
  reachableExternalSchemas,
  reachableRuntimeLocationIds,
  requestNeedsResourceGraphRuntime,
} from "./standalone-reachability";
import type {
  JsonSchemaRuntimeProjection,
  StandaloneRuntimeRequest,
} from "./standalone-reachability";
import { standaloneRuntimePreamble } from "./standalone-runtime-preamble";
import { chunkOversizedAjvValidator } from "./standalone-source-chunks";
import { compareCodeUnits } from "./string-order";
import { parseGeneratedTypeScriptExpression } from "./typescript-expression-parser";
import { createResourceGraphRuntimeProgram } from "./unevaluated-runtime";

export { jsonSchemaRuntimeProjection };
export type { JsonSchemaRuntimeProjection };

const defaultExportPattern = /^export default (?<identifier>[A-Za-z_$][\w$]*);$/mu;

const ajvForDialect = (dialect: JsonSchemaDialect): JsonSchemaAjv => {
  const ajv = createJsonSchemaAjv(dialect, ajvStandaloneOptions);
  installExactMultipleOf(ajv);
  if (dialect === "draft-2020-12") installExactDynamicReference(ajv);
  if (dialect === "draft-2019-09") installExactRecursiveReference(ajv);
  return ajv;
};

const addExternalSchemas = (
  ajv: JsonSchemaAjv,
  schemas: JsonSchemaInputPluginOptions["externalSchemas"],
): void => {
  for (const [uri, schema] of Object.entries(schemas).toSorted(([left], [right]) =>
    compareCodeUnits(left, right),
  ))
    ajv.addSchema(schema, uri);
};

type AddDialectMetaSchemasRequest = Readonly<{
  dialect: JsonSchemaDialect;
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  rootRetrievalUri?: string | undefined;
}>;

const addDialectMetaSchemas = (
  ajv: JsonSchemaAjv,
  { dialect, externalSchemas, rootRetrievalUri }: AddDialectMetaSchemasRequest,
): void => {
  const schemas = {
    ...jsonSchemaDialectMetaSchemas(dialect),
    ...jsonSchemaDialectMetaSchemaAliases(dialect),
  };
  for (const [uri, schema] of Object.entries(schemas).toSorted(([left], [right]) =>
    compareCodeUnits(left, right),
  ))
    if (uri !== rootRetrievalUri && !Object.hasOwn(externalSchemas, uri))
      ajv.addSchema(schema, uri);
};

const standaloneExpressionSource = (source: string): Result<string> => {
  const validateIdentifier = defaultExportPattern.exec(source)?.groups?.["identifier"];
  if (validateIdentifier === undefined)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: "Ajv standalone output did not expose a default validation function.",
      }),
    );

  const executableSource = normalizeAjvStandaloneSource(source);
  if (!executableSource.ok) return executableSource;
  return ok(
    [
      "(() => {",
      standaloneRuntimePreamble,
      chunkOversizedAjvValidator(executableSource.value),
      `return (value: unknown): boolean => ${validateIdentifier}(value);`,
      "})()",
    ].join("\n"),
  );
};

export const createStandaloneRuntimeProgram = async (
  request: StandaloneRuntimeRequest,
): Promise<Result<ZodRuntimeProgram>> => {
  const externalSchemas = reachableExternalSchemas(request);
  const runtimeRequest = { ...request, externalSchemas };
  const reachableLocations = reachableRuntimeLocationIds(runtimeRequest);
  if (
    request.references.root.location !== request.references.graph.root ||
    requestNeedsResourceGraphRuntime(runtimeRequest)
  )
    return createResourceGraphRuntimeProgram({ ...runtimeRequest, reachableLocations });
  try {
    const ajv = ajvForDialect(request.dialect);
    const normalizedSchema = normalizeEmbeddedResources({
      dialect: request.dialect,
      reachableLocations,
      references: request.references,
      resourcePolicies: request.resourcePolicies,
      schema: request.schema,
    });
    const normalizedExternalSchemas = Object.fromEntries(
      Object.entries(externalSchemas).map(([uri, schema]) => {
        const resource = jsonSchemaDocumentResource(request.references.graph.resources, uri);
        return [
          uri,
          normalizeEmbeddedResources({
            dialect: request.dialect,
            reachableLocations,
            references: request.references,
            resourcePolicies: request.resourcePolicies,
            rootLocationId: resource?.location,
            schema,
          }),
        ] as const;
      }),
    );
    const documents =
      request.dialect === "draft-2020-12"
        ? instrumentExactDynamicReferences({
            externalSchemas: normalizedExternalSchemas,
            graph: request.references.graph,
            reachableLocations: [...reachableLocations],
            schema: normalizedSchema,
          })
        : { externalSchemas: normalizedExternalSchemas, schema: normalizedSchema };
    addDialectMetaSchemas(ajv, {
      dialect: request.dialect,
      externalSchemas: documents.externalSchemas,
      rootRetrievalUri: request.references.graph.location(request.references.graph.root)
        ?.retrievalUri,
    });
    addExternalSchemas(ajv, documents.externalSchemas);
    const rootRetrievalUri = request.references.graph.location(
      request.references.graph.root,
    )?.retrievalUri;
    if (rootRetrievalUri === undefined) throw new Error("Missing runtime root retrieval URI.");
    ajv.addSchema(documents.schema, rootRetrievalUri);
    const validate = ajv.getSchema(rootRetrievalUri);
    if (validate === undefined) throw new Error("Missing runtime root validator.");
    const source = standaloneCode(ajv, validate);
    const expressionSource = standaloneExpressionSource(source);
    if (!expressionSource.ok) return expressionSource;
    return ok(
      zodRuntimeProgram(
        jsonSchemaRuntimeProgramId,
        await parseGeneratedTypeScriptExpression(expressionSource.value),
      ),
    );
  } catch (error) {
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        message: `JSON Schema exact runtime compilation failed: ${
          error instanceof Error ? error.message : "Unknown validation compiler failure."
        }`,
      }),
    );
  }
};
