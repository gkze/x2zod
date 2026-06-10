import { zodDeclaration, zodPlan, zodSymbol } from "@x2zod/core";
import type {
  Diagnostic,
  JsonPointer,
  Result,
  SourceLocationMap,
  ZodDeclaration,
  ZodEmissionModuleInput,
  ZodExpression,
} from "@x2zod/core";

import { hasJsonSchemaArrayKeywords, lowerJsonSchemaArray } from "./array";
import {
  applyJsonSchemaNumberBounds,
  applyJsonSchemaStringPattern,
  hasJsonSchemaNumberBounds,
  hasJsonSchemaStringPattern,
} from "./constraints";
import { addJsonSchemaDiagnostic, resultFromJsonSchemaDiagnostics } from "./diagnostics";
import type { JsonSchemaDiagnosticInput, JsonSchemaDiagnosticSink } from "./diagnostics";
import {
  isJsonArray,
  isJsonPrimitive,
  isJsonSchemaValue,
  jsonPointerFromPath,
  jsonStringValues,
} from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue, ParsedJsonSchemaDocument } from "./document";
import { collectKeywordDiagnostics } from "./keyword-diagnostics";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaDeclarationNameHints } from "./name-hints";
import { hasJsonSchemaObjectKeywords, lowerJsonSchemaObject } from "./object";
import type { JsonSchemaInputPluginOptions } from "./options";
import { emptyPointer, jsonSchemaPointerWithSegment } from "./pointer";
import { jsonSchemaAddress, resolveJsonSchemaReference } from "./reference";
import type { JsonSchemaAddress } from "./reference";
import { hasUnsupportedSiblingAssertions } from "./sibling-assertions";

const rootSymbol = "root";

type LoweringContext = Readonly<{
  declarations: Map<JsonSchemaAddress, ZodDeclaration>;
  diagnostics: Diagnostic[];
  document: ParsedJsonSchemaDocument;
  locations?: SourceLocationMap;
  options: JsonSchemaInputPluginOptions;
  diagnosedExternalSchemas: Set<JsonSchemaAddress>;
  visiting: Set<JsonSchemaAddress>;
}>;

type LowerTypeRequest = Readonly<{
  context: LoweringContext;
  pointer: JsonPointer;
  schema: JsonObject;
  typeValuePointer: JsonPointer;
}>;

type DeclareSchemaRequest = Readonly<{
  address: JsonSchemaAddress;
  pointer: JsonPointer;
  schema: JsonSchemaValue;
}>;

const addDiagnostic = (context: LoweringContext, input: JsonSchemaDiagnosticInput): void => {
  addJsonSchemaDiagnostic(context.diagnostics, input, context.locations);
};

const diagnosticSink = (context: LoweringContext): JsonSchemaDiagnosticSink => ({
  addDiagnostic: (input): void => {
    addDiagnostic(context, input);
  },
});

const siblingAssertionContext = (
  context: LoweringContext,
): Readonly<{
  addDiagnostic: (input: JsonSchemaDiagnosticInput) => void;
  sourceProfile: JsonSchemaInputPluginOptions["sourceProfile"];
}> => ({ ...diagnosticSink(context), sourceProfile: context.options.sourceProfile });

const symbolForAddress = (address: JsonSchemaAddress): string =>
  address === emptyPointer ? rootSymbol : `schema:${address}`;

const isExternalSchemaAddress = (request: DeclareSchemaRequest): boolean =>
  request.address !== jsonSchemaAddress(request.pointer);

const collectSchemaKeywordDiagnostics = (
  request: DeclareSchemaRequest,
  context: LoweringContext,
): void => {
  if (!isExternalSchemaAddress(request)) return;
  if (context.diagnosedExternalSchemas.has(request.address)) return;

  context.diagnosedExternalSchemas.add(request.address);
  collectKeywordDiagnostics(request.schema, request.pointer, {
    ...diagnosticSink(context),
    options: context.options,
  });
};

