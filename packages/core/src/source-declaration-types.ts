import { SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  PropertyName,
  Statement,
  TypeElement,
  TypeNode,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayTypeNode,
  createIdentifier,
  createQualifiedName,
  createIntersectionTypeNode,
  createKeywordExpression,
  createKeywordTypeNode,
  createLiteralTypeNode,
  createNumericLiteral,
  createOptionalTypeNode,
  createPropertySignatureDeclaration,
  createStringLiteral,
  createToken,
  createTupleTypeNode,
  createTypeAliasDeclaration,
  createTypeLiteralNode,
  createTypeQueryNode,
  createTypeReferenceNode,
  createUnionTypeNode,
} from "@typescript/native-preview/unstable/ast/factory";

import { createSourceZodType as zodType } from "./source-ast";
import { optionalExpression } from "./source-expression-optionality";
import type {
  SourceArgument,
  SourceEmissionModule,
  SourceExpression,
  SourceFactoryExpression,
  SourceMethodCall,
  SourceReferenceExpression,
} from "./source-model";
import type { TypeScriptIdentifierAllocator } from "./typescript-identifiers";
import { isTypeScriptIdentifier } from "./typescript-identifiers";
import type { ZodLiteralValue, ZodSymbol } from "./zod-plan";

const noTokenFlags = 0;

type TypeProjection = "input" | "output";

export type DeclarationTypeNames = Readonly<{ input: string; output: string; schema: string }>;

type DeclarationTypes = Readonly<{
  names: ReadonlyMap<ZodSymbol, DeclarationTypeNames>;
  statements: readonly Statement[];
}>;

type ValueTypeContext = Readonly<{
  declarations: ReadonlyMap<ZodSymbol, SourceExpression>;
  declarationNames: ReadonlyMap<ZodSymbol, DeclarationTypeNames>;
  schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}>;

type ValueTypeRequest = Readonly<{
  context: ValueTypeContext;
  expression: SourceExpression;
  projection: TypeProjection;
}>;

type FactoryValueTypeRequest = Readonly<{
  context: ValueTypeContext;
  expression: SourceFactoryExpression;
  projection: TypeProjection;
}>;

