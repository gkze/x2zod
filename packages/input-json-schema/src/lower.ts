import { zodDeclaration, zodHelper, zodPlan, zodSymbol } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import { lowerJsonSchemaArray } from "./array";
import { lowerJsonSchemaComposition } from "./composition-lower";
import {
  applyJsonSchemaNumberConstraints,
  applyJsonSchemaStringConstraints,
  hasJsonSchemaNumberConstraints,
  hasJsonSchemaStringConstraints,
} from "./constraints";
import type { JsonSchemaDiagnosticInput } from "./diagnostics";
import { isJsonArray } from "./document";
import type { JsonObject, JsonValue } from "./document";
import { withoutConfiguredInertKeywords } from "./inert-keywords";
import { lowerJsonLiteral, lowerJsonSchemaEnum } from "./literal";
import {
  addLoweringDiagnostic as addDiagnostic,
  loweringDiagnosticSink as diagnosticSink,
} from "./lower-diagnostics";
import type {
  DeclareSchemaRequest,
  LocatedSchemaRequest,
  LowerChildSchemaRequest,
  LowerReferenceRequest,
  LowerTypeRequest,
  LoweringContext,
  JsonSchemaLocationId,
} from "./lower-types";
import { isSupportedJsonSchemaMetaSchemaResource } from "./meta-schemas";
import { jsonSchemaKeywords, jsonSchemaValidationKeywords } from "./metadata";
import { jsonSchemaDeclarationNameHints } from "./name-hints";
import { lowerJsonSchemaObject } from "./object";
import type { ResolvedJsonSchemaInputPluginOptions } from "./options";
import { emptyPointer, jsonSchemaPointerWithSegment } from "./pointer";
import type { JsonSchemaAddress, JsonSchemaReferenceResolver } from "./reference";
import { jsonSchemaUntypedAssertionKind } from "./schema-applicability";
import { lowerJsonSchemaSiblingIntersection } from "./sibling-intersection";
import { oneOrUnion } from "./zod-expressions";

const rootSymbol = "root";

type JsonSchemaDialectPolicy =
  LoweringContext["resourcePolicies"] extends ReadonlyMap<JsonSchemaLocationId, infer TPolicy>
    ? TPolicy
    : never;

const policyForLocation = (
  context: LoweringContext,
  location: JsonSchemaLocationId,
): JsonSchemaDialectPolicy =>
  context.resourcePolicies.get(location) ?? {
    applicator: true,
    dialect: context.options.dialect,
    formatAssertion: context.formatAssertionVocabulary,
    unevaluated: true,
    validation: context.validationVocabulary,
  };

const siblingAssertionContext = (
  context: LoweringContext,
  location: JsonSchemaLocationId,
): Readonly<{
  addDiagnostic: (input: JsonSchemaDiagnosticInput) => void;
  dialect: ResolvedJsonSchemaInputPluginOptions["dialect"];
  resolveReference: (ref: string) => ReturnType<JsonSchemaReferenceResolver["resolve"]>;
  sourceProfile: ResolvedJsonSchemaInputPluginOptions["sourceProfile"];
}> => ({
  ...diagnosticSink(context),
  dialect: policyForLocation(context, location).dialect,
  resolveReference: (reference): ReturnType<JsonSchemaReferenceResolver["resolve"]> =>
    context.references.resolve(reference, location),
  sourceProfile: context.options.sourceProfile,
});

export const symbolForAddress = (address: JsonSchemaAddress): string =>
  address === emptyPointer ? rootSymbol : `schema:${address}`;

const lowerTypeName = (typeName: string, request: LowerTypeRequest): ZodExpression => {
  const { context, pointer, schema, typeValuePointer } = request;
  switch (typeName) {
    case "array": {
      return lowerArraySchema(request);
    }
    case "boolean": {
      return zodPlan.boolean();
    }
    case "integer": {
      return applyJsonSchemaNumberConstraints(
        {
          expression: zodPlan.refine(zodPlan.number(), zodHelper.exactMultipleOf(1)),
          pointer,
          schema,
        },
        diagnosticSink(context),
      );
    }
    case "null": {
      return zodPlan.null();
    }
    case "number": {
      return applyJsonSchemaNumberConstraints(
        { expression: zodPlan.number(), pointer, schema },
        diagnosticSink(context),
      );
    }
    case "object": {
      return lowerObjectSchema(request);
    }
    case "string": {
      return applyJsonSchemaStringConstraints(
        { expression: zodPlan.string(), pointer, schema },
        diagnosticSink(context),
      );
    }
    default: {
      addDiagnostic(context, {
        code: "invalid_schema_document",
        message: "Unknown JSON Schema type.",
        pointer: typeValuePointer,
      });
      return zodPlan.unknown();
    }
  }
};

const typeArrayPointer = (request: LowerTypeRequest): JsonPointer =>
  jsonSchemaPointerWithSegment(request.pointer, jsonSchemaKeywords.type);

