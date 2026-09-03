import { _, getProperty, Name, nil, stringify } from "ajv/dist/compile/codegen/index.js";
import type { Code } from "ajv/dist/compile/codegen/index.js";
import { resolveRef, SchemaEnv } from "ajv/dist/compile/index.js";
import type { KeywordCxt } from "ajv/dist/compile/validate/index.js";
import type AjvCore from "ajv/dist/core.js";
import type { AnySchema, CodeKeywordDefinition } from "ajv/dist/types/index.js";
import { callRef, getValidate } from "ajv/dist/vocabularies/core/ref.js";

import {
  ajvDynamicAnchors as dynamicAnchorsName,
  callAjvReferenceValidation as callValidation,
  ownAjvDynamicAnchorTarget as ownDynamicAnchorTarget,
} from "./ajv-reference-codegen";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { isJsonArray, isJsonObject, jsonPointerFromPath } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaInputPluginOptions } from "./options";
import { jsonSchemaPointerReference } from "./pointer-reference";
import { jsonSchemaLocationId } from "./resource-graph";
import type { JsonSchemaLocationId, JsonSchemaResourceGraph } from "./resource-graph";
import { decodeJsonSchemaPlainNameFragment } from "./retrieval-uri";
import { compareCodeUnits } from "./string-order";

type StaticReferenceTarget =
  | Readonly<{ environment: SchemaEnv; kind: "environment"; validate: Code }>
  | Readonly<{ kind: "inline"; schema: AnySchema }>;
type ExactDynamicReference = Readonly<{
  anchor?: string | undefined;
  documentPointer?: boolean | undefined;
  reference: string;
}>;

const dynamicScopeEnterKeyword = "x2zodDynamicScopeEnter";
const dynamicScopeExitKeyword = "x2zodDynamicScopeExit";

const isDynamicScopeObject = (schema: unknown): schema is JsonObject =>
  typeof schema === "object" && schema !== null && !Array.isArray(schema);

type DynamicScope = Readonly<{
  anchors: readonly (readonly [anchor: string, reference: string])[];
  id: number;
}>;
type ExactDynamicReferenceDocuments = Readonly<{
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  schema: JsonSchemaValue;
}>;

const referenceResource = (reference: string): string => {
  const missingIndex = -1;
  const hashIndex = reference.lastIndexOf("#");
  return hashIndex === missingIndex ? reference : reference.slice(0, hashIndex);
};

const rootAnchorTarget = (context: KeywordCxt, reference: string): SchemaEnv | undefined => {
  const anchor = decodeJsonSchemaPlainNameFragment(reference);
  if (anchor === undefined) return undefined;
  const { baseId, schemaEnv, self } = context.it;
  const target = resolveRef.call(self, schemaEnv.root, baseId, referenceResource(reference));
  if (!(target instanceof SchemaEnv) || !isJsonObject(target.schema)) return undefined;
  return target.schema[jsonSchemaKeywords.anchor] === anchor ||
    target.schema[jsonSchemaKeywords.dynamicAnchor] === anchor
    ? target
    : undefined;
};

const staticReferenceTarget = (
  context: KeywordCxt,
  reference: string,
  documentPointer = false,
): StaticReferenceTarget => {
  const { baseId, schemaEnv, self } = context.it;
  const referenceBaseId = documentPointer ? schemaEnv.root.baseId : baseId;
  const target =
    resolveRef.call(self, schemaEnv.root, referenceBaseId, reference) ??
    rootAnchorTarget(context, reference);
  if (target === undefined)
    throw new Error(`Cannot resolve exact dynamic reference ${JSON.stringify(reference)}.`);
  return target instanceof SchemaEnv
    ? { environment: target, kind: "environment", validate: getValidate(context, target) }
    : { kind: "inline", schema: target };
};

const targetDefinesDynamicAnchor = (
  target: SchemaEnv,
  anchor: string | undefined,
): anchor is string =>
  anchor !== undefined &&
  isJsonObject(target.schema) &&
  target.schema[jsonSchemaKeywords.dynamicAnchor] === anchor;

const compileInlineReference = (
  context: KeywordCxt,
  schema: AnySchema,
  reference: string,
): void => {
  const { gen, it } = context;
  const schemaName = gen.scopeValue(
    "schema",
    it.opts.code.source === true ? { code: stringify(schema), ref: schema } : { ref: schema },
  );
  const valid = gen.name("valid");
  const schemaContext = context.subschema(
    { dataTypes: [], errSchemaPath: reference, schema, schemaPath: nil, topSchemaRef: schemaName },
    valid,
  );
  context.mergeEvaluated(schemaContext);
  context.ok(valid);
};

