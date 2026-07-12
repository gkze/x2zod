import type { JsonPointer } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import {
  isJsonArray,
  isJsonObject,
  isJsonPrimitive,
  isJsonSchemaValue,
  jsonStringValues,
} from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import {
  jsonSchemaAnyOfAllowedSiblingKeywords,
  jsonSchemaKeywords,
  opencodeModelRef,
  opencodeSourceProfileMetadataKeywords,
} from "./metadata";
import type { JsonSchemaDialect, JsonSchemaSourceProfile } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { ResolvedJsonSchemaReference } from "./reference";

type SiblingAssertionContext = JsonSchemaDiagnosticSink &
  Readonly<{
    dialect: JsonSchemaDialect;
    resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
    sourceProfile: JsonSchemaSourceProfile;
  }>;

type ReferenceResolutionContext = Readonly<{
  resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
}>;

type SiblingAssertionRequest = Readonly<{
  keyword: string;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const integerTypeName = "integer";
const numberTypeName = "number";
const knownTypeNames: ReadonlySet<string> = new Set([
  "array",
  "boolean",
  integerTypeName,
  "null",
  numberTypeName,
  "object",
  "string",
]);
const unsafeIntersectionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.allOf,
  jsonSchemaKeywords.anyOf,
  jsonSchemaKeywords.oneOf,
  jsonSchemaKeywords.ref,
]);
const objectAssertionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.unevaluatedProperties,
]);
const arrayAssertionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.maxItems,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.prefixItems,
]);

const jsonSchemaTypeForLiteral = (value: boolean | null | number | string): string => {
  if (value === null) return "null";
  if (typeof value === "number") return numberTypeName;
  return typeof value;
};

const schemaTypeNames = (schema: JsonSchemaValue): readonly string[] => {
  if (!isJsonObject(schema)) return [];
  const type = schema[jsonSchemaKeywords.type];
  if (typeof type === "string") return knownTypeNames.has(type) ? [type] : [];
  if (!isJsonArray(type) || type.length === 0) return [];

  const types = jsonStringValues(type);
  return types.length === type.length &&
    new Set(types).size === types.length &&
    types.every((typeName) => knownTypeNames.has(typeName))
    ? types
    : [];
};

const typeAllowsNumberLiteralValue = (types: readonly string[], value: number): boolean =>
  types.includes(numberTypeName) || (Number.isInteger(value) && types.includes(integerTypeName));

const typeAllowsLiteralValue = (types: readonly string[], value: JsonValue): boolean =>
  isJsonPrimitive(value) &&
  (typeof value === "number"
    ? typeAllowsNumberLiteralValue(types, value)
    : types.includes(jsonSchemaTypeForLiteral(value)));

const isRedundantTypeForEnum = (schema: JsonObject): boolean => {
  const types = schemaTypeNames(schema);
  const values = schema[jsonSchemaKeywords.enum];
  return (
    types.length > 0 &&
    isJsonArray(values) &&
    values.every((value) => typeAllowsLiteralValue(types, value))
  );
};

const isRedundantTypeForConst = (schema: JsonObject): boolean => {
  const types = schemaTypeNames(schema);
  const value = schema[jsonSchemaKeywords.const];
  return types.length > 0 && value !== undefined && typeAllowsLiteralValue(types, value);
};

const isOpenCodeModelRefTypeSibling = (
  schema: JsonObject,
  context: SiblingAssertionContext,
): boolean =>
  context.sourceProfile === "opencode" &&
  schema[jsonSchemaKeywords.ref] === opencodeModelRef &&
  schema[jsonSchemaKeywords.type] === "string";

const typeAllowsSchemaType = (types: readonly string[], schemaType: string): boolean =>
  types.includes(schemaType) || (schemaType === integerTypeName && types.includes(numberTypeName));