const lowerLiteralValue = (
  value: JsonValue,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression => {
  if (isJsonPrimitive(value)) return zodPlan.literal(value);

  addDiagnostic(context, {
    code: "unrepresentable_schema_combination",
    message:
      "Only primitive const and enum values are supported in the first JSON Schema lowering slice.",
    pointer,
  });
  return zodPlan.unknown();
};

const oneOrUnion = (expressions: readonly ZodExpression[]): ZodExpression => {
  const [first, second, ...remaining] = expressions;
  if (first === undefined) return zodPlan.never();
  return second === undefined ? first : zodPlan.union([first, second, ...remaining]);
};

const lowerEnum = (
  values: JsonValue,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression => {
  if (!isJsonArray(values)) return zodPlan.unknown();

  const stringValues = jsonStringValues(values);
  const [firstStringValue, ...remainingStringValues] = stringValues;
  if (firstStringValue !== undefined && stringValues.length === values.length)
    return zodPlan.enum([firstStringValue, ...remainingStringValues]);

  const expressions = values.map((value, index) =>
    lowerLiteralValue(value, jsonSchemaPointerWithSegment(pointer, index), context),
  );
  return oneOrUnion(expressions);
};

const lowerTypeName = (typeName: string, request: LowerTypeRequest): ZodExpression => {
  const { context, pointer, schema, typeValuePointer } = request;
  switch (typeName) {
    case "array": {
      return lowerArraySchema(schema, pointer, context);
    }
    case "boolean": {
      return zodPlan.boolean();
    }
    case "integer": {
      return applyJsonSchemaNumberBounds(
        { expression: zodPlan.integer(), pointer, schema },
        diagnosticSink(context),
      );
    }
    case "null": {
      return zodPlan.null();
    }
    case "number": {
      return applyJsonSchemaNumberBounds(
        { expression: zodPlan.number(), pointer, schema },
        diagnosticSink(context),
      );
    }
    case "object": {
      return lowerObjectSchema(schema, pointer, context);
    }
    case "string": {
      return applyJsonSchemaStringPattern(
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

const lowerAnyOf = (
  values: JsonValue,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression => {
  if (!isJsonArray(values)) {
    addDiagnostic(context, {
      code: "invalid_schema_document",
      message: "JSON Schema anyOf must be an array of schemas.",
      pointer,
    });
    return zodPlan.unknown();
  }
  if (values.length === 0) {
    addDiagnostic(context, {
      code: "invalid_schema_document",
      message: "JSON Schema anyOf must contain at least one schema.",
      pointer,
    });
    return zodPlan.unknown();
  }

  const expressions: ZodExpression[] = [];
  for (const [index, schema] of values.entries()) {
    const schemaPointer = jsonSchemaPointerWithSegment(pointer, index);
    if (isJsonSchemaValue(schema)) expressions.push(lowerSchema(schemaPointer, schema, context));
    else
      addDiagnostic(context, {
        code: "invalid_schema_document",
        message: "JSON Schema anyOf entries must be boolean schemas or schema objects.",
        pointer: schemaPointer,
      });
  }

  return oneOrUnion(expressions);
};

const lowerArraySchema = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression =>
  lowerJsonSchemaArray(schema, pointer, {
    ...diagnosticSink(context),
    lowerSchema: (childPointer, childSchema) => lowerSchema(childPointer, childSchema, context),
  });

const lowerObjectSchema = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression =>
  lowerJsonSchemaObject(schema, pointer, {
    ...diagnosticSink(context),
    lowerSchema: (childPointer, childSchema) => lowerSchema(childPointer, childSchema, context),
  });

const lowerUntypedConstraintSchema = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression | undefined => {
  if (hasJsonSchemaNumberBounds(schema)) {
    addDiagnostic(context, {
      code: "unrepresentable_schema_combination",
      message:
        "JSON Schema numeric bounds without a number or integer type are not supported by this lowering slice.",
      pointer,
    });
    return zodPlan.unknown();
  }
  if (!hasJsonSchemaStringPattern(schema)) return undefined;

  applyJsonSchemaStringPattern(
    { expression: zodPlan.string(), pointer, schema },
    diagnosticSink(context),
  );
  addDiagnostic(context, {
    code: "unrepresentable_schema_combination",
    message: "JSON Schema pattern without a string type is not supported by this lowering slice.",
    pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.pattern),
  });
  return zodPlan.unknown();
};

const lowerReference = (
  ref: string,
  pointer: JsonPointer,
  context: LoweringContext,
): ZodExpression => {
  const target = resolveJsonSchemaReference(ref, context.document.schema, context.options);
  if (target === undefined) {
    addDiagnostic(context, {
      code: "unresolved_reference",
      message:
        "JSON Schema $ref target was not found. External references must be provided through plugin options.",
      pointer,
    });
    return zodPlan.unknown();
  }

  declareSchema(target, context);
  return zodPlan.reference(zodSymbol(symbolForAddress(target.address)));
};

const lowerSchema = (
  pointer: JsonPointer,
  schema: JsonSchemaValue,
  context: LoweringContext,
): ZodExpression => {
  if (schema === true) return zodPlan.unknown();
  if (schema === false) return zodPlan.never();

  const ref = schema[jsonSchemaKeywords.ref];
  if (typeof ref === "string") {
    if (
      hasUnsupportedSiblingAssertions(
        { keyword: jsonSchemaKeywords.ref, pointer, schema },
        siblingAssertionContext(context),
      )
    )
      return zodPlan.unknown();
    return lowerReference(
      ref,
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.ref),
      context,
    );
  }
  const constValue = schema[jsonSchemaKeywords.const];
  if (constValue !== undefined) {
    if (
      hasUnsupportedSiblingAssertions(
        { keyword: jsonSchemaKeywords.const, pointer, schema },
        siblingAssertionContext(context),
      )
    )
      return zodPlan.unknown();
    return lowerLiteralValue(
      constValue,
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.const),
      context,
    );
  }
  const enumValues = schema[jsonSchemaKeywords.enum];
  if (enumValues !== undefined) {
    if (
      hasUnsupportedSiblingAssertions(
        { keyword: jsonSchemaKeywords.enum, pointer, schema },
        siblingAssertionContext(context),
      )
    )
      return zodPlan.unknown();
    return lowerEnum(
      enumValues,
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.enum),
      context,
    );
  }
  const anyOfValues = schema[jsonSchemaKeywords.anyOf];
  if (anyOfValues !== undefined) {
    if (
      hasUnsupportedSiblingAssertions(
        { keyword: jsonSchemaKeywords.anyOf, pointer, schema },
        siblingAssertionContext(context),
      )
    )
      return zodPlan.unknown();
    return lowerAnyOf(
      anyOfValues,
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.anyOf),
      context,
    );
  }
  const typeValue = schema[jsonSchemaKeywords.type];
  if (isJsonArray(typeValue))
    return lowerTypeArray(typeValue, {
      context,
      pointer,
      schema,
      typeValuePointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.type),
    });
  if (typeof typeValue === "string")
    return lowerTypeName(typeValue, {
      context,
      pointer,
      schema,
      typeValuePointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.type),
    });
  if (hasJsonSchemaObjectKeywords(schema)) return lowerObjectSchema(schema, pointer, context);
  if (hasJsonSchemaArrayKeywords(schema)) return lowerArraySchema(schema, pointer, context);
  const untypedConstraint = lowerUntypedConstraintSchema(schema, pointer, context);
  if (untypedConstraint !== undefined) return untypedConstraint;

  return zodPlan.unknown();
};