const compileExactDynamicReference = (
  context: KeywordCxt,
  request: ExactDynamicReference,
): void => {
  const { documentPointer, reference } = request;
  const anchor = request.anchor ?? decodeJsonSchemaPlainNameFragment(reference);
  const { gen, it } = context;
  const target = staticReferenceTarget(context, reference, documentPointer);
  const dynamic =
    target.kind === "environment" && targetDefinesDynamicAnchor(target.environment, anchor);

  if (!dynamic) {
    if (target.kind === "environment")
      callRef(context, target.validate, target.environment, target.environment.$async);
    else compileInlineReference(context, target.schema, reference);
    return;
  }

  const runtimeTarget = gen.let("_v", ownDynamicAnchorTarget(anchor));
  if (it.allErrors === true)
    gen.if(
      runtimeTarget,
      callValidation(context, { validate: runtimeTarget }),
      callValidation(context, { validate: target.validate, target: target.environment }),
    );
  else {
    const valid = gen.let("valid", false);
    gen.if(
      runtimeTarget,
      callValidation(context, { validate: runtimeTarget, valid }),
      callValidation(context, { target: target.environment, valid, validate: target.validate }),
    );
    context.ok(valid);
  }
};

const readExactDynamicReference = (schema: unknown): ExactDynamicReference => {
  if (typeof schema === "string") return { reference: schema };
  if (!isDynamicScopeObject(schema) || typeof schema["reference"] !== "string")
    throw new Error("Invalid dynamic reference.");
  const { anchor, documentPointer, reference } = schema;
  if (anchor !== undefined && typeof anchor !== "string")
    throw new Error("Invalid dynamic reference anchor.");
  if (documentPointer !== undefined && typeof documentPointer !== "boolean")
    throw new Error("Invalid dynamic reference document pointer marker.");
  return {
    ...(anchor === undefined ? {} : { anchor }),
    ...(documentPointer === undefined ? {} : { documentPointer }),
    reference,
  };
};

const scopeVariable = (scope: DynamicScope): Name =>
  new Name(`x2zodDynamicAnchors${scope.id.toString()}`);

const compileDynamicScopeEnter = (context: KeywordCxt, scope: DynamicScope): void => {
  const { gen } = context;
  gen.const(scopeVariable(scope), dynamicAnchorsName);
  gen.assign(dynamicAnchorsName, _`Object.assign(Object.create(null), ${dynamicAnchorsName})`);
  for (const [anchor, reference] of scope.anchors) {
    const target = staticReferenceTarget(context, reference, true);
    if (target.kind !== "environment")
      throw new Error(`Dynamic anchor ${JSON.stringify(anchor)} did not resolve to a schema.`);
    const runtimeTarget = ownDynamicAnchorTarget(anchor);
    gen.if(_`!${runtimeTarget}`, () => {
      gen.assign(_`${dynamicAnchorsName}${getProperty(anchor)}`, target.validate);
    });
  }
};

const compileDynamicScopeExit = (context: KeywordCxt, scope: DynamicScope): void => {
  context.gen.assign(dynamicAnchorsName, scopeVariable(scope));
};

const readDynamicScope = (schema: unknown): DynamicScope => {
  if (!isDynamicScopeObject(schema)) throw new Error("Invalid dynamic scope.");
  const { anchors, id } = schema;
  if (!isJsonArray(anchors) || typeof id !== "number") throw new Error("Invalid dynamic scope.");
  const entries: (readonly [string, string])[] = [];
  for (const entry of anchors)
    if (
      isJsonArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    )
      entries.push([entry[0], entry[1]]);
    else throw new Error("Invalid dynamic scope anchor.");
  return { anchors: entries, id };
};

const exactDynamicReferenceDefinition: CodeKeywordDefinition = {
  code: (context): void => {
    compileExactDynamicReference(context, readExactDynamicReference(context.schema));
  },
  keyword: jsonSchemaKeywords.dynamicRef,
  schemaType: ["object", "string"],
};

const dynamicScopeEnterDefinition: CodeKeywordDefinition = {
  before: jsonSchemaKeywords.dynamicAnchor,
  code: (context): void => {
    compileDynamicScopeEnter(context, readDynamicScope(context.schema));
  },
  keyword: dynamicScopeEnterKeyword,
  schemaType: "object",
};

const dynamicScopeExitDefinition: CodeKeywordDefinition = {
  code: (context): void => {
    compileDynamicScopeExit(context, readDynamicScope(context.schema));
  },
  keyword: dynamicScopeExitKeyword,
  post: true,
  schemaType: "object",
};

const dynamicAnchorsByResource = (
  graph: JsonSchemaResourceGraph,
  reachable: ReadonlySet<JsonSchemaLocationId>,
): ReadonlyMap<string, readonly (readonly [string, string])[]> => {
  const anchors = new Map<string, Map<string, string>>();
  for (const location of graph.locations)
    if (reachable.has(location.id) && isJsonObject(location.schema)) {
      const anchor = location.schema[jsonSchemaKeywords.dynamicAnchor];
      if (typeof anchor === "string") {
        const resourceAnchors = anchors.get(location.resourceUri) ?? new Map<string, string>();
        const reference = jsonSchemaPointerReference({
          local: true,
          pointer: location.pointer,
          retrievalUri: location.retrievalUri,
          rootPointer: jsonPointerFromPath([]),
        });
        resourceAnchors.set(anchor, reference);
        anchors.set(location.resourceUri, resourceAnchors);
      }
    }
  return new Map(
    [...anchors.entries()].map(([resourceUri, resourceAnchors]) => [
      resourceUri,
      [...resourceAnchors.entries()].toSorted(([left], [right]) => compareCodeUnits(left, right)),
    ]),
  );
};

