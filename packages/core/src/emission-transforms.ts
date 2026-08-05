import { createDiagnostic } from "./diagnostics";
import type { ZodEmissionTransform, ZodPropertyKeyCase } from "./emission-transform-config";
import { err, ok } from "./result";
import type { Result } from "./result";
import type {
  SourceArgument,
  SourceCodecExpression,
  SourceCodecOperation,
  SourceDeclaration,
  SourceEmissionModule,
  SourceExpression,
  SourceFactoryExpression,
  SourceMethodCall,
  SourceObjectProperty,
  SourcePropertyKeyMapping,
  SourceReferenceExpression,
} from "./source-model";
import type {
  ZodArgument,
  ZodDeclaration,
  ZodEmissionModule,
  ZodExpression,
  ZodLiteralValue,
  ZodMethodCall,
  ZodSymbol,
} from "./zod-plan";
import { zodMethodMetadataFor } from "./zod-plan-metadata";
import type { ZodFactoryName } from "./zod-plan-metadata";

type ExpressionProjection = Readonly<{
  changed: boolean;
  decodedSchema: SourceExpression;
  schema: SourceExpression;
}>;
type ArgumentProjection = Readonly<{
  changed: boolean;
  decodedArgument: SourceArgument;
  schemaArgument: SourceArgument;
}>;
type CallsProjection = Readonly<{
  changed: boolean;
  decodedCalls: readonly SourceMethodCall[];
  schemaCalls: readonly SourceMethodCall[];
}>;
type DeclarationProjection = ExpressionProjection;
type ProjectionContext = Readonly<{
  declarations: ReadonlyMap<ZodSymbol, ZodDeclaration>;
  declarationProjections: Map<ZodSymbol, DeclarationProjection>;
  decodedKey: (key: string) => string;
  projectExpression: (
    expression: ZodExpression,
    context: ProjectionContext,
  ) => Result<ExpressionProjection>;
}>;

type SourceCodecInput = Readonly<{
  calls?: readonly SourceMethodCall[] | undefined;
  input: SourceExpression;
  operation: SourceCodecOperation;
  output: SourceExpression;
}>;