const typeArrayValuePointer = (request: LowerTypeRequest, index: number): JsonPointer =>
  jsonSchemaPointerWithSegment(typeArrayPointer(request), index);

const lowerTypeArray = (
  typeNames: readonly JsonValue[],
  request: LowerTypeRequest,
): ZodExpression => {
  if (typeNames.length === 0) {
    addDiagnostic(request.context, {
      code: "invalid_schema_document",
      message: "JSON Schema type arrays must contain at least one type.",
      pointer: typeArrayPointer(request),
    });
    return zodPlan.unknown();
  }

  const seenTypeNames = new Set<string>();
  const stringTypeNames: string[] = [];
  const expressions: ZodExpression[] = [];
  for (const [index, typeName] of typeNames.entries()) {
    const valuePointer = typeArrayValuePointer(request, index);
    if (typeof typeName !== "string")
      addDiagnostic(request.context, {
        code: "invalid_schema_document",
        message: "JSON Schema type array entries must be strings.",
        pointer: valuePointer,
      });
    else if (seenTypeNames.has(typeName))
      addDiagnostic(request.context, {
        code: "invalid_schema_document",
        message: "JSON Schema type array entries must be unique.",
        pointer: valuePointer,
      });
    else {
      seenTypeNames.add(typeName);
      stringTypeNames.push(typeName);
      expressions.push(lowerTypeName(typeName, { ...request, typeValuePointer: valuePointer }));
    }
  }

  const nullable = stringTypeNames.includes("null") && expressions.length === 2;
  if (nullable) {
    const nonNullExpression =
      expressions[stringTypeNames.findIndex((typeName) => typeName !== "null")];
    return nonNullExpression === undefined ? zodPlan.null() : zodPlan.nullable(nonNullExpression);
  }

  return oneOrUnion(expressions);
};

const childLocation = (
  pointer: JsonPointer,
  parent: JsonSchemaLocationId,
  context: LoweringContext,
): JsonSchemaLocationId => context.references.location(pointer, parent)?.id ?? parent;

const lowerChildSchema = (request: LowerChildSchemaRequest): ZodExpression =>
  lowerJsonSchema({
    ...request,
    location: childLocation(request.pointer, request.parent, request.context),
  });

const childSchemaLowerer =
  (context: LoweringContext, parent: JsonSchemaLocationId) =>
  (pointer: JsonPointer, schema: LowerChildSchemaRequest["schema"]): ZodExpression =>
    lowerChildSchema({ context, parent, pointer, schema });

const lowerArraySchema = ({
  context,
  location,
  pointer,
  schema,
}: LocatedSchemaRequest<JsonObject>): ZodExpression =>
  lowerJsonSchemaArray(schema, pointer, {
    ...diagnosticSink(context),
    dialect: policyForLocation(context, location).dialect,
    lowerSchema: childSchemaLowerer(context, location),
  });

const lowerObjectSchema = ({
  context,
  location,
  pointer,
  schema,
}: LocatedSchemaRequest<JsonObject>): ZodExpression =>
  lowerJsonSchemaObject(schema, pointer, {
    ...diagnosticSink(context),
    lowerSchema: childSchemaLowerer(context, location),
  });

const anyJsonObject = (): ZodExpression =>
  zodPlan.preserveObjectInput(zodPlan.passthrough(zodPlan.object({})), []);

const lowerUntypedTypeSpecificSchema = ({
  context,
  location,
  pointer,
  schema,
}: LocatedSchemaRequest<JsonObject>): ZodExpression | undefined => {
  const hasNumberConstraints = hasJsonSchemaNumberConstraints(schema);
  const hasStringConstraints = hasJsonSchemaStringConstraints(schema);
  const assertionKind = jsonSchemaUntypedAssertionKind(schema);
  if (!hasNumberConstraints && !hasStringConstraints && assertionKind === undefined)
    return undefined;

  return oneOrUnion([
    assertionKind === "array" || assertionKind === "mixed"
      ? lowerArraySchema({ context, location, pointer, schema })
      : zodPlan.array(zodPlan.unknown()),
    assertionKind === "object" || assertionKind === "mixed"
      ? lowerObjectSchema({ context, location, pointer, schema })
      : anyJsonObject(),
    zodPlan.boolean(),
    zodPlan.null(),
    hasNumberConstraints
      ? applyJsonSchemaNumberConstraints(
          { expression: zodPlan.number(), pointer, schema },
          diagnosticSink(context),
        )
      : zodPlan.number(),
    hasStringConstraints
      ? applyJsonSchemaStringConstraints(
          { expression: zodPlan.string(), pointer, schema },
          diagnosticSink(context),
        )
      : zodPlan.string(),
  ]);
};