const addScopeEntries = ({
  entries,
  graph,
  location,
}: Readonly<{
  entries: Set<JsonSchemaLocationId>;
  graph: JsonSchemaResourceGraph;
  location: JsonSchemaResourceGraph["locations"][number];
}>): void => {
  if (!isJsonObject(location.schema)) return;
  for (const keyword of [jsonSchemaKeywords.ref, jsonSchemaKeywords.dynamicRef]) {
    const reference = location.schema[keyword];
    if (typeof reference === "string") {
      const target = graph.resolve({ from: location.id, reference });
      if (target !== undefined) entries.add(target.location.id);
    }
  }
};

const scopeEntryLocations = (
  graph: JsonSchemaResourceGraph,
  reachable: ReadonlySet<JsonSchemaLocationId>,
): ReadonlySet<JsonSchemaLocationId> => {
  const entries = new Set<JsonSchemaLocationId>([
    graph.root,
    ...graph.resources
      .map((resource) => resource.location)
      .filter((location) => reachable.has(location)),
  ]);
  for (const location of graph.locations)
    if (reachable.has(location.id)) addScopeEntries({ entries, graph, location });
  return entries;
};

const scopesByLocation = (
  graph: JsonSchemaResourceGraph,
  reachableLocations: readonly JsonSchemaLocationId[] = graph.reachableLocations,
): ReadonlyMap<JsonSchemaLocationId, DynamicScope> => {
  const reachable = new Set(reachableLocations);
  const anchors = dynamicAnchorsByResource(graph, reachable);
  const scopes = new Map<JsonSchemaLocationId, DynamicScope>();
  let id = 0;
  for (const locationId of [...scopeEntryLocations(graph, reachable)].toSorted()) {
    const location = graph.location(locationId);
    if (location !== undefined && isJsonObject(location.schema)) {
      const resourceAnchors = anchors.get(location.resourceUri);
      if (resourceAnchors !== undefined && resourceAnchors.length > 0) {
        scopes.set(locationId, { anchors: resourceAnchors, id });
        id += 1;
      }
    }
  }
  return scopes;
};

type InstrumentJsonValueRequest = Readonly<{
  pointer: string;
  retrievalUri: string;
  scopes: ReadonlyMap<JsonSchemaLocationId, DynamicScope>;
  value: JsonValue;
}>;

const instrumentJsonValue = ({
  pointer,
  retrievalUri,
  scopes,
  value,
}: InstrumentJsonValueRequest): JsonValue => {
  if (isJsonArray(value))
    return value.map((item, index) =>
      instrumentJsonValue({ pointer: `${pointer}/${index}`, retrievalUri, scopes, value: item }),
    );
  if (!isJsonObject(value)) return value;
  const entries = Object.entries(value).map(([key, child]): readonly [string, JsonValue] => [
    key,
    instrumentJsonValue({
      pointer: `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      retrievalUri,
      scopes,
      value: child,
    }),
  ]);
  const scope = scopes.get(jsonSchemaLocationId(retrievalUri, pointer));
  return Object.fromEntries(
    scope === undefined
      ? entries
      : [...entries, [dynamicScopeEnterKeyword, scope], [dynamicScopeExitKeyword, scope]],
  );
};

const instrumentJsonSchemaValue = (
  value: JsonSchemaValue,
  scopes: ReadonlyMap<JsonSchemaLocationId, DynamicScope>,
  retrievalUri: string,
): JsonSchemaValue => {
  if (typeof value === "boolean") return value;
  const instrumented = instrumentJsonValue({ pointer: "", retrievalUri, scopes, value });
  if (!isJsonObject(instrumented)) throw new Error("Instrumented schema is not an object.");
  return instrumented;
};

export const instrumentExactDynamicReferences = ({
  externalSchemas,
  graph,
  reachableLocations,
  schema,
}: Readonly<{
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  graph: JsonSchemaResourceGraph;
  reachableLocations?: readonly JsonSchemaLocationId[];
  schema: JsonSchemaValue;
}>): ExactDynamicReferenceDocuments => {
  const scopes = scopesByLocation(graph, reachableLocations);
  const rootRetrievalUri = graph.location(graph.root)?.retrievalUri ?? "";
  return {
    externalSchemas: Object.fromEntries(
      Object.entries(externalSchemas).map(([uri, externalSchema]) => [
        uri,
        instrumentJsonSchemaValue(externalSchema, scopes, uri),
      ]),
    ),
    schema: instrumentJsonSchemaValue(schema, scopes, rootRetrievalUri),
  };
};

export const installExactDynamicReference = (ajv: AjvCore): void => {
  ajv.addKeyword(dynamicScopeEnterDefinition);
  ajv.addKeyword(dynamicScopeExitDefinition);
  ajv.removeKeyword(jsonSchemaKeywords.dynamicRef);
  ajv.addKeyword(exactDynamicReferenceDefinition);
};