type ValueTypeProjector = (request: ValueTypeRequest) => TypeNode;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected source value type node: ${JSON.stringify(value)}`);
};

const namedType = (name: string): TypeNode => createTypeReferenceNode(createIdentifier(name));

const unionType = (types: readonly TypeNode[]): TypeNode =>
  types.length === 1 && types[0] !== undefined ? types[0] : createUnionTypeNode(types);

const literalKeywordKind = (
  value: boolean | null,
): SyntaxKind.FalseKeyword | SyntaxKind.NullKeyword | SyntaxKind.TrueKeyword => {
  if (value === null) return SyntaxKind.NullKeyword;
  return value ? SyntaxKind.TrueKeyword : SyntaxKind.FalseKeyword;
};

const literalType = (value: ZodLiteralValue): TypeNode => {
  if (typeof value === "string")
    return createLiteralTypeNode(createStringLiteral(value, noTokenFlags));
  if (typeof value === "number")
    return createLiteralTypeNode(createNumericLiteral(String(value), noTokenFlags));
  return createLiteralTypeNode(createKeywordExpression(literalKeywordKind(value)));
};

const propertyName = (key: string): PropertyName =>
  isTypeScriptIdentifier(key) ? createIdentifier(key) : createStringLiteral(key, noTokenFlags);

const expressionArgument = (argument: SourceArgument | undefined): SourceExpression | undefined =>
  argument?.kind === "expression" ? argument.expression : undefined;

const arrayElements = (argument: SourceArgument | undefined): readonly SourceArgument[] =>
  argument?.kind === "array" ? argument.elements : [];

const literalArguments = (argument: SourceArgument | undefined): readonly ZodLiteralValue[] =>
  arrayElements(argument).flatMap((element) => (element.kind === "literal" ? [element.value] : []));

const requiredKeys = (calls: readonly SourceMethodCall[]): ReadonlySet<string> =>
  new Set(
    calls.flatMap((call) =>
      call.method === "required"
        ? literalArguments(call.args[0]).flatMap((value) =>
            typeof value === "string" ? [value] : [],
          )
        : [],
    ),
  );

const applyValueCalls = (type: TypeNode, calls: readonly SourceMethodCall[]): TypeNode => {
  const variants = [type];
  if (calls.some((call) => call.method === "optional"))
    variants.push(createKeywordTypeNode(SyntaxKind.UndefinedKeyword));
  if (calls.some((call) => call.method === "nullable"))
    variants.push(createLiteralTypeNode(createKeywordExpression(SyntaxKind.NullKeyword)));
  return unionType(variants);
};

const referenceValueType = (
  expression: SourceReferenceExpression,
  projection: TypeProjection,
  context: ValueTypeContext,
): TypeNode => {
  const referencedProjection = expression.view === "schema" ? projection : expression.view;
  const declarationNames = context.declarationNames.get(expression.symbol);
  const base =
    declarationNames === undefined
      ? zodType(referencedProjection, [
          createTypeQueryNode(
            createIdentifier(context.schemaConstNames.get(expression.symbol) ?? expression.symbol),
          ),
        ])
      : namedType(declarationNames[referencedProjection]);
  return applyValueCalls(base, expression.calls);
};

const objectConfigValueType = (
  objectType: TypeNode,
  project: ValueTypeProjector,
  request: FactoryValueTypeRequest,
): TypeNode => {
  const { expression } = request;
  let additionalValue: TypeNode | undefined = undefined;
  for (const call of expression.calls)
    if (call.method === "strict") additionalValue = undefined;
    else if (call.method === "passthrough")
      additionalValue = createKeywordTypeNode(SyntaxKind.UnknownKeyword);
    else if (call.method === "catchall") {
      const catchall = expressionArgument(call.args[0]);
      if (catchall !== undefined) additionalValue = project({ ...request, expression: catchall });
    }
  return additionalValue === undefined
    ? objectType
    : createIntersectionTypeNode([
        objectType,
        createTypeReferenceNode(
          createQualifiedName(createIdentifier("globalThis"), createIdentifier("Record")),
          [createKeywordTypeNode(SyntaxKind.StringKeyword), additionalValue],
        ),
      ]);
};

const objectValueType = (
  project: ValueTypeProjector,
  request: FactoryValueTypeRequest,
): TypeNode => {
  const { expression } = request;
  const [shape] = expression.args;
  const properties = shape?.kind === "object" ? shape.properties : [];
  const required = requiredKeys(expression.calls);
  const members: TypeElement[] = properties.map((property) => {
    const optional =
      optionalExpression({ ...request, expression: property.expression }) &&
      !required.has(property.key);
    const type = project({ ...request, expression: property.expression });
    return createPropertySignatureDeclaration(
      undefined,
      propertyName(property.key),
      optional ? createToken(SyntaxKind.QuestionToken) : undefined,
      required.has(property.key)
        ? createTypeReferenceNode(
            createQualifiedName(createIdentifier("globalThis"), createIdentifier("Exclude")),
            [type, createKeywordTypeNode(SyntaxKind.UndefinedKeyword)],
          )
        : type,
      createIdentifier("undefined"),
    );
  });
  const configured = objectConfigValueType(createTypeLiteralNode(members), project, request);
  return applyValueCalls(configured, expression.calls);
};

const tupleValueType = (
  request: FactoryValueTypeRequest,
  project: ValueTypeProjector,
): TypeNode => {
  const items = arrayElements(request.expression.args[0]);
  let optionalStart = items.length;
  while (optionalStart > 0) {
    const child = expressionArgument(items[optionalStart - 1]);
    if (child === undefined || !optionalExpression({ ...request, expression: child })) break;
    optionalStart -= 1;
  }
  return createTupleTypeNode(
    items.map((argument, index) => {
      const child = expressionArgument(argument);
      const type =
        child === undefined
          ? createKeywordTypeNode(SyntaxKind.UnknownKeyword)
          : project({ ...request, expression: child });
      return index >= optionalStart ? createOptionalTypeNode(type) : type;
    }),
  );
};

const factoryValueType = (
  request: FactoryValueTypeRequest,
  project: ValueTypeProjector,
): TypeNode => {
  const { expression } = request;
  const nested = (argument: SourceArgument | undefined): TypeNode => {
    const child = expressionArgument(argument);
    return child === undefined
      ? createKeywordTypeNode(SyntaxKind.UnknownKeyword)
      : project({ ...request, expression: child });
  };
  const applyCalls = (type: TypeNode): TypeNode => applyValueCalls(type, expression.calls);
  switch (expression.factory) {
    case "array": {
      return applyCalls(createArrayTypeNode(nested(expression.args[0])));
    }
    case "boolean": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.BooleanKeyword));
    }
    case "enum": {
      return applyCalls(
        unionType(literalArguments(expression.args[0]).map((value) => literalType(value))),
      );
    }
    case "intersection": {
      return applyCalls(
        createIntersectionTypeNode([nested(expression.args[0]), nested(expression.args[1])]),
      );
    }
    case "literal": {
      const [argument] = expression.args;
      return applyCalls(
        argument?.kind === "literal"
          ? literalType(argument.value)
          : createKeywordTypeNode(SyntaxKind.UnknownKeyword),
      );
    }
    case "never": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.NeverKeyword));
    }
    case "null": {
      return applyCalls(createLiteralTypeNode(createKeywordExpression(SyntaxKind.NullKeyword)));
    }
    case "number": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.NumberKeyword));
    }
    case "object": {
      return objectValueType(project, request);
    }
    case "record": {
      return applyCalls(
        createTypeReferenceNode(
          createQualifiedName(createIdentifier("globalThis"), createIdentifier("Record")),
          [nested(expression.args[0]), nested(expression.args[1])],
        ),
      );
    }
    case "string": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.StringKeyword));
    }
    case "tuple": {
      return applyCalls(tupleValueType(request, project));
    }
    case "union": {
      return applyCalls(
        unionType(arrayElements(expression.args[0]).map((argument) => nested(argument))),
      );
    }
    case "unknown": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.UnknownKeyword));
    }
    case "xor": {
      return applyCalls(
        unionType(arrayElements(expression.args[0]).map((argument) => nested(argument))),
      );
    }
    default: {
      return assertNever(expression.factory);
    }
  }
};

const valueType: ValueTypeProjector = (request) => {
  const { context, expression, projection } = request;
  switch (expression.kind) {
    case "codec": {
      const projectedExpression = projection === "input" ? expression.input : expression.output;
      return applyValueCalls(
        valueType({ ...request, expression: projectedExpression }),
        expression.calls,
      );
    }
    case "factory": {
      return factoryValueType({ ...request, expression }, valueType);
    }
    case "reference": {
      return referenceValueType(expression, projection, context);
    }
    case "runtime-guard": {
      const projected = expression.parseStructural ? projection : "output";
      return applyValueCalls(
        valueType({ ...request, expression: expression.expression, projection: projected }),
        expression.calls,
      );
    }
    case "wrapper": {
      return applyValueCalls(
        valueType({
          ...request,
          expression: expression.expression,
          projection: expression.parseStructural ? projection : "input",
        }),
        expression.calls,
      );
    }
    default: {
      return assertNever(expression);
    }
  }
};

const canNameCustomSchema = (expression: SourceExpression): boolean =>
  (expression.kind === "wrapper" || expression.kind === "runtime-guard") &&
  !expression.parseStructural &&
  expression.calls.every((call) => call.method === "describe");

const declarationSchemaType = (
  expression: SourceExpression,
  names: DeclarationTypeNames,
  context: ValueTypeContext,
): TypeNode => {
  const schemaType =
    expression.kind === "codec"
      ? zodType("ZodCodec", [
          zodType("ZodType", [
            createKeywordTypeNode(SyntaxKind.UnknownKeyword),
            namedType(names.input),
          ]),
          zodType("ZodType", [namedType(names.output), namedType(names.output)]),
        ])
      : zodType(canNameCustomSchema(expression) ? "ZodCustom" : "ZodType", [
          namedType(names.output),
          namedType(names.input),
        ]);
  const optionalMarkers = (["input", "output"] as const).flatMap((projection) =>
    optionalExpression({ context, expression, projection })
      ? [
          createPropertySignatureDeclaration(
            undefined,
            createIdentifier(projection === "input" ? "optin" : "optout"),
            undefined,
            literalType("optional"),
            createIdentifier("undefined"),
          ),
        ]
      : [],
  );
  return optionalMarkers.length === 0
    ? schemaType
    : createIntersectionTypeNode([
        schemaType,
        createTypeLiteralNode([
          createPropertySignatureDeclaration(
            undefined,
            createIdentifier("_zod"),
            undefined,
            createTypeLiteralNode(optionalMarkers),
            createIdentifier("undefined"),
          ),
        ]),
      ]);
};

export const createDeclarationTypes = (input: {
  readonly allocator: TypeScriptIdentifierAllocator;
  readonly cyclicSymbols: ReadonlySet<ZodSymbol>;
  readonly module: SourceEmissionModule;
  readonly schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}): DeclarationTypes => {
  const declarations = new Map(
    input.module.declarations.map((declaration) => [declaration.symbol, declaration.expression]),
  );
  // Preserve finite custom-schema boundaries as well as cycles: declaration serialization can
  // Otherwise inline private chains and silently elide deep types to any.
  const annotatedDeclarations = input.module.declarations
    .filter(
      (declaration) =>
        input.cyclicSymbols.has(declaration.symbol) ||
        (input.module.declarations.length > 1 && canNameCustomSchema(declaration.expression)),
    )
    .map((declaration) => {
      const schemaName = input.schemaConstNames.get(declaration.symbol) ?? declaration.symbol;
      return {
        symbol: declaration.symbol,
        expression: declaration.expression,
        names: {
          input: input.allocator.allocate(`${schemaName}Input`),
          output: input.allocator.allocate(`${schemaName}Output`),
          schema: input.allocator.allocate(
            `${schemaName}${input.cyclicSymbols.has(declaration.symbol) ? "RecursiveType" : "SchemaType"}`,
          ),
        },
      };
    });
  const names = new Map(
    annotatedDeclarations.map((declaration) => [declaration.symbol, declaration.names]),
  );
  const context: ValueTypeContext = {
    declarations,
    declarationNames: names,
    schemaConstNames: input.schemaConstNames,
  };
  const statements = annotatedDeclarations.flatMap((declaration) => [
    createTypeAliasDeclaration(
      [createToken(SyntaxKind.ExportKeyword)],
      createIdentifier(declaration.names.input),
      undefined,
      valueType({ context, expression: declaration.expression, projection: "input" }),
    ),
    createTypeAliasDeclaration(
      [createToken(SyntaxKind.ExportKeyword)],
      createIdentifier(declaration.names.output),
      undefined,
      valueType({ context, expression: declaration.expression, projection: "output" }),
    ),
    createTypeAliasDeclaration(
      [createToken(SyntaxKind.ExportKeyword)],
      createIdentifier(declaration.names.schema),
      undefined,
      declarationSchemaType(declaration.expression, declaration.names, context),
    ),
  ]);
  return { names, statements };
};

export const declarationSchemaAnnotation = (
  symbol: ZodSymbol,
  names: ReadonlyMap<ZodSymbol, DeclarationTypeNames>,
): TypeNode | undefined => {
  const declarationNames = names.get(symbol);
  return declarationNames === undefined ? undefined : namedType(declarationNames.schema);
};

export const declarationReferenceAnnotation = (
  expression: SourceReferenceExpression,
  names: ReadonlyMap<ZodSymbol, DeclarationTypeNames>,
): TypeNode | undefined => {
  const declarationNames = names.get(expression.symbol);
  if (declarationNames === undefined) return undefined;
  if (expression.view === "schema") return namedType(declarationNames.schema);
  const projectedName = declarationNames[expression.view];
  return zodType("ZodType", [namedType(projectedName), namedType(projectedName)]);
};