const isResolvedRefTypeSiblingRedundant = (
  schema: JsonObject,
  context: SiblingAssertionContext,
): boolean => {
  if (context.dialect === "draft-7") return false;
  const ref = schema[jsonSchemaKeywords.ref];
  if (typeof ref !== "string") return false;

  const siblingTypes = schemaTypeNames(schema);
  const target = context.resolveReference(ref);
  const targetTypes = target === undefined ? [] : schemaTypeNames(target.schema);

  return (
    siblingTypes.length > 0 &&
    targetTypes.length > 0 &&
    targetTypes.every((targetType) => typeAllowsSchemaType(siblingTypes, targetType))
  );
};

const allowsTypeSibling = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean => {
  if (request.keyword === jsonSchemaKeywords.enum) return isRedundantTypeForEnum(request.schema);
  if (request.keyword === jsonSchemaKeywords.const) return isRedundantTypeForConst(request.schema);
  if (request.keyword === jsonSchemaKeywords.ref)
    return (
      isOpenCodeModelRefTypeSibling(request.schema, context) ||
      isResolvedRefTypeSiblingRedundant(request.schema, context)
    );
  return false;
};

const isMetadataSiblingKeyword = (key: string, context: SiblingAssertionContext): boolean =>
  jsonSchemaAnyOfAllowedSiblingKeywords.has(key) ||
  (context.sourceProfile === "opencode" && opencodeSourceProfileMetadataKeywords.has(key));

const isSupportedUnevaluatedPropertiesSibling = (
  key: string,
  request: SiblingAssertionRequest,
): boolean => {
  if (key !== jsonSchemaKeywords.unevaluatedProperties) return false;
  const value = request.schema[jsonSchemaKeywords.unevaluatedProperties];

  return (
    value === true ||
    (request.keyword === jsonSchemaKeywords.allOf && (value === false || isJsonObject(value)))
  );
};

const isAllowedSiblingKeyword = (
  key: string,
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean =>
  key === request.keyword ||
  isMetadataSiblingKeyword(key, context) ||
  isSupportedUnevaluatedPropertiesSibling(key, request) ||
  (allowsTypeSibling(request, context) && key === jsonSchemaKeywords.type);

const canOmitRedundantTypeSibling = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean =>
  allowsTypeSibling(request, context) &&
  Object.keys(request.schema).every(
    (key) =>
      key === request.keyword ||
      key === jsonSchemaKeywords.type ||
      isMetadataSiblingKeyword(key, context) ||
      isSupportedUnevaluatedPropertiesSibling(key, request),
  );

export const jsonSchemaSiblingAssertionSchema = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): JsonObject | undefined => {
  const omitRedundantType = canOmitRedundantTypeSibling(request, context);
  const entries = Object.entries(request.schema).filter(
    ([key]) =>
      key !== request.keyword &&
      !isMetadataSiblingKeyword(key, context) &&
      !isSupportedUnevaluatedPropertiesSibling(key, request) &&
      !(omitRedundantType && key === jsonSchemaKeywords.type),
  );

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

export const hasUnsupportedUnevaluatedPropertiesSibling = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean => {
  const value = request.schema[jsonSchemaKeywords.unevaluatedProperties];
  if (
    value === undefined ||
    value === true ||
    (request.keyword === jsonSchemaKeywords.allOf && (value === false || isJsonObject(value)))
  )
    return false;

  const mayEvaluateObjectProperties =
    request.keyword === jsonSchemaKeywords.ref ||
    request.keyword === jsonSchemaKeywords.anyOf ||
    request.keyword === jsonSchemaKeywords.oneOf;
  if (!mayEvaluateObjectProperties) return false;

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: [
      `JSON Schema ${request.keyword} with unevaluatedProperties`,
      "requires evaluated-property annotation bookkeeping that is not supported by this lowering slice.",
    ].join(" "),
    pointer: jsonSchemaPointerWithSegment(
      request.pointer,
      jsonSchemaKeywords.unevaluatedProperties,
    ),
  });
  return true;
};

class UnsafeObjectBoundaryScanner {
  private readonly arrayOnlyVisiting = new Set<string>();
  private readonly context: ReferenceResolutionContext;
  private readonly objectOnlyVisiting = new Set<string>();
  private readonly visiting = new Set<string>();

  public constructor(context: ReferenceResolutionContext) {
    this.context = context;
  }