const declareSchema = (request: DeclareSchemaRequest, context: LoweringContext): void => {
  const { address, pointer, schema } = request;
  if (context.declarations.has(address)) return;
  if (context.visiting.has(address)) return;

  collectSchemaKeywordDiagnostics(request, context);
  context.visiting.add(address);
  const expression = lowerSchema(pointer, schema, context);
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

export const lowerJsonSchemaDocument = (
  document: ParsedJsonSchemaDocument,
  options: JsonSchemaInputPluginOptions,
  locations?: SourceLocationMap,
): Result<ZodEmissionModuleInput> => {
  const context: LoweringContext = {
    declarations: new Map<JsonSchemaAddress, ZodDeclaration>(),
    diagnosedExternalSchemas: new Set<JsonSchemaAddress>(),
    diagnostics: [],
    document,
    options,
    visiting: new Set<JsonSchemaAddress>(),
    ...(locations === undefined ? {} : { locations }),
  };
  collectKeywordDiagnostics(document.schema, jsonPointerFromPath([]), {
    ...diagnosticSink(context),
    options,
  });
  if (context.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    return resultFromJsonSchemaDiagnostics(
      { declarations: [], root: rootSymbol },
      context.diagnostics,
    );

  declareSchema(
    {
      address: jsonSchemaAddress(emptyPointer),
      pointer: jsonPointerFromPath([]),
      schema: document.schema,
    },
    context,
  );

  return resultFromJsonSchemaDiagnostics(
    { declarations: [...context.declarations.values()], root: rootSymbol },
    context.diagnostics,
  );
};