const lowerReference = ({
  context,
  location,
  pointer,
  ref,
}: LowerReferenceRequest): ZodExpression => {
  const target = context.references.resolve(ref, location);
  if (target === undefined) {
    addDiagnostic(context, {
      code: "unresolved_reference",
      message: [
        "JSON Schema $ref target was not found.",
        "External references must be provided through plugin options.",
      ].join(" "),
      pointer,
    });
    return zodPlan.unknown();
  }

  const targetLocation = context.references.graph.location(target.location);
  if (
    targetLocation !== undefined &&
    isSupportedJsonSchemaMetaSchemaResource(targetLocation.resourceUri)
  )
    return zodPlan.unknown();
  declareSchema(target, context);
  return zodPlan.reference(zodSymbol(symbolForAddress(target.address)));
};

type LowerCompositionRequest = Readonly<{
  context: LoweringContext;
  dialect: ResolvedJsonSchemaInputPluginOptions["dialect"];
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const lowerComposition = ({
  context,
  dialect,
  location,
  pointer,
  schema,
}: LowerCompositionRequest): ZodExpression | undefined =>
  lowerJsonSchemaComposition(schema, pointer, {
    ...diagnosticSink(context),
    lowerSchema: childSchemaLowerer(context, location),
    resolveReference: (reference) => context.references.resolve(reference, location),
    dialect,
    sourceProfile: context.options.sourceProfile,
  });

export const lowerJsonSchema = ({
  context,
  location,
  pointer,
  schema,
}: LocatedSchemaRequest): ZodExpression => {
  if (schema === true) return zodPlan.unknown();
  if (schema === false) return zodPlan.never();

  const policy = policyForLocation(context, location);
  const semanticSchema = withoutConfiguredInertKeywords(schema, context.options.inertKeywords);
  const effectiveSchema = policy.validation
    ? semanticSchema
    : Object.fromEntries(
        Object.entries(semanticSchema).filter(([key]) => !jsonSchemaValidationKeywords.has(key)),
      );

  const withSiblingAssertions = (keyword: string, expression: ZodExpression): ZodExpression =>
    lowerJsonSchemaSiblingIntersection(
      { expression, keyword, pointer, schema: effectiveSchema },
      {
        ...siblingAssertionContext(context, location),
        lowerSchema: childSchemaLowerer(context, location),
      },
    );

  const ref = effectiveSchema[jsonSchemaKeywords.ref];
  if (typeof ref === "string") {
    const referenceExpression = lowerReference({
      context,
      location,
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.ref),
      ref,
    });
    return policy.dialect === "draft-7"
      ? referenceExpression
      : withSiblingAssertions(jsonSchemaKeywords.ref, referenceExpression);
  }
  const constValue = effectiveSchema[jsonSchemaKeywords.const];
  if (constValue !== undefined)
    return withSiblingAssertions(jsonSchemaKeywords.const, lowerJsonLiteral(constValue));
  const enumValues = effectiveSchema[jsonSchemaKeywords.enum];
  if (enumValues !== undefined)
    return withSiblingAssertions(
      jsonSchemaKeywords.enum,
      lowerJsonSchemaEnum(
        enumValues,
        jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.enum),
        diagnosticSink(context),
      ),
    );
  const compositionExpression = lowerComposition({
    context,
    dialect: policy.dialect,
    location,
    pointer,
    schema: effectiveSchema,
  });
  if (compositionExpression !== undefined) return compositionExpression;
  const typeValue = effectiveSchema[jsonSchemaKeywords.type];
  if (isJsonArray(typeValue))
    return lowerTypeArray(typeValue, {
      context,
      location,
      pointer,
      schema: effectiveSchema,
      typeValuePointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.type),
    });
  if (typeof typeValue === "string")
    return lowerTypeName(typeValue, {
      context,
      location,
      pointer,
      schema: effectiveSchema,
      typeValuePointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.type),
    });
  if (typeValue !== undefined) {
    addDiagnostic(context, {
      code: "invalid_schema_document",
      message: "JSON Schema type must be a string or an array of strings.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.type),
    });
    return zodPlan.unknown();
  }
  const untypedTypeSpecific = lowerUntypedTypeSpecificSchema({
    context,
    location,
    pointer,
    schema: effectiveSchema,
  });
  if (untypedTypeSpecific !== undefined) return untypedTypeSpecific;

  return zodPlan.unknown();
};

export const declareSchema = (request: DeclareSchemaRequest, context: LoweringContext): void => {
  const { address, location, pointer, schema } = request;
  if (context.declarations.has(address)) return;
  if (context.visiting.has(address)) return;

  context.visiting.add(address);
  const expression = lowerJsonSchema({ context, location, pointer, schema });
  context.visiting.delete(address);
  context.declarations.set(
    address,
    zodDeclaration(
      zodSymbol(symbolForAddress(address)),
      expression,
      jsonSchemaDeclarationNameHints(pointer, schema),
    ),
  );
};