  public scan(schema: JsonSchemaValue): boolean {
    if (!isJsonObject(schema)) return false;
    if (UnsafeObjectBoundaryScanner.hasDirectBoundary(schema)) return true;
    if (this.referenceHasBoundary(schema)) return true;
    if (this.schemaMapHasBoundary(schema[jsonSchemaKeywords.properties])) return true;

    for (const keyword of [
      jsonSchemaKeywords.allOf,
      jsonSchemaKeywords.anyOf,
      jsonSchemaKeywords.oneOf,
      jsonSchemaKeywords.prefixItems,
    ])
      if (this.schemaArrayHasBoundary(schema[keyword])) return true;

    for (const keyword of [
      jsonSchemaKeywords.items,
      jsonSchemaKeywords.not,
      jsonSchemaKeywords.propertyNames,
    ])
      if (this.childSchemaHasBoundary(schema[keyword])) return true;

    return false;
  }

  public provesObjectOnly(schema: JsonSchemaValue): boolean {
    if (!isJsonObject(schema)) return false;
    const types = schemaTypeNames(schema);
    if (types.length === 1 && types[0] === "object") return true;
    if (this.referenceProvesObjectOnly(schema)) return true;

    const allOf = schema[jsonSchemaKeywords.allOf];
    if (
      isJsonArray(allOf) &&
      allOf.some((branch) => isJsonSchemaValue(branch) && this.provesObjectOnly(branch))
    )
      return true;

    for (const keyword of [jsonSchemaKeywords.anyOf, jsonSchemaKeywords.oneOf]) {
      const branches = schema[keyword];
      if (
        isJsonArray(branches) &&
        branches.length > 0 &&
        branches.every((branch) => isJsonSchemaValue(branch) && this.provesObjectOnly(branch))
      )
        return true;
    }

    return false;
  }

  public provesArrayOnly(schema: JsonSchemaValue): boolean {
    if (!isJsonObject(schema)) return false;
    const types = schemaTypeNames(schema);
    if (types.length === 1 && types[0] === "array") return true;
    if (this.referenceProvesArrayOnly(schema)) return true;

    const allOf = schema[jsonSchemaKeywords.allOf];
    if (
      isJsonArray(allOf) &&
      allOf.some((branch) => isJsonSchemaValue(branch) && this.provesArrayOnly(branch))
    )
      return true;

    for (const keyword of [jsonSchemaKeywords.anyOf, jsonSchemaKeywords.oneOf]) {
      const branches = schema[keyword];
      if (
        isJsonArray(branches) &&
        branches.length > 0 &&
        branches.every((branch) => isJsonSchemaValue(branch) && this.provesArrayOnly(branch))
      )
        return true;
    }

    return false;
  }

  private childSchemaHasBoundary(value: JsonValue | undefined): boolean {
    return isJsonSchemaValue(value) && this.scan(value);
  }

  private static hasDirectBoundary(schema: JsonObject): boolean {
    const additionalProperties = schema[jsonSchemaKeywords.additionalProperties];
    const unevaluatedProperties = schema[jsonSchemaKeywords.unevaluatedProperties];

    return (
      additionalProperties === false ||
      isJsonObject(additionalProperties) ||
      unevaluatedProperties === false ||
      isJsonObject(unevaluatedProperties)
    );
  }

  private referenceHasBoundary(schema: JsonObject): boolean {
    const ref = schema[jsonSchemaKeywords.ref];
    if (typeof ref !== "string") return false;

    const target = this.context.resolveReference(ref);
    if (target === undefined || this.visiting.has(target.address)) return false;
    this.visiting.add(target.address);
    const unsafe = this.scan(target.schema);
    this.visiting.delete(target.address);
    return unsafe;
  }

  private referenceProvesObjectOnly(schema: JsonObject): boolean {
    const ref = schema[jsonSchemaKeywords.ref];
    if (typeof ref !== "string") return false;

    const target = this.context.resolveReference(ref);
    if (target === undefined || this.objectOnlyVisiting.has(target.address)) return false;
    this.objectOnlyVisiting.add(target.address);
    const proves = this.provesObjectOnly(target.schema);
    this.objectOnlyVisiting.delete(target.address);
    return proves;
  }