const notFoundIndex = -1;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod transform node: ${JSON.stringify(value)}`);
};

const camelCasePropertyKey = (key: string): string => {
  const [head = "", ...tail] = key.split("_");
  return `${head}${tail
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join("")}`;
};

const propertyKeyCaseProjectors: Record<ZodPropertyKeyCase, (key: string) => string> = {
  camelCase: camelCasePropertyKey,
};

const decodedKeyFunction =
  (transforms: readonly ZodEmissionTransform[]): ((key: string) => string) =>
  (key) => {
    let decodedKey = key;
    for (const transform of transforms)
      decodedKey = propertyKeyCaseProjectors[transform.options.keys.decodedCase](decodedKey);
    return decodedKey;
  };

const sourceLiteralArgument = (value: ZodLiteralValue): SourceArgument => ({
  kind: "literal",
  value,
});

const sourceFactory = (
  factory: ZodFactoryName,
  args: readonly SourceArgument[],
  calls: readonly SourceMethodCall[],
): SourceFactoryExpression => ({ args, calls, factory, kind: "factory" });

const sourceReference = (
  symbol: ZodSymbol,
  outputView: boolean,
  calls: readonly SourceMethodCall[],
): SourceReferenceExpression => ({ calls, kind: "reference", outputView, symbol });

const sourceCodec = ({
  calls = [],
  input,
  operation,
  output,
}: SourceCodecInput): SourceCodecExpression => ({ calls, input, kind: "codec", operation, output });

const appendCalls = (
  expression: SourceExpression,
  calls: readonly SourceMethodCall[],
): SourceExpression => ({ ...expression, calls: [...expression.calls, ...calls] });

const unsupportedTransformComposition = (factory: string): Result<never> =>
  err(
    createDiagnostic({
      code: "unsupported_emission_transform",
      message: `Property-key transforms cannot yet preserve bidirectional ${factory} composition.`,
    }),
  );

const transformedReferenceCall = (call: ZodMethodCall): boolean =>
  zodMethodMetadataFor(call.method)?.wrapsReceiver !== true;

const projectArgument = (
  argument: ZodArgument,
  context: ProjectionContext,
  mapStringLiterals = false,
): Result<ArgumentProjection> => {
  switch (argument.kind) {
    case "array": {
      const projections: ArgumentProjection[] = [];
      for (const element of argument.elements) {
        const projection = projectArgument(element, context, mapStringLiterals);
        if (!projection.ok) return projection;
        projections.push(projection.value);
      }
      return ok({
        changed: projections.some((projection) => projection.changed),
        decodedArgument: {
          elements: projections.map((projection) => projection.decodedArgument),
          kind: "array",
        },
        schemaArgument: {
          elements: projections.map((projection) => projection.schemaArgument),
          kind: "array",
        },
      });
    }
    case "expression": {
      const projection = context.projectExpression(argument.expression, context);
      return projection.ok
        ? ok({
            changed: projection.value.changed,
            decodedArgument: { expression: projection.value.decodedSchema, kind: "expression" },
            schemaArgument: { expression: projection.value.schema, kind: "expression" },
          })
        : projection;
    }
    case "literal": {
      const decodedValue =
        mapStringLiterals && typeof argument.value === "string"
          ? context.decodedKey(argument.value)
          : argument.value;
      return ok({
        changed: decodedValue !== argument.value,
        decodedArgument: sourceLiteralArgument(decodedValue),
        schemaArgument: sourceLiteralArgument(argument.value),
      });
    }
    case "object": {
      const projections: {
        decoded: SourceObjectProperty;
        schema: SourceObjectProperty;
        changed: boolean;
      }[] = [];
      for (const property of argument.properties) {
        const projection = context.projectExpression(property.expression, context);
        if (!projection.ok) return projection;
        projections.push({
          changed: projection.value.changed,
          decoded: { expression: projection.value.decodedSchema, key: property.key },
          schema: { expression: projection.value.schema, key: property.key },
        });
      }
      return ok({
        changed: projections.some((projection) => projection.changed),
        decodedArgument: {
          kind: "object",
          properties: projections.map((projection) => projection.decoded),
        },
        schemaArgument: {
          kind: "object",
          properties: projections.map((projection) => projection.schema),
        },
      });
    }
    default: {
      return assertNever(argument);
    }
  }
};

const projectCalls = (
  calls: readonly ZodMethodCall[],
  context: ProjectionContext,
  mapRequiredKeys = false,
): Result<CallsProjection> => {
  const schemaCalls: SourceMethodCall[] = [];
  const decodedCalls: SourceMethodCall[] = [];
  let changed = false;

  for (const call of calls) {
    const schemaArgs: SourceArgument[] = [];
    const decodedArgs: SourceArgument[] = [];
    const mapStringLiterals =
      mapRequiredKeys && zodMethodMetadataFor(call.method)?.printArgument === "requiredKeys";
    for (const argument of call.args) {
      const projection = projectArgument(argument, context, mapStringLiterals);
      if (!projection.ok) return projection;
      changed ||= projection.value.changed;
      schemaArgs.push(projection.value.schemaArgument);
      decodedArgs.push(projection.value.decodedArgument);
    }
    schemaCalls.push({ args: schemaArgs, method: call.method });
    decodedCalls.push({ args: decodedArgs, method: call.method });
  }

  return ok({ changed, decodedCalls, schemaCalls });
};

const propertyKeyCollision = (
  encodedKeys: readonly string[],
  decodedKey: (key: string) => string,
): Result<readonly SourcePropertyKeyMapping[]> => {
  const encodedByDecoded = new Map<string, string>();
  const mappings: SourcePropertyKeyMapping[] = [];

  for (const encodedKey of encodedKeys) {
    const projectedKey = decodedKey(encodedKey);
    const previous = encodedByDecoded.get(projectedKey);
    if (previous !== undefined && previous !== encodedKey)
      return err(
        createDiagnostic({
          code: "emission_transform_key_collision",
          message: [
            `Property-key transform maps both ${JSON.stringify(previous)}`,
            `and ${JSON.stringify(encodedKey)} to ${JSON.stringify(projectedKey)}.`,
          ].join(" "),
        }),
      );
    encodedByDecoded.set(projectedKey, encodedKey);
    if (projectedKey !== encodedKey) mappings.push({ decodedKey: projectedKey, encodedKey });
  }

  return ok(mappings);
};

const projectObjectExpression = (
  expression: Extract<ZodExpression, { kind: "factory" }>,
  context: ProjectionContext,
): Result<ExpressionProjection> => {
  const [shape] = expression.args;
  if (shape?.kind !== "object") return unsupportedTransformComposition("object");

  const mappings = propertyKeyCollision(
    shape.properties.map((property) => property.key),
    context.decodedKey,
  );
  if (!mappings.ok) return mappings;

  const schemaProperties: SourceObjectProperty[] = [];
  const decodedProperties: SourceObjectProperty[] = [];
  let childChanged = false;
  for (const property of shape.properties) {
    const projection = context.projectExpression(property.expression, context);
    if (!projection.ok) return projection;
    childChanged ||= projection.value.changed;
    schemaProperties.push({ expression: projection.value.schema, key: property.key });
    decodedProperties.push({
      expression: projection.value.decodedSchema,
      key: context.decodedKey(property.key),
    });
  }

  const firstWrappingCall = expression.calls.findIndex(
    (call) => zodMethodMetadataFor(call.method)?.wrapsReceiver === true,
  );
  const objectCalls =
    firstWrappingCall === notFoundIndex
      ? expression.calls
      : expression.calls.slice(0, firstWrappingCall);
  const wrappingCalls =
    firstWrappingCall === notFoundIndex ? [] : expression.calls.slice(firstWrappingCall);
  const projectedObjectCalls = projectCalls(objectCalls, context, true);
  if (!projectedObjectCalls.ok) return projectedObjectCalls;
  const projectedWrappingCalls = projectCalls(wrappingCalls, context);
  if (!projectedWrappingCalls.ok) return projectedWrappingCalls;

  const schemaObject = sourceFactory(
    "object",
    [{ kind: "object", properties: schemaProperties }],
    projectedObjectCalls.value.schemaCalls,
  );
  const decodedObject = sourceFactory(
    "object",
    [{ kind: "object", properties: decodedProperties }],
    projectedObjectCalls.value.decodedCalls,
  );
  const decodedSchema = appendCalls(decodedObject, projectedWrappingCalls.value.decodedCalls);
  const ownKeysChanged = mappings.value.length > 0;
  const changed =
    ownKeysChanged ||
    childChanged ||
    projectedObjectCalls.value.changed ||
    projectedWrappingCalls.value.changed;

  return ownKeysChanged
    ? ok({
        changed,
        decodedSchema,
        schema: sourceCodec({
          calls: projectedWrappingCalls.value.schemaCalls,
          input: schemaObject,
          operation: { kind: "map-properties", mappings: mappings.value },
          output: decodedObject,
        }),
      })
    : ok({
        changed,
        decodedSchema,
        schema: appendCalls(schemaObject, projectedWrappingCalls.value.schemaCalls),
      });
};

const projectFactoryExpression = (
  expression: Extract<ZodExpression, { kind: "factory" }>,
  context: ProjectionContext,
): Result<ExpressionProjection> => {
  if (expression.factory === "object") return projectObjectExpression(expression, context);

  const schemaArgs: SourceArgument[] = [];
  const decodedArgs: SourceArgument[] = [];
  let changed = false;
  for (const argument of expression.args) {
    const projection = projectArgument(argument, context);
    if (!projection.ok) return projection;
    changed ||= projection.value.changed;
    schemaArgs.push(projection.value.schemaArgument);
    decodedArgs.push(projection.value.decodedArgument);
  }
  const calls = projectCalls(expression.calls, context);
  if (!calls.ok) return calls;
  changed ||= calls.value.changed;

  if (
    changed &&
    (expression.factory === "intersection" ||
      expression.factory === "union" ||
      expression.factory === "xor")
  )
    return unsupportedTransformComposition(expression.factory);

  return ok({
    changed,
    decodedSchema: sourceFactory(expression.factory, decodedArgs, calls.value.decodedCalls),
    schema: sourceFactory(expression.factory, schemaArgs, calls.value.schemaCalls),
  });
};

const projectDeclaration = (
  symbol: ZodSymbol,
  context: ProjectionContext,
): Result<DeclarationProjection> => {
  const cached = context.declarationProjections.get(symbol);
  if (cached !== undefined) return ok(cached);

  const declaration = context.declarations.get(symbol);
  if (declaration === undefined)
    return err(
      createDiagnostic({
        code: "unresolved_reference",
        message: `Zod emission transform references an undeclared symbol: ${symbol}`,
      }),
    );

  const projection = context.projectExpression(declaration.expression, context);
  if (!projection.ok) return projection;
  const reusableSchema =
    projection.value.changed &&
    !(projection.value.schema.kind === "codec" && projection.value.schema.calls.length === 0)
      ? sourceCodec({
          input: projection.value.schema,
          operation: { kind: "identity" },
          output: projection.value.decodedSchema,
        })
      : projection.value.schema;
  const reusableProjection = { ...projection.value, schema: reusableSchema };
  context.declarationProjections.set(symbol, reusableProjection);
  return ok(reusableProjection);
};

const projectReferenceExpression = (
  expression: Extract<ZodExpression, { kind: "reference" }>,
  context: ProjectionContext,
): Result<ExpressionProjection> => {
  const declaration = projectDeclaration(expression.symbol, context);
  if (!declaration.ok) return declaration;
  const unsupportedCall = expression.calls.find(transformedReferenceCall);
  if (declaration.value.changed && unsupportedCall !== undefined)
    return unsupportedTransformComposition(`reference method ${unsupportedCall.method}`);

  const calls = projectCalls(expression.calls, context);
  if (!calls.ok) return calls;
  return ok({
    changed: declaration.value.changed || calls.value.changed,
    decodedSchema: sourceReference(
      expression.symbol,
      declaration.value.changed,
      calls.value.decodedCalls,
    ),
    schema: sourceReference(expression.symbol, false, calls.value.schemaCalls),
  });
};

const projectExpression = (
  expression: ZodExpression,
  context: ProjectionContext,
): Result<ExpressionProjection> => {
  switch (expression.kind) {
    case "factory": {
      return projectFactoryExpression(expression, context);
    }
    case "reference": {
      return projectReferenceExpression(expression, context);
    }
    default: {
      return assertNever(expression);
    }
  }
};

export const applyZodEmissionTransforms = (
  module: ZodEmissionModule,
  transforms: readonly ZodEmissionTransform[],
): Result<SourceEmissionModule> => {
  const declarations = new Map(
    module.declarations.map((declaration) => [declaration.symbol, declaration]),
  );
  const context: ProjectionContext = {
    declarations,
    declarationProjections: new Map(),
    decodedKey: decodedKeyFunction(transforms),
    projectExpression,
  };
  const projectedDeclarations: SourceDeclaration[] = [];

  for (const declaration of module.declarations) {
    const projection = projectDeclaration(declaration.symbol, context);
    if (!projection.ok) return projection;
    projectedDeclarations.push({
      expression: projection.value.schema,
      nameHints: declaration.nameHints,
      symbol: declaration.symbol,
    });
  }

  return ok({ declarations: projectedDeclarations, root: module.root });
};