  private referenceProvesArrayOnly(schema: JsonObject): boolean {
    const ref = schema[jsonSchemaKeywords.ref];
    if (typeof ref !== "string") return false;

    const target = this.context.resolveReference(ref);
    if (target === undefined || this.arrayOnlyVisiting.has(target.address)) return false;
    this.arrayOnlyVisiting.add(target.address);
    const proves = this.provesArrayOnly(target.schema);
    this.arrayOnlyVisiting.delete(target.address);
    return proves;
  }

  private schemaArrayHasBoundary(value: JsonValue | undefined): boolean {
    return (
      isJsonArray(value) && value.some((schema) => isJsonSchemaValue(schema) && this.scan(schema))
    );
  }

  private schemaMapHasBoundary(value: JsonValue | undefined): boolean {
    return (
      isJsonObject(value) &&
      Object.values(value).some((schema) => isJsonSchemaValue(schema) && this.scan(schema))
    );
  }
}

export const jsonSchemaHasUnsafeObjectBoundary = (
  schema: JsonSchemaValue,
  resolveReference: ReferenceResolutionContext["resolveReference"],
): boolean => new UnsafeObjectBoundaryScanner({ resolveReference }).scan(schema);

export const hasUnsupportedUntypedObjectSiblingIntersection = (
  request: SiblingAssertionRequest,
  siblingSchema: JsonObject,
  context: SiblingAssertionContext,
): boolean => {
  const hasUntypedObjectAssertions =
    siblingSchema[jsonSchemaKeywords.type] === undefined &&
    Object.keys(siblingSchema).some((keyword) => objectAssertionKeywords.has(keyword));
  if (
    !hasUntypedObjectAssertions ||
    new UnsafeObjectBoundaryScanner(context).provesObjectOnly(request.schema)
  )
    return false;

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: [
      `JSON Schema ${request.keyword} has untyped object sibling assertions`,
      "whose non-object applicability cannot be preserved by object-only Zod lowering.",
    ].join(" "),
    pointer: jsonSchemaPointerWithSegment(request.pointer, request.keyword),
  });
  return true;
};

export const hasUnsupportedUntypedArraySiblingIntersection = (
  request: SiblingAssertionRequest,
  siblingSchema: JsonObject,
  context: SiblingAssertionContext,
): boolean => {
  const hasUntypedArrayAssertions =
    siblingSchema[jsonSchemaKeywords.type] === undefined &&
    Object.keys(siblingSchema).some((keyword) => arrayAssertionKeywords.has(keyword));
  if (
    !hasUntypedArrayAssertions ||
    new UnsafeObjectBoundaryScanner(context).provesArrayOnly(request.schema)
  )
    return false;

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: [
      `JSON Schema ${request.keyword} has untyped array sibling assertions`,
      "whose non-array applicability cannot be preserved by array-only Zod lowering.",
    ].join(" "),
    pointer: jsonSchemaPointerWithSegment(request.pointer, request.keyword),
  });
  return true;
};

export const hasUnsupportedObjectSiblingIntersection = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean => {
  if (
    !unsafeIntersectionKeywords.has(request.keyword) ||
    !jsonSchemaHasUnsafeObjectBoundary(request.schema, context.resolveReference)
  )
    return false;

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: [
      `JSON Schema ${request.keyword} sibling assertions include closed or schema-valued object boundaries`,
      "that cannot be preserved by a plain Zod intersection.",
    ].join(" "),
    pointer: jsonSchemaPointerWithSegment(request.pointer, request.keyword),
  });
  return true;
};

export const hasUnsupportedSiblingAssertions = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean => {
  const { keyword, pointer, schema } = request;
  if (Object.keys(schema).every((key) => isAllowedSiblingKeyword(key, request, context)))
    return false;

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: `JSON Schema ${keyword} with sibling assertion keywords is not supported by this lowering slice.`,
    pointer: jsonSchemaPointerWithSegment(pointer, keyword),
  });
  return true;
};
